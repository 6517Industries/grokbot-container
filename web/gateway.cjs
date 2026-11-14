const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const {records}=require('./users.cjs');
const access=require('./access.cjs');
const {translate}=require('./api.cjs');
function credential(req){
  const auth=req.headers.authorization||'';
  if(auth.startsWith('Bearer '))return {token:auth.slice(7)};
  if(auth.startsWith('Basic ')){
    const decoded=Buffer.from(auth.slice(6),'base64').toString(),colon=decoded.indexOf(':');
    if(colon>=0)return {id:decoded.slice(0,colon),token:decoded.slice(colon+1)};
  }
  return {};
}
function keyFor(req,user){return access.match(user.access,credential(req).token);}
function identity(req,users){
  const match=/^(?:([a-z][a-z0-9-]{0,30})\.)?(localhost|127\.0\.0\.1)(?::\d+)?$/.exec(req.headers.host||'');
  if(!match||match[1]&&match[2]!=='localhost')return null;
  const {id,token}=credential(req);
  const user=users.find(u=>(id===undefined||u.id===id)&&access.match(u.access,token));
  if(!user||match[1]&&match[1]!==user.id)return null;
  if(!req.url.startsWith('/api/')&&match[1]!==user.id)return null;
  return user;
}
function gateway(getUsers){
  const active=new Map(),rates=new Map();
  const audit=(user,tool,status,requestId)=>console.log(JSON.stringify({event:'grok_api',user:user.id,tool,status,requestId,at:new Date().toISOString()}));
  const deny=res=>{res.writeHead(401,{'WWW-Authenticate':'Basic realm="Grok Bot", charset="UTF-8"','Cache-Control':'no-store','Content-Type':'text/plain'});res.end('Use your user ID and bridge token. Browser URL: http://USER.localhost:8088/');};
  const headers=(req,user)=>({...req.headers,host:'localhost',origin:'http://localhost',authorization:`Bearer ${user.token}`});
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"frame-ancestors 'none'");
    const user=identity(req,getUsers());if(!user){deny(res);return;}
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`){res.writeHead(403);res.end('Origin refused');return;}
    if(req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end('Cross-site request refused');return;}
    const key=keyFor(req,user),isApi=req.url.startsWith('/api/');
    if(!isApi&&!['all','browser'].includes(key.scope)){res.writeHead(403);res.end('Browser access not permitted');return;}
    if(isApi&&!['all','tasks','read'].includes(key.scope)){res.writeHead(403);res.end('API access not permitted');return;}
    if(isApi&&!((req.url==='/api/tools'&&req.method==='GET')||(req.url==='/api/call'&&req.method==='POST'))){res.writeHead(404);res.end('Unknown API route');return;}
    let body,tool;
    if(req.url==='/api/call'){
      const now=Date.now(),rate=rates.get(user.id);
      if(!rate||now-rate.start>=60000)rates.set(user.id,{start:now,count:1});
      else if(++rate.count>120){res.writeHead(429,{'Retry-After':'60'});res.end('Per-user rate limit');return;}
      if((active.get(user.id)||0)>=8){res.writeHead(429,{'Retry-After':'2'});res.end('Too many concurrent calls');return;}
      active.set(user.id,(active.get(user.id)||0)+1);
      res.once('close',()=>active.set(user.id,Math.max(0,(active.get(user.id)||1)-1)));
      if(!req.headers['content-type']?.startsWith('application/json')){res.writeHead(415);res.end('Use application/json');return;}
      try{
        const chunks=[];let length=0;
        for await(const chunk of req){length+=chunk.length;if(length>128*1024){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
        body=Buffer.concat(chunks);const input=JSON.parse(body.toString('utf8'));
        if(!input||Object.keys(input).some(k=>!['name','arguments'].includes(k)))throw Error('Invalid call');
        tool=input.name;translate(tool,input.arguments??{});
        if(key.scope==='read'&&!['grok_list_bots','grok_read'].includes(tool)){res.writeHead(403);res.end('Read-only key cannot submit or interrupt tasks');return;}
      }catch{res.writeHead(400);res.end('Invalid tool call');return;}
    }
    // Never forward untrusted proxy-routing or connection-control headers.
    const requestHeaders=headers(req,user);
    for(const name of ['forwarded','x-forwarded-host','x-forwarded-for','x-forwarded-proto','connection','transfer-encoding','proxy-authorization'])delete requestHeaders[name];
    if(body)requestHeaders['content-length']=body.length;
    const requestId=crypto.randomUUID();res.setHeader('X-Request-ID',requestId);
    if(tool)res.once('close',()=>audit(user,tool,res.statusCode,requestId));
    const upstream=http.request({socketPath:user.socket,path:req.url,method:req.method,headers:requestHeaders},response=>{
      res.writeHead(response.statusCode,{...response.headers,'Cache-Control':'no-store'});response.pipe(res);
    });
    upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end('User service starting or unavailable; retry shortly');});
    upstream.setTimeout(65000,()=>upstream.destroy(Error('Upstream timeout')));
    req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());
    if(body)upstream.end(body);else req.pipe(upstream);
  });
  server.on('upgrade',(req,socket,head)=>{
    const user=identity(req,getUsers());
    if(!user||!['all','browser'].includes(keyFor(req,user).scope)||req.url!=='/__bridge/socket'||req.headers.origin!==`http://${req.headers.host}`){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
    const upstream=http.request({socketPath:user.socket,path:req.url,headers:headers(req,user)});
    upstream.on('upgrade',(response,peer,upHead)=>{
      const authorized=setInterval(()=>{if(!identity(req,getUsers())||!['all','browser'].includes(keyFor(req,user)?.scope))socket.destroy();},1000);
      socket.once('close',()=>clearInterval(authorized));
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([k,v])=>`${k}: ${v}\r\n`).join('')}\r\n`);
      if(upHead.length)socket.write(upHead);if(head.length)peer.write(head);
      peer.on('error',()=>socket.destroy());socket.on('error',()=>peer.destroy());
      socket.on('close',()=>peer.destroy());peer.on('close',()=>socket.destroy());socket.pipe(peer).pipe(socket);
    });
    upstream.on('response',()=>socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'));
    upstream.on('error',()=>socket.destroy());upstream.end();
  });
  server.headersTimeout=10000;server.requestTimeout=20000;server.maxRequestsPerSocket=1000;
  return server;
}
function main(){
  const root=process.env.GROK_DATA||'/data';const users=new Map();let stopping=false;
  fs.mkdirSync('/run/grok-users',{recursive:true,mode:0o711});
  function launch(record){
    const {id,uid}=record;const dir=path.join(root,'users',id);const home=path.join(dir,'home');
    // Parent directories allow traversal only; homes remain private to their UID.
    fs.chmodSync(root,0o711);fs.chmodSync(path.join(root,'users'),0o711);fs.chmodSync(dir,0o711);
    if(fs.statSync(home).uid!==uid||(fs.statSync(home).mode&0o077)!==0)throw Error(`Unsafe storage for ${id}: use a Docker named volume with a mode-700 home owned by UID ${uid}`);
    const account=`grok-${id}`;
    try{execFileSync('id',['-u',account],{stdio:'ignore'});}catch{execFileSync('groupadd',['-g',String(uid),account]);execFileSync('useradd',['-u',String(uid),'-g',String(uid),'-d',home,'-s','/bin/sh',account]);}
    const runtime=`/run/grok-users/${id}`;fs.mkdirSync(runtime,{recursive:true,mode:0o700});fs.chownSync(runtime,uid,uid);
    const socket=path.join(runtime,'bridge.sock');const display=`:${uid}`;const xauth=path.join(runtime,'Xauthority');
    try{fs.unlinkSync(xauth);}catch(e){if(e.code!=='ENOENT')throw e;}
    fs.writeFileSync(xauth,'',{mode:0o600,flag:'wx'});
    execFileSync('xauth',['-f',xauth,'add',display,'.',crypto.randomBytes(16).toString('hex')]);fs.chownSync(xauth,uid,uid);
    const token=access.backendToken(root,id);
    if(token.length<32)throw Error(`Invalid token for ${id}`);
    const user={id,token,socket,access:access.migrate(root,id,token)};users.set(id,user);
    const start=()=>{
      if(stopping)return;
      for(const file of [`/tmp/.X${uid}-lock`,`/tmp/.X11-unix/X${uid}`]){try{fs.unlinkSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}}
      // A distinct X server and Unix UID prevent cross-user display/profile access.
      const child=spawn('/bin/sh',['-c','rm -f "$HOME/.config/Grok Bot/SingletonLock" "$HOME/.config/Grok Bot/SingletonSocket" "$HOME/.config/Grok Bot/SingletonCookie"; Xvfb "$DISPLAY" -screen 0 1280x800x24 -nolisten tcp -auth "$XAUTHORITY" & xvfb=$!; trap "kill $xvfb 2>/dev/null || true" EXIT; dbus-run-session -- grok-bot --no-sandbox --disable-gpu'],{
        uid,gid:uid,cwd:home,detached:true,stdio:['ignore','inherit','inherit'],
        env:{PATH:process.env.PATH,HOME:home,USER:account,LOGNAME:account,DISPLAY:display,XAUTHORITY:xauth,XDG_RUNTIME_DIR:runtime,GROK_SOCKET:socket}
      });
      user.child=child;
      child.on('exit',()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}if(!stopping)setTimeout(start,3000);});
      child.on('error',e=>console.error(`Worker ${id}: ${e.message}`));
    };start();
  }
  function sync(){for(const u of records(root)){if(!users.has(u.id))launch(u);else{const user=users.get(u.id);try{user.access=access.read(root,u.id);}catch{user.access={disabled:true,keys:[]};}}}}
  sync();const timer=setInterval(()=>{try{sync();}catch(e){console.error(e.message);}},2000);
  const server=gateway(()=>[...users.values()]);server.listen(8080,'0.0.0.0',()=>console.log('[gateway] multi-user service listening on 8080'));
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{
    stopping=true;clearInterval(timer);server.close();
    for(const u of users.values())try{process.kill(-u.child.pid,'SIGTERM');}catch{}
    setTimeout(()=>process.exit(0),1500);
  });
}
if(require.main===module)main();
module.exports={identity,gateway};
