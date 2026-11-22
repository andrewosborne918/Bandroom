'use client';

import {useEffect,useId,useSyncExternalStore,type ReactNode} from 'react';

const APP_SIZES=[80,90,100,110,125,150];
const SCORE_SIZES=[60,75,90,100,110,125,150,175,200];
const CHANGE_EVENT='bndrm-text-size-change';
type SizeKind='app'|'chart'|'tab';
const keys:Record<SizeKind,string>={app:'bndrm-text-size-v1',chart:'bndrm-chart-size-v1',tab:'bndrm-tab-size-v1'};
const volatileSizes:Partial<Record<SizeKind,number>>={};
const sizesFor=(kind:SizeKind)=>kind==='app'?APP_SIZES:SCORE_SIZES;
function readSize(kind:SizeKind){
 if(volatileSizes[kind]!==undefined)return volatileSizes[kind]!;
 try{const value=Number(localStorage.getItem(keys[kind]));return sizesFor(kind).includes(value)?value:100}catch{return 100}
}
function subscribe(listener:()=>void){
 const sync=(event:StorageEvent)=>{if(event.key===null||Object.values(keys).includes(event.key))listener()};
 window.addEventListener('storage',sync);
 window.addEventListener(CHANGE_EVENT,listener);
 return()=>{window.removeEventListener('storage',sync);window.removeEventListener(CHANGE_EVENT,listener)};
}
function changeSize(kind:SizeKind,value:number){
 if(!sizesFor(kind).includes(value))return;
 try{localStorage.setItem(keys[kind],String(value));delete volatileSizes[kind]}catch{volatileSizes[kind]=value}
 window.dispatchEvent(new Event(CHANGE_EVENT));
}
const readAppSize=()=>readSize('app');
const readChartSize=()=>readSize('chart');
const readTabSize=()=>readSize('tab');
const defaultSize=()=>100;
export function TextSizeProvider({children}:{children:ReactNode}){
 const size=useSyncExternalStore(subscribe,readAppSize,defaultSize);
 const chartSize=useSyncExternalStore(subscribe,readChartSize,defaultSize);
 const tabSize=useSyncExternalStore(subscribe,readTabSize,defaultSize);
 useEffect(()=>{
  const style=document.documentElement.style;
  style.setProperty('--app-text-scale',String(size/100));
  style.setProperty('--chart-text-scale',String(chartSize/100));
  style.setProperty('--tab-text-scale',String(tabSize/100));
 },[size,chartSize,tabSize]);
 return children;
}
function SizeControl({kind,label}:{kind:SizeKind;label:string}){
 const size=useSyncExternalStore(subscribe,kind==='app'?readAppSize:kind==='chart'?readChartSize:readTabSize,defaultSize);
 const id=useId();
 return <div className="size-control">
  <label htmlFor={id}>{label}</label>
  <div className="text-size-controls">
   <select id={id} value={size} onChange={event=>changeSize(kind,Number(event.target.value))}>
    {sizesFor(kind).map(value=><option key={value} value={value}>{value}%{value===100?' (default)':''}</option>)}
   </select>
   <button type="button" className="button subtle" disabled={size===100} onClick={()=>changeSize(kind,100)} aria-label={'Reset '+label.toLowerCase()}>Reset</button>
  </div>
 </div>;
}
export function ScoreSizeControl({view}:{view:string}){
 return <div className="score-size-toolbar"><SizeControl kind={view==='tabs'?'tab':'chart'} label={view==='tabs'?'Tab size':'Chart and lyrics size'}/></div>;
}
export default function TextSizeSettings(){
 const id=useId();
 return <section className="text-size-settings" aria-labelledby={id}>
  <h3 id={id}>Display</h3>
  <SizeControl kind="app" label="App text size"/>
  <p className="form-hint">Menus, buttons and settings.</p>
  <SizeControl kind="chart" label="Chart and lyrics size"/>
  <p className="chart-size-preview">C · G · Am · F<br/>Your chart and lyrics preview.</p>
  <SizeControl kind="tab" label="Tab size"/>
  <pre className="tab-size-preview">{'e|--0--3--5--3--|\nB|--1--0--1--0--|'}</pre>
  <p className="form-hint">Each size is independent. Changes apply immediately and are saved on this device. You can also adjust chart and tab sizes above the song.</p>
 </section>;
}
