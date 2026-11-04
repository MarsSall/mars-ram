import { xtermJs, fitJs, xtermCss } from "./vendor";

// All code and styles are shipped with the app. No remote resources, file URLs,
// link provider, OSC clipboard provider, images, or dynamically evaluated input.
export const terminalHtml = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<style>${xtermCss}\nhtml,body,#terminal{width:100%;height:100%;margin:0;overflow:hidden;background:#000} .xterm{height:100%;padding:0 2px;box-sizing:border-box} .xterm-viewport{overscroll-behavior:contain}</style>
</head><body><div id="terminal"></div><script>${xtermJs}</script><script>${fitJs}</script><script>
(function(){
 const post = value => window.ReactNativeWebView.postMessage(JSON.stringify(value));
 const term = new Terminal({fontSize:14,fontFamily:'monospace',scrollback:5000,cursorBlink:true,allowProposedApi:false,convertEol:false});
 const fit = new FitAddon.FitAddon(); term.loadAddon(fit); term.open(document.getElementById('terminal'));
 const sendBytes = bytes => { for(let i=0;i<bytes.length;i+=32768) { let binary=''; for(const b of bytes.subarray(i,i+32768)) binary+=String.fromCharCode(b); post({type:'input',data:btoa(binary)}); } };
 term.onData(data => sendBytes(new TextEncoder().encode(data)));
 term.onBinary(data => sendBytes(Uint8Array.from(data,c=>c.charCodeAt(0))));
 term.onResize(size => post({type:'size',cols:size.cols,rows:size.rows}));
 let cursorMode=false;
 term.onWriteParsed(() => { const enabled=term.modes.applicationCursorKeysMode; if(enabled!==cursorMode){cursorMode=enabled;post({type:'cursorMode',enabled});} });
 term.onSelectionChange(() => {const text=term.getSelection();if(text && text.length<=65536)post({type:'selection',text});});
 const refit = () => {if(document.body.clientWidth>0 && document.body.clientHeight>0){fit.fit();post({type:'size',cols:term.cols,rows:term.rows});}};
 function receive(event){try{const m=JSON.parse(event.data);
  if(m.type==='output'){const binary=atob(m.data);term.write(Uint8Array.from(binary,c=>c.charCodeAt(0)));}
  else if(m.type==='reset'){term.reset();cursorMode=false;post({type:'cursorMode',enabled:false});post({type:'selection',text:''});}
  else if(m.type==='fit'||m.type==='resize')refit();
  else if(m.type==='fontSize'&&Number.isInteger(m.value)&&m.value>=8&&m.value<=28){term.options.fontSize=m.value;refit();}
  else if(m.type==='focus'){term.blur();term.focus();}
  else if(m.type==='blur'){term.blur();const active=document.activeElement;if(active&&typeof active.blur==='function')active.blur();}
 }catch(_){} }
 document.addEventListener('message',receive);window.addEventListener('message',receive);
 window.addEventListener('resize',refit);new ResizeObserver(refit).observe(document.body);
 document.getElementById('terminal').addEventListener('click',()=>term.focus());
 document.addEventListener('click',event=>{if(event.target.closest('a'))event.preventDefault();});
 window.open=()=>null;
 let pinch=null;
 const distance=touches=>Math.hypot(touches[0].clientX-touches[1].clientX,touches[0].clientY-touches[1].clientY);
 // One finger dragged vertically scrolls: a wheel event lets xterm report it to Herdr or scroll its own buffer.
 let drag=null;
 const wheel=(deltaY,touch)=>{const target=document.querySelector('.xterm-screen');if(target)target.dispatchEvent(new WheelEvent('wheel',{deltaY,deltaMode:0,clientX:touch.clientX,clientY:touch.clientY,bubbles:true,cancelable:true}));};
 document.addEventListener('touchstart',event=>{if(event.touches.length===2){drag=null;pinch={distance:distance(event.touches),size:term.options.fontSize};event.preventDefault();}else if(event.touches.length===1)drag={y:event.touches[0].clientY,scrolling:false};},{passive:false,capture:true});
 document.addEventListener('touchmove',event=>{if(pinch&&event.touches.length===2){event.preventDefault();const size=Math.max(8,Math.min(28,Math.round(pinch.size*distance(event.touches)/Math.max(1,pinch.distance))));if(size!==term.options.fontSize){term.options.fontSize=size;refit();post({type:'fontSize',value:size});}}
  else if(drag&&event.touches.length===1){const y=event.touches[0].clientY,dy=y-drag.y;if(!drag.scrolling&&Math.abs(dy)<8)return;drag.scrolling=true;drag.y=y;event.preventDefault();event.stopPropagation();wheel(-dy,event.touches[0]);}},{passive:false,capture:true});
 document.addEventListener('touchend',()=>{pinch=null;drag=null;},{capture:true});
 post({type:'ready'});requestAnimationFrame(refit);
})();
</script></body></html>`;
