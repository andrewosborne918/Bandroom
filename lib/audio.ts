import {safeLoop,transportPosition} from './rehearsal.ts';
import {audioCacheKey,decodedAudioCache,deviceAudioBudget} from './audio-cache.ts';
import {beatMap} from './analysis.ts';
import {restricted} from './stems.ts';
import type { Song, Transport } from './types';
export class BandAudio {
  context: AudioContext | null=null;
  buffers=new Map<string,AudioBuffer>();
  bufferKeys=new Map<string,string>();
  async loadStem(songId:string,stem:import('./types').Stem,loader:()=>Promise<ArrayBuffer>,retain:()=>boolean=()=>true,background=false){const key=audioCacheKey(songId,stem);if(this.bufferKeys.get(stem.id)===key&&this.buffers.has(stem.id))return this.buffers.get(stem.id)!;const buffer=await decodedAudioCache.load(key,async()=>this.decode(await loader(),!background),deviceAudioBudget());if(retain()){this.buffers.set(stem.id,buffer);this.bufferKeys.set(stem.id,key)}return buffer;}
  hasStem(songId:string,stem:import('./types').Stem){return this.buffers.has(stem.id)&&this.bufferKeys.get(stem.id)===audioCacheKey(songId,stem);}
  sources:AudioBufferSourceNode[]=[];
  effects:AudioNode[]=[];
  private rateOutput:AudioNode|null=null;
  private pitchFactory:((context:AudioContext,rate:number)=>AudioNode)|null=null;
  async prepareRate(rate=1){
    if(rate===1)return;
    if(!this.context)await this.arm();
    if(this.pitchFactory)return;
    if(!this.context!.audioWorklet)throw Error('Practice speed needs a browser with AudioWorklet support. Use original speed on this device.');
    const {SoundTouchNode}=await import('@soundtouchjs/audio-worklet');
    await SoundTouchNode.register(this.context!,'/audio/soundtouch-processor.js');
    this.pitchFactory=(context,rate)=>{const node=new SoundTouchNode({context});node.playbackRate.value=rate;node.pitch.value=1;return node};
  }
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
  async decode(data:ArrayBuffer,activate=true){ if(activate)await this.arm();else if(!this.context)this.context=new AudioContext({latencyHint:'interactive'});return await this.context!.decodeAudioData(data); }
  stop(){this.clicks.forEach(o=>{try{o.stop();}catch{}});this.clicks.clear();this.sources.forEach(s=>{try{s.stop();}catch{}});this.sources=[];this.effects.forEach(n=>n.disconnect());this.effects=[];this.rateOutput=null;this.gains.clear();this.pans.clear();if(this.timer)clearInterval(this.timer);this.timer=null;this.run='';this.transport=null;}
  output(node:AudioNode,click=false){
    if(this.audience&&click)return;
    const ctx=this.context!;
    if(this.split&&!this.audience){const mono=ctx.createGain();mono.channelCount=1;mono.channelCountMode='explicit';const merge=ctx.createChannelMerger(2);node.connect(mono);mono.connect(merge,0,click?1:0);merge.connect(this.rateOutput||ctx.destination);}
    else node.connect(this.rateOutput||ctx.destination);
  }
  audioTime(serverMs:number){return this.context!.currentTime+(serverMs-this.now())/1000-this.latency+this.adjustment/1000;}
  start(song:Song,t:Transport){
    this.stop();this.run=t.run;this.song=song;this.transport=t;
    if(t.status!=='playing'||!this.ready)return;
    const rate=t.rate||1,loop=safeLoop(t.loop,song.duration);if(rate!==1&&!this.pitchFactory)throw Error('Prepare practice speed before playback');const ctx=this.context!;if(rate!==1){this.rateOutput=this.pitchFactory!(ctx,rate);this.rateOutput.connect(ctx.destination);this.effects.push(this.rateOutput)}const target=this.audioTime(t.startAt),when=Math.max(ctx.currentTime+.03,target),offset=transportPosition(t,t.startAt+Math.max(0,when-target)*1000,song.duration);
    if(offset<song.duration){
      for(const stem of song.stems){
        if(this.audience&&restricted(stem))continue;const privateStem=restricted(stem);
        const buffer=this.buffers.get(stem.id),stemOffset=stem.offset||0,bufferOffset=Math.max(0,offset-stemOffset),stemWhen=when+Math.max(0,stemOffset-offset);if(!buffer||!loop&&(bufferOffset>=buffer.duration||stemOffset>=song.duration))continue;
        const src=ctx.createBufferSource(),gain=ctx.createGain();if(!loop)src.buffer=buffer;if(rate!==1)src.playbackRate.value=rate;
        let loopOffset=bufferOffset;
        if(loop){
          const frames=Math.ceil((loop.end-loop.start)*buffer.sampleRate),piece=ctx.createBuffer(buffer.numberOfChannels,frames,buffer.sampleRate);
          for(let channel=0;channel<buffer.numberOfChannels;channel++){const from=Math.round((loop.start-stemOffset)*buffer.sampleRate),read=Math.max(0,from),write=Math.max(0,-from),length=Math.min(buffer.length-read,frames-write);if(length>0)piece.getChannelData(channel).set(buffer.getChannelData(channel).subarray(read,read+length),write)}
          src.buffer=piece;src.loop=true;src.loopStart=0;src.loopEnd=piece.duration;loopOffset=Math.max(0,offset-loop.start)%piece.duration;
        }gain.gain.value=stem.enabled&&(privateStem?(stem.category==='click'?this.click:this.cues):this.stems)&&(!song.stems.some(s=>s.solo&&!this.audience||s.solo&&!restricted(s))||stem.solo)?stem.volume*(stem.category==='click'?this.clickVolume:1):0;src.connect(gain);const privateAudio=restricted(stem);if(ctx.createStereoPanner&&!this.split){const pan=ctx.createStereoPanner();pan.pan.value=stem.pan||0;this.pans.set(stem.id,pan);gain.connect(pan);this.output(pan,privateAudio);}else this.output(gain,privateAudio);if(loop)src.start(when,loopOffset);else src.start(when+Math.max(0,stemOffset-offset)/rate,bufferOffset,Math.max(.001,song.duration-Math.max(offset,stemOffset)));this.sources.push(src);this.gains.set(stem.id,gain);
      }
    }
    const map=beatMap(song),shift=map?.length?(song.beatOffset-map[0]):0;
    const beats=map?.length?map.map((at,index)=>({at:at+shift,index})):Array.from({length:Math.ceil(song.duration*song.bpm/60)+1},(_,index)=>({at:song.beatOffset+index*60/song.bpm,index}));
    const loopBeats=loop?beats.filter(b=>b.at>=loop.start&&b.at<loop.end):[];
    let scheduledThrough=this.now()+4;
    const clickAt=(at:number,index:number)=>{const audioAt=this.audioTime(at);if(audioAt<=ctx.currentTime+.004||!this.click||this.audience)return;const osc=ctx.createOscillator(),gain=ctx.createGain();this.clicks.add(osc);osc.onended=()=>this.clicks.delete(osc);osc.frequency.value=((index%song.beats)+song.beats)%song.beats===0?1500:1000;gain.gain.setValueAtTime(this.clickVolume,audioAt);gain.gain.exponentialRampToValueAtTime(.001,audioAt+.035);osc.connect(gain);this.output(gain,true);osc.start(audioAt);osc.stop(audioAt+.04)};
    const tick=()=>{
      if(!this.ready)return;
      const from=Math.max(scheduledThrough,this.now()+4),until=this.now()+Math.max(180,(this.latency+.15)*1000);
      const countBeats=song.countIn*song.beats;
      for(let i=0;t.countIn>0&&i<countBeats;i++){const at=t.startAt-t.countIn*1000+i*t.countIn*1000/Math.max(1,countBeats);if(at>=from&&at<until)clickAt(at,i)}
      if(this.generatedClick){
        if(loop){const length=(loop.end-loop.start)/rate,origin=t.startAt+(loop.start-t.offset)/rate*1000;const first=Math.max(0,Math.floor((from-origin)/1000/length));for(let cycle=first;cycle<=first+2;cycle++)for(const b of loopBeats){const at=origin+cycle*length*1000+(b.at-loop.start)/rate*1000;if(at>=t.startAt&&at>=from&&at<until)clickAt(at,b.index)}}
        else {let low=0,high=beats.length;const minimum=t.offset+(from-t.startAt)/1000*rate;while(low<high){const middle=(low+high)>>>1;if(beats[middle].at<minimum)low=middle+1;else high=middle}for(let i=low;i<beats.length;i++){const b=beats[i];const at=t.startAt+(b.at-t.offset)/rate*1000;if(at>=until)break;if(at>=t.startAt&&at>=from&&at<until&&b.at<song.duration){clickAt(at,b.index);this.nextBeat=b.index+1}}}
      }
      scheduledThrough=until;
      if(!loop&&this.now()>t.startAt+(song.duration-t.offset)/rate*1000+200){if(this.timer)clearInterval(this.timer);this.timer=null}
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
