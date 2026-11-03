"""Small, independently decodable AAC segments in one private range-readable file."""
import json, pathlib, struct, subprocess, tempfile, wave
VERSION=1
SECONDS=4
BITRATE=192000

def build_playback(source, target, ffmpeg='ffmpeg'):
    source,target=pathlib.Path(source),pathlib.Path(target)
    # Original audio is never changed. A consistent sample grid prevents stem drift.
    with tempfile.TemporaryDirectory(prefix='bndrm-playback-',dir=target.parent) as folder:
        folder=pathlib.Path(folder);pcm=folder/'source.wav'
        subprocess.run([ffmpeg,'-v','error','-y','-i',str(source),'-map','0:a:0','-vn','-sn','-dn','-ar','44100','-ac','2','-c:a','pcm_s16le',str(pcm)],check=True,timeout=600)
        segments=[];parts=[]
        with wave.open(str(pcm),'rb') as audio:
            rate=audio.getframerate();channels=audio.getnchannels();frames=audio.getnframes()
            while True:
                data=audio.readframes(rate*SECONDS)
                if not data:break
                segment=folder/'segment.wav';encoded=folder/'segment.m4a'
                with wave.open(str(segment),'wb') as out:
                    out.setparams((channels,2,rate,0,'NONE','not compressed'));out.writeframes(data)
                # The MP4 edit list describes encoder priming. Raw AAC/ADTS does not.
                subprocess.run([ffmpeg,'-v','error','-y','-i',str(segment),'-c:a','aac','-b:a',str(BITRATE),'-movflags','+faststart','-use_editlist','1',str(encoded)],check=True,timeout=120)
                part=encoded.read_bytes();parts.append(part);segments.append({'bytes':len(part),'frames':len(data)//(channels*2)})
        meta={'version':VERSION,'codec':'aac','sampleRate':rate,'channels':channels,'frames':frames,'chunkSeconds':SECONDS,'segments':segments}
        header=json.dumps(meta,separators=(',',':')).encode()
        if len(header)>65536:raise ValueError('Playback index exceeds limit')
        temporary=target.with_suffix('.partial')
        with temporary.open('wb') as out:
            out.write(b'BNA1'+struct.pack('<I',len(header))+header)
            for part in parts:out.write(part)
        temporary.replace(target)
        return meta
