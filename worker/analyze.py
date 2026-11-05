"""Local analysis of the supplied audio, never a fabricated catalog chart.
Demucs code/weights and Whisper code/weights: MIT. librosa: ISC.
Chord/key estimates use chroma template matching and must be reviewed.
"""
import argparse,json,os,pathlib,sys,numpy as np,librosa
NOTES=['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B']
CHORD_SHAPES=[
    ('',{0:1.0,4:0.9,7:0.85},0.0,None),
    ('m',{0:1.0,3:0.9,7:0.85},0.0,None),
    ('7',{0:1.0,4:0.85,7:0.75,10:0.8},0.085,10),
    ('m7',{0:1.0,3:0.85,7:0.75,10:0.8},0.085,10),
    ('maj7',{0:1.0,4:0.85,7:0.75,11:0.8},0.095,11),
    ('sus4',{0:1.0,5:0.9,7:0.85},0.075,5),
    ('dim',{0:1.0,3:0.9,6:0.85},0.095,6),
]

def enable_mps_demucs_shim():
    import torch,torch.nn.functional as F
    if getattr(F,'_bandroom_mps_shim',False):return
    orig_conv1d=F.conv1d;orig_conv_t1d=F.conv_transpose1d
    def safe_conv1d(input,weight,bias=None,stride=1,padding=0,dilation=1,groups=1):
        if getattr(input,'device',None) is not None and input.device.type=='mps':
            try:return orig_conv1d(input,weight,bias,stride,padding,dilation,groups)
            except NotImplementedError:
                return orig_conv1d(input.cpu(),weight.cpu(),bias.cpu() if bias is not None else None,stride,padding,dilation,groups).to('mps')
        return orig_conv1d(input,weight,bias,stride,padding,dilation,groups)
    def safe_conv_t1d(input,weight,bias=None,stride=1,padding=0,output_padding=0,groups=1,dilation=1):
        if getattr(input,'device',None) is not None and input.device.type=='mps':
            if input.shape[-1]* (stride[0] if isinstance(stride,tuple) else stride)>65535:
                return orig_conv_t1d(input.cpu(),weight.cpu(),bias.cpu() if bias is not None else None,stride,padding,output_padding,groups,dilation).to('mps')
            try:return orig_conv_t1d(input,weight,bias,stride,padding,output_padding,groups,dilation)
            except NotImplementedError:
                return orig_conv_t1d(input.cpu(),weight.cpu(),bias.cpu() if bias is not None else None,stride,padding,output_padding,groups,dilation).to('mps')
        return orig_conv_t1d(input,weight,bias,stride,padding,output_padding,groups,dilation)
    F.conv1d=safe_conv1d;F.conv_transpose1d=safe_conv_t1d;F._bandroom_mps_shim=True

def preferred_demucs_device():
    forced=os.getenv('BANDROOM_DEVICE','').strip().lower()
    if forced in ('cpu','mps','cuda'):return forced
    try:
        import torch
        if torch.cuda.is_available():return 'cuda'
        if hasattr(torch.backends,'mps') and torch.backends.mps.is_available():return 'mps'
    except Exception:pass
    return 'cpu'

