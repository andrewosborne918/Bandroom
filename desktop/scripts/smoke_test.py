"""Exercise the frozen executable, actual Demucs inference and analysis on synthetic audio."""
import json,os,pathlib,subprocess,sys,tempfile
import numpy as np,soundfile as sf
exe=pathlib.Path(sys.argv[1]).resolve()
env={**os.environ,'PATH':str(exe.parent/'_internal'/'ffmpeg')+os.pathsep+os.defpath}
with tempfile.TemporaryDirectory() as folder:
 root=pathlib.Path(folder);sr=44100;duration=12;t=np.arange(sr*duration)/sr
 # Tonal backing plus a clear half-second pulse. Test data contains no private recording.
 y=.08*np.sin(2*np.pi*220*t)+.05*np.sin(2*np.pi*330*t)
 rng=np.random.default_rng(7)
 for beat in np.arange(0,duration,.5):
  i=int(beat*sr);n=min(int(.04*sr),len(y)-i);y[i:i+n]+=.35*rng.normal(size=n)*np.exp(-np.arange(n)/(sr*.008))
 source=root/'test.wav';sf.write(source,np.column_stack([y,y]),sr)
 # Regression: valid MP3 files with embedded cover art must need no video tools.
 import lameenc,io
 from PIL import Image
 encoder=lameenc.Encoder();encoder.set_bit_rate(128);encoder.set_in_sample_rate(sr);encoder.set_channels(2)
 pcm=(np.column_stack([y,y])*32767).astype(np.int16).tobytes()
 mp3=encoder.encode(pcm)+encoder.flush()
 cover=io.BytesIO();Image.new('RGB',(8,8),(20,80,60)).save(cover,format='JPEG')
 apic=b'\x00image/jpeg\x00\x03\x00'+cover.getvalue()
 frame=b'APIC'+len(apic).to_bytes(4,'big')+b'\x00\x00'+apic
 length=len(frame);tag_size=bytes([(length>>21)&127,(length>>14)&127,(length>>7)&127,length&127])
 with_art=root/'artwork.mp3';with_art.write_bytes(b'ID3\x03\x00\x00'+tag_size+frame+mp3)
 checked=json.loads(subprocess.check_output([str(exe),'--verify-audio',str(with_art)],text=True,timeout=60,env=env))
 assert abs(checked['duration']-duration)<.2 and checked['sampleRate']==sr and checked['bytes']==with_art.stat().st_size
 invalid=root/'not-audio.mp3';invalid.write_bytes(cover.getvalue())
 rejected=subprocess.run([str(exe),'--verify-audio',str(invalid)],capture_output=True,text=True,timeout=60,env=env)
 assert rejected.returncode!=0,'Artwork without audio must not pass verification'
 print('Frozen verifier accepted MP3 artwork and rejected a file without audio.')
 subprocess.run([str(exe),'--demucs','--int24','-n','htdemucs','-d','cpu','-j','1','-o',str(root/'out'),str(source)],check=True,timeout=600,env=env)
 stems=root/'out'/'htdemucs'/'test'
 for category in ('vocals','drums','bass','other'):
  info=sf.info(stems/(category+'.wav'));assert abs(info.duration-duration)<.01;assert info.samplerate==sr
 # Empty online lyrics exercises Whisper as well as chroma and beat analysis.
 online=root/'online.json';online.write_text('{}');result=root/'analysis.json'
 subprocess.run([str(exe),'--analyze',str(source),str(stems),str(result),'--online-lyrics',str(online)],check=True,timeout=600,env=env)
 analysis=json.loads(result.read_text());assert analysis['bpm']>0;assert analysis.get('beats')
 print('Frozen runtime passed actual four-stem separation, shared-duration and analysis checks.')
