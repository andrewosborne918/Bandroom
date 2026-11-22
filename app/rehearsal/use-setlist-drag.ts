import {useEffect, useRef, useState, type PointerEvent} from 'react';

type Drop = {id: string; after: boolean};
type Drag = {id: string; pointer: number; startY: number; x: number; y: number; frame: number};

export function useSetlistDrag(enabled: boolean, move: (id: string, targetId: string, after: boolean) => void) {
  const list = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<{id: string; drop: Drop | null} | null>(null);

  function cancel() {
    if (!drag.current) return;
    cancelAnimationFrame(drag.current.frame);
    drag.current = null;
    setPreview(null);
  }

  useEffect(() => {
    if (!enabled && drag.current) {
      cancelAnimationFrame(drag.current.frame);
      drag.current = null;
    }
    return () => {
      if (drag.current) cancelAnimationFrame(drag.current.frame);
    };
  }, [enabled]);

  function dropAt(active: Drag): Drop | null {
    const sidebar = list.current?.closest('aside');
    const bounds = sidebar?.getBoundingClientRect();
    if (!bounds || active.x < bounds.left || active.x > bounds.right || active.y < bounds.top || active.y > bounds.bottom) return null;

    const rows = list.current!.querySelectorAll<HTMLElement>('[data-setlist-song]');
    for (const row of rows) {
      const bounds = row.getBoundingClientRect();
      if (active.y < bounds.top + bounds.height / 2) return {id: row.dataset.setlistSong!, after: false};
    }
    const last = rows[rows.length - 1];
    return last ? {id: last.dataset.setlistSong!, after: true} : null;
  }

  function showDrop(active: Drag) {
    const drop = dropAt(active);
    setPreview(previous => previous?.id === active.id && previous.drop?.id === drop?.id && previous.drop?.after === drop?.after
      ? previous
      : {id: active.id, drop});
  }

  function scrollWhileDragging(active: Drag) {
    const sidebar = list.current?.closest('aside');
    if (!sidebar || drag.current !== active) return;
    const {top, bottom, left, right} = sidebar.getBoundingClientRect();
    if (active.x >= left && active.x <= right && active.y >= top && active.y <= bottom) {
      const previous = sidebar.scrollTop;
      if (active.y < top + 44) sidebar.scrollTop -= 10;
      if (active.y > bottom - 44) sidebar.scrollTop += 10;
      if (sidebar.scrollTop !== previous) showDrop(active);
    }
    active.frame = requestAnimationFrame(() => scrollWhileDragging(active));
  }

  function start(event: PointerEvent<HTMLSpanElement>, id: string) {
    if (!enabled || !event.isPrimary || event.button !== 0) return;
    cancel();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {id, pointer: event.pointerId, startY: event.clientY, x: event.clientX, y: event.clientY, frame: 0};
  }

  function update(event: PointerEvent<HTMLSpanElement>) {
    const active = drag.current;
    if (!enabled || active?.pointer !== event.pointerId) return;
    active.x = event.clientX;
    active.y = event.clientY;
    if (!active.frame) {
      if (Math.abs(active.y - active.startY) < 4) return;
      active.frame = requestAnimationFrame(() => scrollWhileDragging(active));
    }
    showDrop(active);
  }

  function finish(event: PointerEvent<HTMLSpanElement>) {
    const active = drag.current;
    if (active?.pointer !== event.pointerId) return;
    const drop = enabled && active.frame ? dropAt({...active, x: event.clientX, y: event.clientY}) : null;
    cancel();
    if (drop && drop.id !== active.id) move(active.id, drop.id, drop.after);
  }

  return {
    list,
    preview: enabled ? preview : null,
    handle: (id: string) => ({
      onPointerDown: (event: PointerEvent<HTMLSpanElement>) => start(event, id),
      onPointerMove: update,
      onPointerUp: finish,
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
    }),
  };
}
