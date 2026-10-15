"""Frozen entry point. Credentials arrive over stdin and never appear in argv."""
import json,os,pathlib,runpy,signal,sys

def main():
    configure_binaries()
    if len(sys.argv)>1 and sys.argv[1] in ('--demucs','--analyze'):
        module='demucs' if sys.argv[1]=='--demucs' else 'analyze'
        sys.argv=[module,*sys.argv[2:]]
        runpy.run_module(module,run_name='__main__');return
    if len(sys.argv)>1 and sys.argv[1]=='--self-test':
        import torch,torchaudio,librosa,whisper,soundfile,subprocess
        for binary in ('ffmpeg','ffprobe'):subprocess.check_call([binary,'-version'],stdout=subprocess.DEVNULL)
        import demucs.separate,analyze
        print(json.dumps({'stage':'idle','message':'Bundled Python, Demucs, Whisper and FFmpeg passed startup checks.'}),flush=True);return
    config=json.loads(sys.stdin.readline())
    if config.get('url')!='https://bndrm.vercel.app' or len(config.get('secret',''))!=64:raise ValueError('Invalid desktop connection')
    os.environ.update(BANDROOM_URL=config['url'],WORKER_SECRET=config['secret'],BANDROOM_CACHE=config['cache'],TORCH_HOME=str(pathlib.Path(config['models'])/'torch'),XDG_CACHE_HOME=config['models'],NUMBA_CACHE_DIR=str(pathlib.Path(config['models'])/'numba'),OMP_NUM_THREADS=str(max(1,min(4,os.cpu_count() or 1))))
    os.environ.pop('SITES_SERVICE_TOKEN',None)
    from cloud_worker import PublicWorker
    class DesktopWorker(PublicWorker):
        def set_progress(self,stage,percent=None,eta=None):
            super().set_progress(stage,percent,eta)
            print(json.dumps({'stage':stage,'percent':percent,'etaSeconds':eta,'filename':self.active.get('filename','')}),flush=True)
        def process(self,job,limits):
            super().process(job,limits)
            print(json.dumps({'stage':'idle','message':'Ready for your band’s next upload.'}),flush=True)
    worker=DesktopWorker()
    def stop(*_):
        child=getattr(worker,'_child',None)
        if child and child.poll() is None:child.terminate()
        raise SystemExit(0)
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    print(json.dumps({'stage':'models','message':'Checking AI models. First launch downloads about 220 MB; keep this window open.'}),flush=True)
    # Confirm the connection before downloading models, which also detects revocation.
    worker.call('GET','/heartbeat').close()
    import threading
    worker._heartbeat_started=True
    threading.Thread(target=worker.heartbeat,daemon=True).start()
    from demucs.pretrained import get_model
    get_model('htdemucs')
    import whisper
    whisper.load_model('base',device='cpu')
    print(json.dumps({'stage':'idle','message':'Ready. Drop a song into the Bndrm library.'}),flush=True)
    worker.run()

def configure_binaries():
    if getattr(sys,'frozen',False):
        bundled=pathlib.Path(sys._MEIPASS)/'ffmpeg'
        os.environ['PATH']=str(bundled)+os.pathsep+os.environ.get('PATH','')

if __name__=='__main__':
    import multiprocessing
    multiprocessing.freeze_support()
    main()
