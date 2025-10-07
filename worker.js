/* worker.js - uses pako via importScripts to support worker environment */
importScripts('https://cdn.jsdelivr.net/npm/pako@2.1.5/dist/pako.min.js');

const TOK0 = 'Rick';
const TOK1 = 'Deckard';
const MAGIC = 'RDECKARD/1';

function sendProgress(phase, pct){ postMessage({type:'progress', phase, pct}); }

function bytesToBits(bytes){
  const bits = [];
  for(let i=0;i<bytes.length;i++){
    let b = bytes[i];
    for(let bit=7;bit>=0;bit--){
      bits.push(((b>>bit)&1)?1:0);
    }
    if (i%32768===0) sendProgress('encode', Math.min(99, Math.floor(i/bytes.length*100)));
  }
  return bits;
}

function bitsToBytes(bits){
  const out = new Uint8Array(Math.ceil(bits.length/8));
  for(let i=0;i<bits.length;i++){
    const byteIndex = Math.floor(i/8);
    out[byteIndex] = (out[byteIndex]<<1) | bits[i];
    if (i%8===7) continue;
  }
  // Fix left-shifted accumulation: rebuild properly
  let idx=0;
  for(let i=0;i<bits.length;i+=8){
    let val=0;
    for(let j=0;j<8 && (i+j)<bits.length;j++){
      val = (val<<1) | bits[i+j];
    }
    out[idx++] = val;
  }
  return out;
}

function uint8ToBitsFast(u8){
  const bits = new Array(u8.length*8);
  for(let i=0;i<u8.length;i++){
    let b = u8[i];
    for(let j=0;j<8;j++){
      bits[i*8 + (7-j)] = (b >> j) & 1;
    }
    if (i%32768===0) sendProgress('encode', Math.min(99, Math.floor(i/u8.length*100)));
  }
  return bits;
}

function encodeText(meta, u8){
  // header
  const header = MAGIC + '\n' + JSON.stringify(meta) + '\n\n';
  // bits -> tokens
  const bits = uint8ToBitsFast(u8);
  const parts = [];
  const N = bits.length;
  for(let i=0;i<N;i++){
    parts.push(bits[i] ? TOK1 : TOK0);
    if (i%4096===0) sendProgress('encode', Math.min(98, Math.floor(i/N*100)));
  }
  sendProgress('encode', 100);
  return header + parts.join(' ');
}

function decodeText(text){
  if (!text.startsWith(MAGIC)) throw new Error('Not an RDECKARD file (bad magic)');
  const rest = text.slice(MAGIC.length).trimStart();
  const idx = rest.indexOf('\n\n');
  if (idx===-1) throw new Error('Missing header separator');
  const metaLine = rest.slice(0, idx).trim();
  const payload = rest.slice(idx+2).trim();
  const meta = JSON.parse(metaLine);
  // stream parse words
  const words = payload.split(/\s+/);
  const bits = new Array(words.length);
  for(let i=0;i<words.length;i++){
    const w = words[i];
    if (w === TOK0) bits[i]=0;
    else if (w === TOK1) bits[i]=1;
    else {
      // ignore unknown tokens (robustness)
      continue;
    }
    if (i%65536===0) sendProgress('decode', Math.min(99, Math.floor(i/words.length*100)));
  }
  sendProgress('decode', 100);
  const bytes = bitsToBytes(bits);
  return {meta, bytes};
}

onmessage = function(e){
  try {
    const data = e.data;
    if (data.action === 'encode') {
      const meta = {
        filename: data.filename,
        mime: data.mime,
        length: data.fileBuf ? data.fileBuf.byteLength : 0,
        compression: data.gzip ? 'gzip' : 'none',
        checksum: null
      };
      let u8 = new Uint8Array(data.fileBuf);
      if (data.gzip) {
        sendProgress('encode', 5);
        u8 = pako.deflate(u8);
      }
      sendProgress('encode', 10);
      const text = encodeText(meta, u8);
      postMessage({type:'encoded', text, meta});
    } else if (data.action === 'decode') {
      sendProgress('decode', 2);
      const result = decodeText(data.text);
      let bytes = result.bytes;
      if (result.meta.compression === 'gzip') {
        sendProgress('decode', 30);
        bytes = pako.inflate(bytes);
      }
      // transfer bytes buffer back
      postMessage({type:'decoded', bytes: bytes.buffer, meta: result.meta}, [bytes.buffer]);
    }
  } catch (err){
    postMessage({type:'error', message: err.message || String(err)});
  }
};

