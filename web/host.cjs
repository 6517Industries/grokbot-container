const {app,ipcMain,shell}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {WebSocketServer}=require('/usr/share/nodejs/ws');
const ROOT=path.join(app.getAppPath(),'dist/renderer');
const PRELOAD=path.join(app.getAppPath(),'dist/electron-preload/vendor-preload.cjs');
let contents,boot,client;
const api=require('/opt/grok-web/api.cjs').install({ipcMain,getContents:()=>contents});
const {encode,decode}=require('/opt/grok-web/wire.js');
const send=m=>{if(client?.readyState===1)client.send(JSON.stringify(encode(m)));};
ipcMain.on('__grokweb:ready',(event,value)=>{
  if(!event.sender.getURL().endsWith('/dist/renderer/index.html'))return;
  contents=event.sender;boot=value;console.log('[web] Electron services ready');
});
ipcMain.on('__grokweb:out',(event,message)=>{if(event.sender===contents){if(message.type==='event'&&message.channel==='sand:main-edge-served')boot.mainEdge='served';send(message);}});
const originalOpen=shell.openExternal.bind(shell);
shell.openExternal=async(url,options)=>{
  if(client?.readyState===1){send({type:'external-url',url});return;}
  return originalOpen(url,options);
};
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.wasm':'application/wasm'};
const validHost=host=>/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host||'');
const server=http.createServer(async(req,res)=>{
  if(!validHost(req.headers.host)){res.writeHead(403);res.end('Host refused');return;}
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"frame-ancestors 'none'");
  if(req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end('Cross-site request refused');return;}
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){await api(req,res);return;}
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  if(url.pathname==='/__bridge/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ready:!!boot,version:app.getVersion()}));return;}
  if(url.pathname==='/__bridge/config.js'){
    if(!boot){res.writeHead(503);res.end('throw new Error("Grok services are starting; reload shortly")');return;}
    res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','no-store');
    res.end('window.__grokWeb='+JSON.stringify({boot,platform:process.platform})+';');return;
  }
  if(['/__bridge/client.js','/__bridge/wire.js'].includes(url.pathname)){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync('/opt/grok-web/'+path.basename(url.pathname)));return;}
  if(url.pathname==='/__bridge/preload.js'){
    res.setHeader('Content-Type','text/javascript');
    res.end('(function(require,process){\n'+fs.readFileSync(PRELOAD,'utf8')+'\n})(name=>{if(name!=="electron")throw new Error(name);return window.__electron;},{platform:"linux",type:"renderer",argv:[],env:{}});');return;
  }
  let file;try{file=path.resolve(ROOT,'.'+decodeURIComponent(url.pathname));}catch{res.writeHead(400);res.end('Malformed path');return;}
  if(file!==ROOT&&!file.startsWith(ROOT+path.sep)){res.writeHead(403);res.end();return;}
  if(url.pathname==='/'||url.pathname==='/index.html')file=path.join(ROOT,'web-index.html');
  try{
    let data=fs.readFileSync(file);
    if(file.endsWith('web-index.html'))data=data.toString().replace('<head>','<head><style>button[aria-label="Minimize window"],button[aria-label="Maximize window"],button[aria-label="Close window"]{display:none!important}</style><script src="/__bridge/config.js"></script><script src="/__bridge/wire.js"></script><script src="/__bridge/client.js"></script><script src="/__bridge/preload.js"></script>');
    res.setHeader('Content-Type',MIME[path.extname(file)]||'application/octet-stream');res.end(data);
  }catch{res.writeHead(404);res.end('Not found');}
});
const wss=new WebSocketServer({noServer:true,maxPayload:64*1024*1024});
server.on('upgrade',(req,socket,head)=>{
  if(!validHost(req.headers.host)||req.headers.origin!==`http://${req.headers.host}`||req.url!=='/__bridge/socket'||!contents){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
});
wss.on('connection',ws=>{
  const previous=client;client=ws;
  if(previous){previous.close(4001,'Session moved to another tab');contents.send('__grokweb:request',{type:'reset'});}
  ws.on('message',raw=>{
    try{
      if(client!==ws)return;
      const m=decode(JSON.parse(raw.toString()));
      if(!['invoke','send','port-data','port-close'].includes(m.type))throw new Error('Invalid message');
      if((m.type==='invoke'||m.type==='send')&&(typeof m.channel!=='string'||m.channel.startsWith('__grokweb:')||!Array.isArray(m.args)))throw new Error('Invalid IPC request');
      contents.send('__grokweb:request',m);
    }catch{ws.close(1008,'Invalid bridge message');}
  });
  ws.on('close',()=>{if(client===ws){client=undefined;contents?.send('__grokweb:request',{type:'reset'});}});
});
const socketPath=process.env.GROK_SOCKET;
if(socketPath){
  try{fs.unlinkSync(socketPath);}catch(e){if(e.code!=='ENOENT')throw e;}
  server.listen(socketPath,()=>{fs.chmodSync(socketPath,0o600);console.log('[web] private socket ready');});
}else server.listen(8080,'0.0.0.0',()=>console.log('[web] listening on 8080'));
app.on('will-quit',()=>{wss.close();server.close();});
