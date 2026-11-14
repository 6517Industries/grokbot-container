const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const validId=id=>typeof id==='string'&&/^[a-z][a-z0-9-]{0,30}$/.test(id);
function records(root){
  const dir=path.join(root,'users');fs.mkdirSync(dir,{recursive:true,mode:0o700});
  return fs.readdirSync(dir).filter(validId).filter(id=>fs.existsSync(path.join(dir,id,'user.json'))).map(id=>{
    const record=JSON.parse(fs.readFileSync(path.join(dir,id,'user.json'),'utf8'));
    if(record.id!==id||!Number.isInteger(record.uid)||record.uid<2000||record.uid>60000)throw Error('Invalid user record');
    return record;
  });
}
function provision(root,id){
  if(!validId(id))throw Error('User ID must be lowercase letters/digits/hyphens, starting with a letter (max 31)');
  const users=records(root);if(users.some(u=>u.id===id))throw Error('User already exists');
  const uid=Math.max(1999,...users.map(u=>u.uid))+1;
  const dir=path.join(root,'users',id);fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const home=path.join(dir,'home');fs.mkdirSync(home,{recursive:true,mode:0o700});
  const tokenDir=path.join(home,'.config/grok-web');fs.mkdirSync(tokenDir,{recursive:true,mode:0o700});
  const tokenPath=path.join(tokenDir,'api-token');
  try{fs.writeFileSync(tokenPath,crypto.randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
  execFileSync('chown',['-R',`${uid}:${uid}`,home]);
  if(fs.statSync(home).uid!==uid)throw Error('Storage does not preserve Linux ownership; use a Docker named volume');
  const record={id,uid};fs.writeFileSync(path.join(dir,'user.json'),JSON.stringify(record),{flag:'wx',mode:0o600});
  return record;
}
module.exports={validId,records,provision};
if(require.main===module){
  const root=process.env.GROK_DATA||'/data';
  let locked=false;const lock=path.join(root,'.admin-lock');
  try{
    fs.mkdirSync(root,{recursive:true});fs.mkdirSync(lock,{mode:0o700});locked=true;
    const access=require('./access.cjs');
    const [command,id,arg,days]=process.argv.slice(2);
    if(['issue','keys','revoke','disable','enable'].includes(command)){
      if(!records(root).some(u=>u.id===id))throw Error('Unknown user');
      const token=access.backendToken(root,id);
      access.migrate(root,id,token);
      if(command==='issue')console.log(JSON.stringify(access.issue(root,id,arg,days===undefined?30:Number(days))));
      if(command==='keys')console.log(JSON.stringify(access.read(root,id).keys.map(({hash,...key})=>key)));
      if(command==='revoke')access.revoke(root,id,arg);
      if(command==='disable'||command==='enable')access.disable(root,id,command==='disable');
    }else if(process.argv[2]==='add'){const u=provision(root,process.argv[3]);console.log(`Added ${u.id}. Token: ${root}/users/${u.id}/home/.config/grok-web/api-token`);}
    else if(process.argv[2]==='list')console.log(records(root).map(u=>u.id).join('\n'));
    else throw Error('Usage: users.cjs add USER | list | issue USER SCOPE [DAYS] | keys USER | revoke USER KEY_ID | disable USER | enable USER');
  }catch(e){console.error(e.message);process.exitCode=1;}finally{if(locked)fs.rmdirSync(lock);}
}
module.exports={validId,records,provision};
