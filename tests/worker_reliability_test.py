import importlib.util,io,json,pathlib,tempfile,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('band_worker',ROOT/'worker'/'worker.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class Response:
    status_code=200
    def close(self):pass
    def raise_for_status(self):pass
class Reliability(unittest.TestCase):
    def make_worker(self):
        worker=module.Worker.__new__(module.Worker);worker.base='https://test/api';worker.headers={};return worker
    def test_streamed_upload_rewinds_after_lost_connection(self):
        worker=self.make_worker();seen=[]
        class Session:
            def request(self,*args,**kwargs):
                seen.append(kwargs['data'].read())
                if len(seen)==1:raise module.requests.ConnectionError('lost connection')
                return Response()
        worker.http=Session()
        with patch.object(module.time,'sleep'):worker.call('PUT','/job/result',data=io.BytesIO(b'full wav file'))
        self.assertEqual(seen,[b'full wav file',b'full wav file'])
    def test_results_survive_network_failure_and_are_reused(self):
        worker=self.make_worker();worker.active={}
        with tempfile.TemporaryDirectory() as tmp:
            worker.cache=pathlib.Path(tmp);job={'id':'test-job','filename':'song.mp3','lease':'lease'};limits={'seconds':1200}
            def prepare(j,l,r):
                (r/'analysis.json').write_text('{}');(r/'drums.wav').write_bytes(b'completed audio');return r,{}
            worker.prepare=prepare;worker.deliver=lambda *args:(_ for _ in ()).throw(module.NetworkUnavailable())
            with self.assertRaises(module.NetworkUnavailable):worker.process(job,limits)
            root=worker.cache/'test-job';self.assertTrue((root/'drums.wav').exists());self.assertEqual(json.loads((root/'job.json').read_text())['job']['id'],'test-job');self.assertEqual(worker.active,{})
    def test_authentication_failure_is_actionable_and_not_retried(self):
        worker=self.make_worker()
        class Session:
            def request(self,*args,**kwargs):
                response=Response();response.status_code=403;return response
        worker.http=Session()
        with self.assertRaisesRegex(module.ConnectionRejected,'Refresh worker-config.json'):worker.call('GET','/queue')
    def test_model_progress_parses_real_terminal_counters(self):
        self.assertEqual(module.parse_progress('15%|...| 35.09/228.14 [00:13<01:13, 2.63seconds/s]'),(15,73))
        self.assertEqual(module.parse_progress('81%|...| 26468/32680 [00:06<00:01, 4359.18frames/s]'),(81,1))
        self.assertIsNone(module.parse_progress('Downloading model weights'))
    def test_heartbeat_does_not_restart_stage_eta(self):
        worker=self.make_worker();worker.progress={}
        with patch.object(module.time,'monotonic',return_value=100):worker.set_progress('separating',15,73)
        with patch.object(module.time,'monotonic',return_value=110):snapshot=worker.progress_snapshot()
        self.assertEqual(snapshot['etaSeconds'],63);self.assertNotIn('measuredAt',snapshot)
    def test_subprocess_output_updates_stage_and_actual_progress(self):
        worker=self.make_worker();worker.progress={}
        worker.command([module.sys.executable,'-c','print("BANDROOM_STAGE:lyrics"); print("81%|...| 26468/32680 [00:06<00:01, 4359.18frames/s]")'],'beats')
        self.assertEqual(worker.progress['stage'],'lyrics');self.assertEqual(worker.progress['percent'],81)
if __name__=='__main__':unittest.main()
