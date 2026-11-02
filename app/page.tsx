"use client";
import { FormEvent, useEffect, useRef, useState } from "react";

type Entry = { id:number; command:string; output:string; code:number|null };
export default function Home() {
 const [command,setCommand]=useState("");
 const [entries,setEntries]=useState<Entry[]>([]);
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState("ON DEMAND");
 const [fileName,setFileName]=useState("");
 const [fileStatus,setFileStatus]=useState("");
 const input=useRef<HTMLInputElement>(null);
 const output=useRef<HTMLDivElement>(null);
 const history=useRef<string[]>([]);
 const historyIndex=useRef(-1);
 useEffect(()=>{output.current?.scrollTo({top:output.current.scrollHeight,behavior:"smooth"});},[entries]);
 async function run(raw:string) {
  const value=raw.trim(); if(!value||busy)return;
  if(value==="clear"){setEntries([]);setCommand("");return;}
  if(value==="help"){setEntries(old=>[...old,{id:Date.now(),command:value,code:0,output:"Available commands:\nhelp, clear, pwd, whoami, id, uname -a, ls -la, date, df -h, free -h, python3 --version, node --version, git --version\ncurl -I https://example.com\ncurl -L https://example.com\nwget https://example.com/robots.txt\n\nHTTPS outbound networking is enabled in your isolated sandbox. File upload and download are available above."}]);setCommand("");return;}
  history.current=[...history.current.filter(x=>x!==value),value].slice(-100);historyIndex.current=-1;
  setBusy(true);setCommand("");
  const id=Date.now();setEntries(old=>[...old,{id,command:value,output:"Running in isolated sandbox…",code:null}]);
  try{
   const response=await fetch("/api/terminal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({command:value})});
   const data=await response.json();if(!response.ok)throw new Error(data.error||"Sandbox request failed");
   setStatus("ACTIVE");
   setEntries(old=>old.map(e=>e.id===id?{...e,output:data.output||"(no output)",code:data.exitCode}:e));
  }catch(e){setStatus("ERROR");setEntries(old=>old.map(x=>x.id===id?{...x,output:e instanceof Error?e.message:"Sandbox unavailable",code:1}:x));}
  finally{setBusy(false);input.current?.focus();}
 }

 async function uploadFile(file?:File) {
  if(!file)return;
  setFileStatus("Uploading "+file.name+"…");
  const form=new FormData();form.append("file",file);
  try {
   const response=await fetch("/api/files",{method:"POST",body:form});
   const data=await response.json();if(!response.ok)throw new Error(data.error||"Upload failed");
   setFileName(file.name);setFileStatus("Uploaded "+file.name+" ("+data.size+" bytes)");
  } catch(e){setFileStatus(e instanceof Error?e.message:"Upload failed");}
 }
 async function downloadFile() {
  const name=fileName.trim();if(!name)return;
  setFileStatus("Preparing "+name+"…");
  try {
   const response=await fetch("/api/files?name="+encodeURIComponent(name));
   if(!response.ok){const data=await response.json();throw new Error(data.error||"Download failed");}
   const blob=await response.blob();const url=URL.createObjectURL(blob);
   const a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);
   setFileStatus("Downloaded "+name);
  } catch(e){setFileStatus(e instanceof Error?e.message:"Download failed");}
 }

 function submit(e:FormEvent){e.preventDefault();void run(command);}
 function handleInputKey(e:React.KeyboardEvent<HTMLInputElement>){
  if(e.key==="ArrowUp"){e.preventDefault();const next=historyIndex.current<0?history.current.length-1:Math.max(0,historyIndex.current-1);historyIndex.current=next;setCommand(history.current[next]||"");}
  if(e.key==="ArrowDown"){e.preventDefault();const next=historyIndex.current+1;if(next>=history.current.length){historyIndex.current=-1;setCommand("");}else{historyIndex.current=next;setCommand(history.current[next]||"");}}
  if(e.key==="l"&&e.ctrlKey){e.preventDefault();setEntries([]);}
 }
 return <main className="shell">
  <header className="topbar"><a className="brand" href="/"> <span className="mark">▣</span> LINUX<span>TERMIAL</span></a><div className="private">● PRIVATE LAB <small>BUILD 0.1.0</small></div></header>
  <div className="layout"><aside className="sidebar"><div className="label">WORKSPACE</div><div className="nav active">⌘ &nbsp; Terminal</div><div className="nav active">▤ &nbsp; Files <small>READY</small></div><div className="nav muted">◇ &nbsp; Security tools <small>SOON</small></div><hr/><div className="label">ENVIRONMENT</div><div className="env"><b>⌁ &nbsp; Linux Sandbox</b><small>Ubuntu · isolated microVM</small></div><p className="status">● {status}</p><div className="bottom"><div className="label">SAFETY MODE</div><div className="env"><b>◎ &nbsp; Network enabled</b><small>Outbound internet available</small></div><p>Only test systems you own or have permission to assess.</p></div></aside>
  <section className="main"><div className="heading"><div><div className="label">PRIVATE COMPUTE / TERMINAL</div><h1>Linux <span>Terminal</span></h1><p>A Linux command workspace running in an isolated microVM.</p></div><div className="session">● SESSION &nbsp; <b>{status}</b></div></div>
  <div className="terminal"><div className="bar"><div className="lights"><i/><i/><i/></div><span>ubuntu@linuxtermial — bash</span><button onClick={()=>setEntries([])}>CLEAR</button></div>
  <div className="output" ref={output} onClick={()=>input.current?.focus()}>{entries.length===0&&<div className="welcome"><pre>{String.raw` _     ___ _   _ _   ___  _____ ____  __  __ ___    _    _
| |   |_ _| \ | | | / / |/ /_ _|  \/  |_ _|  / \  | |
| |    | ||  \| | |/ /| ' / | || |\/| || |  / _ \ | |
| |___ | || |\  |   < | . \ | || |  | || | / ___ \| |___
|_____|___|_| \_|_|\_\|_|\_\___|_|  |_|___/_/   \_\_____|`}</pre><p>Welcome to your private Linux workspace.</p><p>Real commands execute in an isolated Vercel Sandbox.</p><p>HTTPS network access is enabled for this sandbox.</p><p>Try <code>help</code> to see available commands.</p></div>}
  {entries.map(e=><div className="entry" key={e.id}><div><b>ubuntu@linuxtermial</b><span>:/workspace$ </span>{e.command}</div><pre className={e.code===1?"error":""}>{e.output}</pre>{e.code!==null&&<small>EXIT CODE: {e.code}</small>}</div>)}
  {busy&&<div className="running">● RUNNING IN ISOLATED SANDBOX…</div>}</div>
  <form className="inputbar" onSubmit={submit}><strong>❯</strong><input ref={input} value={command} onChange={e=>setCommand(e.target.value)} onKeyDown={handleInputKey} placeholder="Enter a Linux command…" disabled={busy} autoComplete="off" spellCheck={false}/><button disabled={busy||!command.trim()}>RUN ↗</button></form></div>
  <div className="files-panel"><div><b>FILES</b><small>Upload files to your private sandbox workspace (4 MB max).</small></div><label className="file-pick">UPLOAD FILE<input type="file" onChange={e=>void uploadFile(e.target.files?.[0])}/></label><input className="filename" value={fileName} onChange={e=>setFileName(e.target.value)} placeholder="Filename to download…"/><button className="file-download" onClick={()=>void downloadFile()} disabled={!fileName.trim()}>DOWNLOAD ↧</button>{fileStatus&&<small className="file-status">{fileStatus}</small>}</div>\n  <div className="quick"><span>QUICK COMMANDS</span>{["whoami","pwd","uname -a","ls -la","python3 --version","git --version"].map(x=><button key={x} disabled={busy} onClick={()=>void run(x)}>{x}</button>)}</div>
  <div className="notice">ⓘ &nbsp; <span><b>Sandbox boundary:</b> Commands run in an isolated microVM, not on the Vercel application server. HTTPS network access is enabled. Use curl -I https://example.com to test it.</span></div>
  <footer><span>LINUXTERMIAL · PRIVATE SECURITY WORKSPACE</span><span>POWERED BY VERCEL SANDBOX</span></footer></section></div>
 </main>;
}