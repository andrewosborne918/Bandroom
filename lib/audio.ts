import {outputAudioTime} from './audio-clock.ts';
import {playbackIndex,packedStream} from './packed-audio.ts';
import {WavStream,wavHeader,type AudioRange} from './wav-stream.ts';
import {safeLoop,transportPosition,loopClock} from './rehearsal.ts';
import {audioCacheKey,decodedAudioCache,deviceAudioBudget} from './audio-cache.ts';
import {beatMap} from './analysis.ts';
import {restricted} from './stems.ts';
import type { Song, Transport } from './types';
export class BandAudio {
  context: AudioContext | null=null;
  buffers=new Map<string,AudioBuffer>();
  bufferKeys=new Map<string,string>();
  streams=new Map<string,WavStream>();private streamStops:(()=>void)[]=[];
  onStreamError:(error:Error)=>void=()=>{};
  async loadWav(songId:string,stem:import('./types').Stem,read:AudioRange,retain:()=>boolean=()=>true,packedBytes?:number){
    const key=audioCacheKey(songId,stem)+(packedBytes?':aac':'');if(this.bufferKeys.get(stem.id)===key&&this.streams.has(stem.id))return;
    if(!this.context)this.context=new AudioContext({latencyHint:'interactive'});
    const context=this.context;
    const index=packedBytes?await playbackIndex(read,packedBytes):null;const header=index?{duration:index.frames/index.sampleRate,channels:index.channels,sampleRate:index.sampleRate}:await wavHeader(read,stem.bytes);if(this.streamingBytes+Math.min(24,header.duration)*header.channels*Math.max(header.sampleRate,context.sampleRate)*4>deviceAudioBudget())throw Error('This high-resolution arrangement exceeds this device’s audio memory. Reduce its tracks or use a computer.');const stream=index?packedStream(context,index,read):new WavStream(context,header as import('./wav-stream.ts').WavHeader,read);
    await stream.prepare(0);if(!retain()||this.context!==context){stream.clear();return}this.streams.get(stem.id)?.clear();this.streams.set(stem.id,stream);this.bufferKeys.set(stem.id,key);
  }
  releaseExcept(keep:Set<string>){for(const id of this.buffers.keys())if(!keep.has(id)){this.buffers.delete(id);this.bufferKeys.delete(id)}for(const [id,stream] of this.streams)if(!keep.has(id)){stream.clear();this.streams.delete(id);this.bufferKeys.delete(id)}}
  get streamingBytes(){return [...this.streams.values()].reduce((n,stream)=>n+Math.min(24,stream.header.duration)*stream.header.channels*Math.max(stream.header.sampleRate,this.context?.sampleRate||0)*4,0)}
  clearAudio(){this.releaseExcept(new Set());this.bufferKeys.clear()}
  async preparePlayback(song:Song,t:Transport){const position=t.status==='preparing'?t.offset:transportPosition(t,Math.max(t.startAt,this.now()+100),song.duration);await Promise.all(song.stems.map(async stem=>{const stream=this.streams.get(stem.id);if(!stream)return;await stream.prepare(Math.max(0,position-(stem.offset||0)));const loop=safeLoop(t.loop,song.duration);if(loop)await stream.prepare(Math.max(0,loop.start-(stem.offset||0)),Math.min(8,loop.end-loop.start))}))}

