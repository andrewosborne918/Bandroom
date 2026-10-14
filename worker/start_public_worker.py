"""Reads the owner-downloaded connection without exposing credentials in shell arguments."""
import json,os,pathlib,runpy,sys
root=pathlib.Path(__file__).resolve().parent
config=root/'public-worker-config.json'
if not config.exists():
    print('Download the Mac connection in Bndrm administration, then put public-worker-config.json in this Bndrm folder.')
    sys.exit(1)
config.chmod(0o600)
data=json.loads(config.read_text())
os.environ['BANDROOM_URL']=data['url']
os.environ['WORKER_SECRET']=data['secret']
os.environ.pop('SITES_SERVICE_TOKEN',None)
os.environ['BANDROOM_CACHE']=str(root/'.bandroom-public-cache')
sys.path.insert(0,str(root))
runpy.run_path(str(root/'cloud_worker.py'),run_name='__main__')
