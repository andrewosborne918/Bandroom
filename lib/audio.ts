import {audioCacheKey,decodedAudioCache,deviceAudioBudget} from './audio-cache.ts';
import {beatMap} from './analysis.ts';
import {restricted} from './stems.ts';
import type { Song, Transport } from './types';
export class BandAudio {
  context: AudioContext | null=null;
  buffers=new Map<string,AudioBuffer>();
  bufferKeys=new Map<string,string>();
  async loadStem(songId:string,stem:import('./types').Stem,loader:()=>Promise<ArrayBuffer>,retain:()=>boolean=()=>true){const key=audioCacheKey(songId,stem);if(this.bufferKeys.get(stem.id)===key&&this.buffers.has(stem.id))return this.buffers.get(stem.id)!;const buffer=await decodedAudioCache.load(key,async()=>this.decode(await loader()),deviceAudioBudget());if(retain()){this.buffers.set(stem.id,buffer);this.bufferKeys.set(stem.id,key)}return buffer;}
  hasStem(songId:string,stem:import('./types').Stem){return this.buffers.has(stem.id)&&this.bufferKeys.get(stem.id)===audioCacheKey(songId,stem);}
  sources:AudioBufferSourceNode[]=[];
  clicks=new Set<OscillatorNode>();
  gains=new Map<string,GainNode>();
  pans=new Map<string,StereoPannerNode>();
  timer: ReturnType<typeof setInterval>|null=null;
  run='';
  now=()=>Date.now();
  audience=false; generatedClick=true; cues=true; click=false; clickVolume=.35; stems=false; split=false; adjustment=0;
  nextBeat=0; song:Song|null=null; transport:Transport|null=null;
  async arm(){ if(!this.context) this.context=new AudioContext({latencyHint:'interactive'}); await this.context.resume(); }
  get ready(){return this.context?.state==='running';}
  get latency(){return this.context?.outputLatency||this.context?.baseLatency||0;}
  async decode(data:ArrayBuffer){ await this.arm();return await this.context!.decodeAudioData(data); }
  stop(){this.clicks.forEach(o=>{try{o.stop();}catch{}});this.clicks.clear();this.sources.forEach(s=>{try{s.stop();}catch{}});this.sources=[];this.gains.clear();this.pans.clear();if(this.timer)clearInterval(this.timer);this.timer=null;this.run='';this.transport=null;}
  output(node:AudioNode,click=false){
    if(this.audience&&click)return;
    const ctx=this.context!;
    if(this.split&&!this.audience){const mono=ctx.createGain();mono.channelCount=1;mono.channelCountMode='explicit';const merge=ctx.createChannelMerger(2);node.connect(mono);mono.connect(merge,0,click?1:0);merge.connect(ctx.destination);}
    else node.connect(ctx.destination);
  }
  audioTime(serverMs:number){return this.context!.currentTime+(serverMs-this.now())/1000-this.latency+this.adjustment/1000;}
  start(song:Song,t:Transport){
    this.stop();this.run=t.run;this.song=song;this.transport=t;
    if(t.status!=='playing'||!this.ready)return;
    const ctx=this.context!,target=this.audioTime(t.startAt),when=Math.max(ctx.currentTime+.03,target),offset=t.offset+Math.max(0,when-target);
    if(offset<song.duration){
      for(const stem of song.stems){
        if(this.audience&&restricted(stem))continue;const privateStem=restricted(stem);
        const buffer=this.buffers.get(stem.id),stemOffset=stem.offset||0,bufferOffset=Math.max(0,offset-stemOffset),stemWhen=when+Math.max(0,stemOffset-offset);if(!buffer||bufferOffset>=buffer.duration||stemOffset>=song.duration)continue;
        const src=ctx.createBufferSource(),gain=ctx.createGain();src.buffer=buffer;gain.gain.value=stem.enabled&&(privateStem?(stem.category==='click'?this.click:this.cues):this.stems)&&(!song.stems.some(s=>s.solo&&!this.audience||s.solo&&!restricted(s))||stem.solo)?stem.volume*(stem.category==='click'?this.clickVolume:1):0;src.connect(gain);const privateAudio=restricted(stem);if(ctx.createStereoPanner&&!this.split){const pan=ctx.createStereoPanner();pan.pan.value=stem.pan||0;this.pans.set(stem.id,pan);gain.connect(pan);this.output(pan,privateAudio);}else this.output(gain,privateAudio);src.start(stemWhen,bufferOffset,Math.max(.001,song.duration-Math.max(offset,stemOffset)));this.sources.push(src);this.gains.set(stem.id,gain);
      }
    }
    const map=beatMap(song);const mapped=!!map?.length;const shift=mapped?((song.beatOffset||0)-map![0]):0;
    const origin=t.startAt+((song.beatOffset||0)-t.offset)*1000,interval=60000/song.bpm;
    const earliest=t.startAt-t.countIn*1000;
    this.nextBeat=mapped?Math.ceil((Math.max(this.now()+30,earliest)-t.startAt+t.offset*1000-shift*1000-map![0]*1000)/interval):Math.ceil((Math.max(this.now()+30,earliest)-origin)/interval);if(mapped&&this.nextBeat>=0){this.nextBeat=0;while(this.nextBeat<map!.length&&t.startAt+(map![this.nextBeat]+shift-t.offset)*1000<this.now()+30)this.nextBeat++;}
    const countBeats=song.countIn*song.beats,countInterval=countBeats?t.countIn*1000/countBeats:interval;let nextCount=Math.max(0,Math.ceil((this.now()+30-earliest)/countInterval));
    const tick=()=>{
      if(!this.ready)return;
      while(nextCount<countBeats&&t.countIn>0){const at=earliest+nextCount*countInterval;if(at>this.now()+Math.max(180,(this.latency+0.15)*1000))break;const audioAt=this.audioTime(at);if(at<t.startAt&&audioAt>ctx.currentTime+.004&&this.click&&!this.audience){const osc=ctx.createOscillator(),gain=ctx.createGain();this.clicks.add(osc);osc.onended=()=>this.clicks.delete(osc);osc.frequency.value=nextCount%song.beats===0?1500:1000;gain.gain.setValueAtTime(this.clickVolume,audioAt);gain.gain.exponentialRampToValueAtTime(.001,audioAt+.035);osc.connect(gain);this.output(gain,true);osc.start(audioAt);osc.stop(audioAt+.04)}nextCount++;}
      while(true){if(mapped&&this.nextBeat>=map!.length)break;const at=mapped&&this.nextBeat>=0?t.startAt+(map![this.nextBeat]+shift-t.offset)*1000:origin+this.nextBeat*interval;if(at>this.now()+Math.max(180,(this.latency+0.15)*1000))break;
        if(at>=t.startAt && at<t.startAt+(song.duration-t.offset)*1000 && this.click && this.generatedClick && !this.audience){
          const audioAt=this.audioTime(at);if(audioAt>ctx.currentTime+.004){const osc=ctx.createOscillator(),gain=ctx.createGain();const accent=((this.nextBeat%song.beats)+song.beats)%song.beats===0;this.clicks.add(osc);osc.onended=()=>this.clicks.delete(osc);osc.frequency.value=accent?1500:1000;gain.gain.setValueAtTime(this.clickVolume,audioAt);gain.gain.exponentialRampToValueAtTime(.001,audioAt+.035);osc.connect(gain);this.output(gain,true);osc.start(audioAt);osc.stop(audioAt+.04);}
        }
        this.nextBeat++;if(this.nextBeat>100000)break;
      }
      if(this.now()>t.startAt+(song.duration-t.offset)*1000+200) {if(this.timer)clearInterval(this.timer);this.timer=null;}
    };tick();this.timer=setInterval(tick,25);
  }
  mix(song:Song){for(const stem of song.stems){const gain=this.gains.get(stem.id);if(gain&&this.context)gain.gain.setTargetAtTime(stem.enabled&&(restricted(stem)?(stem.category==='click'?this.click:this.cues):this.stems)&&(!song.stems.some(s=>s.solo&&(!this.audience||!restricted(s)))||stem.solo)?stem.volume*(stem.category==='click'?this.clickVolume:1):0,this.context.currentTime,.02);const pan=this.pans.get(stem.id);if(pan&&this.context)pan.pan.setTargetAtTime(stem.pan||0,this.context.currentTime,.02);}}
  demo(song:Song){
    const ctx=this.context!,rate=ctx.sampleRate,duration=song.duration,beat=60/song.bpm;
    song.stems.forEach((s,index)=>{
      if(this.buffers.has(s.id))return;
      const buf=ctx.createBuffer(1,Math.ceil(rate*duration),rate),out=buf.getChannelData(0);
      for(let b=0;b<duration/beat;b++){
        const start=Math.floor(b*beat*rate),length=Math.min(Math.floor(rate*(index===0?.15:.35)),out.length-start);
        for(let j=0;j<length;j++){
          const t=j/rate;
          if(index===0)out[start+j]+=(b%2===0?Math.sin(2*Math.PI*(80*t-90*t*t)):(Math.sin(j*23.19)*.45))*Math.exp(-t*35)*.5;
          else if(index===1)out[start+j]+=Math.sin(2*Math.PI*[65.41,87.31,98,65.41][Math.floor(b/16)%4]*t)*Math.exp(-t*8)*.2;
          else if(b%4===0)out[start+j]+=(Math.sin(2*Math.PI*261.63*t)+Math.sin(2*Math.PI*329.63*t)+Math.sin(2*Math.PI*392*t))*Math.exp(-t*6)*.08;
        }
      }
      this.buffers.set(s.id,buf);
    });
  }
}
