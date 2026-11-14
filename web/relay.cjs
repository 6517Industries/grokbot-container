(() => {
  const ipc=require('electron').ipcRenderer;
  const ports=new Map();let nextPort=0,coordinatorId,coordinatorArgs;
  const out=m=>ipc.send('__grokweb:out',m);
  const coordinator=require('/opt/grok-web/coordinator.cjs')({
    browser:data=>out({type:'port-data',port:coordinatorId,data}),
    result:m=>ipc.send('__grokweb:api-result',m)
  });
  const announce=()=>{
    coordinator.browserAttach();
    out({type:'event',channel:'sand:coordinator-port',args:coordinatorArgs,ports:[coordinatorId]});
  };
  const emit=ipc.emit.bind(ipc);
  ipc.emit=function(channel,event,...args){
    if(channel==='sand:coordinator-port'&&event?.ports?.[0]){
      coordinatorId=++nextPort;coordinatorArgs=args;
      coordinator.attach(event.ports[0]);announce();
    }else if(!channel.startsWith('__grokweb:')){
      const ids=(event?.ports||[]).map(port=>{
        const id=++nextPort;ports.set(id,port);
        port.addEventListener('message',e=>out({type:'port-data',port:id,data:e.data}));
        port.start();return id;
      });
      out({type:'event',channel,args,ports:ids});
    }
    return emit(channel,event,...args);
  };
  ipc.on('__grokweb:api',async(_,m)=>{
    if(m.cancel){coordinator.cancel(m.id);return;}
    try{
      if(!coordinator.attached)await ipc.invoke('sand:coordinator-port-request');
      coordinator.request(m.id,m.method,m.args);
    }catch(error){ipc.send('__grokweb:api-result',{id:m.id,error:error.message});}
  });
  ipc.on('__grokweb:request',async(_,m)=>{
    try {
      if(m.type==='invoke'){
        let value;
        if(m.channel==='sand:coordinator-port-request'&&coordinator.attached){announce();value=null;}
        else value=await ipc.invoke(m.channel,...m.args);
        out({type:'reply',id:m.id,value});
      }
      else if(m.type==='send')ipc.send(m.channel,...m.args);
      else if(m.type==='port-data'){
        if(m.port===coordinatorId)coordinator.browserSend(m.data);
        else ports.get(m.port)?.postMessage(m.data);
      }
      else if(m.type==='port-close'){
        if(m.port===coordinatorId)coordinator.browserDetach();
        else{ports.get(m.port)?.close();ports.delete(m.port);}
      }
      else if(m.type==='reset'){coordinator.browserDetach();for(const p of ports.values())p.close();ports.clear();}
    }catch(error){out({type:'reply',id:m.id,error:error.message});}
  });
  window.addEventListener('DOMContentLoaded',()=>ipc.send('__grokweb:ready',ipc.sendSync('sand:boot-snapshot-sync')),{once:true});
})();
