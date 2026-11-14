// One vendor port, independent browser and API request namespaces.
module.exports = function coordinator({browser, result}) {
  let port, ready, browserAttached=false, browserHello=false;let generation=0;
  const pending=new Map();
  const fail=reason=>{for(const id of pending.keys())result({id,error:reason});pending.clear();};
  return {
    attach(next) {
      if(port)fail('Coordinator replaced; request outcome may be unknown');
      port?.close();port=next;ready=undefined;browserHello=false;
      next.addEventListener('message',({data:m})=>{
        if(port!==next)return;
        if(m.kind==='lifecycle'&&m.phase==='ready'){
          ready=m;
          for(const [id,{method,args}] of pending)next.postMessage({kind:'request',requestId:`api:${id}`,method,args});
          if(browserHello)browser(m);return;
        }
        if(m.kind==='reply'&&m.requestId.startsWith('api:')){
          const id=m.requestId.slice(4);
          if(pending.delete(id))result({id,outcome:m.outcome});return;
        }
        if(m.kind==='reply'&&m.requestId.startsWith('web:')){
          const prefix=`web:${generation}:`;
          if(browserAttached&&m.requestId.startsWith(prefix))browser({...m,requestId:m.requestId.slice(prefix.length)});
          return;
        }
        if(m.kind==='lifecycle'&&m.phase==='shutdown'){
          ready=undefined;port=undefined;fail('Coordinator shut down; request outcome may be unknown');
        }
        if(browserAttached)browser(m);
      });
      next.start();next.postMessage({kind:'lifecycle',phase:'hello',protocolVersion:3});
    },
    browserAttach(){generation++;browserAttached=true;browserHello=false;},
    browserDetach(){browserAttached=false;browserHello=false;},
    browserSend(m){
      if(m.kind==='lifecycle'){
        if(m.phase==='hello'){browserHello=true;if(ready)browser(ready);}
        else if(m.phase==='shutdown'){browserAttached=false;browserHello=false;}
        return;
      }
      if(typeof m.requestId==='string'&&m.requestId.startsWith('api:'))throw Error('Reserved request ID');
      port?.postMessage(typeof m.requestId==='string'?{...m,requestId:`web:${generation}:${m.requestId}`}:m);
    },
    request(id,method,args){
      pending.set(id,{method,args});if(!ready)return;
      port.postMessage({kind:'request',requestId:`api:${id}`,method,args});
    },
    cancel(id){if(pending.delete(id))port?.postMessage({kind:'cancel',requestId:`api:${id}`});},
    get attached(){return !!port;}
  };
};
