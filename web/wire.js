(function(root){
  const types={Uint8Array,Uint8ClampedArray,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,BigInt64Array,BigUint64Array,DataView};
  function encode(v){
    if(v===undefined)return {$grokType:'undefined'};
    if(typeof v==='bigint')return {$grokType:'bigint',data:String(v)};
    if(v instanceof ArrayBuffer)return {$grokType:'ArrayBuffer',data:Array.from(new Uint8Array(v))};
    if(ArrayBuffer.isView(v))return {$grokType:v.constructor.name,data:Array.from(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))};
    if(v instanceof Date)return {$grokType:'Date',data:v.toISOString()};
    if(v instanceof Map)return {$grokType:'Map',data:Array.from(v,([k,x])=>[encode(k),encode(x)])};
    if(v instanceof Set)return {$grokType:'Set',data:Array.from(v,encode)};
    if(Array.isArray(v))return v.map(encode);
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]));
    return v;
  }
  function decode(v){
    if(v?.$grokType==='undefined')return undefined;
    if(v?.$grokType==='bigint')return BigInt(v.data);
    if(v?.$grokType==='Date')return new Date(v.data);
    if(v?.$grokType==='Map')return new Map(v.data.map(([k,x])=>[decode(k),decode(x)]));
    if(v?.$grokType==='Set')return new Set(v.data.map(decode));
    if(v?.$grokType&&Array.isArray(v.data)){
      const bytes=new Uint8Array(v.data);
      if(v.$grokType==='ArrayBuffer')return bytes.buffer;
      if(v.$grokType==='Buffer')return bytes;
      if(types[v.$grokType])return new types[v.$grokType](bytes.buffer);
      throw new Error('Unknown binary type');
    }
    if(Array.isArray(v))return v.map(decode);
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)]));
    return v;
  }
  const api={encode,decode};
  if(typeof module!=='undefined')module.exports=api;else root.GrokWire=api;
})(globalThis);
