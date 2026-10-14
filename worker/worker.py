"""Mac/CPU worker with durable local checkpoints and resumable network delivery."""
import json,os,pathlib,re,shutil,subprocess,sys,threading,time
import requests,soundfile as sf
def parse_progress(line):
    match=re.search(r'(\d+)%.*?\[[^<\]]*<([^,\]]+),[^\]]*(?:seconds/s|s/seconds|frames/s|s/frames)',line)
    if not match:return None
    pieces=match.group(2).strip().split(':')
    try:
        seconds=0
        for piece in pieces:seconds=seconds*60+float(piece)
        return int(match.group(1)),seconds
    except ValueError:return int(match.group(1)),None

CATEGORIES=('vocals','drums','bass','other')
class NetworkUnavailable(Exception):pass
class ConnectionRejected(Exception):pass
class JobUnavailable(Exception):pass
class Worker:
    def __init__(self):
        self.base=os.environ['BANDROOM_URL'].rstrip('/')+'/api/band/processing'
        self.headers={'Authorization':'Bearer '+os.environ.get('WORKER_SECRET',os.environ.get('BACKGROUND_SECRET',''))}
        if os.getenv('SITES_SERVICE_TOKEN'):self.headers['OAI-Sites-Authorization']='Bearer '+os.environ['SITES_SERVICE_TOKEN']
        self.http=requests.Session();self.active={};self.progress={};self.network_interrupted=False;self.cache=pathlib.Path(os.getenv('BANDROOM_CACHE',str(pathlib.Path(__file__).resolve().parent/'.bandroom-cache')))
        self.cache.mkdir(parents=True,exist_ok=True);self.cache.chmod(0o700)
    def call(self,method,path,lease=None,**kw):
        data=kw.get('data');start=data.tell() if hasattr(data,'tell') else None
        for attempt in range(5):
            if start is not None:data.seek(start)
            try:
                r=self.http.request(method,self.base+path,headers={**self.headers,**({'x-job-lease':lease} if lease else {})},timeout=(15,300),allow_redirects=False,**kw)
                if r.status_code in (401,403) or 300<=r.status_code<400:raise ConnectionRejected('Connection credentials were rejected. Refresh worker-config.json and restart.')
                if r.status_code>=500 or r.status_code==429:r.close();raise requests.ConnectionError('Server temporarily unavailable')
                if r.status_code in (404,409,410):raise JobUnavailable(r.status_code)
                r.raise_for_status();self.network_interrupted=False;return r
            except (requests.ConnectionError,requests.Timeout) as e:
                self.network_interrupted=True;delay=min(30,2**attempt)
                print(f'Bndrm connection interrupted ({type(e).__name__}). Finished files are retained. Retrying in {delay}s.',flush=True)
                if attempt==4:raise NetworkUnavailable() from e
                time.sleep(delay)
    def set_progress(self,stage,percent=None,eta=None):
        self.progress={'stage':stage,'percent':percent,'etaSeconds':eta,'startedAt':self.progress.get('startedAt',int(time.time()*1000)),'measuredAt':time.monotonic()}
    def progress_snapshot(self):
        snapshot=self.progress.copy();measured=snapshot.pop('measuredAt',time.monotonic())
        if snapshot.get('etaSeconds') is not None:snapshot['etaSeconds']=max(0,snapshot['etaSeconds']-(time.monotonic()-measured))
        return snapshot
    def command(self,command,stage):
        self.set_progress(stage,0)
        process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
        def consume():
            line=''
            for char in iter(lambda:process.stdout.read(1),''):
                sys.stdout.write(char)
                if char in '\r\n':
                    sys.stdout.flush()
                    if 'BANDROOM_STAGE:' in line:self.set_progress(line.split('BANDROOM_STAGE:')[-1].strip())
                    else:
                        parsed=parse_progress(line)
                        if parsed:self.set_progress(self.progress.get('stage',stage),*parsed)
                    line=''
                else:line+=char
        reader=threading.Thread(target=consume,daemon=True);reader.start()
        try:code=process.wait(timeout=3300)
        except subprocess.TimeoutExpired:process.kill();process.wait();raise
        finally:reader.join(timeout=10);process.stdout.close()
        if code:raise subprocess.CalledProcessError(code,command)
    def folder(self,job):
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',job['id']):raise ValueError('Invalid job identifier')
        root=self.cache/job['id'];root.mkdir(exist_ok=True);return root
    def record(self,root,job,limits):
        file=root/'job.json';temp=root/'job.json.tmp';temp.write_text(json.dumps({'job':job,'limits':limits}));temp.chmod(0o600);temp.replace(file)
    def prepare(self,job,limits,root):
        source=root/('original'+pathlib.Path(job['filename']).suffix.lower());stemdir=root/'out'/'htdemucs'/source.stem
        if not source.exists():
            self.set_progress('downloading',0);print('Downloading '+job['filename'],flush=True)
            partial=root/'download.part'
            with self.call('GET','/'+job['id']+'/original',lease=job['lease'],stream=True) as response,partial.open('wb') as f:
                total=int(response.headers.get('Content-Length') or job.get('bytes') or 0);received=0;began=time.monotonic()
                for block in response.iter_content(1024*1024):
                    f.write(block);received+=len(block);elapsed=time.monotonic()-began
                    self.set_progress('downloading',100*received/total if total else None,(total-received)*elapsed/received if total and received else None)
            partial.replace(source)
        actual=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(source)],text=True).strip())
        if actual<=0 or actual>limits['seconds']:raise ValueError('Recording exceeds configured duration limit')
        complete=root/'separated.done'
        if not complete.exists() or not all((stemdir/(c+'.wav')).exists() for c in CATEGORIES):
            print('Separating instruments. Results will be kept locally until Bndrm confirms saving.',flush=True)
            self.command([sys.executable,'-m','demucs','--int24','-n','htdemucs','-d','cpu','-j','1','-o',str(root/'out'),str(source)],'separating')
            for category in CATEGORIES:
                if abs(sf.info(stemdir/(category+'.wav')).duration-actual)>.1:raise ValueError('Separated stem duration mismatch')
            complete.write_text('complete')
        analysis=root/'analysis.json'
        try:json.loads(analysis.read_text())
        except (OSError,ValueError):
            print('Detecting timing, lyrics and chords.',flush=True)
            temp=root/'analysis.tmp.json'
            self.set_progress('lyrics');print('Looking up online lyrics before audio transcription.',flush=True)
            online={}
            try:online=self.call('GET','/'+job['id']+'/lyrics',lease=job['lease']).json()
            except JobUnavailable:pass
            online_path=root/'online-lyrics.json';online_path.write_text(json.dumps(online))
            self.command([sys.executable,str(pathlib.Path(__file__).resolve().parent/'analyze.py'),str(source),str(stemdir),str(temp),'--online-lyrics',str(online_path)],'beats')
            json.loads(temp.read_text());temp.replace(analysis)
        return stemdir,json.loads(analysis.read_text())
    def deliver(self,job,root,stemdir,analysis):
        # Re-send all four deterministic outputs after a lease recovery. The server
        # replaces the same category record, so retries cannot duplicate stems.
        self.set_progress('uploading',0);upload_began=time.monotonic();total_bytes=sum((stemdir/(c+'.wav')).stat().st_size for c in CATEGORIES);completed_bytes=0
        for i,category in enumerate(CATEGORIES,1):
            path=stemdir/(category+'.wav');info=sf.info(path)
            print(f'Uploading {category} ({i}/4). Local results remain safe if the connection drops.',flush=True)
            owner=self;size=path.stat().st_size
            with path.open('rb') as audio:
                class ReportingFile:
                    def __getattr__(self,name):return getattr(audio,name)
                    def read(self,n=-1):
                        data=audio.read(n);sent=completed_bytes+audio.tell();elapsed=time.monotonic()-upload_began
                        owner.set_progress('uploading',100*sent/max(1,total_bytes),(total_bytes-sent)*elapsed/sent if sent else None)
                        return data
                self.call('PUT','/'+job['id']+'/result',lease=job['lease'],params={'category':category,'duration':info.duration,'sampleRate':info.samplerate},data=ReportingFile()).close()
            completed_bytes+=size;self.set_progress('uploading',100*completed_bytes/max(1,total_bytes),(total_bytes-completed_bytes)*(time.monotonic()-upload_began)/completed_bytes)
        self.set_progress('saving');self.call('POST','/'+job['id']+'/finish',lease=job['lease'],json={'analysis':analysis}).close()
        print('Saved to Bndrm: '+job['filename']+'. Stems, timing and charts are ready for review.',flush=True)
        shutil.rmtree(root)
    def process(self,job,limits):
        self.progress={};self.active=job.copy();self.set_progress('downloading');root=self.folder(job);self.record(root,job,limits)
        try:
            stems,analysis=self.prepare(job,limits,root);self.deliver(job,root,stems,analysis)
        except (NetworkUnavailable,ConnectionRejected,JobUnavailable,requests.ConnectionError,requests.Timeout):raise
        except Exception as e:
            print('Audio processing failed: '+type(e).__name__+'. Results retained at '+str(root),flush=True)
            self.call('POST','/'+job['id']+'/finish',lease=job['lease'],json={'error':'Audio processing failed: '+type(e).__name__}).close()
            (root/'paused').write_text('Use Retry in Bndrm')
        finally:self.active={}
    def pending(self):
        for file in sorted(self.cache.glob('*/job.json')):
            if (file.parent/'paused').exists():continue
            saved=json.loads(file.read_text());job=saved['job']
            try:response=self.call('POST','/'+job['id']+'/resume',lease=job.get('lease'),json={}).json()
            except JobUnavailable as e:
                if e.args[0] in (404,410):shutil.rmtree(file.parent);continue
                raise
            if response.get('completed') or response.get('deleted'):shutil.rmtree(file.parent);continue
            if response.get('failed'):(file.parent/'paused').write_text('Use Retry in Bndrm');print('A saved job needs Retry in the song editor.',flush=True);continue
            return response['job'],saved['limits']
        return None
    def heartbeat(self):
        last_heartbeat=0
        while True:
            active=self.active.copy()
            headers={**self.headers,**({'x-job-lease':active['lease']} if active else {})}
            try:
                if time.monotonic()-last_heartbeat>=30:
                    response=requests.get(self.base+'/heartbeat',headers=headers,params={'job':active['id']} if active else {},timeout=(10,15),allow_redirects=False);response.close();last_heartbeat=time.monotonic()
                if active and self.progress:
                    response=requests.post(self.base+'/'+active['id']+'/progress',headers=headers,json={**self.progress_snapshot(),'connectionLost':getattr(self,'network_interrupted',False)},timeout=(10,10),allow_redirects=False);response.close()
            except requests.RequestException:pass
            time.sleep(3)
    def run(self):
        threading.Thread(target=self.heartbeat,daemon=True).start();print('Mac processor running. Waiting for Bndrm uploads. Ctrl+C stops it.',flush=True)
        while True:
            try:
                pending=self.pending()
                if pending:job,limits=pending
                else:
                    response=self.call('GET','/queue').json();job=response['job'];limits=response.get('limits')
                    if not job:time.sleep(15);continue
                self.process(job,limits)
            except ConnectionRejected as e:print(str(e),flush=True);return
            except (NetworkUnavailable,JobUnavailable):time.sleep(15)
            except requests.RequestException as e:print('Bndrm request failed ('+type(e).__name__+'). Cached files retained. Retrying.',flush=True);time.sleep(15)
            except (ValueError,KeyError):print('Unexpected server response. Check the connection file and app sign-in access.',flush=True);time.sleep(30)
if __name__=='__main__':Worker().run()
