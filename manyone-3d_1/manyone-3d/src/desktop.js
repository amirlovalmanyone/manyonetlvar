// Desktop (full-screen) — real backend. Bundled to /assets/vendor/desktop.js
// Upload a .glb (or use the default) -> Create link -> real USDZ + upload ->
// real shareable link + QR, and the phone panel shows the stored model.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import qrcodeMod from 'qrcode-generator';
const qrcode = qrcodeMod.default || qrcodeMod;

const $ = (s) => document.querySelector(s);
const dv = $('#dv'), dLoad = $('#dLoad'), dView = $('#dView'), dDrop = $('#dDrop'), dFile = $('#dFile'), mainBtn = $('#mainBtn');
const phoneSide = $('#phoneSide'), pv = $('#pv'), pLoad = $('#pLoad'), pHead = $('#pHead'), pAR = $('#pAR');
const linkCard = $('#linkCard'), linkInput = $('#linkInput'), qrBox = $('#qr'), copyBtn = $('#copyBtn');

let currentBuffer = null;      // bytes of the model currently shown
let currentName = 'model.glb';
let mode = 'upload';
let objUrl = null;

dv.addEventListener('load', () => dLoad.classList.add('hide'));

// default: the demo model is shown; grab its bytes so "Create link" works on it too
fetch('/assets/demo.glb').then((r) => r.arrayBuffer()).then((b) => { if (!currentBuffer) currentBuffer = b; }).catch(() => {});

async function loadFileObj(file) {
  if (!/\.glb$/i.test(file.name) && file.type !== 'model/gltf-binary') { alert('Please choose a .glb file.'); return; }
  currentName = file.name || 'model.glb';
  currentBuffer = await file.arrayBuffer();
  if (objUrl) URL.revokeObjectURL(objUrl);
  objUrl = URL.createObjectURL(new Blob([currentBuffer], { type: 'model/gltf-binary' }));
  dLoad.classList.remove('hide');
  dv.setAttribute('src', objUrl);
  mode = 'create';
  mainBtn.textContent = 'Create link';
}

mainBtn.addEventListener('click', () => { if (mode === 'upload') dFile.click(); else createLink(); });
dFile.addEventListener('change', () => { const f = dFile.files[0]; if (f) loadFileObj(f); });
['dragenter', 'dragover'].forEach((e) => dView.addEventListener(e, (ev) => { ev.preventDefault(); dDrop.classList.add('on'); }));
['dragleave', 'drop'].forEach((e) => dView.addEventListener(e, (ev) => { ev.preventDefault(); dDrop.classList.remove('on'); }));
dView.addEventListener('drop', (ev) => { const f = ev.dataTransfer.files && ev.dataTransfer.files[0]; if (f) loadFileObj(f); });

async function glbToUSDZ(buf) {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('/assets/vendor/draco/');
  loader.setDRACOLoader(draco);
  const gltf = await loader.parseAsync(buf.slice(0), '');
  const scene = gltf.scene || gltf.scenes[0];
  scene.updateMatrixWorld(true);
  const exporter = new USDZExporter();
  const out = exporter.parseAsync ? await exporter.parseAsync(scene) : await exporter.parse(scene);
  return new Blob([out], { type: 'model/vnd.usdz+zip' });
}

let phoneShown = false;

async function createLink() {
  if (!currentBuffer) { alert('Add a model first.'); return; }
  mainBtn.disabled = true; mainBtn.textContent = 'Creating…';
  try {
    let usdz = null;
    try { usdz = await glbToUSDZ(currentBuffer); } catch (e) { console.warn('USDZ generation failed; AR will be Android-only.', e); }
    const fd = new FormData();
    fd.append('glb', new Blob([currentBuffer], { type: 'model/gltf-binary' }), 'model.glb');
    if (usdz && usdz.size > 0) fd.append('usdz', usdz, 'model.usdz');
    fd.append('name', currentName);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!res.ok) throw new Error('upload failed');
    const data = await res.json();
    revealPhone(data.id, location.origin + data.view);
  } catch (e) {
    console.error(e);
    alert('Something went wrong creating the link. Please try again.');
  } finally {
    mainBtn.disabled = false; mainBtn.textContent = 'Create link';
  }
}

function revealPhone(id, url) {
  // real link + QR
  linkInput.value = url;
  const q = qrcode(0, 'M'); q.addData(url); q.make();
  qrBox.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0 });
  linkCard.style.display = 'block';

  if (!phoneShown) { phoneShown = true; phoneSide.classList.add('open'); }
  pLoad.classList.remove('hide');
  pHead.classList.remove('in'); pAR.classList.remove('in');
  pv.addEventListener('load', () => { pLoad.classList.add('hide'); pHead.classList.add('in'); pAR.classList.add('in'); }, { once: true });
  pv.setAttribute('src', `/m/${id}/model.glb`);
  pv.setAttribute('ios-src', `/m/${id}/model.usdz`);
}

pAR.addEventListener('click', () => {
  if (pv.canActivateAR) pv.activateAR();
  else alert('Open the link on your iPhone (scan the QR) to view in AR.');
});

copyBtn.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(linkInput.value); } catch { linkInput.select(); document.execCommand('copy'); }
  copyBtn.textContent = 'Copied'; copyBtn.classList.add('done');
  setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.classList.remove('done'); }, 1500);
});

$('#homeLogo').addEventListener('click', () => location.reload());
