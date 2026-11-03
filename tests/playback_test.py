import array,hashlib,json,math,pathlib,shutil,struct,subprocess,sys,tempfile,unittest,wave
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'worker'))
from playback import build_playback
@unittest.skipUnless(shutil.which('ffmpeg'),'Codec integration runs in the native installer smoke test when FFmpeg is not installed')
class PlaybackTests(unittest.TestCase):
    def test_real_codec_preserves_original_and_packs_exact_frames(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder);source=root/'source.wav';target=root/'playback.bna';rate=44100;frames=int(rate*4.25)
            samples=array.array('h')
            for i in range(frames):samples.extend([int(8000*math.sin(i*2*math.pi*330/rate))]*2)
            with wave.open(str(source),'wb') as out:out.setparams((2,2,rate,0,'NONE','PCM'));out.writeframes(samples.tobytes())
            checksum=hashlib.sha256(source.read_bytes()).hexdigest();meta=build_playback(source,target);raw=target.read_bytes();length=struct.unpack('<I',raw[4:8])[0]
            self.assertEqual(raw[:4],b'BNA1');self.assertEqual(meta,json.loads(raw[8:8+length]));self.assertEqual(meta['frames'],frames);self.assertEqual([s['frames'] for s in meta['segments']],[rate*4,rate//4]);self.assertEqual(sum(s['bytes'] for s in meta['segments'])+length+8,len(raw));self.assertLess(len(raw),source.stat().st_size/3);self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),checksum)
            position=length+8
            for index,segment in enumerate(meta['segments']):
                encoded=root/f'{index}.m4a';encoded.write_bytes(raw[position:position+segment['bytes']]);position+=segment['bytes'];decoded=subprocess.check_output(['ffmpeg','-v','error','-i',str(encoded),'-f','s16le','-'])
                self.assertGreaterEqual(len(decoded)//4,segment['frames']);self.assertLess(len(decoded)//4-segment['frames'],1024)
if __name__=='__main__':unittest.main()
