const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const definitions=[
  ['grok_list_bots','List available Grok bots and their IDs.',{}],
  ['grok_send','Send a task to an existing bot. Returns acceptance, not completion. Use grok_read to follow progress. Preserve caller constraints and approval requirements. Never resend on timeout without checking history; reuse clientNonce for retries.',{agentId:{type:'string'},prompt:{type:'string'},clientNonce:{type:'string'},sessionId:{type:'string'}},['agentId','prompt','clientNonce']],
  ['grok_read','Read recent conversation entries, including responses and pending approval cards.',{agentId:{type:'string'},limit:{type:'integer',minimum:1,maximum:500},beforeSeq:{type:'integer',minimum:0},sessionId:{type:'string'}},['agentId']],
  ['grok_interrupt','Interrupt a bot run explicitly requested by the caller.',{agentId:{type:'string'},sessionId:{type:'string'}},['agentId']]
];
const tools=definitions.map(([name,description,properties,required=[]])=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}}));
function translate(name,args){
  const tool=tools.find(t=>t.name===name);
  if(!tool||!args||typeof args!=='object'||Array.isArray(args))throw Error('Unknown tool or invalid arguments');
  const schema=tool.inputSchema;
  for(const key of schema.required)if(!(key in args))throw Error(`Missing ${key}`);
  for(const [key,value] of Object.entries(args)){
    const rule=schema.properties[key];
    if(!rule)throw Error(`Unknown argument ${key}`);
    if(rule.type==='string'&&(typeof value!=='string'||!value.trim()||value.length>(key==='prompt'?100000:512)))throw Error(`Invalid ${key}`);
    if(rule.type==='integer'&&(!Number.isSafeInteger(value)||value<rule.minimum||value> (rule.maximum??Number.MAX_SAFE_INTEGER)))throw Error(`Invalid ${key}`);
  }
  const {agentId,...rest}=args;
  switch(name){
    case 'grok_list_bots':return ['getServerAgentRoster',{}];
    case 'grok_send':return ['sendPrompt',{agentId,...rest}];
    case 'grok_read':return ['getAgentTranscriptTail',{id:agentId,limit:100,...rest}];
    case 'grok_interrupt':return ['interruptAgentRun',{id:agentId,...rest}];
  }
}
function install({ipcMain,getContents}){
  const tokenPath=path.join(process.env.HOME,'.config/grok-web/api-token');
  fs.mkdirSync(path.dirname(tokenPath),{recursive:true,mode:0o700});
  try{fs.writeFileSync(tokenPath,crypto.randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
  const token=fs.readFileSync(tokenPath,'utf8').trim();
  if(token.length<32)throw Error('API token must be at least 32 characters');
  const pending=new Map();
  ipcMain.on('__grokweb:api-result',(event,m)=>{
    if(event.sender!==getContents())return;
    const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);
    m.error?p.reject(Error(m.error)):p.resolve(m.outcome);
  });
  const call=(method,args)=>new Promise((resolve,reject)=>{
    const contents=getContents();if(!contents||contents.isDestroyed()){reject(Error('Grok service unavailable'));return;}
    if(pending.size>=64){reject(Error('Too many pending requests'));return;}
    const id=crypto.randomUUID();
    const timer=setTimeout(()=>{pending.delete(id);if(!contents.isDestroyed())contents.send('__grokweb:api',{id,cancel:true});reject(Error('Request timed out; outcome may be unknown. Read history before retrying.'));},60000);
    pending.set(id,{resolve,reject,timer});contents.send('__grokweb:api',{id,method,args});
  });
  return async(req,res)=>{
    const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    const supplied=Buffer.from(req.headers.authorization||'');const expected=Buffer.from(`Bearer ${token}`);
    if(supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected)){reply(401,{error:'Bearer token required'});return;}
    if(req.url==='/api/tools'&&req.method==='GET'){reply(200,{tools});return;}
    if(req.url!=='/api/call'||req.method!=='POST'){reply(404,{error:'Unknown API route'});return;}
    if(!req.headers['content-type']?.startsWith('application/json')){reply(415,{error:'Use application/json'});return;}
    let input='';req.setEncoding('utf8');
    try{
      for await(const chunk of req){input+=chunk.toString();if(Buffer.byteLength(input)>128*1024){reply(413,{error:'Request too large'});return;}}
      const {name,arguments:args={}}=JSON.parse(input);
      let method,parameters;
      try{[method,parameters]=translate(name,args);}catch(e){reply(400,{error:e.message});return;}
      const outcome=await call(method,parameters);reply(200,outcome);
    }catch(e){reply(e instanceof SyntaxError?400:503,{error:e.message});}
  };
}
module.exports={tools,translate,install};
