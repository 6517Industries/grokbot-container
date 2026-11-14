const assert=require('node:assert/strict');
const {encode,decode}=require('./wire.js');
const roundtrip=v=>decode(JSON.parse(JSON.stringify(encode(v))));
const buffer=new Uint8Array([1,2,3,4]);
const value={request:42,args:[undefined,null,true,3n],bytes:buffer.subarray(1,3),floats:new Float64Array([Math.PI]),buffer:buffer.buffer,map:new Map([['x',new Set([1,2])]])};
assert.deepEqual(roundtrip(value),value);
assert.throws(()=>roundtrip({$grokType:'Function',data:[1]}),/Unknown binary type/);
assert.deepEqual(roundtrip({kind:'lifecycle',phase:'hello',protocolVersion:3}),{kind:'lifecycle',phase:'hello',protocolVersion:3});
console.log('wire round trips passed');
