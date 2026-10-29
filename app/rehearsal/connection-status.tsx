'use client';
import {useEffect,useState} from 'react';
export default function ConnectionStatus(){const [online,setOnline]=useState(true);useEffect(()=>{const update=()=>setOnline(navigator.onLine);update();window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update)}},[]);return online?null:<div className="connection-banner" role="status">You’re offline. Playing audio can continue; reconnect before changing songs or joining a session.</div>}
