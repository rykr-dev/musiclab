/* Built-in soundfont catalog.

   Big soundfonts can't ship in the repo (GitHub blocks >100 MB, Cloudflare Pages
   caps assets at 25 MiB), so built-ins are fetched from a URL and then cached in
   IndexedDB — the download happens once per browser, and every later load is instant
   and works offline.

   Point a built-in at your own host with a Vite env var (see .env.example):
     VITE_SF_SGM_URL=https://sf.rsage.dev/SGM-V2_01-XG-2_06.sf2
   With no env var it falls back to /soundfonts/<file> so `public/soundfonts/` works
   for local development.
*/
const env = import.meta.env || {};

export const BUILTIN_SOUNDFONTS = [
  {
    id: "sgm",
    name: "SGM-V2.01 (XG 2.06)",
    url: env.VITE_SF_SGM_URL || "/soundfonts/SGM-V2_01-XG-2_06.sf2",
    approxMB: 229,
    note: "Full General MIDI set. Large — first load downloads it, then it's cached.",
  },
];

/* ---------- IndexedDB cache ---------- */
const DB = "musiclab-sf";
const STORE = "fonts";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCached(id) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
      tx.onsuccess = () => resolve(tx.result || null);
      tx.onerror = () => reject(tx.error);
    });
  } catch { return null; }
}

async function putCached(id, buf) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite").objectStore(STORE).put(buf, id);
      tx.onsuccess = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch { return false; }   // quota exceeded / private mode: still usable this session
}

export async function listCached() {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly").objectStore(STORE).getAllKeys();
      tx.onsuccess = () => resolve(tx.result || []);
      tx.onerror = () => resolve([]);
    });
  } catch { return []; }
}

export async function clearCached(id) {
  try {
    const db = await openDB();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
      tx.onsuccess = resolve;
      tx.onerror = resolve;
    });
  } catch { /* nothing cached */ }
}

/* ---------- validation ----------
   The SPA fallback answers ANY missing path with index.html + HTTP 200, so a
   soundfont that isn't hosted "downloads" fine and then fails to parse. Real
   .sf2/.sf3/.dls files are RIFF containers — check the magic before trusting
   (or caching) anything. */
export function looksLikeSoundfont(buf) {
  if (!buf || buf.byteLength < 12) return false;
  const b = new Uint8Array(buf, 0, 4);
  return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46; // "RIFF"
}

/* ---------- fetch with progress ---------- */
export async function fetchSoundfont(font, onProgress) {
  const cached = await getCached(font.id);
  if (cached && looksLikeSoundfont(cached)) { onProgress?.({ done: true, cached: true }); return cached; }
  if (cached) await clearCached(font.id);          // a bad payload got cached earlier — purge it

  const res = await fetch(font.url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  if ((res.headers.get("content-type") || "").includes("text/html")) {
    throw new Error("not hosted at this URL (got a web page instead of a soundfont)");
  }

  const total = Number(res.headers.get("content-length")) || font.approxMB * 1024 * 1024;
  const reader = res.body?.getReader();
  if (!reader) {                                   // no streaming: fall back to a plain read
    const buf = await res.arrayBuffer();
    if (!looksLikeSoundfont(buf)) throw new Error("not hosted at this URL (got a web page instead of a soundfont)");
    await putCached(font.id, buf);
    return buf;
  }

  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({ loaded, total, pct: Math.min(99, Math.round((loaded / total) * 100)) });
  }

  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  if (!looksLikeSoundfont(buf.buffer)) {
    throw new Error("not hosted at this URL (got a web page instead of a soundfont)");
  }
  onProgress?.({ done: true, caching: true });
  await putCached(font.id, buf.buffer);
  return buf.buffer;
}
