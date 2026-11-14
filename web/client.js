(() => {
  const config = window.__grokWeb;
  const listeners = new Map(), pending = new Map(), ports = new Map();
  let nextId = 0, externalWindow = null;
  document.addEventListener('click',event=>{
    const target=event.target.closest?.('button,a');
    if(target && /^(Sign in|Reopen link)$/.test(target.textContent.trim())){
      externalWindow=window.open('about:blank','grok-bot-signin');
      if(externalWindow)externalWindow.document.body.textContent='Opening the official Grok Bot sign-in page…';
    }
  },true);
  const {encode,decode}=window.GrokWire;
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/__bridge/socket`);
  const ready = new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=()=>reject(new Error('Grok service connection failed'));});
  const send = async value => {await ready;socket.send(JSON.stringify(encode(value)));};
  function makePort(id) {
    const handlers = new Map(), queue = []; let started=false;
    const port = {postMessage:data=>send({type:'port-data',port:id,data}),start(){started=true;for(const m of queue.splice(0))port.dispatch(m);},close(){send({type:'port-close',port:id});ports.delete(id);},addEventListener(type,cb){if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(cb);},dispatch(data){if(!started){queue.push(data);return;}for(const cb of handlers.get('message')||[])cb({data});}};
    ports.set(id,port);return port;
  }
  socket.onmessage = event => {
    const m=decode(JSON.parse(event.data));
    if(m.type==='reply'){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error)):p.resolve(m.value);}return;}
    if(m.type==='event'){const event={ports:(m.ports||[]).map(makePort)};for(const cb of [...(listeners.get(m.channel)||[])])cb(event,...(m.args||[]));return;}
    if(m.type==='port-data'){ports.get(m.port)?.dispatch(m.data);return;}
    if(m.type==='external-url'){
      const url=new URL(m.url);if(!['https:','http:','mailto:'].includes(url.protocol))return;
      if(externalWindow&&!externalWindow.closed){externalWindow.location.href=m.url;externalWindow=null;return;}
      const opened=window.open(m.url,'grok-bot-external');if(opened)return;
      const link=document.createElement('a');link.href=m.url;link.target='_blank';link.rel='noopener';link.textContent='Continue sign in';
      link.style='position:fixed;right:24px;top:24px;z-index:2147483647;background:#111;color:white;padding:16px;border-radius:12px';
      link.onclick=()=>link.remove();document.body.append(link);
    }
  };
  socket.onclose=()=>{for(const p of pending.values())p.reject(new Error('Grok service disconnected; reload this page'));pending.clear();};
  const ipcRenderer={
    invoke(channel,...args){const id=++nextId;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});send({type:'invoke',id,channel,args}).catch(reject);});},
    send(channel,...args){void send({type:'send',channel,args});},
    sendSync(channel){if(channel==='sand:boot-snapshot-sync')return config.boot;throw new Error(`Unsupported synchronous IPC: ${channel}`);},
    on(channel,cb){if(!listeners.has(channel))listeners.set(channel,new Set());listeners.get(channel).add(cb);return this;},
    once(channel,cb){const wrapped=(...args)=>{this.off(channel,wrapped);cb(...args);};return this.on(channel,wrapped);},
    off(channel,cb){listeners.get(channel)?.delete(cb);return this;},
    removeListener(channel,cb){return this.off(channel,cb);},
    postMessage(channel,data,transfer){
      if(channel==='sand:render-trace-port')return;
      throw new Error(`Unsupported transferred IPC: ${channel}`);
    }
  };
  window.__electron={ipcRenderer,contextBridge:{exposeInMainWorld:(name,value)=>{window[name]=value;}},webFrame:{getZoomFactor:()=>1},webUtils:{getPathForFile:()=>''}};
})();
