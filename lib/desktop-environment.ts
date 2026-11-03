type DesktopWindow={__BNDRM_DESKTOP__?:boolean;__TAURI__?:unknown;location?:{protocol:string}};
export function isDesktopEnvironment(window:DesktopWindow|undefined,userAgent=''){
 return !!window&&(window.__BNDRM_DESKTOP__===true||!!window.__TAURI__||window.location?.protocol==='tauri:'||userAgent.includes('Tauri'));
}
