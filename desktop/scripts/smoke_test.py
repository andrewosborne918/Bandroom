"""Exercise the frozen executable, actual Demucs inference and analysis on synthetic audio."""
import json,pathlib,subprocess,sys,tempfile
import numpy as np,soundfile as sf
exe=pathlib.Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory() as folder:
 root=pathlib.Path(folder);sr=44100;duration=12;t=np.arange(sr*duration)/sr
 # Tonal backing plus a clear half-second pulse. Test data contains no private recording.
 y=.08*np.sin(2*np.pi*220*t)+.05*np.sin(2*np.pi*330*t)
 rng=np.random.default_rng(7)
 for beat in np.arange(0,duration,.5):
  i=int(beat*sr);n=min(int(.04*sr),len(y)-i);y[i:i+n]+=.35*rng.normal(size=n)*np.exp(-np.arange(n)/(sr*.008))
 source=root/'test.wav';sf.write(source,np.column_stack([y,y]),sr)
 subprocess.run([str(exe),'--demucs','--int24','-n','htdemucs','-d','cpu','-j','1','-o',str(root/'out'),str(source)],check=True,timeout=600)
 stems=root/'out'/'htdemucs'/'test'
 for category in ('vocals','drums','bass','other'):
  info=sf.info(stems/(category+'.wav'));assert abs(info.duration-duration)<.01;assert info.samplerate==sr
 # Empty online lyrics exercises Whisper as well as chroma and beat analysis.
 online=root/'online.json';online.write_text('{}');result=root/'analysis.json'
 subprocess.run([str(exe),'--analyze',str(source),str(stems),str(result),'--online-lyrics',str(online)],check=True,timeout=600)
 analysis=json.loads(result.read_text());assert analysis['bpm']>0;assert analysis.get('beats')
 print('Frozen runtime passed actual four-stem separation, shared-duration and analysis checks.')
