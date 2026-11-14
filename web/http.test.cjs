const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {EventEmitter}=require('node:events');
(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'grok-api-test-'));const original=process.env.HOME;
  process.env.HOME=home;
  const ipcMain=new EventEmitter();
  const contents={isDestroyed:()=>false,send:(_,m)=>setImmediate(()=>ipcMain.emit('__grokweb:api-result',{sender:contents},{id:m.id,outcome:{status:'ok',value:m.args}}))};
  const handler=require('./api.cjs').install({ipcMain,getContents:()=>contents});
  const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const tokenPath=path.join(home,'.config/grok-web/api-token');const token=fs.readFileSync(tokenPath,'utf8');
  try{
    assert.equal(fs.statSync(tokenPath).mode&0o777,0o600);
    assert.equal((await fetch(base+'/api/tools')).status,401);
    const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
    assert.equal((await (await fetch(base+'/api/tools',{headers})).json()).tools.length,4);
    const call=body=>fetch(base+'/api/call',{method:'POST',headers,body:JSON.stringify(body)});
    assert.equal((await call({name:'rawIPC',arguments:{}})).status,400);
    const answer=await (await call({name:'grok_send',arguments:{agentId:'a',clientNonce:'n',prompt:'你好 🐈'}})).json();
    assert.equal(answer.value.prompt,'你好 🐈');
    assert.equal((await fetch(base+'/api/call',{method:'POST',headers,body:'{'})).status,400);
    console.log('HTTP auth, validation, token permissions and Unicode passed');
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));process.env.HOME=original;fs.rmSync(home,{recursive:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
