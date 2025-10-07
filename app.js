import pako from "pako";

const fileIn = document.getElementById('fileIn');
const useGzip = document.getElementById('useGzip');
const encodeBtn = document.getElementById('encodeBtn');
const downloadLink = document.getElementById('downloadLink');
const encodeProgress = document.getElementById('encodeProgress');
const encodedPreview = document.getElementById('encodedPreview');

const rdeckIn = document.getElementById('rdeckIn');
const decodeBtn = document.getElementById('decodeBtn');
const decodeProgress = document.getElementById('decodeProgress');
const decodedDownload = document.getElementById('decodedDownload');
const previewArea = document.getElementById('previewArea');

let worker;

function ensureWorker(){
  if (worker) return;
  worker = new Worker('worker.js');
  worker.onmessage = (e)=>{
    const msg = e.data;
    if (msg.type==='progress') {
      if (msg.phase==='encode') encodeProgress.value = msg.pct;
      else decodeProgress.value = msg.pct;
    } else if (msg.type==='encoded') {
      const blob = new Blob([msg.text], {type: 'text/plain'});
      const url = URL.createObjectURL(blob);
      downloadLink.href = url;
      downloadLink.download = (msg.meta && msg.meta.filename ? msg.meta.filename + '.rdeckard' : 'file.rdeckard');
      downloadLink.classList.remove('hidden');
      encodedPreview.value = msg.text.slice(0, 10000) + (msg.text.length>10000?'\n\n...truncated...':'');
    } else if (msg.type==='decoded') {
      const arr = new Uint8Array(msg.bytes);
      const blob = new Blob([arr], {type: msg.meta.mime || 'application/octet-stream'});
      const url = URL.createObjectURL(blob);
      decodedDownload.href = url;
      decodedDownload.download = msg.meta.filename || 'decoded.bin';
      decodedDownload.classList.remove('hidden');
      previewArea.innerHTML = '';
      if (msg.meta.mime && msg.meta.mime.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = url;
        previewArea.appendChild(img);
      } else if (msg.meta.mime && msg.meta.mime.startsWith('video/')) {
        const vid = document.createElement('video');
        vid.controls = true; vid.src = url;
        previewArea.appendChild(vid);
      } else {
        const p = document.createElement('p');
        p.textContent = `Decoded ${arr.length} bytes — ready to download.`;
        previewArea.appendChild(p);
      }
    } else if (msg.type==='error') {
      alert('Worker error: '+msg.message);
    }
  };
}

encodeBtn.addEventListener('click', async ()=>{
  const f = fileIn.files[0];
  if (!f) { alert('Pick a file to encode.'); return; }
  ensureWorker();
  encodeProgress.value = 0;
  downloadLink.classList.add('hidden');
  encodedPreview.value = '';
  const arrayBuffer = await f.arrayBuffer();
  // send ArrayBuffer without transfer to avoid it becoming neutered in some environments
  worker.postMessage({action:'encode', fileBuf: arrayBuffer, filename: f.name, mime: f.type || 'application/octet-stream', gzip: useGzip.checked});
});

decodeBtn.addEventListener('click', async ()=>{
  const f = rdeckIn.files[0];
  if (!f) { alert('Pick a .rdeckard file to decode.'); return; }
  ensureWorker();
  decodeProgress.value = 0;
  decodedDownload.classList.add('hidden');
  previewArea.innerHTML = '';
  const txt = await f.text();
  worker.postMessage({action:'decode', text: txt});
});