  async loadStem(songId:string,stem:import('./types').Stem,loader:()=>Promise<ArrayBuffer>,retain:()=>boolean=()=>true,background=false){const key=audioCacheKey(songId,stem);if(this.bufferKeys.get(stem.id)===key&&this.buffers.has(stem.id))return this.buffers.get(stem.id)!;const buffer=await decodedAudioCache.load(key,async()=>this.decode(await loader(),!background),deviceAudioBudget());if(retain()){this.buffers.set(stem.id,buffer);this.bufferKeys.set(stem.id,key)}return buffer;}
  hasStem(songId:string,stem:import('./types').Stem){return (this.buffers.has(stem.id)||this.streams.has(stem.id))&&[audioCacheKey(songId,stem),audioCacheKey(songId,stem)+':aac'].includes(this.bufferKeys.get(stem.id)||'');}
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
  async arm(){
    if(!this.context)this.context=new AudioContext({latencyHint:'interactive'});
    const context=this.context;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([context.resume(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Audio did not start. Tap Enable audio or reconnect this device’s audio output.')),4000)})]);}
    finally{if(timer)clearTimeout(timer)}
    if(context.state!=='running')throw Error('Audio is interrupted. Reconnect this device’s audio output.');
  }
  async reconnectOutput(){
    const previous=this.context;
    // Create/resume inside the button gesture, before awaiting any network work.
    this.stop();this.clearAudio();this.pitchFactory=null;
    this.context=new AudioContext({latencyHint:'interactive'});
    void previous?.close().catch(()=>{});
    await this.arm();
  }
  async testOutput(){
    await this.arm();
    const context=this.context!,tone=context.createOscillator(),gain=context.createGain();
    const at=context.currentTime+.03;
    tone.frequency.value=523.25;
    gain.gain.setValueAtTime(0,at);
    gain.gain.linearRampToValueAtTime(.06,at+.02);
    gain.gain.linearRampToValueAtTime(0,at+.45);
    tone.connect(gain);gain.connect(context.destination);
    tone.onended=()=>{tone.disconnect();gain.disconnect()};
    tone.start(at);tone.stop(at+.5);
  }
  get ready(){return this.context?.state==='running';}
  get latency(){return this.context?.outputLatency||this.context?.baseLatency||0;}
  async decode(data:ArrayBuffer,activate=true){ if(activate)await this.arm();else if(!this.context)this.context=new AudioContext({latencyHint:'interactive'});return await this.context!.decodeAudioData(data); }
  stop(){this.streamStops.forEach(stop=>stop());this.streamStops=[];this.clicks.forEach(o=>{try{o.stop();}catch{}});this.clicks.clear();this.sources.forEach(s=>{try{s.stop();}catch{}});this.sources=[];this.effects.forEach(n=>n.disconnect());this.effects=[];this.rateOutput=null;this.gains.clear();this.pans.clear();if(this.timer)clearInterval(this.timer);this.timer=null;this.run='';this.transport=null;}
  output(node:AudioNode,click=false){
    if(this.audience&&click)return;
    const ctx=this.context!;
    if(this.split&&!this.audience){const mono=ctx.createGain();mono.channelCount=1;mono.channelCountMode='explicit';const merge=ctx.createChannelMerger(2);node.connect(mono);mono.connect(merge,0,click?1:0);merge.connect(this.rateOutput||ctx.destination);}
    else node.connect(this.rateOutput||ctx.destination);
  }
  private startTarget=0;
  audioTime(serverMs:number){return outputAudioTime(this.context!,serverMs,this.now(),performance.now(),this.adjustment)}
  driftMs(t:Transport){return this.run===t.run&&this.ready?1000*(this.audioTime(t.startAt)-this.startTarget):0}
  start(song:Song,t:Transport){
    this.stop();this.run=t.run;this.song=song;this.transport=t;
    if(t.status!=='playing')return;
    if(!this.ready)throw Error('Audio output is interrupted. Enable audio or reconnect this device’s output.');
    const rate=t.rate||1,loop=safeLoop(t.loop,song.duration);if(rate!==1&&!this.pitchFactory)throw Error('Prepare practice speed before playback');const ctx=this.context!;if(rate!==1){this.rateOutput=this.pitchFactory!(ctx,rate);this.rateOutput.connect(ctx.destination);this.effects.push(this.rateOutput)}const target=this.audioTime(t.startAt);this.startTarget=target;const when=Math.max(ctx.currentTime+.03,target),offset=transportPosition(t,t.startAt+Math.max(0,when-target)*1000,song.duration);
    const loopState=loopClock(t,t.startAt+Math.max(0,when-target)*1000,song.duration);
    if(offset<song.duration||loop){
      for(const stem of song.stems){
        if(this.audience&&restricted(stem))continue;const privateStem=restricted(stem);
        const buffer=this.buffers.get(stem.id),stream=this.streams.get(stem.id),stemOffset=stem.offset||0,bufferOffset=Math.max(0,offset-stemOffset);if((!buffer&&!stream)||!loop&&(bufferOffset>=(stream?.header.duration??buffer!.duration)||stemOffset>=song.duration))continue;
        const gain=ctx.createGain();gain.gain.value=stem.enabled&&(privateStem?(stem.category==='click'?this.click:this.cues):this.stems)&&(!song.stems.some(s=>s.solo&&!this.audience||s.solo&&!restricted(s))||stem.solo)?stem.volume*(stem.category==='click'?this.clickVolume:1):0;
        const privateAudio=restricted(stem);if(ctx.createStereoPanner&&!this.split){const pan=ctx.createStereoPanner();pan.pan.value=stem.pan||0;this.pans.set(stem.id,pan);gain.connect(pan);this.output(pan,privateAudio);}else this.output(gain,privateAudio);this.gains.set(stem.id,gain);
        if(stream){this.streamStops.push(stream.schedule(ctx,gain,{when:when+loopState.restRemaining,offset:loopState.restRemaining&&loop?loop.start:offset,duration:song.duration,stemOffset,rate,loop},error=>{this.stop();this.onStreamError(error)}));continue}
        const audio=buffer!,src=ctx.createBufferSource();if(!loop)src.buffer=audio;if(rate!==1)src.playbackRate.value=rate;
        let loopOffset=bufferOffset;
        if(loop){
          const frames=Math.ceil((loop.end-loop.start+(loop.rest||0)*rate)*audio.sampleRate),piece=ctx.createBuffer(audio.numberOfChannels,frames,audio.sampleRate);
          for(let channel=0;channel<audio.numberOfChannels;channel++){const from=Math.round((loop.start-stemOffset)*audio.sampleRate),read=Math.max(0,from),write=Math.max(0,-from),length=Math.min(audio.length-read,Math.ceil((loop.end-loop.start)*audio.sampleRate)-write);if(length>0)piece.getChannelData(channel).set(audio.getChannelData(channel).subarray(read,read+length),write)}
          src.buffer=piece;src.loop=true;src.loopStart=0;src.loopEnd=piece.duration;loopOffset=loopState.cycleOffset%piece.duration;
        }src.connect(gain);if(loop)src.start(when,loopOffset);else src.start(when+Math.max(0,stemOffset-offset)/rate,bufferOffset,Math.max(.001,song.duration-Math.max(offset,stemOffset)));this.sources.push(src);
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
        if(loop){const length=(loop.end-loop.start)/rate+(loop.rest||0),origin=t.startAt+(loop.start-t.offset)/rate*1000;const first=Math.max(0,Math.floor((from-origin)/1000/length));for(let cycle=first;cycle<=first+2;cycle++)for(const b of loopBeats){const at=origin+cycle*length*1000+(b.at-loop.start)/rate*1000;if(at>=t.startAt&&at>=from&&at<until)clickAt(at,b.index)}}
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
