import json,pathlib,tempfile,unittest,os,sys
from unittest.mock import patch
import requests,soundfile as sf,numpy as np
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'worker'))
from cloud_worker import PublicWorker
from worker import NetworkUnavailable,CATEGORIES
class Response:
    def __init__(self,data=None):self.data=data
    def json(self):return self.data
    def raise_for_status(self):pass
class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{'BANDROOM_URL':'https://bandroom.test','WORKER_SECRET':'private-queue-secret','BANDROOM_CACHE':self.temp.name},clear=False);self.env.start()
        self.worker=PublicWorker()
        self.job={'id':'00000000-0000-4000-8000-000000000001','kind':'separation','lease':'lease-a','filename':'mix.wav','max_seconds':1}
    def tearDown(self):self.env.stop();self.temp.cleanup()
    def test_delivery_keeps_shared_duration_and_four_deterministic_outputs(self):
        root=self.worker.folder(self.job);sf.write(root/'original.wav',np.zeros((44100,2)),44100)
        stems=root/'out';stems.mkdir()
        for category in CATEGORIES:sf.write(stems/(category+'.wav'),np.zeros((44100,2)),44100,subtype='PCM_24')
        uploads=[];finished=[]
        def call(method,path,lease=None,**kw):
            if path.endswith('/output-url'):return Response({'signedUrl':'https://storage.test/'+kw['json']['category'],'object_key':'bands/a/songs/s/'+kw['json']['id']+'/'+kw['json']['category']+'.wav'})
            if path.endswith('/finish'):finished.append(kw['json']);return Response({})
            raise AssertionError(path)
        self.worker.call=call;self.worker.prepare=lambda *args:(stems,{'bpm':120});self.worker.upload=lambda url,path,ct:uploads.append((url,sf.info(path).duration,ct))
        self.worker.process(self.job,{'seconds':1})
        self.assertEqual(len(uploads),4);self.assertTrue(all(x[1]==1 for x in uploads));self.assertEqual(len(set(s['id'] for s in finished[0]['stems'])),4);self.assertFalse(root.exists())
    def test_network_failure_retains_checkpoint_and_original(self):
        root=self.worker.folder(self.job);(root/'original.wav').write_bytes(b'cached input')
        self.worker.prepare=lambda *args:(_ for _ in ()).throw(NetworkUnavailable())
        with self.assertRaises(NetworkUnavailable):self.worker.process(self.job,{'seconds':1})
        self.assertTrue((root/'job.json').exists());self.assertEqual((root/'original.wav').read_bytes(),b'cached input');self.assertEqual(self.worker.active,{})
    def test_upload_retry_reopens_file_at_start(self):
        audio=pathlib.Path(self.temp.name)/'stem.wav';audio.write_bytes(b'whole audio');attempts=[]
        def put(url,data,**kw):
            attempts.append(data.read())
            if len(attempts)==1:raise requests.Timeout()
            return Response()
        self.worker.http.put=put
        with patch('cloud_worker.time.sleep'):self.worker.upload('https://storage.test/upload',audio,'audio/wav')
        self.assertEqual(attempts,[b'whole audio',b'whole audio'])
    def test_completed_resume_removes_confirmed_local_checkpoint(self):
        root=self.worker.folder(self.job);self.worker.record(root,self.job,{'seconds':1});self.worker.call=lambda *args,**kw:Response({'completed':True})
        self.assertIsNone(self.worker.pending());self.assertFalse(root.exists())
if __name__=='__main__':unittest.main()