def run_demucs(argv):
    enable_mps_demucs_shim()
    import demucs.separate
    args=list(argv)
    dev=preferred_demucs_device()
    if '-d' in args:
        idx=args.index('-d')+1
        if idx<len(args) and args[idx]=='auto':args[idx]=dev
        elif idx<len(args):dev=args[idx]
    else:args=['-d',dev,*args]
    try:
        demucs.separate.main(args)
    except Exception:
        if dev=='cpu':raise
        print(f'GPU separation on {dev} encountered an issue; falling back to multi-core CPU.',flush=True)
        cpu_args=list(args)
        if '-d' in cpu_args:cpu_args[cpu_args.index('-d')+1]='cpu'
        if '-j' in cpu_args:cpu_args[cpu_args.index('-j')+1]=str(max(1,min(4,(os.cpu_count() or 2)//2)))
        demucs.separate.main(cpu_args)

def timing(y,sr,backing=None):
    hop=512
    onset=librosa.onset.onset_strength(y=y,sr=sr,hop_length=hop,aggregate=np.median)
    if backing is not None and len(backing):
        b_onset=librosa.onset.onset_strength(y=backing,sr=sr,hop_length=hop,aggregate=np.median)
        m=min(len(onset),len(b_onset))
        d_scale=float(np.percentile(onset[:m],95)) if m else 0.0
        b_scale=float(np.percentile(b_onset[:m],95)) if m else 0.0
        d_norm=onset[:m]/max(d_scale,1e-4)
        b_norm=b_onset[:m]/max(b_scale,1e-4)
        drum_rms=float(np.sqrt(np.mean(y**2))) if len(y) else 0.0
        onset=0.75*d_norm+0.25*b_norm if drum_rms>0.003 else 0.35*d_norm+0.65*b_norm
    tempo,frames=librosa.beat.beat_track(onset_envelope=onset,sr=sr,hop_length=hop,trim=False)
    if len(frames)<3:raise ValueError('Not enough rhythmic information to estimate a beat map')
    refined=[]
    for f in frames:
        lo=max(0,int(f)-2);hi=min(len(onset),int(f)+3)
        refined.append(lo+int(np.argmax(onset[lo:hi])) if hi>lo else int(f))
    frames=np.array(sorted(set(refined)),dtype=int)
    times=librosa.frames_to_time(frames,sr=sr,hop_length=hop)
    if len(times)<3:raise ValueError('Not enough rhythmic information to estimate a beat map')
    active=np.flatnonzero(onset>max(float(np.max(onset))*.08,.01))
    if len(active):
        first_active=max(0.0,float(librosa.frames_to_time(active[0],sr=sr,hop_length=hop))-.15)
        keep=times>=first_active
        frames=frames[keep];times=times[keep]
    if len(times)<3:raise ValueError('Not enough detected beats after leading silence')
    if len(frames)>=8:
        low_spec=np.abs(librosa.stft(y,n_fft=2048,hop_length=hop))[:12,:]
        low_env=np.mean(low_spec,axis=0) if low_spec.size else onset
        m=min(len(onset),len(low_env))
        accent=onset[:m]/(float(np.max(onset[:m])) or 1.0)+0.5*(low_env[:m]/(float(np.max(low_env[:m])) or 1.0))
        valid_frames=np.clip(frames,0,len(accent)-1)
        phase_scores=[float(np.mean(accent[valid_frames[p::4]])) for p in range(4)]
        best_phase=int(np.argmax(phase_scores))
        if best_phase>0 and len(times)-best_phase>=4 and phase_scores[best_phase]>phase_scores[0]*1.06:
            frames=frames[best_phase:];times=times[best_phase:]
    diffs=np.diff(times)
    med=float(np.median(diffs))
    inliers=diffs[(diffs>=med*0.7)&(diffs<=med*1.3)]
    step=float(np.median(inliers)) if len(inliers) else med
    bpm=60.0/step if step>0 else float(np.atleast_1d(tempo)[0])
    if len(inliers)>=8 and float(np.std(inliers))/max(step,1e-4)<0.018 and abs(bpm-round(bpm))<0.15:
        bpm=float(round(bpm))
    return float(round(bpm,2)),[round(float(t),5) for t in times]

def _diatonic_pcs(key):
    if not key:return set()
    minor=key.endswith('m')
    root_name=key[:-1] if minor else key
    if root_name not in NOTES:return set()
    root=NOTES.index(root_name)
    scale=[0,2,3,5,7,8,10] if minor else [0,2,4,5,7,9,11]
    return {(root+i)%12 for i in scale}

def harmony(y,sr,bass=None,beats=None):
    hop=2048
    y_harm=librosa.effects.harmonic(y=y,margin=4.0) if len(y)>hop*2 else y
    try:
        chroma=librosa.feature.chroma_cqt(y=y_harm,sr=sr,hop_length=hop,fmin=librosa.note_to_hz('C2'),n_octaves=4)
        bass_src=bass if bass is not None and len(bass)>hop*2 else y_harm
        bass_chroma=librosa.feature.chroma_cqt(y=bass_src,sr=sr,hop_length=hop,fmin=librosa.note_to_hz('C1'),n_octaves=3)
    except Exception:
        chroma=librosa.feature.chroma_stft(y=y_harm,sr=sr,n_fft=4096,hop_length=hop)
        bass_chroma=chroma
    energy=librosa.feature.rms(y=y_harm,frame_length=4096,hop_length=hop)[0]
    n_frames=min(chroma.shape[1],bass_chroma.shape[1],len(energy))
    chroma=chroma[:,:n_frames];bass_chroma=bass_chroma[:,:n_frames];energy=energy[:n_frames]
    major=np.array([6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88])
    minor=np.array([6.33,2.68,3.52,5.38,2.6,3.53,2.54,4.75,3.98,2.69,3.34,3.17])
    weights=np.maximum(energy-float(np.percentile(energy,25))*0.5,0.0)
    if float(np.sum(weights))<=0:weights=np.ones_like(energy)
    h_prof=np.average(chroma,axis=1,weights=weights)
    b_prof=np.average(bass_chroma,axis=1,weights=weights)
    profile=0.82*(h_prof/(np.linalg.norm(h_prof) or 1.0))+0.18*(b_prof/(np.linalg.norm(b_prof) or 1.0))
    keys=[(float(np.corrcoef(profile,np.roll(p,root))[0,1]),NOTES[root]+suffix) for p,suffix in [(major,''),(minor,'m')] for root in range(12)]
    keys.sort(reverse=True)
    key=keys[0][1] if keys[0][0]>.62 and keys[0][0]-keys[1][0]>.02 else ''
    scale_pcs=_diatonic_pcs(key)
    templates=[]
    for root in range(12):
        for suffix,intervals,penalty,ext_pc in CHORD_SHAPES:
            v=np.zeros(12)
            for interval,weight in intervals.items():v[(root+interval)%12]=weight
            pcs={(root+interval)%12 for interval in intervals}
            diatonic_bonus=0.02 if scale_pcs and pcs.issubset(scale_pcs) and ext_pc is None else 0.0
            templates.append((NOTES[root]+suffix,root,v/np.linalg.norm(v),penalty-diatonic_bonus,ext_pc))
    windows=[]
    if beats and len(beats)>=4:
        med_beat=float(np.median(np.diff(beats)))
        step=2 if med_beat>0 and (60.0/med_beat)>=95 else 1
        b_times=list(beats[::step])
        if b_times[0]>0.6:
            pre=np.arange(0.0,b_times[0],max(0.5,med_beat*step)).tolist()
            b_times=pre+b_times
        for idx,t0 in enumerate(b_times):
            t1=b_times[idx+1] if idx+1<len(b_times) else n_frames*hop/sr
            f0=max(0,int(round(t0*sr/hop)));f1=min(n_frames,max(f0+1,int(round(t1*sr/hop))))
            if f0<n_frames:windows.append((round(float(t0),5),f0,f1))
    else:
        width=max(1,round(.5*sr/hop))
        for frame in range(0,n_frames,width):
            windows.append((round(frame*hop/sr,5),frame,min(n_frames,frame+width)))
    thresh=max(float(np.max(energy))*.025,.001) if len(energy) else .001
    win_candidates=[]
    for t0,f0,f1 in windows:
        win_e=float(np.mean(energy[f0:f1])) if f1>f0 else 0.0
        vector=np.mean(chroma[:,f0:f1],axis=1) if f1>f0 else np.zeros(12)
        b_vec=np.mean(bass_chroma[:,f0:f1],axis=1) if f1>f0 else np.zeros(12)
        norm=float(np.linalg.norm(vector));b_norm=float(np.linalg.norm(b_vec))
        if win_e<=thresh or norm<=0:
            win_candidates.append((t0,[('N',1.0),('N',0.0)]))
            continue
        v_unit=vector/norm
        b_unit=b_vec/b_norm if b_norm>0 else np.zeros(12)
        scored=[]
        for name,root,t_vec,cost,ext_pc in templates:
            ext_penalty=0.06 if ext_pc is not None and float(v_unit[(root+ext_pc)%12])<0.38 else 0.0
            raw=float(np.dot(v_unit,t_vec))+0.14*float(b_unit[root])-cost-ext_penalty
            scored.append((raw,name))
        scored.sort(reverse=True)
        if scored[0][0]<=.62 or scored[0][0]-scored[1][0]<=.01:
            win_candidates.append((t0,[('N',round(float(scored[0][0]),3)),(scored[0][1],round(float(scored[0][0]),3))]))
        else:
            win_candidates.append((t0,[(name,round(min(1.0,max(0.0,float(sc))),3)) for sc,name in scored[:6]]))
    changes=[];previous=None
    n_win=len(win_candidates)
    for i,(t0,cands) in enumerate(win_candidates):
        label,conf=cands[0]
        if label=='N' and previous and previous!='N' and i+1<n_win and win_candidates[i+1][1][0][0]==previous:
            label,conf=previous,cands[1][1]
        elif previous and label!=previous and label!='N':
            prev_match=next((sc for nm,sc in cands if nm==previous),None)
            next_top=win_candidates[i+1][1][0][0] if i+1<n_win else None
            if next_top==previous and prev_match is not None and conf-prev_match<0.065:
                label,conf=previous,prev_match
        if label!=previous:
            changes.append({'time':t0,'chord':label,'confidence':conf})
            previous=label
    if len(set(c['chord'] for c in changes if c['chord']!='N'))<2:key=''
    return key,changes

def _vocal_clip_timestamps(vocals,sr=16000):
    peak=float(np.max(np.abs(vocals))) if len(vocals) else 0.0
    if peak<=1e-5:return []
    y_norm=vocals/peak
    intervals=librosa.effects.split(y_norm,top_db=28,frame_length=2048,hop_length=512)
    merged=[]
    for s,e in intervals:
        t0,t1=float(s)/sr,float(e)/sr
        if t1-t0<0.18:continue
        if merged and t0-merged[-1][1]<2.0:merged[-1][1]=t1
        else:merged.append([t0,t1])
    duration=len(vocals)/sr
    clips=[]
    for s,e in merged:
        if e-s>=0.45:
            clips.extend([round(max(0.0,s-0.25),2),round(min(duration,e+0.25),2)])
    return clips

GUITAR_SHAPES={
    'C':(-1,3,2,0,1,0),'Cm':(-1,3,5,5,4,3),'C7':(-1,3,2,3,1,0),'Cmaj7':(-1,3,2,0,0,0),
    'C#':(-1,4,6,6,6,4),'C#m':(-1,4,6,6,5,4),'C#7':(-1,4,6,4,6,4),
    'D':(-1,-1,0,2,3,2),'Dm':(-1,-1,0,2,3,1),'D7':(-1,-1,0,2,1,2),'Dm7':(-1,-1,0,2,1,1),'Dmaj7':(-1,-1,0,2,2,2),'Dsus4':(-1,-1,0,2,3,3),
    'Eb':(-1,6,8,8,8,6),'Ebm':(-1,6,8,8,7,6),
    'E':(0,2,2,1,0,0),'Em':(0,2,2,0,0,0),'E7':(0,2,0,1,0,0),'Em7':(0,2,0,0,0,0),'Emaj7':(0,2,1,1,0,0),'Esus4':(0,2,2,2,0,0),
    'F':(1,3,3,2,1,1),'Fm':(1,3,3,1,1,1),'F7':(1,3,1,2,1,1),'Fmaj7':(-1,-1,3,2,1,0),
    'F#':(2,4,4,3,2,2),'F#m':(2,4,4,2,2,2),'F#7':(2,4,2,3,2,2),'F#m7':(2,4,2,2,2,2),
    'G':(3,2,0,0,0,3),'Gm':(3,5,5,3,3,3),'G7':(3,2,0,0,0,1),'Gmaj7':(3,2,0,0,0,2),'Gsus4':(3,3,0,0,1,3),
    'Ab':(4,6,6,5,4,4),'Abm':(4,6,6,4,4,4),
    'A':(-1,0,2,2,2,0),'Am':(-1,0,2,2,1,0),'A7':(-1,0,2,0,2,0),'Am7':(-1,0,2,0,1,0),'Amaj7':(-1,0,2,1,2,0),'Asus4':(-1,0,2,2,3,0),
    'Bb':(-1,1,3,3,3,1),'Bbm':(-1,1,3,3,2,1),'Bb7':(-1,1,3,1,3,1),
    'B':(-1,2,4,4,4,2),'Bm':(-1,2,4,4,3,2),'B7':(-1,2,1,2,0,2),'Bm7':(-1,2,4,2,3,2),'Bsus4':(-1,2,4,4,5,2),
}

def _chord_root_pc(chord_name):
    if not chord_name or chord_name=='N':return None
    for i,n in enumerate(NOTES):
        if chord_name.startswith(n) and (len(n)==2 or len(chord_name)==1 or chord_name[1] not in ('#','b')):
            return i
    return None

def _guitar_voicing(chord_name):
    if not chord_name or chord_name=='N':return None
    if chord_name in GUITAR_SHAPES:return GUITAR_SHAPES[chord_name]
    base=chord_name.replace('maj7','').replace('m7','m').replace('sus4','').replace('dim','m').replace('7','')
    if base in GUITAR_SHAPES:return GUITAR_SHAPES[base]
    pc=_chord_root_pc(chord_name)
    if pc is None:return None
    fret=(pc-4)%12
    is_min='m' in chord_name and 'maj' not in chord_name
    return (fret,fret+2,fret+2,fret+(1 if is_min else 2),fret,fret)

def _chord_at(chords,t):
    active='N'
    for c in chords:
        if c['time']<=t+0.05:active=c['chord']
        else:break
    return active

def _fmt_mmss(sec):
    s=max(0,int(round(sec)))
    return f'{s//60}:{s%60:02d}'

def generate_tabs(root,bass_y,backing_y,sr,beats,bpm,chords):
    hop=512
    step_sec=60.0/max(60.0,float(bpm or 120.0))/2.0
    if beats and len(beats)>=8:
        grid=[]
        for i in range(len(beats)-1):
            b0,b1=float(beats[i]),float(beats[i+1])
            grid.extend([b0,(b0+b1)*0.5])
        grid.append(float(beats[-1]))
    else:
        dur=len(bass_y)/sr
        grid=np.arange(0.0,dur,step_sec).tolist()
    if len(grid)<16:return {},[]
    # Bass tab generation (4 strings: G=43, D=38, A=33, E=28)
    bass_strings=[('G',43),('D',38),('A',33),('E',28)]
    bass_rms=librosa.feature.rms(y=bass_y,frame_length=2048,hop_length=hop)[0]
    bass_thresh=max(float(np.percentile(bass_rms,30))*0.85,0.002) if len(bass_rms) else 0.002
    try:
        f0=librosa.yin(bass_y,fmin=librosa.note_to_hz('E1'),fmax=librosa.note_to_hz('G3'),sr=sr,frame_length=2048,hop_length=hop)
    except Exception:
        f0=np.zeros(len(bass_rms))
    bass_blocks=[];tab_cues=[]
    slots_per_bar=8;bars_per_block=4;block_slots=slots_per_bar*bars_per_block
    max_blocks=16
    for b_idx,start_slot in enumerate(range(0,len(grid)-slots_per_bar,block_slots)):
        if len(bass_blocks)>=max_blocks:break
        end_slot=min(len(grid),start_slot+block_slots)
        t_start=grid[start_slot]
        lines={s:[] for s,_ in bass_strings}
        bar_chords=[];active_notes=0
        for s_idx in range(start_slot,end_slot):
            if (s_idx-start_slot)%slots_per_bar==0 and s_idx>start_slot:
                for s,_ in bass_strings:lines[s].append('|')
            t0=grid[s_idx];t1=grid[s_idx+1] if s_idx+1<len(grid) else t0+step_sec
            ch=_chord_at(chords,t0)
            if (s_idx-start_slot)%slots_per_bar==0 and ch!='N' and (not bar_chords or bar_chords[-1]!=ch):
                bar_chords.append(ch)
            f_start=max(0,int(round(t0*sr/hop)));f_end=min(len(bass_rms),max(f_start+1,int(round(t1*sr/hop))))
            seg_rms=float(np.mean(bass_rms[f_start:f_end])) if f_end>f_start else 0.0
            if seg_rms<bass_thresh:
                for s,_ in bass_strings:lines[s].append('--')
                continue
            valid_f0=f0[f_start:f_end]
            valid_f0=valid_f0[np.isfinite(valid_f0)&(valid_f0>35)&(valid_f0<220)]
            midi=int(round(float(np.median(librosa.hz_to_midi(valid_f0))))) if len(valid_f0) else None
            if midi is None:
                pc=_chord_root_pc(ch)
                if pc is not None and (s_idx-start_slot)%2==0:
                    midi=28+((pc-4)%12)
            if midi is None:
                for s,_ in bass_strings:lines[s].append('--')
                continue
            chosen_s='E';chosen_fret=max(0,min(12,midi-28))
            for s_name,open_midi in bass_strings:
                fret=midi-open_midi
                if 0<=fret<=9:
                    chosen_s=s_name;chosen_fret=fret;break
            active_notes+=1
            for s_name,_ in bass_strings:
                lines[s_name].append(f'{chosen_fret}-' if len(str(chosen_fret))==1 else str(chosen_fret) if s_name==chosen_s else '--')
                if s_name!=chosen_s:lines[s_name][-1]='--'
        if active_notes<2:continue
        header=f"[{_fmt_mmss(t_start)}"+(f" · {' - '.join(bar_chords)}]" if bar_chords else "]")
        body='\n'.join(f"{s}|{''.join(lines[s])}|" for s,_ in bass_strings)
        block_text=f"{header}\n{body}"
        bass_blocks.append(block_text)
        tab_cues.append({'id':f'bass-{len(bass_blocks)-1}','at':round(float(t_start),2),'instrument':'Bass','block':len(bass_blocks)-1,'text':block_text})
    # Guitar tab generation (6 strings: e=64, B=59, G=55, D=50, A=45, E=40)
    gtr_path=root/'guitar.wav'
    gtr_y,_=librosa.load(gtr_path,sr=sr,mono=True) if gtr_path.exists() else (backing_y,sr)
    gtr_rms=librosa.feature.rms(y=gtr_y,frame_length=2048,hop_length=hop)[0]
    gtr_thresh=max(float(np.percentile(gtr_rms,28))*0.8,0.002) if len(gtr_rms) else 0.002
    gtr_strings=[('e',64),('B',59),('G',55),('D',50),('A',45),('E',40)]
    guitar_blocks=[]
    for start_slot in range(0,len(grid)-slots_per_bar,block_slots):
        if len(guitar_blocks)>=max_blocks:break
        end_slot=min(len(grid),start_slot+block_slots)
        t_start=grid[start_slot]
        lines={s:[] for s,_ in gtr_strings}
        bar_chords=[];active_hits=0
        for s_idx in range(start_slot,end_slot):
            pos_in_bar=(s_idx-start_slot)%slots_per_bar
            if pos_in_bar==0 and s_idx>start_slot:
                for s,_ in gtr_strings:lines[s].append('|')
            t0=grid[s_idx];t1=grid[s_idx+1] if s_idx+1<len(grid) else t0+step_sec
            ch=_chord_at(chords,t0)
            if pos_in_bar==0 and ch!='N' and (not bar_chords or bar_chords[-1]!=ch):
                bar_chords.append(ch)
            f_start=max(0,int(round(t0*sr/hop)));f_end=min(len(gtr_rms),max(f_start+1,int(round(t1*sr/hop))))
            seg_rms=float(np.mean(gtr_rms[f_start:f_end])) if f_end>f_start else 0.0
            voicing=_guitar_voicing(ch)
            if seg_rms<gtr_thresh or voicing is None:
                for s,_ in gtr_strings:lines[s].append('--')
                continue
            active_hits+=1
            # On beat 1 & 3 (pos 0, 4) play full chord or root note; on 8th-note subdivisions arpeggiate/strum upper strings
            for idx,(s_name,_) in enumerate(gtr_strings):
                fret=voicing[5-idx]
                play=(fret>=0) and (pos_in_bar in (0,4) or (pos_in_bar in (2,6) and idx<=3) or (pos_in_bar%2==1 and idx in (1,2)))
                if play:
                    lines[s_name].append(f'{fret}-' if fret<10 else str(fret))
                else:
                    lines[s_name].append('--')
        if active_hits<2:continue
        header=f"[{_fmt_mmss(t_start)}"+(f" · {' - '.join(bar_chords)}]" if bar_chords else "]")
        body='\n'.join(f"{s}|{''.join(lines[s])}|" for s,_ in gtr_strings)
        block_text=f"{header}\n{body}"
        guitar_blocks.append(block_text)
        tab_cues.append({'id':f'guitar-{len(guitar_blocks)-1}','at':round(float(t_start),2),'instrument':'Guitar','block':len(guitar_blocks)-1,'text':block_text})
    tabs={}
    if guitar_blocks:tabs['Guitar']='\n\n'.join(guitar_blocks)
    if bass_blocks:tabs['Bass']='\n\n'.join(bass_blocks)
    return tabs,tab_cues

def analyze(original,stem_dir,output,transcribe=True,online_lyrics=None):
    root=pathlib.Path(stem_dir)
    print('BANDROOM_STAGE:beats',flush=True)
    drums,sr=librosa.load(root/'drums.wav',sr=22050,mono=True)
    backing,sr=librosa.load(root/'other.wav',sr=22050,mono=True)
    bass,_=librosa.load(root/'bass.wav',sr=22050,mono=True)
    for extra in ('guitar.wav','piano.wav','keyboards.wav'):
        extra_path=root/extra
        if extra_path.exists():
            ext_y,_=librosa.load(extra_path,sr=22050,mono=True)
            m=min(len(backing),len(ext_y))
            backing[:m]=backing[:m]+ext_y[:m]
    n=min(len(drums),len(backing),len(bass))
    try:bpm,beats=timing(drums[:n],sr,backing=backing[:n]+bass[:n])
    except ValueError:
        mix,sr=librosa.load(original,sr=22050,mono=True)
        try:bpm,beats=timing(mix,sr)
        except ValueError:bpm,beats=0,[]
    print('BANDROOM_STAGE:chords',flush=True)
    n_harm=min(len(backing),len(bass))
    key,chords=harmony(backing[:n_harm],sr,bass=bass[:n_harm],beats=beats)
    tabs,tab_cues=generate_tabs(root,bass[:n_harm],backing[:n_harm],sr,beats,bpm,chords)
    print('BANDROOM_STAGE:lyrics',flush=True)
    online=online_lyrics or {}
    lyrics=online.get('lyrics',[]) if online.get('found') else []
    if online.get('found'):transcribe=False;print('Using online lyrics; skipping audio transcription.',flush=True)
    vocals,_=librosa.load(root/'vocals.wav',sr=16000,mono=True)
    vocal_rms=float(np.sqrt(np.mean(vocals**2))) if len(vocals) else 0.0
    if transcribe and vocal_rms>.001:
        import soundfile as sf,tempfile,whisper
        model=whisper.load_model('base',device='cpu')
        peak=float(np.max(np.abs(vocals)))
        norm_vocals=(vocals/peak*0.95).astype(np.float32) if peak>0 else vocals
        clips=_vocal_clip_timestamps(norm_vocals,16000)
        with tempfile.NamedTemporaryFile(suffix='.wav',delete=True) as tmp:
            sf.write(tmp.name,norm_vocals,16000)
            kw={'fp16':False,'condition_on_previous_text':False,'temperature':(0.0,0.2,0.4,0.6,0.8,1.0),'compression_ratio_threshold':2.2,'logprob_threshold':-1.0,'no_speech_threshold':0.6,'verbose':False}
            if clips:kw['clip_timestamps']=clips
            transcript=model.transcribe(tmp.name,**kw)
        lyrics=[]
        for s in transcript['segments']:
            text=s['text'].strip()
            if not text or s.get('no_speech_prob',0)>=.65 or s.get('avg_logprob',0)<=-1.05 or s.get('compression_ratio',0)>=2.4:continue
            i0=max(0,int(float(s['start'])*16000));i1=min(len(vocals),max(i0+1,int(float(s['end'])*16000)))
            seg_rms=float(np.sqrt(np.mean(vocals[i0:i1]**2))) if i1>i0 else 0.0
            if seg_rms<max(vocal_rms*0.08,0.0012):continue
            if lyrics and lyrics[-1]['text'].lower()==text.lower() and float(s['start'])-lyrics[-1]['end']<1.0:continue
            lyrics.append({'start':round(float(s['start']),3),'end':round(float(s['end']),3),'text':text})
    if not beats:lyrics_warning='No reliable beat map was detected; use confirmed manual timing.'
    else:lyrics_warning='Beat tracking can choose half or double time; downbeat and time signature require review.'
    result={'version':1,'bpm':bpm,'key':key,'beats':beats,'chords':chords,'lyrics':lyrics,'tabs':tabs,'tabCues':tab_cues,'methods':{'stems':'Demucs htdemucs','beats':'librosa onset-refined beat tracker on drums + backing','lyrics':'Online lyrics' if online.get('found') else 'Whisper base on active vocal segments','chords':'beat-synced CQT harmonic + bass template matching','tabs':'librosa pYIN bass pitch tracking + beat-synced guitar voicing tab generator'},'warnings':[lyrics_warning,'Lyrics are transcribed estimates and may contain errors or omit difficult sung words.','Chords and key are estimates; complex voicings, distortion and modulation can reduce accuracy.']}
    pathlib.Path(output).write_text(json.dumps(result));return result
if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--demucs':
        run_demucs(sys.argv[2:])
    else:
        p=argparse.ArgumentParser();p.add_argument('original');p.add_argument('stem_dir');p.add_argument('output');p.add_argument('--online-lyrics');args=p.parse_args();online=json.loads(pathlib.Path(args.online_lyrics).read_text()) if args.online_lyrics else None;analyze(args.original,args.stem_dir,args.output,online_lyrics=online)
