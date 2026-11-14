const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {validId}=require('./users.cjs');
const scopes=['read','tasks','browser','all'];
const hash=token=>crypto.createHash('sha256').update(token).digest('hex');
const file=(root,id)=>{if(!validId(id))throw Error('Invalid user ID');return path.join(root,'users',id,'access.json');};
function save(root,id,value){
 const target=file(root,id),tmp=target+'.'+crypto.randomUUID();
 fs.writeFileSync(tmp,JSON.stringify(value),{mode:0o600,flag:'wx'});fs.renameSync(tmp,target);
}
function read(root,id){return JSON.parse(fs.readFileSync(file(root,id),'utf8'));}
function backendToken(root,id){
 const target=path.join(path.dirname(file(root,id)),'backend-token');
 if(!fs.existsSync(target)){
   const home=path.join(root,'users',id,'home'),source=path.join(home,'.config/grok-web/api-token');
   if(!fs.realpathSync(source).startsWith(fs.realpathSync(home)+path.sep))throw Error('Token path escapes user home');
   fs.writeFileSync(target,fs.readFileSync(source,'utf8').trim(),{flag:'wx',mode:0o600});
 }
 const token=fs.readFileSync(target,'utf8').trim();if(!/^[a-f0-9]{64}$/.test(token))throw Error('Invalid backend token');return token;
}
function migrate(root,id,token){
 if(!fs.existsSync(file(root,id)))save(root,id,{disabled:false,keys:[{id:'legacy',hash:hash(token),scope:'all',expiresAt:null}]});
 return read(root,id);
}
function issue(root,id,scope,days=30){
 if(!scopes.includes(scope)||!Number.isInteger(days)||days<1||days>365)throw Error('Scope: read|tasks|browser|all; expiry: 1–365 days');
 const access=read(root,id),token=crypto.randomBytes(32).toString('hex');
 const key={id:crypto.randomUUID(),hash:hash(token),scope,expiresAt:Date.now()+days*86400000};
 access.keys.push(key);save(root,id,access);return {id:key.id,token,scope,expiresAt:key.expiresAt};
}
function revoke(root,id,keyId){const access=read(root,id);if(!access.keys.some(k=>k.id===keyId))throw Error('Unknown key');access.keys=access.keys.filter(k=>k.id!==keyId);save(root,id,access);}
function disable(root,id,disabled){const access=read(root,id);access.disabled=disabled;save(root,id,access);}
function match(access,token,now=Date.now()){
 if(!access||access.disabled||typeof token!=='string'||token.length>512)return null;
 const digest=hash(token);
 return access.keys.find(k=>scopes.includes(k.scope)&&typeof k.hash==='string'&&k.hash.length===64&&crypto.timingSafeEqual(Buffer.from(k.hash),Buffer.from(digest))&&(k.expiresAt===null||k.expiresAt>now))||null;
}
module.exports={backendToken,hash,save,read,migrate,issue,revoke,disable,match};
