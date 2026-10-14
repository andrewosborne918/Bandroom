"""Standalone Bndrm worker. Reuses Mac tools, progress and durable checkpoints."""
import json,os,pathlib,shutil,sys,time,uuid,zipfile
import requests,soundfile as sf
from worker import Worker,NetworkUnavailable,ConnectionRejected,JobUnavailable,CATEGORIES

class PublicWorker(Worker):
    def call(self,method,path,lease=None,**kw):
        kw['params']={**kw.get('params',{}),'kind':self.active.get('kind','separation')}
        return super().call(method,path,lease,**kw)
    def download(self,url,target):
        partial=target.with_suffix('.part')
        for attempt in range(5):
            try:
                with self.http.get(url,stream=True,timeout=(15,120)) as response,partial.open('wb') as audio:
                    response.raise_for_status();total=int(response.headers.get('Content-Length') or 0);received=0;started=time.monotonic()
                    for block in response.iter_content(1024*1024):
                        audio.write(block);received+=len(block);elapsed=time.monotonic()-started
                        self.set_progress('downloading',received*100/total if total else None,(total-received)*elapsed/received if received and total else None)
                partial.replace(target);return
            except (requests.ConnectionError,requests.Timeout):
                if attempt==4:raise NetworkUnavailable()
                time.sleep(min(30,2**attempt))
    def upload(self,url,path,content_type):
        for attempt in range(5):
            try:
                with path.open('rb') as audio:
                    response=self.http.put(url,data=audio,headers={'Content-Type':content_type},timeout=(15,300))
                    response.raise_for_status();return
            except (requests.ConnectionError,requests.Timeout):
                if attempt==4:raise NetworkUnavailable()
                time.sleep(min(30,2**attempt))
    def process(self,job,limits):
        self.active=job.copy();self.progress={};root=self.folder(job);self.record(root,job,limits);(root/'paused').unlink(missing_ok=True)
        try:
            if job['kind']=='export':
                archive=root/'stems.zip'
                if not archive.exists():
                    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_STORED) as z:
                        for stem in self.call('GET','/'+job['id']+'/inputs',job['lease']).json()['stems']:
                            filename=stem['filename'];audio=root/filename
                            if not audio.exists():self.download(stem['url'],audio)
                            z.write(audio,filename)
                signed=self.call('POST','/'+job['id']+'/output-url',job['lease'],json={'bytes':archive.stat().st_size}).json()
                self.upload(signed['signedUrl'],archive,'application/zip')
                self.call('POST','/'+job['id']+'/finish',job['lease'],json={'bytes':archive.stat().st_size})
            else:
                source=root/('original'+pathlib.Path(job['filename']).suffix.lower())
                if not source.exists():self.download(self.call('GET','/'+job['id']+'/input-url',job['lease']).json()['url'],source)
                if job['kind']=='verification':
                    self.command(['ffmpeg','-v','error','-i',str(source),'-f','null','-'],'beats')
                    import subprocess
                    meta=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','a:0','-show_entries','stream=sample_rate:format=duration','-of','json',str(source)],text=True))
                    self.call('POST','/'+job['id']+'/finish',job['lease'],json={'bytes':source.stat().st_size,'duration':float(meta['format']['duration']),'sampleRate':int(meta['streams'][0]['sample_rate'])})
                else:
                    stems,analysis=self.prepare(job,limits,root);outputs=[]
                    self.set_progress('uploading',0)
                    for index,category in enumerate(CATEGORIES):
                        path=stems/(category+'.wav');info=sf.info(path);asset_id=str(uuid.uuid5(uuid.UUID(job['id']),category))
                        signed=self.call('POST','/'+job['id']+'/output-url',job['lease'],json={'id':asset_id,'category':category,'bytes':path.stat().st_size}).json()
                        self.upload(signed['signedUrl'],path,'audio/wav')
                        outputs.append({'id':asset_id,'category':category,'filename':category+'.wav','object_key':signed['object_key'],'bytes':path.stat().st_size,'duration':info.duration,'sampleRate':info.samplerate})
                        self.set_progress('uploading',(index+1)*25)
                    self.set_progress('saving')
                    self.call('POST','/'+job['id']+'/finish',job['lease'],json={'stems':outputs,'analysis':analysis})
            print('Saved to Bndrm: '+job.get('filename',job['kind']),flush=True);shutil.rmtree(root)
        except (NetworkUnavailable,ConnectionRejected,JobUnavailable):raise
        except Exception as error:
            print('Processing failed: '+type(error).__name__+'. Local results retained.',flush=True)
            self.call('POST','/'+job['id']+'/finish',job['lease'],json={'error':'Audio processing failed: '+type(error).__name__})
            (root/'paused').write_text('Use Retry in Bndrm')
        finally:self.active={}
    def pending(self):
        for file in sorted(self.cache.glob('*/job.json')):
            if (file.parent/'paused').exists():continue
            saved=json.loads(file.read_text());job=saved['job'];self.active=job.copy()
            try:
                response=self.call('POST','/'+job['id']+'/resume',job['lease'],json={}).json()
                if response.get('completed'):shutil.rmtree(file.parent);continue
                if response.get('failed'):(file.parent/'paused').write_text('Use Retry in Bndrm');continue
                return job,saved['limits']
            except JobUnavailable:
                (file.parent/'paused').write_text('Job ended or was reassigned')
            finally:self.active={}
        return None
    def heartbeat(self):
        while True:
            active=self.active.copy()
            try:
                self.call('GET','/heartbeat',active.get('lease'),params={'job':active.get('id',''),'kind':active.get('kind','separation')}).close()
                if active.get('kind')=='separation' and self.progress:self.call('POST','/'+active['id']+'/progress',active['lease'],json=self.progress_snapshot()).close()
            except (requests.RequestException,NetworkUnavailable,ConnectionRejected,JobUnavailable):pass
            time.sleep(3)
    def run(self):
        import threading
        if not getattr(self,'_heartbeat_started',False):
            self._heartbeat_started=True
            threading.Thread(target=self.heartbeat,daemon=True).start()
        print('Standalone Bndrm processor connected. Waiting for uploads. Ctrl+C stops it.',flush=True)
        while True:
            try:
                pending=self.pending()
                if pending:job,limits=pending
                else:
                    response=self.call('GET','/queue').json();job=response.get('job')
                    if not job:time.sleep(10);continue
                    limits={'seconds':job.get('max_seconds',7200)}
                self.process(job,limits)
            except ConnectionRejected:
                print('Connection rejected. Check the public worker configuration and Vercel production protection.',flush=True);return
            except (NetworkUnavailable,JobUnavailable,requests.RequestException):
                print('Connection interrupted. Local results retained; retrying.',flush=True);time.sleep(10)

if __name__=='__main__':PublicWorker().run()
