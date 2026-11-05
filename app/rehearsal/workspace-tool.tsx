'use client';
import {useState,type ReactNode} from 'react';

/** Mount secondary tools only when requested, so closed tools do no background work. */
export default function WorkspaceTool({title,children}:{title:string;children:ReactNode}){
 const [open,setOpen]=useState(false);
 return <details className="workspace-tool" onToggle={event=>setOpen(event.currentTarget.open)}><summary>{title}</summary>{open&&<div className="workspace-tool-body">{children}</div>}</details>;
}
