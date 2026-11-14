#!/usr/bin/env node
// stdio MCP adapter. Requires Node 18+; no packages.
const fs=require('node:fs');
const readline=require('node:readline');
const {tools}=require('./web/api.cjs');
const base=process.env.GROK_URL||'http://127.0.0.1:8088';
const token=process.env.GROK_API_TOKEN||(process.env.GROK_TOKEN_FILE?fs.readFileSync(process.env.GROK_TOKEN_FILE,'utf8').trim():'');
if(!token){console.error('Set GROK_API_TOKEN or GROK_TOKEN_FILE');process.exit(1);}
async function handle(m){
  if(m.id===undefined)return;
  let result;
  switch(m.method){
    case 'initialize':result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'grokbot-container',version:'1.0.0'}};break;
    case 'ping':result={};break;
    case 'tools/list':result={tools};break;
    case 'tools/call':{
      try{
        if(!tools.some(t=>t.name===m.params?.name))throw Error('Unknown tool');
        const response=await fetch(new URL('/api/call',base),{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(m.params),signal:AbortSignal.timeout(65000)});
        const text=await response.text();
        let body;try{body=JSON.parse(text);}catch{body={error:text};}
        if(!response.ok)body={...body,httpStatus:response.status,...response.headers.has('retry-after')?{retryAfter:response.headers.get('retry-after')}: {}};
        result={content:[{type:'text',text:JSON.stringify(body)}],isError:!response.ok||body.status!=='ok'};
      }catch(e){result={content:[{type:'text',text:e.message}],isError:true};}
      break;
    }
    default:return {jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}};
  }
  return {jsonrpc:'2.0',id:m.id,result};
}
readline.createInterface({input:process.stdin}).on('line',async line=>{
  let response;
  try{response=await handle(JSON.parse(line));}catch{response={jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON-RPC input'}};}
  if(response)process.stdout.write(JSON.stringify(response)+'\n');
});
