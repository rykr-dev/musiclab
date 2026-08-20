/* Local persistence + serverless share links.
   Saves live in localStorage; share links deflate the whole song JSON into a
   base64url string carried in the URL fragment - no server involved, the song IS the link. */
const KEY = "musiclab:saves";
const OLD_KEYS = ["asterism:saves", "seqlab:saves"];
// one-time migration from pre-rename storage keys
try {
  if (!localStorage.getItem(KEY)) {
    for (const k of OLD_KEYS) {
      const v = localStorage.getItem(k);
      if (v) { localStorage.setItem(KEY, v); break; }
    }
  }
} catch { /* storage unavailable */ }

export function listSaves() {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) || "{}");
    return Object.entries(m).map(([name, v]) => ({ name, ts: v.ts })).sort((a, b) => b.ts - a.ts);
  } catch { return []; }
}
export function saveLocal(name, song) {
  const m = JSON.parse(localStorage.getItem(KEY) || "{}");
  m[name] = { ts: Date.now(), song };
  localStorage.setItem(KEY, JSON.stringify(m));
}
export function loadLocal(name) {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}")[name]?.song ?? null; }
  catch { return null; }
}
export function deleteLocal(name) {
  const m = JSON.parse(localStorage.getItem(KEY) || "{}");
  delete m[name];
  localStorage.setItem(KEY, JSON.stringify(m));
}

function b64url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s) {
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
}

export async function encodeShare(song) {
  const stream = new Blob([JSON.stringify(song)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return b64url(await new Response(stream).arrayBuffer());
}
export async function decodeShare(code) {
  const stream = new Blob([unb64url(code)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return JSON.parse(await new Response(stream).text());
}
