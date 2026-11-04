'use client';

import {useEffect} from 'react';

// Settings can open above a song editor. Keep the page locked until both close.
let locks = 0;
let release: (() => void) | undefined;

export function useModalViewport(open: boolean) {
  useEffect(() => {
    if (!open) return;
    if (locks++ === 0) {
      const root = document.documentElement;
      const body = document.body;
      const x = window.scrollX, y = window.scrollY;
      const bodyProperties = ['position', 'top', 'left', 'width', 'overflow'] as const;
      const rootProperties = ['overflow', 'overscroll-behavior', '--modal-height', '--modal-top'] as const;
      const savedBody = bodyProperties.map(key => [key, body.style.getPropertyValue(key)]);
      const savedRoot = rootProperties.map(key => [key, root.style.getPropertyValue(key)]);
      body.style.position = 'fixed';
      body.style.top = `${-y}px`;
      body.style.left = `${-x}px`;
      body.style.width = '100%';
      body.style.overflow = 'hidden';
      root.style.overflow = 'hidden';
      root.style.overscrollBehavior = 'none';
      const viewport = window.visualViewport;
      const resize = () => {
        root.style.setProperty('--modal-height', `${viewport?.height ?? window.innerHeight}px`);
        root.style.setProperty('--modal-top', `${viewport?.offsetTop ?? 0}px`);
      };
      resize();
      viewport?.addEventListener('resize', resize);
      viewport?.addEventListener('scroll', resize);
      window.addEventListener('resize', resize);
      release = () => {
        viewport?.removeEventListener('resize', resize);
        viewport?.removeEventListener('scroll', resize);
        window.removeEventListener('resize', resize);
        for (const [key, value] of savedBody) body.style.setProperty(key, value);
        for (const [key, value] of savedRoot) root.style.setProperty(key, value);
        window.scrollTo({left: x, top: y, behavior: 'instant'});
      };
    }
    return () => {
      if (--locks === 0) {
        release?.();
        release = undefined;
      }
    };
  }, [open]);
}
