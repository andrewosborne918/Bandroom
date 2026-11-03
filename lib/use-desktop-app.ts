'use client';
import {useSyncExternalStore} from 'react';
import {isDesktopEnvironment} from './desktop-environment';
const subscribe=()=>()=>{};
const serverSnapshot=()=>false;
const desktopSnapshot=()=>typeof window!=='undefined'&&isDesktopEnvironment(window,navigator.userAgent);
export function useDesktopApp(){return useSyncExternalStore(subscribe,desktopSnapshot,serverSnapshot)}
