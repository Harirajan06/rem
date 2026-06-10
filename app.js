'use strict';
/* Stash — personal vault for links, notes and images.
   Storage: IndexedDB (local-first, free, no accounts).
   The data layer is isolated in `store` so a cloud backend
   (e.g. Supabase) can replace it later without touching the UI. */

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const URL_RE = /^(https?:\/\/|www\.)[^\s]+$/i;

/* ---------------- data layer (IndexedDB) ---------------- */
const store = (() => {
  let dbp = null;
  const open = () => dbp ??= new Promise((res, rej) => {
    const rq = indexedDB.open('stash-db', 1);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      db.createObjectStore('items', { keyPath: 'id' });
      db.createObjectStore('blobs', { keyPath: 'id' });
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  const tx = async (storeName, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(storeName, mode);
      const result = fn(t.objectStore(storeName));
      t.oncomplete = () => res(result.__val ?? result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    async all() {
      const db = await open();
      return new Promise(res => {
        const rq = db.transaction('items').objectStore('items').getAll();
        rq.onsuccess = () => res(rq.result.sort((a, b) => b.created - a.created));
      });
    },
    put: item => tx('items', 'readwrite', s => s.put(item)),
    delete: id => tx('items', 'readwrite', s => s.delete(id)),
    putBlob: (id, dataURL) => tx('blobs', 'readwrite', s => s.put({ id, dataURL })),
    async getBlob(id) {
      const db = await open();
      return new Promise(res => {
        const rq = db.transaction('blobs').objectStore('blobs').get(id);
        rq.onsuccess = () => res(rq.result?.dataURL || null);
        rq.onerror = () => res(null);
      });
    },
    deleteBlob: id => tx('blobs', 'readwrite', s => s.delete(id)),
  };
})();

/* ---------------- state ---------------- */
let items = [];
let filter = 'all';
let query = '';
let pendingImageDataURL = null;
let modalType = 'link';

/* ---------------- helpers ---------------- */
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 1800);
}
function hostOf(url) {
  try { return new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}
function normUrl(url) { return url.startsWith('http') ? url : 'https://' + url; }
async function compressImage(fileOrBlob, max = 1200) {
  const bmp = await createImageBitmap(fileOrBlob);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}
const fmtDate = ts => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/* ---------------- rendering ---------------- */
async function render() {
  const q = query.toLowerCase();
  const visible = items.filter(it =>
    (filter === 'all' || it.type === filter) &&
    (!q || (it.title || '').toLowerCase().includes(q) ||
      (it.content || '').toLowerCase().includes(q) ||
      it.tags.some(t => t.toLowerCase().includes(q)))
  );
  $('countLabel').textContent = `${visible.length} of ${items.length} item${items.length === 1 ? '' : 's'}`;
  $('pasteHint').style.display = items.length ? 'none' : 'block';
  const grid = $('grid');
  grid.innerHTML = '';
  for (const it of visible) {
    const el = document.createElement('div');
    el.className = 'item';
    let inner = '';
    if (it.type === 'image' && it.blobId) {
      const dataURL = await store.getBlob(it.blobId);
      if (dataURL) inner += `<img class="thumb" src="${dataURL}" alt="" onclick="openLightbox('${it.blobId}')">`;
    }
    inner += '<div class="body">';
    if (it.type === 'link') {
      const host = hostOf(it.content);
      inner += `<div class="title"><img class="favicon" src="https://www.google.com/s2/favicons?domain=${esc(host)}&sz=32" alt="">` +
        `<a href="${esc(normUrl(it.content))}" target="_blank" rel="noopener">${esc(it.title || host || it.content)}</a></div>` +
        `<div class="url">${esc(it.content)}</div>`;
    } else {
      if (it.title) inner += `<div class="title">${esc(it.title)}</div>`;
      if (it.type === 'text') inner += `<div class="snippet">${esc(it.content)}</div>`;
    }
    if (it.tags.length) inner += `<div class="tags">${it.tags.map(t => `<span class="tag" onclick="searchTag('${esc(t)}')">#${esc(t)}</span>`).join('')}</div>`;
    inner += `<div class="meta"><span class="date">${fmtDate(it.created)}</span>` +
      (it.type === 'link' ? `<button class="act" title="Open" onclick="window.open('${esc(normUrl(it.content))}','_blank')">↗</button>` : '') +
      (it.type !== 'image' ? `<button class="act" title="Copy" onclick="copyItem('${it.id}')">⧉</button>` : '') +
      `<button class="act" title="Delete" onclick="deleteItem('${it.id}')">🗑</button></div></div>`;
    el.innerHTML = inner;
    grid.appendChild(el);
  }
}

function searchTag(tag) {
  $('searchBox').value = tag;
  query = tag;
  render();
}
async function copyItem(id) {
  const it = items.find(x => x.id === id);
  await navigator.clipboard.writeText(it.type === 'link' ? normUrl(it.content) : it.content);
  toast('Copied ⧉');
}
async function deleteItem(id) {
  const it = items.find(x => x.id === id);
  if (!confirm('Delete this from your stash?')) return;
  await store.delete(id);
  if (it.blobId) await store.deleteBlob(it.blobId);
  items = items.filter(x => x.id !== id);
  render();
  toast('Deleted');
}
async function openLightbox(blobId) {
  const dataURL = await store.getBlob(blobId);
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `<img src="${dataURL}">`;
  lb.onclick = () => lb.remove();
  document.body.appendChild(lb);
}

/* ---------------- add / save ---------------- */
function setModalType(type) {
  modalType = type;
  document.querySelectorAll('#typeRow button').forEach(b => b.classList.toggle('sel', b.dataset.type === type));
  $('contentLabel').style.display = type === 'image' ? 'none' : 'block';
  $('imageLabel').style.display = type === 'image' ? 'block' : 'none';
  $('contentLabel').firstChild.textContent = type === 'link' ? 'URL' : 'Text';
  $('itemContent').placeholder = type === 'link' ? 'https://…' : 'Anything worth keeping…';
}
function openModal(prefill = {}) {
  setModalType(prefill.type || 'link');
  $('itemContent').value = prefill.content || '';
  $('itemTitle').value = prefill.title || '';
  $('itemTags').value = '';
  $('imgPreview').innerHTML = prefill.imageDataURL ? `<img src="${prefill.imageDataURL}">` : '';
  pendingImageDataURL = prefill.imageDataURL || null;
  $('itemImage').value = '';
  $('addOverlay').classList.add('open');
  (prefill.type === 'image' ? $('itemTitle') : $('itemContent')).focus();
}
function closeModal() { $('addOverlay').classList.remove('open'); }

async function saveItem() {
  const content = $('itemContent').value.trim();
  const title = $('itemTitle').value.trim();
  const tags = $('itemTags').value.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean).slice(0, 6);
  if (modalType === 'image' && !pendingImageDataURL) return toast('Pick an image first');
  if (modalType !== 'image' && !content) return toast(modalType === 'link' ? 'Paste a URL first' : 'Write something first');
  if (modalType === 'link' && !URL_RE.test(content)) return toast('That doesn’t look like a URL');
  const item = { id: uid(), type: modalType, content: modalType === 'image' ? '' : content, title, tags, created: Date.now() };
  if (modalType === 'image') {
    item.blobId = 'b' + item.id;
    await store.putBlob(item.blobId, pendingImageDataURL);
  }
  await store.put(item);
  items.unshift(item);
  closeModal();
  render();
  toast('Stashed ✓');
}

/* ---------------- paste anything ---------------- */
document.addEventListener('paste', async e => {
  if (e.target.closest('.modal') || e.target.id === 'searchBox') return;
  const imgFile = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (imgFile) {
    const dataURL = await compressImage(imgFile.getAsFile());
    openModal({ type: 'image', imageDataURL: dataURL });
    return;
  }
  const text = e.clipboardData?.getData('text')?.trim();
  if (!text) return;
  openModal(URL_RE.test(text) ? { type: 'link', content: text } : { type: 'text', content: text });
});

/* ---------------- backup / restore ---------------- */
$('exportBtn').onclick = async () => {
  const blobs = [];
  for (const it of items) if (it.blobId) blobs.push({ id: it.blobId, dataURL: await store.getBlob(it.blobId) });
  const blob = new Blob([JSON.stringify({ items, blobs })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `stash-backup-${new Date().toLocaleDateString('en-CA')}.json`;
  a.click();
  toast('Backup downloaded ⬇');
};
$('importInput').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.items)) throw new Error('bad');
    if (!confirm(`Add ${data.items.length} item(s) from this backup to your stash?`)) return;
    const existing = new Set(items.map(i => i.id));
    for (const b of data.blobs || []) if (b.dataURL) await store.putBlob(b.id, b.dataURL);
    for (const it of data.items) if (!existing.has(it.id)) { await store.put(it); items.push(it); }
    items.sort((a, b) => b.created - a.created);
    render();
    toast('Restored ✓');
  } catch { toast('Not a Stash backup file'); }
};

/* ---------------- wiring ---------------- */
$('addBtn').onclick = () => openModal();
$('saveBtn').onclick = saveItem;
$('typeRow').addEventListener('click', e => { if (e.target.dataset.type) setModalType(e.target.dataset.type); });
$('itemImage').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  pendingImageDataURL = await compressImage(f);
  $('imgPreview').innerHTML = `<img src="${pendingImageDataURL}">`;
};
$('searchBox').addEventListener('input', e => { query = e.target.value.trim(); render(); });
document.querySelectorAll('.chip').forEach(c => c.onclick = () => {
  document.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active');
  filter = c.dataset.filter;
  render();
});
document.addEventListener('keydown', e => {
  if (e.key === '/' && !e.target.matches('input, textarea')) { e.preventDefault(); $('searchBox').focus(); }
  if (e.key === 'Escape') closeModal();
});
$('addOverlay').addEventListener('click', e => { if (e.target.id === 'addOverlay') closeModal(); });

/* ---------------- boot ---------------- */
(async () => { items = await store.all(); render(); })();

/* test hooks */
window.Stash = { store, refresh: async () => { items = await store.all(); render(); }, items: () => items };
