const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const access=require('./access.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'grok-access-'));
try{
 fs.mkdirSync(path.join(root,'users/alice'),{recursive:true});
 access.migrate(root,'alice','legacy-secret');
 assert.equal(access.match(access.read(root,'alice'),'legacy-secret').scope,'all');
 const key=access.issue(root,'alice','read',1);
 assert.equal(access.match(access.read(root,'alice'),key.token).scope,'read');
 assert.equal(access.match(access.read(root,'alice'),key.token,key.expiresAt),null);
 assert.ok(!fs.readFileSync(path.join(root,'users/alice/access.json'),'utf8').includes(key.token));
 access.revoke(root,'alice',key.id);assert.equal(access.match(access.read(root,'alice'),key.token),null);
 access.disable(root,'alice',true);assert.equal(access.match(access.read(root,'alice'),'legacy-secret'),null);
 access.disable(root,'alice',false);assert.ok(access.match(access.read(root,'alice'),'legacy-secret'));
 assert.throws(()=>access.issue(root,'alice','admin',30));assert.throws(()=>access.issue(root,'alice','read',0));assert.throws(()=>access.read(root,'../alice'));
 assert.equal(fs.statSync(path.join(root,'users/alice/access.json')).mode&0o777,0o600);
 console.log('Key hashing, expiry, revocation, disabling and validation passed');
}finally{fs.rmSync(root,{recursive:true});}
const second=fs.mkdtempSync(path.join(os.tmpdir(),'grok-backend-'));
try{
 const home=path.join(second,'users/alice/home');fs.mkdirSync(path.join(home,'.config/grok-web'),{recursive:true});
 const source=path.join(home,'.config/grok-web/api-token');fs.writeFileSync(source,'a'.repeat(64));
 assert.equal(access.backendToken(second,'alice'),'a'.repeat(64));
 fs.writeFileSync(source,'b'.repeat(64));assert.equal(access.backendToken(second,'alice'),'a'.repeat(64));
 fs.mkdirSync(path.join(second,'users/bob/home/.config/grok-web'),{recursive:true});
 fs.symlinkSync(source,path.join(second,'users/bob/home/.config/grok-web/api-token'));
 assert.throws(()=>access.backendToken(second,'bob'),/escapes/);
 console.log('Private backend token pinning and symlink rejection passed');
}finally{fs.rmSync(second,{recursive:true});}
