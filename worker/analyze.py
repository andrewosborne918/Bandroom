"""Local analysis of the supplied audio, never a fabricated catalog chart.
Demucs code/weights and Whisper code/weights: MIT. librosa: ISC.
Chord/key estimates use chroma template matching and must be reviewed.
"""
import argparse,json,pathlib,numpy as np,librosa
NOTES=['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B']
def timing(y,sr):
    onset=librosa.onset.onset_strength(y=y,sr=sr,hop_length=512)
    tempo,frames=librosa.beat.beat_track(onset_envelope=onset,sr=sr,hop_length=512,trim=False)
    times=librosa.frames_to_time(frames,sr=sr,hop_length=512)
    if len(times)<3:raise ValueError('Not enough rhythmic information to estimate a beat map')
    active=np.flatnonzero(onset>max(float(np.max(onset))*.08,.01))
    if len(active):times=times[times>=max(0,float(librosa.frames_to_time(active[0],sr=sr,hop_length=512))-.15)]
    if len(times)<3:raise ValueError('Not enough detected beats after leading silence')
    bpm=60/float(np.polyfit(np.arange(len(times)),times,1)[0])
    return float(round(bpm,2)),[round(float(t),5) for t in times]
def harmony(y,sr):
    chroma=librosa.feature.chroma_stft(y=y,sr=sr,n_fft=4096,hop_length=2048)
    energy=librosa.feature.rms(y=y,frame_length=4096,hop_length=2048)[0]
    major=np.array([6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88])
    minor=np.array([6.33,2.68,3.52,5.38,2.6,3.53,2.54,4.75,3.98,2.69,3.34,3.17])
    profile=np.mean(chroma,axis=1);keys=[(float(np.corrcoef(profile,np.roll(p,root))[0,1]),NOTES[root]+suffix) for p,suffix in [(major,''),(minor,'m')] for root in range(12)]
    keys.sort(reverse=True);key=keys[0][1] if keys[0][0]>.65 and keys[0][0]-keys[1][0]>.04 else '';templates=[]
    for root in range(12):
        for suffix,intervals in [('',[0,4,7]),('m',[0,3,7]),('7',[0,4,7,10])]:
            v=np.zeros(12);v[[(root+i)%12 for i in intervals]]=1;templates.append((NOTES[root]+suffix,v/np.linalg.norm(v)))
    changes=[];previous=None
    # Aggregate ~0.5 second windows; individual guitar notes are not separate chords.
    width=max(1,round(.5*sr/2048))
    for frame in range(0,chroma.shape[1],width):
        vector=np.mean(chroma[:,frame:frame+width],axis=1);norm=float(np.linalg.norm(vector))
        scores=sorted([(float(np.dot(vector/norm,t)),name) for name,t in templates],reverse=True) if norm else [(0,'N'),(0,'N')]
        label=scores[0][1] if np.mean(energy[frame:frame+width])>max(float(np.max(energy))*.025,.001) and scores[0][0]>.65 and scores[0][0]-scores[1][0]>.015 else 'N'
        if label!=previous:changes.append({'time':round(frame*2048/sr,5),'chord':label,'confidence':round(scores[0][0],3)});previous=label
    if len(set(c['chord'] for c in changes if c['chord']!='N'))<3:key=''
    return key,changes

def analyze(original,stem_dir,output,transcribe=True,online_lyrics=None):
    root=pathlib.Path(stem_dir)
    print('BANDROOM_STAGE:beats',flush=True)
    drums,sr=librosa.load(root/'drums.wav',sr=22050,mono=True)
    try:bpm,beats=timing(drums,sr)
    except ValueError:
        mix,sr=librosa.load(original,sr=22050,mono=True)
        try:bpm,beats=timing(mix,sr)
        except ValueError:bpm,beats=0,[]
    print('BANDROOM_STAGE:chords',flush=True)
    backing,sr=librosa.load(root/'other.wav',sr=22050,mono=True);bass,_=librosa.load(root/'bass.wav',sr=22050,mono=True);n=min(len(backing),len(bass));key,chords=harmony(backing[:n]+bass[:n],sr)
    print('BANDROOM_STAGE:lyrics',flush=True)
    online=online_lyrics or {}
    lyrics=online.get('lyrics',[]) if online.get('found') else []
    if online.get('found'):transcribe=False;print('Using online lyrics; skipping audio transcription.',flush=True)
    vocals,_=librosa.load(root/'vocals.wav',sr=16000,mono=True)
    if transcribe and float(np.sqrt(np.mean(vocals**2)))>.001:
        import whisper
        model=whisper.load_model('base',device='cpu')
        transcript=model.transcribe(str(root/'vocals.wav'),fp16=False,condition_on_previous_text=False,temperature=0,verbose=False)
        lyrics=[{'start':round(float(s['start']),3),'end':round(float(s['end']),3),'text':s['text'].strip()} for s in transcript['segments'] if s.get('no_speech_prob',0)<.6 and s.get('avg_logprob',0)>-1 and s.get('compression_ratio',0)<2.4 and s['text'].strip()]
    if not beats:lyrics_warning='No reliable beat map was detected; use confirmed manual timing.'
    else:lyrics_warning='Beat tracking can choose half or double time; downbeat and time signature require review.'
    result={'version':1,'bpm':bpm,'key':key,'beats':beats,'chords':chords,'lyrics':lyrics,'methods':{'stems':'Demucs htdemucs','beats':'librosa dynamic beat tracker on drums','lyrics':'Online lyrics' if online.get('found') else 'Whisper base on vocals','chords':'chroma template matching on other + bass'},'warnings':[lyrics_warning,'Lyrics are transcribed estimates and may contain errors or omit difficult sung words.','Chords and key are estimates; complex voicings, distortion and modulation can reduce accuracy.']}
    pathlib.Path(output).write_text(json.dumps(result));return result
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('original');p.add_argument('stem_dir');p.add_argument('output');p.add_argument('--online-lyrics');args=p.parse_args();online=json.loads(pathlib.Path(args.online_lyrics).read_text()) if args.online_lyrics else None;analyze(args.original,args.stem_dir,args.output,online_lyrics=online)
