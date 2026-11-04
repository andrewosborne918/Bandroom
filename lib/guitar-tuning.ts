export const guitarTunings = [
  {id:'standard',name:'Standard',strings:'E A D G B E'},
  {id:'half-step-down',name:'Half-step down',strings:'E♭ A♭ D♭ G♭ B♭ E♭'},
  {id:'drop-d',name:'Drop D',strings:'D A D G B E'},
  {id:'whole-step-down',name:'Whole-step down',strings:'D G C F A D'},
] as const;
export type GuitarTuning = typeof guitarTunings[number]['id']|'custom';
export function safeGuitarTuning(value:unknown):GuitarTuning|undefined{
  return value==='custom'||guitarTunings.some(t=>t.id===value)?value as GuitarTuning:undefined;
}
export function guitarTuningInfo(info?:{guitarTuning?:GuitarTuning;guitarTuningCustom?:string}){
  if(info?.guitarTuning==='custom')return {name:'Custom tuning',strings:info.guitarTuningCustom||''};
  return guitarTunings.find(t=>t.id===info?.guitarTuning);
}
