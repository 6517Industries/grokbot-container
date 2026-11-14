const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {identity,gateway}=require('./gateway.cjs');
const {validId}=require('./users.cjs');
const access=require('./access.cjs');
const alice={id:'alice',token:'a'.repeat(64)},bob={id:'bob',token:'b'.repeat(64)};const users=[alice,bob];
for(const u of users)u.access={disabled:false,keys:[{id:'legacy',hash:access.hash(u.token),scope:'all',expiresAt:null}]};
const req=(host,authorization,url='/')=>({headers:{host,authorization},url});
const basic=(user,token)=>'Basic '+Buffer.from(`${user}:${token}`).toString('base64');
assert.equal(identity(req('alice.localhost:8088',basic('alice',alice.token)),users),alice);
assert.equal(identity(req('bob.localhost:8088',basic('alice',alice.token)),users),null);
assert.equal(identity(req('localhost:8088',`Bearer ${alice.token}`,'/api/call'),users),alice);
assert.equal(identity(req('localhost:8088',`Bearer ${alice.token}`),users),null);
assert.equal(identity(req('evil.test',`Bearer ${alice.token}`,'/api/call'),users),null);
assert.equal(identity(req('bob.localhost:8088',`Bearer ${alice.token}`,'/api/call'),users),null);
assert.equal(identity(req('alice.localhost:8088',basic('alice',bob.token)),users),null);
assert.equal(validId('../alice'),false);assert.equal(validId('alice'),true);
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'grok-gateway-'));const backends=[];let server;
 try{
  for(const u of users){u.socket=path.join(dir,u.id+'.sock');const backend=http.createServer((q,r)=>{assert.equal(q.headers.authorization,`Bearer ${u.token}`);r.end(u.id);});await new Promise(r=>backend.listen(u.socket,r));backends.push(backend);}
  server=gateway(()=>users);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const call=(host,auth,url='/api/tools',extra={})=>new Promise((resolve,reject)=>{
   const q=http.request({host:'127.0.0.1',port:server.address().port,path:url,headers:{host,authorization:auth,...extra}},r=>{let body='';r.on('data',c=>body+=c);r.on('end',()=>resolve({status:r.statusCode,body}));});q.on('error',reject);q.end();
  });
  assert.deepEqual(await call('localhost',`Bearer ${alice.token}`),{status:200,body:'alice'});
  assert.deepEqual(await call('bob.localhost',basic('bob',bob.token),'/'),{status:200,body:'bob'});
  assert.equal((await call('alice.localhost',`Bearer ${bob.token}`)).status,401);
  assert.equal((await call('localhost','Bearer invalid')).status,401);
  assert.equal((await call('alice.localhost',basic('alice',alice.token),'/',{origin:'http://bob.localhost'})).status,403);
  assert.equal((await call('alice.localhost',basic('alice',alice.token),'/',{'sec-fetch-site':'cross-site'})).status,403);
  const post=(args,token=alice.token)=>new Promise((resolve,reject)=>{
   const body=JSON.stringify(args);const q=http.request({host:'127.0.0.1',port:server.address().port,path:'/api/call',method:'POST',headers:{host:'localhost',authorization:`Bearer ${token}`,'content-type':'application/json','content-length':Buffer.byteLength(body)}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});q.on('error',reject);q.end(body);
  });
  alice.access.keys[0].scope='read';
  assert.equal(await post({name:'grok_send',arguments:{agentId:'a',prompt:'no',clientNonce:'n'}}),403);
  assert.equal(await post({name:'grok_read',arguments:{agentId:'a'}}),200);
  assert.equal(await post({name:'grok_list_bots',arguments:{},userId:'bob'}),400);
  alice.access.keys[0].scope='browser';assert.equal((await call('localhost',`Bearer ${alice.token}`)).status,403);
  alice.access.keys[0].scope='tasks';assert.equal((await call('alice.localhost',basic('alice',alice.token),'/')).status,403);
  assert.equal(await post({name:'grok_list_bots',arguments:{}}),200);
  alice.access.keys[0].scope='all';
  for(let i=0;i<120;i++)await post({name:'grok_list_bots',arguments:{}});
  assert.equal(await post({name:'grok_list_bots',arguments:{}}),429);
  assert.equal(await post({name:'grok_list_bots',arguments:{}},bob.token),200);
  alice.access.disabled=true;assert.equal((await call('localhost',`Bearer ${alice.token}`)).status,401);alice.access.disabled=false;
  alice.access.keys[0].scope='read';assert.equal((await call('alice.localhost',basic('alice',alice.token),'/')).status,403);
  alice.access.keys[0].expiresAt=Date.now()-1;assert.equal((await call('localhost',`Bearer ${alice.token}`)).status,401);
  console.log('Tenant authentication, cross-user routing, origin and path validation passed');
 }finally{for(const s of [...backends,server].filter(Boolean)){s.closeAllConnections();await new Promise(r=>s.close(r));}fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
