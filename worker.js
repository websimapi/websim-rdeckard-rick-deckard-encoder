/* worker.js - uses pako via importScripts to support worker environment */
importScripts('https://cdn.jsdelivr.net/npm/pako@2.1.5/dist/pako.min.js');

const TOK0 = 'Rick';
const TOK1 = 'Deckard';
const MAGIC = 'RDECKARD/1';

function sendProgress(phase, pct){ postMessage({type:'progress', phase, pct}); }

function bitsToBytes(bits){
  const out = new Uint8Array(Math.ceil(bits.length/8));
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

function encodeText(meta, u8){
  const totalBytes = u8.length;
  // header
  const header = MAGIC + '\n' + JSON.stringify(meta) + '\n\n';

  // --- Stage A: Bytes to Bits conversion (10% to 50%) ---
  // Convert compressed/uncompressed bytes into a long sequence of bits.
  const bits = new Array(totalBytes * 8);
  
  const START_PCT_A = 10;
  const RANGE_A = 40; // Total range for this stage 10% to 50%

  for(let i=0;i<totalBytes;i++){
    let b = u8[i];
    for(let j=0;j<8;j++){
      // Set MSB first: j=0 means first bit index, extracting bit 7
      const bitIndex = i*8 + j;
      const bitValue = (b >> (7-j)) & 1;
      bits[bitIndex] = bitValue;
    }

    if (i > 0 && i % 32768 === 0) { // Update frequency based on 32KB of bytes processed
      const currentPct = START_PCT_A + Math.floor((i / totalBytes) * RANGE_A);
      sendProgress('encode', Math.min(50, currentPct));
    }
  }
  sendProgress('encode', 50);

  // --- Stage B: Bits to Tokens (50% to 99%) ---
  // Convert bit sequence into Rick/Deckard tokens.
  const N = bits.length;
  const parts = [];
  
  const START_PCT_B = 50;
  const RANGE_B = 49; // Total range for this stage 50% to 99%
  const TOKENS_PER_UPDATE = 32768 * 8; // Update every 32KB of tokens/bits processed
  
  for(let i=0;i<N;i++){
    parts.push(bits[i] ? TOK1 : TOK0);
    
    if (i > 0 && i % TOKENS_PER_UPDATE === 0) { 
      const currentPct = START_PCT_B + Math.floor((i / N) * RANGE_B);
      sendProgress('encode', Math.min(99, currentPct));
    }
  }

  sendProgress('encode', 99);
  
  // Final string join and return
  const result = header + parts.join(' ');
  sendProgress('encode', 100);
  return result;
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
      
      // Stage 0: Compression (0% to 10%)
      if (data.gzip) {
        sendProgress('encode', 2);
        u8 = pako.deflate(u8);
        sendProgress('encode', 10);
      } else {
        // No compression, start tokenization progress at 10% baseline.
        sendProgress('encode', 10); 
      }
      
      // Stages 1 & 2: Tokenization (10% to 100%)
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