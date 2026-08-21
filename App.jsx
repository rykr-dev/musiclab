import { useState, useRef, useEffect, useCallback } from "react";
import {
  BG, PANEL, PANEL2, LINE, TEXT, DIM, ACCENT, ACCENT2, DANGER,
  PATTERN_COLORS, PL_BAR_W, SONG_BARS, N_TRACKS, ALT_LABEL,
  uid, clamp, defaultReverb, bumpUid, DEFAULT_VEL, APP_NAME, SNAPS, CMD_LABEL,
} from "./constants";
import { Knob, Btn, Select, RenameInput, FloatWin, numFrom, parsePan } from "./components/ui";
import PianoRoll from "./components/PianoRoll";
import { Engine } from "./engine/engine";
import { listSaves, saveLocal, loadLocal, deleteLocal, encodeShare, decodeShare } from "./store";
import { BUILTIN_SOUNDFONTS, fetchSoundfont, getCached, clearCached } from "./soundfonts";
import { defaultThreeOsc, WAVEFORMS } from "./engine/threeosc";

/* ================= playlist playhead ================= */
function Playhead({ transportRef, beatsPerBar }) {
  const [beats, setBeats] = useState(0);
  useEffect(() => {
    let raf;
    const tick = () => {
      const t = transportRef.current;
      const base = t.mode === "pattern" ? (t.patStart ?? 0) : (t.startBeats ?? 0);
      setBeats(t.getBeats
        ? t.getBeats()
        : t.playing
          ? base + ((performance.now() - t.t0) * t.bpm) / 60000
          : base);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [transportRef]);
  const x = (beats / beatsPerBar) * PL_BAR_W;
  if (transportRef.current.mode === "pattern" && transportRef.current.playing) return null;   // playlist idle in PAT mode
  return <div style={{ position: "absolute", left: x, top: 0, bottom: 0, width: 1, background: ACCENT2, boxShadow: `0 0 6px ${ACCENT2}`, pointerEvents: "none", zIndex: 5 }} />;
}

function LCDPosition({ transportRef, beatsPerBar }) {
  const [beats, setBeats] = useState(0);
  useEffect(() => {
    let raf;
    const tick = () => {
      const t = transportRef.current;
      const base = t.mode === "pattern" ? (t.patStart ?? 0) : (t.startBeats ?? 0);
      setBeats(t.getBeats
        ? t.getBeats()
        : t.playing
          ? base + ((performance.now() - t.t0) * t.bpm) / 60000
          : base);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [transportRef]);
  const t = transportRef.current;
  const pat = t.mode === "pattern";
  const pos = pat
    ? (t.playing ? beats % Math.max(1e-6, t.patLoopBeats || beatsPerBar) : (t.patStart ?? 0))
    : beats;
  const bar = Math.floor(pos / beatsPerBar) + 1;
  const beat = Math.floor(pos % beatsPerBar) + 1;
  return <span style={{ color: pat ? ACCENT : undefined }}>{String(bar).padStart(3, "0")}:{beat}</span>;
}

/* ================= app ================= */
export default function App() {
  const [title, setTitle] = useState("untitled sequence");
  const [bpm, setBpm] = useState(140);
  const [timeSig, setTimeSig] = useState({ num: 4, den: 4 });
  const [snap, setSnap] = useState(0.25);
  const [playing, setPlaying] = useState(false);
  const transportRef = useRef({ playing: false, t0: 0, bpm: 140, startBeats: 0 });
  const [startBars, setStartBars] = useState(0);
  const [mode, setMode] = useState("song");          // "song" = playlist, "pattern" = loop the open pattern
  const [patStartBeats, setPatStartBeats] = useState(0);
  const rulerDrag = useRef(false);
  const [rollSize, setRollSize] = useState({ w: 640, h: 330 });
  const [rollMax, setRollMax] = useState(false);
  const prevRollSize = useRef(null);
  const toggleRollMax = () => {
    setRollMax((m) => {
      if (!m) {
        prevRollSize.current = rollSize;
        setRollSize({ w: Math.max(420, window.innerWidth - 24), h: Math.max(200, window.innerHeight - 250) });
      } else if (prevRollSize.current) {
        setRollSize(prevRollSize.current);
      }
      return !m;
    });
  };

  /* ---- audio engine ---- */
  const engineRef = useRef(null);
  const stateRef = useRef({});
  const sfInputRef = useRef(null);
  const [presets, setPresets] = useState([]);
  const [sfName, setSfName] = useState(null);
  const [sfLoading, setSfLoading] = useState(false);
  const [sfProgress, setSfProgress] = useState(null);
  const [sfCached, setSfCached] = useState({});

  useEffect(() => {                                  // which built-ins are already downloaded?
    (async () => {
      const map = {};
      for (const f of BUILTIN_SOUNDFONTS) map[f.id] = !!(await getCached(f.id));
      setSfCached(map);
    })();
  }, []);

  const [channels, setChannels] = useState([
    { id: 1, name: "Channel 1", vol: 0.8, pan: 0, insert: 0, instrument: null, pitch: 0, attack: 0.5, decay: 0.5, sustain: 0.5, release: 0.5 },
    { id: 2, name: "Channel 2", vol: 0.8, pan: 0, insert: 0, instrument: null, pitch: 0, attack: 0.5, decay: 0.5, sustain: 0.5, release: 0.5 },
  ]);
  const [activeChId, setActiveChId] = useState(1);
  const [renamingCh, setRenamingCh] = useState(null);
  const [confirmDelCh, setConfirmDelCh] = useState(null);
  const [chanSettingsId, setChanSettingsId] = useState(null);

  const [patterns, setPatterns] = useState([
    { id: 1, name: "Pattern 1", color: PATTERN_COLORS[0], notes: [] },
  ]);
  const [activePatId, setActivePatId] = useState(1);
  const [renamingPat, setRenamingPat] = useState(null);

  const [clips, setClips] = useState([]);
  const clipDrag = useRef(null);

  const [rollOpen, setRollOpen] = useState(false);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [inserts, setInserts] = useState([
    { id: 0, name: "Master", vol: 0.8, slots: [null, null, null] },
    ...[1, 2, 3, 4, 5, 6].map((i) => ({ id: i, name: `Insert ${i}`, vol: 0.8, slots: [null, null, null] })),
  ]);
  const [selInsert, setSelInsert] = useState(0);
  const [pluginWin, setPluginWin] = useState(null);
  const [zOrder, setZOrder] = useState({ roll: 20, plugin: 21, chan: 22, proj: 23 });
  const bump = (key) => setZOrder((z) => ({ ...z, [key]: Math.max(z.roll, z.plugin, z.chan ?? 0, z.proj ?? 0) + 1 }));

  const [toastMsg, setToastMsg] = useState(null);
  const toastTimer = useRef(null);
  const toast = useCallback((m) => {
    setToastMsg(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  }, []);

  useEffect(() => { transportRef.current.bpm = bpm; }, [bpm]);

  const ensureEngine = useCallback(async () => {
    if (!engineRef.current) {
      const eng = new Engine(() => stateRef.current, {
        onPresets: (list) => {                    // presets arriving means we're done
          setPresets(list);
          if (list.length) { setSfLoading(false); setSfProgress(null); }
        },
        onStatus: (m) => toast(m),
      });
      engineRef.current = eng;
      await eng.init();
    }
    return engineRef.current;
  }, [toast]);

  const loadSoundfontFile = async (file) => {
    if (!file) return;
    try {
      setSfLoading(true);
      const eng = await ensureEngine();
      const buf = await file.arrayBuffer();
      await eng.loadSoundfont(buf);
      setSfName(file.name);
    } catch (err) {
      console.error(err);
      toast(`Couldn't load soundfont: ${err.message || err}`);
    } finally {
      setSfLoading(false);
    }
  };

  const loadBuiltinSoundfont = async (font) => {
    try {
      setSfLoading(true);
      setSfProgress({ pct: 0 });
      const eng = await ensureEngine();
      const buf = await fetchSoundfont(font, (p) => {
        if (p.done) setSfProgress({ pct: 100, caching: p.caching });
        else setSfProgress(p);
      });
      await eng.loadSoundfont(buf);
      setSfName(font.name);
      setSfCached((m) => ({ ...m, [font.id]: true }));
    } catch (err) {
      console.error(err);
      toast(`Couldn't load ${font.name}: ${err.message || err}`);
    } finally {
      setSfLoading(false);
      setSfProgress(null);
    }
  };

  useEffect(() => { engineRef.current?.scheduler?.setBpm?.(bpm); }, [bpm]);
  useEffect(() => {
    if (engineRef.current) { engineRef.current.syncChannels(channels); return; }
    // A built-in synth needs the audio graph even though no soundfont was loaded.
    if (channels.some((c) => c.instrument?.type === "3xosc")) {
      ensureEngine().then((eng) => {
        eng.syncChannels(stateRef.current.channels);
        eng.syncInserts(stateRef.current.inserts);
      }).catch((err) => console.error(err));
    }
  }, [channels, ensureEngine]);
  useEffect(() => { engineRef.current?.syncInserts(inserts); }, [inserts]);

  /* ---- note audition: hear notes as you click/place them, muted while the song plays ---- */
  const auditionOn = useCallback((chId, pitch, vel) => {
    if (transportRef.current.playing) return;
    if (engineRef.current?.ready) { engineRef.current.audition(chId, pitch, vel ?? DEFAULT_VEL); return; }
    ensureEngine().then((eng) => eng.audition(chId, pitch, vel ?? DEFAULT_VEL)).catch(() => {});
  }, [ensureEngine]);
  const auditionOff = useCallback((chId, pitch) => {
    engineRef.current?.auditionOff(chId, pitch);
  }, []);

  /* ---- undo / redo ----
     Snapshot history over the song document. Changes landing within 400 ms of each
     other coalesce into one entry, so a note drag or a knob sweep is a single undo. */
  const histRef = useRef({ past: [], future: [], last: null, t: 0, applying: false });
  const [histTick, setHistTick] = useState(0);
  const docSnapshot = JSON.stringify({ title, bpm, timeSig, patterns, channels, inserts, clips });

  const applyDoc = (json) => {
    const d = JSON.parse(json);
    histRef.current.applying = true;
    setTitle(d.title); setBpm(d.bpm); setTimeSig(d.timeSig);
    setPatterns(d.patterns); setChannels(d.channels);
    setInserts(d.inserts); setClips(d.clips);
    if (!d.patterns.some((p) => p.id === activePatId)) setActivePatId(d.patterns[0]?.id ?? 1);
    if (!d.channels.some((c) => c.id === activeChId)) setActiveChId(d.channels[0]?.id ?? 1);
  };

  useEffect(() => {
    const h = histRef.current;
    const now = Date.now();
    if (h.last == null) { h.last = docSnapshot; h.t = now; return; }
    if (docSnapshot === h.last) return;
    if (h.applying) { h.applying = false; h.last = docSnapshot; h.t = now; return; }
    if (now - h.t > 400) {                       // new gesture → new history entry
      h.past.push(h.last);
      if (h.past.length > 150) h.past.shift();
      h.future = [];
    }
    h.last = docSnapshot;
    h.t = now;
    setHistTick((x) => x + 1);
  }, [docSnapshot]);

  const undo = useCallback(() => {
    const h = histRef.current;
    if (!h.past.length) return;
    h.future.push(h.last);
    applyDoc(h.past.pop());
    setHistTick((x) => x + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePatId, activeChId]);
  const redo = useCallback(() => {
    const h = histRef.current;
    if (!h.future.length) return;
    h.past.push(h.last);
    applyDoc(h.future.pop());
    setHistTick((x) => x + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePatId, activeChId]);

  useEffect(() => {                              // FL hotkeys: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA"].includes(el.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (k === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const canUndo = histRef.current.past.length > 0;
  const canRedo = histRef.current.future.length > 0;

  /* ---- project: local saves + serverless share links ---- */
  const [projOpen, setProjOpen] = useState(false);
  const [saves, setSaves] = useState([]);
  const [saveName, setSaveName] = useState("");
  const importInputRef = useRef(null);

  const collectSong = () => ({ v: 1, title, bpm, timeSig, snap, patterns, channels, inserts, clips });
  const applySong = (s) => {
    stop();
    setRollOpen(false); setPluginWin(null); setChanSettingsId(null); setConfirmDelCh(null);
    setTitle(s.title ?? "untitled sequence");
    setBpm(s.bpm ?? 140);
    setTimeSig(s.timeSig ?? { num: 4, den: 4 });
    setSnap(s.snap ?? 0.25);
    if (s.patterns?.length) { setPatterns(s.patterns); setActivePatId(s.patterns[0].id); }
    if (s.channels?.length) { setChannels(s.channels); setActiveChId(s.channels[0].id); }
    if (s.inserts?.length) setInserts(s.inserts);
    setClips(s.clips ?? []);
    setSelInsert(0);
    setStartBars(0);
    transportRef.current.startBeats = 0;
    let maxId = 10;
    for (const p of s.patterns ?? []) { maxId = Math.max(maxId, p.id); for (const n of p.notes ?? []) maxId = Math.max(maxId, n.id); }
    for (const c of s.channels ?? []) maxId = Math.max(maxId, c.id);
    for (const c of s.clips ?? []) maxId = Math.max(maxId, c.id);
    bumpUid(maxId);
  };
  const applySongRef = useRef(applySong);
  applySongRef.current = applySong;

  useEffect(() => {                                   // open a shared #s= link
    const m = location.hash.match(/[#&]s=([^&]+)/);
    if (!m) return;
    decodeShare(m[1])
      .then((song) => { applySongRef.current(song); toast("Loaded shared sequence — load a soundfont to hear it"); })
      .catch(() => toast("Couldn't read that share link"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doSaveLocal = () => {
    const name = (saveName || title || "untitled").trim();
    saveLocal(name, collectSong());
    setSaves(listSaves());
    toast(`Saved "${name}" in this browser`);
  };
  const doExport = () => {
    const blob = new Blob([JSON.stringify(collectSong(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(title || "sequence").replace(/[^a-z0-9-_ ]/gi, "").trim() || "sequence"}.seq.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const doImport = async (file) => {
    if (!file) return;
    try { applySong(JSON.parse(await file.text())); toast("Sequence imported"); }
    catch { toast("Not a valid sequence file"); }
  };
  const doShareLink = async () => {
    try {
      const code = await encodeShare(collectSong());
      const url = `${location.origin}${location.pathname}#s=${code}`;
      await navigator.clipboard.writeText(url);
      toast(url.length > 8000 ? "Link copied — it's a long one; Export .json may travel better" : "Share link copied to clipboard");
    } catch { toast("Couldn't build the share link"); }
  };

  const beatsPerBar = timeSig.num;
  const beatPx = PL_BAR_W / beatsPerBar;
  /* playlist grid snapping — quantize ABSOLUTE positions to the beat grid the track displays */
  const plSnap = (bars) => (Math.round((bars * beatsPerBar) / snap) * snap) / beatsPerBar;
  const plFloor = (bars) => (Math.floor((bars * beatsPerBar) / snap + 1e-9) * snap) / beatsPerBar;
  const activePat = patterns.find((p) => p.id === activePatId) || patterns[0];

  const patLoopBeats = Math.max(beatsPerBar, Math.ceil(
    (activePat?.notes ?? []).reduce((m, n) => Math.max(m, n.start + n.len), 0) / beatsPerBar || 1
  ) * beatsPerBar);

  const patternBars = (p) => {
    const end = p.notes.reduce((m, n) => Math.max(m, n.start + n.len), 0);
    return Math.max(1, Math.ceil(end / beatsPerBar || 1));
  };

  /* ---- transport ---- */
  const togglePlay = () => {
    const tr = transportRef.current;
    const next = !tr.playing;
    const fromBeats = tr.mode === "pattern" ? (tr.patStart ?? 0) : (tr.startBeats ?? 0);
    tr.playing = next;
    tr.t0 = performance.now();
    tr.from = fromBeats;
    setPlaying(next);

    if (!next) {
      engineRef.current?.stop();
      delete transportRef.current.getBeats;
      return;
    }
    if (fromBeats != null && tr.mode === "song" && clips.length === 0) {
      toast("No clips in the playlist — switch to PAT to play the open pattern");
    }
    // Boot the audio engine on demand — 3xOsc channels need it even with no soundfont loaded.
    (async () => {
      const eng = await ensureEngine();
      eng.syncChannels(stateRef.current.channels);
      eng.syncInserts(stateRef.current.inserts);
      await eng.play(fromBeats);
      transportRef.current.getBeats = () => eng.getBeats();     // playheads follow the audio clock
    })().catch((err) => {
      console.error(err);
      toast(`Audio engine failed to start: ${err.message || err}`);
    });
  };
  const stop = () => {
    const wasPlaying = transportRef.current.playing;
    transportRef.current.playing = false;
    engineRef.current?.stop();
    delete transportRef.current.getBeats;
    setPlaying(false);
    if (!wasPlaying) {                                  // FL: stop while stopped rewinds the marker to the top
      if (mode === "pattern") { setPatStartBeats(0); transportRef.current.patStart = 0; }
      else { transportRef.current.startBeats = 0; setStartBars(0); }
    }
  };
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;
  useEffect(() => {                                     // Space = play / stop-to-marker
    const onKey = (e) => {
      if (e.code !== "Space") return;
      const el = document.activeElement;
      if (el && ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(el.tagName)) return;
      e.preventDefault();
      togglePlayRef.current();                          // always the current closure
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const scrubTo = (e) => {                              // drag on the ruler to place the start marker
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = (e.clientX - rect.left) / PL_BAR_W;
    const bars = Math.max(0, e.altKey ? raw : plSnap(raw));
    setStartBars(bars);
    setMode("song");
    transportRef.current.mode = "song";
    transportRef.current.startBeats = bars * beatsPerBar;
    if (transportRef.current.playing) {
      transportRef.current.t0 = performance.now();                                   // live seek (visual)
      transportRef.current.from = bars * beatsPerBar;
      engineRef.current?.seek(bars * beatsPerBar);                                   // live seek (audio)
    }
  };

  /* Opening the piano roll focuses that pattern: the transport follows the roll
     until you click the playlist ruler, which hands control back to the song. */
  const focusPattern = (patId) => {
    setActivePatId(patId);
    setRollOpen(true);
    bump("roll");
    setMode("pattern");
    transportRef.current.mode = "pattern";
  };

  /* piano-roll scrub: places the pattern marker and flips to PATTERN mode */
  const scrubPattern = (beats) => {
    const b = Math.max(0, beats);
    setPatStartBeats(b);
    setMode("pattern");
    transportRef.current.mode = "pattern";
    transportRef.current.patStart = b;
    if (transportRef.current.playing) {
      transportRef.current.t0 = performance.now();
      transportRef.current.from = b;
      engineRef.current?.seek(b);
    }
  };

  /* ---- patterns ---- */
  const addPattern = () => {
    const id = uid();
    setPatterns((ps) => [...ps, { id, name: `Pattern ${ps.length + 1}`, color: PATTERN_COLORS[ps.length % PATTERN_COLORS.length], notes: [] }]);
    setActivePatId(id);
  };
  const deletePattern = (id) => {
    if (patterns.length === 1) { toast("Can't delete the last pattern"); return; }
    setPatterns((ps) => ps.filter((p) => p.id !== id));
    setClips((cs) => cs.filter((c) => c.patternId !== id));
    if (activePatId === id) { setActivePatId(patterns.find((p) => p.id !== id).id); setRollOpen(false); }
  };
  const updateNotes = useCallback((fn) => {
    setPatterns((ps) => ps.map((p) => p.id === activePatId ? { ...p, notes: fn(p.notes) } : p));
  }, [activePatId]);

  /* ---- channels ---- */
  const addChannel = () => {
    const id = uid();
    setChannels((cs) => [...cs, { id, name: `Channel ${cs.length + 1}`, vol: 0.8, pan: 0, insert: 0, instrument: null, pitch: 0, attack: 0.5, decay: 0.5, sustain: 0.5, release: 0.5 }]);
    setActiveChId(id);
  };
  const notesOnChannel = (chId) => patterns.reduce((sum, p) => sum + p.notes.filter((n) => n.ch === chId).length, 0);
  const requestDeleteChannel = (id) => {
    if (channels.length === 1) { toast("Can't delete the last channel"); return; }
    setConfirmDelCh(id);
  };
  const deleteChannel = (id) => {
    setPatterns((ps) => ps.map((p) => ({ ...p, notes: p.notes.filter((n) => n.ch !== id) })));
    setChannels((cs) => {
      const next = cs.filter((c) => c.id !== id);
      if (activeChId === id && next.length) setActiveChId(next[0].id);
      return next;
    });
    setConfirmDelCh(null);
  };

  /* ---- playlist ---- */
  const onTrackDown = (e, track) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (e.target.dataset.clip) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = (e.clientX - rect.left) / PL_BAR_W;
    const bar = e.altKey ? Math.max(0, raw) : Math.floor(raw);   // patterns land on whole measures
    setClips((cs) => [...cs, { id: uid(), patternId: activePat.id, track, startBar: bar, offsetBars: 0, lenBars: patternBars(activePat) }]);
  };
  const onClipDown = (e, clip, defLen) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button === 2) { setClips((cs) => cs.filter((c) => c.id !== clip.id)); return; }
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const mode = px < 7 ? "resizeL" : px > rect.width - 7 ? "resizeR" : "move";
    clipDrag.current = {
      mode, id: clip.id, grabX: e.clientX, grabY: e.clientY,
      startBar: clip.startBar, track: clip.track,
      offsetBars: clip.offsetBars ?? 0, lenBars: clip.lenBars ?? defLen,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onClipMove = (e) => {
    const d = clipDrag.current;
    if (!d) return;
    const free = e.altKey;
    const rawD = (e.clientX - d.grabX) / PL_BAR_W;
    const minLen = free ? 0.05 : snap / beatsPerBar;

    if (d.mode === "resizeR") {
      const rawEnd = d.startBar + d.lenBars + rawD;
      const end = free ? rawEnd : plSnap(rawEnd);          // snap the EDGE itself to the grid
      const lenBars = Math.max(minLen, end - d.startBar);
      setClips((cs) => cs.map((c) => c.id === d.id ? { ...c, lenBars } : c));
      return;
    }
    if (d.mode === "resizeL") {
      const rawLeft = d.startBar + rawD;
      const left = free ? rawLeft : plSnap(rawLeft);       // snap the EDGE itself to the grid
      let delta = left - d.startBar;
      delta = clamp(delta, Math.max(-d.offsetBars, -d.startBar), d.lenBars - minLen);
      setClips((cs) => cs.map((c) => c.id === d.id ? {
        ...c,
        startBar: d.startBar + delta,
        offsetBars: d.offsetBars + delta,
        lenBars: d.lenBars - delta,
      } : c));
      return;
    }
    const rawStart = d.startBar + rawD;
    const startBar = Math.max(0, free ? rawStart : Math.round(rawStart));  // moves stay measure-aligned
    const dTrack = Math.round((e.clientY - d.grabY) / 40);
    setClips((cs) => cs.map((c) => c.id === d.id ? {
      ...c,
      startBar,
      track: clamp(d.track + dTrack, 0, N_TRACKS - 1),
    } : c));
  };

  /* ---- mixer ---- */
  const addReverb = (insIdx, slotIdx) => {
    setInserts((ins) => ins.map((x, i) => i === insIdx ? {
      ...x, slots: x.slots.map((s, j) => j === slotIdx ? { type: "reverb", params: defaultReverb() } : s),
    } : x));
    setPluginWin({ insertIdx: insIdx, slotIdx });
    bump("plugin");
    toast("Reverb added — only plugin available for now");
  };
  const removeSlot = (insIdx, slotIdx) => {
    setInserts((ins) => ins.map((x, i) => i === insIdx ? {
      ...x, slots: x.slots.map((s, j) => j === slotIdx ? null : s),
    } : x));
    if (pluginWin && pluginWin.insertIdx === insIdx && pluginWin.slotIdx === slotIdx) setPluginWin(null);
  };
  const setReverbParam = (key, val) => {
    setInserts((ins) => ins.map((x, i) => i === pluginWin.insertIdx ? {
      ...x,
      slots: x.slots.map((s, j) => j === pluginWin.slotIdx ? { ...s, params: { ...s.params, [key]: val } } : s),
    } : x));
  };

  const reverbSlot = pluginWin ? inserts[pluginWin.insertIdx]?.slots[pluginWin.slotIdx] : null;

  /* live snapshot the engine's scheduler reads every tick */
  stateRef.current = { bpm, beatsPerBar, clips, patterns, channels, inserts, mode, patternId: activePatId, patLoopBeats };
  transportRef.current.mode = mode;
  transportRef.current.patStart = patStartBeats;
  transportRef.current.patLoopBeats = patLoopBeats;

  /* ================= render ================= */
  return (
    <div onDragStart={(e) => e.preventDefault()} style={{
      width: "100%", height: "100vh", background: BG, color: TEXT, display: "flex", flexDirection: "column",
      fontFamily: "system-ui, -apple-system, sans-serif", overflow: "hidden", position: "relative", userSelect: "none",
    }}>
      {/* ---------- top bar ---------- */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: PANEL, borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, letterSpacing: 2, color: ACCENT, fontSize: 13 }}>✦ {APP_NAME}</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={{
          background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 4, color: TEXT,
          padding: "4px 8px", fontSize: 12, width: 170,
        }} />
        <div style={{ display: "flex", gap: 2 }}>
          <Btn onClick={undo} title={`Undo (${CMD_LABEL}+Z)`}
            style={{ opacity: canUndo ? 1 : 0.35, padding: "4px 8px" }}>↶</Btn>
          <Btn onClick={redo} title={`Redo (${CMD_LABEL}+Shift+Z)`}
            style={{ opacity: canRedo ? 1 : 0.35, padding: "4px 8px" }}>↷</Btn>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <Btn on={playing} onClick={togglePlay} title="Play / stop (Space)">{playing ? "❚❚" : "▶"}</Btn>
          <Btn onClick={stop} title="Stop · press again to rewind marker to 1:1">■</Btn>
        </div>
        <div style={{
          fontFamily: "ui-monospace, monospace", background: "#0a0e18", border: `1px solid ${LINE}`, borderRadius: 4,
          color: ACCENT2, padding: "4px 10px", fontSize: 12, letterSpacing: 1, textShadow: `0 0 8px ${ACCENT2}66`, display: "flex", gap: 12,
        }}>
          <span>{bpm.toFixed(0)} BPM</span>
          <LCDPosition transportRef={transportRef} beatsPerBar={beatsPerBar} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, color: DIM }}>BPM</span>
          <input type="number" min={20} max={999} value={bpm}
            onChange={(e) => setBpm(clamp(Number(e.target.value) || 20, 20, 999))}
            style={{ width: 54, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 4, color: TEXT, padding: "3px 6px", fontSize: 12 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, color: DIM }}>Time sig</span>
          <Select value={String(timeSig.num)} width={46}
            options={[2, 3, 4, 5, 6, 7, 9, 12].map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(v) => setTimeSig((t) => ({ ...t, num: Number(v) }))} />
          <span style={{ color: DIM }}>/</span>
          <Select value={String(timeSig.den)} width={46}
            options={[2, 4, 8, 16].map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(v) => setTimeSig((t) => ({ ...t, den: Number(v) }))} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, color: DIM }}>Grid</span>
          <Select value={String(snap)} width={58}
            options={SNAPS.map((s) => ({ value: String(s.v), label: s.label }))}
            onChange={(v) => setSnap(Number(v))} />
        </div>
        <div style={{ display: "flex", gap: 2 }} title="PAT loops the open pattern · SONG plays the playlist">
          <Btn on={mode === "pattern"} onClick={() => { setMode("pattern"); transportRef.current.mode = "pattern"; }}>PAT</Btn>
          <Btn on={mode === "song"} onClick={() => { setMode("song"); transportRef.current.mode = "song"; }}>SONG</Btn>
        </div>
        <div style={{ flex: 1 }} />
        <Btn on={mixerOpen} onClick={() => setMixerOpen((m) => !m)}>Mixer</Btn>
        <Btn on={projOpen} onClick={() => { setSaveName(title); setSaves(listSaves()); setProjOpen(true); bump("proj"); }}
          style={{ borderColor: ACCENT, color: ACCENT }}>Save / Share</Btn>
      </div>

      {/* ---------- body ---------- */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* left rail */}
        <div style={{ width: 250, borderRight: `1px solid ${LINE}`, display: "flex", flexDirection: "column", background: PANEL, minHeight: 0 }}>
          {/* patterns */}
          <div style={{ padding: "8px 10px", borderBottom: `1px solid ${LINE}`, display: "flex", alignItems: "center" }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, color: DIM }}>PATTERNS</span>
            <div style={{ flex: 1 }} />
            <Btn onClick={addPattern} title="New pattern">＋</Btn>
          </div>
          <div style={{ maxHeight: 170, overflowY: "auto" }}>
            {patterns.map((p) => (
              <div key={p.id}
                onClick={() => setActivePatId(p.id)}
                onDoubleClick={() => focusPattern(p.id)}
                onContextMenu={(e) => { e.preventDefault(); deletePattern(p.id); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "pointer",
                  background: p.id === activePatId ? PANEL2 : "transparent",
                  borderLeft: `3px solid ${p.id === activePatId ? p.color : "transparent"}`,
                }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: p.color }} />
                {renamingPat === p.id ? (
                  <RenameInput initial={p.name} onDone={(v) => {
                    setPatterns((ps) => ps.map((x) => x.id === p.id ? { ...x, name: v || x.name } : x));
                    setRenamingPat(null);
                  }} />
                ) : (
                  <span style={{ fontSize: 11, flex: 1 }}>{p.name}</span>
                )}
                <button onClick={(e) => { e.stopPropagation(); setRenamingPat(p.id); }}
                  style={{ background: "none", border: "none", color: DIM, cursor: "pointer", fontSize: 10 }} title="Rename">✎</button>
                <span style={{ fontSize: 9, color: DIM }}>{p.notes.length}♪</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 9, color: DIM, padding: "4px 10px 8px" }}>
            Double-click opens the piano roll · right-click deletes · ✎ renames
          </div>

          {/* channel rack */}
          <div style={{ padding: "8px 10px", borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}`, display: "flex", alignItems: "center" }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, color: DIM }}>CHANNEL RACK</span>
            <div style={{ flex: 1 }} />
            <input ref={sfInputRef} type="file" accept=".sf2,.sf3,.dls" style={{ display: "none" }}
              onChange={(e) => { loadSoundfontFile(e.target.files?.[0]); e.target.value = ""; }} />
            <Select value="" width={92}
              options={[
                { value: "", label: sfLoading ? "Loading…" : sfName ? "SF ✓" : "Soundfont…" },
                ...BUILTIN_SOUNDFONTS.map((f) => ({
                  value: f.id,
                  label: `${f.name}${sfCached[f.id] ? " ✓" : ` (${f.approxMB}MB)`}`,
                })),
                { value: "__file", label: "Load from file…" },
              ]}
              onChange={(v) => {
                if (!v) return;
                if (v === "__file") { sfInputRef.current?.click(); return; }
                const font = BUILTIN_SOUNDFONTS.find((f) => f.id === v);
                if (font) loadBuiltinSoundfont(font);
              }} />
            <Btn onClick={addChannel} title="Add channel">＋</Btn>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {channels.map((c) => (
              <div key={c.id} onClick={() => setActiveChId(c.id)} style={{
                padding: "8px 10px", cursor: "pointer", borderBottom: `1px solid ${LINE}22`,
                background: c.id === activeChId ? PANEL2 : "transparent",
                borderLeft: `3px solid ${c.id === activeChId ? ACCENT : "transparent"}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  {renamingCh === c.id ? (
                    <RenameInput width={80} initial={c.name} onDone={(v) => {
                      setChannels((cs) => cs.map((x) => x.id === c.id ? { ...x, name: v || x.name } : x));
                      setRenamingCh(null);
                    }} />
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 600, flex: 1 }}
                      onDoubleClick={(e) => { e.stopPropagation(); setRenamingCh(c.id); }}>{c.name}</span>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); setChanSettingsId(c.id); }}
                    style={{ background: "none", border: "none", color: DIM, cursor: "pointer", fontSize: 11 }} title="Channel settings (pitch / envelope)">⚙</button>
                  <button onClick={(e) => { e.stopPropagation(); setRenamingCh(c.id); }}
                    style={{ background: "none", border: "none", color: DIM, cursor: "pointer", fontSize: 10 }} title="Rename">✎</button>
                  <button onClick={(e) => { e.stopPropagation(); requestDeleteChannel(c.id); }}
                    style={{ background: "none", border: "none", color: DIM, cursor: "pointer", fontSize: 11 }} title="Delete channel">✕</button>
                  <Knob label="PAN" size={26} value={c.pan} min={-1} max={1} parse={parsePan}
                    fmt={(v) => Math.abs(v) < 0.01 ? "C" : v < 0 ? `${Math.round(-v * 100)}L` : `${Math.round(v * 100)}R`}
                    onChange={(v) => setChannels((cs) => cs.map((x) => x.id === c.id ? { ...x, pan: v } : x))} />
                  <Knob label="VOL" size={26} value={c.vol} min={0} max={1} parse={(s) => numFrom(s) / 100}
                    fmt={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => setChannels((cs) => cs.map((x) => x.id === c.id ? { ...x, vol: v } : x))} />
                </div>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <span style={{ fontSize: 8, color: DIM, letterSpacing: 0.5 }} title="Mixer insert this channel routes to">FX</span>
                  <Select value={String(c.insert ?? 0)} width={64}
                    options={[{ value: "0", label: "Master" }, ...[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `Ins ${n}` }))]}
                    onChange={(v) => setChannels((cs) => cs.map((x) => x.id === c.id ? { ...x, insert: Number(v) } : x))} />
                  <select
                    value={c.instrument?.type === "3xosc" ? "__3xosc"
                      : c.instrument ? `${c.instrument.bank}:${c.instrument.program}` : ""}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const v = e.target.value;
                      const inst = v === "__3xosc"
                        ? defaultThreeOsc()
                        : (() => {
                            const p = presets.find((x) => `${x.bank}:${x.program}` === v);
                            return p ? { bank: p.bank, program: p.program, name: p.name } : null;
                          })();
                      setChannels((cs) => cs.map((x) => x.id === c.id ? { ...x, instrument: inst } : x));
                      if (v === "__3xosc") { setChanSettingsId(c.id); bump("chan"); }
                    }}
                    style={{
                      flex: 1, minWidth: 0, background: PANEL2, color: TEXT,
                      border: `1px solid ${LINE}`,
                      borderRadius: 4, fontSize: 10, padding: "3px 6px", cursor: "pointer",
                    }}>
                    <option value="">— pick an instrument —</option>
                    <option value="__3xosc">3xOsc (built-in synth)</option>
                    {presets.map((p) => (
                      <option key={`${p.bank}:${p.program}`} value={`${p.bank}:${p.program}`}>
                        {String(p.bank).padStart(3, "0")}:{String(p.program).padStart(3, "0")} {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* playlist */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: "6px 12px", fontSize: 10, color: DIM, borderBottom: `1px solid ${LINE}`, background: PANEL }}>
            PLAYLIST — click to place <span style={{ color: activePat.color }}>{activePat.name}</span> · drag edges to trim which part plays · right-click removes · hold {ALT_LABEL} for free placement
          </div>
          <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
            <div style={{ width: SONG_BARS * PL_BAR_W + 40, position: "relative" }}>
              {/* ruler with beat ticks */}
              <div
                className="dragsurface"
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  rulerDrag.current = true;
                  scrubTo(e);
                }}
                onPointerMove={(e) => { if (rulerDrag.current) scrubTo(e); }}
                onPointerUp={() => { rulerDrag.current = false; }}
                title="Click or drag to set where playback starts"
                style={{ display: "flex", height: 22, borderBottom: `1px solid ${LINE}`, background: PANEL, position: "sticky", top: 0, zIndex: 4, cursor: "pointer" }}>
                {Array.from({ length: SONG_BARS }, (_, i) => (
                  <div key={i} style={{
                    width: PL_BAR_W, flexShrink: 0, fontSize: 9, color: DIM, borderLeft: `1px solid ${LINE}`,
                    paddingLeft: 4, paddingTop: 5, fontFamily: "ui-monospace, monospace", pointerEvents: "none",
                    backgroundImage: `repeating-linear-gradient(to right, ${LINE}66 0 1px, transparent 1px ${beatPx}px)`,
                    backgroundPosition: "bottom", backgroundSize: `100% 6px`, backgroundRepeat: "no-repeat",
                  }}>{i + 1}</div>
                ))}
                <div style={{
                  position: "absolute", left: startBars * PL_BAR_W - 5, top: 0, width: 0, height: 0,
                  borderLeft: "5px solid transparent", borderRight: "5px solid transparent",
                  borderTop: `8px solid ${ACCENT2}`, pointerEvents: "none",
                }} />
              </div>
              {/* tracks — FL-style grid: beat lines, bar lines, alternating 4-bar groups */}
              <div style={{ position: "relative" }}>
                {Array.from({ length: N_TRACKS }, (_, t) => (
                  <div key={t}
                    className="dragsurface"
                    onPointerDown={(e) => onTrackDown(e, t)}
                    onContextMenu={(e) => e.preventDefault()}
                    style={{
                      height: 40, borderBottom: `1px solid ${LINE}55`, position: "relative",
                      background: t % 2 ? "#161929" : "#181b2d",
                      backgroundImage: `
                        repeating-linear-gradient(to right, rgba(255,255,255,0.028) 0 ${PL_BAR_W * 4}px, transparent ${PL_BAR_W * 4}px ${PL_BAR_W * 8}px),
                        repeating-linear-gradient(to right, ${LINE}99 0 1px, transparent 1px ${PL_BAR_W}px),
                        repeating-linear-gradient(to right, ${LINE}40 0 1px, transparent 1px ${beatPx}px)
                      `,
                    }}>
                    {clips.filter((c) => c.track === t).map((c) => {
                      const p = patterns.find((x) => x.id === c.patternId);
                      if (!p) return null;
                      const defLen = patternBars(p);
                      const lenB = c.lenBars ?? defLen;
                      const off = c.offsetBars ?? 0;
                      const w0 = off * beatsPerBar, w1 = (off + lenB) * beatsPerBar;
                      const pitches = p.notes.map((n) => n.pitch);
                      const pHi = pitches.length ? Math.max(...pitches) : 72;
                      const span = pitches.length ? Math.max(1, pHi - Math.min(...pitches)) : 12;
                      return (
                        <div key={c.id} data-clip="1" className="dragsurface"
                          onPointerDown={(e) => onClipDown(e, c, defLen)}
                          onPointerMove={onClipMove}
                          onPointerUp={() => { clipDrag.current = null; }}
                          onDoubleClick={() => focusPattern(p.id)}
                          onContextMenu={(e) => { e.preventDefault(); }}
                          style={{
                            position: "absolute", left: c.startBar * PL_BAR_W, top: 3, height: 33,
                            width: Math.max(10, lenB * PL_BAR_W - 3), background: `${p.color}2e`, border: `1px solid ${p.color}`,
                            borderRadius: 4, fontSize: 9, color: p.color, cursor: "grab",
                            overflow: "hidden", whiteSpace: "nowrap",
                          }}>
                          <div style={{ padding: "1px 6px 0", pointerEvents: "none" }}>
                            {p.name}{off > 0.001 ? ` ⇥${Number(off.toFixed(2))}` : ""}
                          </div>
                          <svg viewBox={`0 0 ${lenB * PL_BAR_W} 18`} preserveAspectRatio="none"
                            style={{ position: "absolute", left: 0, bottom: 1, width: lenB * PL_BAR_W, height: 18, pointerEvents: "none", opacity: 0.85 }}>
                            {p.notes.filter((n) => n.start < w1 && n.start + n.len > w0).map((n) => {
                              /* true musical pixels: 1 bar = PL_BAR_W, so notes never drift as the clip resizes */
                              const x = ((Math.max(n.start, w0) - w0) / beatsPerBar) * PL_BAR_W;
                              const wdt = ((Math.min(n.start + n.len, w1) - Math.max(n.start, w0)) / beatsPerBar) * PL_BAR_W;
                              const y = ((pHi - n.pitch) / span) * 14 + 1.5;
                              return <rect key={n.id} x={x} y={y} width={Math.max(1, wdt)} height={2.2} fill={p.color} />;
                            })}
                          </svg>
                          <div data-clip="1" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize" }} />
                          <div data-clip="1" style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize" }} />
                        </div>
                      );
                    })}
                  </div>
                ))}
                <Playhead transportRef={transportRef} beatsPerBar={beatsPerBar} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- mixer ---------- */}
      {mixerOpen && (
        <div style={{ height: 210, borderTop: `1px solid ${LINE}`, background: PANEL, display: "flex", overflowX: "auto", flexShrink: 0 }}>
          {inserts.map((ins, i) => {
            const routed = channels.filter((c) => (c.insert ?? 0) === ins.id);
            const hasActive = routed.some((c) => c.id === activeChId);
            return (
            <div key={ins.id} onClick={() => setSelInsert(i)} style={{
              width: 96, flexShrink: 0, borderRight: `1px solid ${LINE}`, padding: 8, cursor: "pointer",
              background: selInsert === i ? PANEL2 : "transparent",
              borderTop: `2px solid ${selInsert === i ? ACCENT : "transparent"}`,
              display: "flex", flexDirection: "column", gap: 6,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: i === 0 ? ACCENT : TEXT, textAlign: "center" }}>{ins.name}</div>
              <div title={routed.map((c) => c.name).join(", ") || "No channels routed here"} style={{
                fontSize: 8, color: hasActive ? ACCENT2 : DIM, textAlign: "center", minHeight: 10,
                overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
              }}>
                {routed.length ? routed.map((c) => c.name).join(", ") : "—"}
              </div>
              <input type="range" min={0} max={1} step={0.01} value={ins.vol}
                onChange={(e) => setInserts((xs) => xs.map((x, j) => j === i ? { ...x, vol: Number(e.target.value) } : x))}
                style={{ width: "100%", accentColor: ACCENT }} />
              <div style={{ fontSize: 8, color: DIM, textAlign: "center", fontFamily: "ui-monospace, monospace" }}>{Math.round(ins.vol * 100)}%</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
                {ins.slots.map((s, j) => (
                  <div key={j}
                    onClick={(e) => { e.stopPropagation(); setSelInsert(i); s ? (setPluginWin({ insertIdx: i, slotIdx: j }), bump("plugin")) : addReverb(i, j); }}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (s) removeSlot(i, j); }}
                    title={s ? "Click to open · right-click to remove" : "Click to add Reverb"}
                    style={{
                      height: 22, borderRadius: 3, fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center",
                      background: s ? `${ACCENT}22` : PANEL2, border: `1px ${s ? "solid " + ACCENT : "dashed " + LINE}`,
                      color: s ? ACCENT : DIM, cursor: "pointer",
                    }}>
                    {s ? "Reverb" : `Slot ${j + 1}`}
                  </div>
                ))}
              </div>
            </div>
          );})}
        </div>
      )}

      {/* ---------- floating: piano roll ---------- */}
      {rollOpen && activePat && (
        <FloatWin title={`PIANO ROLL — ${activePat.name}`} color={activePat.color}
          x0={280} y0={60} w={rollSize.w + 4} z={zOrder.roll} onFocus={() => bump("roll")} onClose={() => setRollOpen(false)}
          maximized={rollMax} onHeaderDoubleClick={toggleRollMax}
          headerExtras={
            <Select value={String(activeChId)} width={110}
              options={channels.map((c) => ({ value: String(c.id), label: c.name }))}
              onChange={(v) => setActiveChId(Number(v))} />
          }>
          <PianoRoll pattern={activePat} channels={channels} activeChId={activeChId}
            updateNotes={updateNotes} snap={snap} setSnap={setSnap} beatsPerBar={beatsPerBar}
            clips={clips} transportRef={transportRef} size={rollSize} setSize={setRollSize}
            audition={auditionOn} auditionOff={auditionOff}
            patStartBeats={patStartBeats} scrubPattern={scrubPattern} patLoopBeats={patLoopBeats} />
        </FloatWin>
      )}

      {/* ---------- floating: channel settings ---------- */}
      {chanSettingsId != null && (() => {
        const ch = channels.find((c) => c.id === chanSettingsId);
        if (!ch) return null;
        const patch = (k, v) => setChannels((cs) => cs.map((x) => x.id === ch.id ? { ...x, [k]: v } : x));
        return (
          <FloatWin title={`CHANNEL — ${ch.name}`} color={ACCENT} x0={340} y0={110}
            w={ch.instrument?.type === "3xosc" ? 400 : 330}
            z={zOrder.chan} onFocus={() => bump("chan")} onClose={() => setChanSettingsId(null)}>
            {ch.instrument?.type === "3xosc" && (() => {
              const inst = ch.instrument;
              const setInst = (patchObj) => setChannels((cs) => cs.map((x) =>
                x.id === ch.id ? { ...x, instrument: { ...x.instrument, ...patchObj } } : x));
              const setOsc = (i, k, v) => setInst({
                oscs: inst.oscs.map((o, j) => j === i ? { ...o, [k]: v } : o),
              });
              return (
                <div style={{ borderBottom: `1px solid ${LINE}`, padding: "10px 12px" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: ACCENT, marginBottom: 8 }}>
                    3×OSC
                  </div>
                  {inst.oscs.map((o, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 9, color: DIM, width: 16 }}>{i + 1}</span>
                      <Select value={o.wave} width={78}
                        options={WAVEFORMS.map((w) => ({ value: w, label: w === "sawtooth" ? "saw" : w }))}
                        onChange={(v) => setOsc(i, "wave", v)} />
                      <Knob label="CRS" size={26} value={o.coarse} min={-24} max={24}
                        fmt={(v) => `${v >= 0 ? "+" : ""}${Math.round(v)}`}
                        onChange={(v) => setOsc(i, "coarse", Math.round(v))} />
                      <Knob label="FINE" size={26} value={o.fine} min={-100} max={100}
                        fmt={(v) => `${v >= 0 ? "+" : ""}${Math.round(v)}`}
                        onChange={(v) => setOsc(i, "fine", v)} />
                      <Knob label="VOL" size={26} value={o.level} min={0} max={1}
                        fmt={(v) => `${Math.round(v * 100)}`} onChange={(v) => setOsc(i, "level", v)} />
                      <Knob label="PAN" size={26} value={o.pan} min={-1} max={1}
                        fmt={(v) => Math.abs(v) < 0.01 ? "C" : v < 0 ? `${Math.round(-v * 100)}L` : `${Math.round(v * 100)}R`}
                        onChange={(v) => setOsc(i, "pan", v)} />
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 6 }}>
                    <Knob label="ATK" size={30} value={inst.attack} min={0} max={1}
                      fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setInst({ attack: v })} />
                    <Knob label="DEC" size={30} value={inst.decay} min={0} max={1}
                      fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setInst({ decay: v })} />
                    <Knob label="SUS" size={30} value={inst.sustain} min={0} max={1}
                      fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setInst({ sustain: v })} />
                    <Knob label="REL" size={30} value={inst.release} min={0} max={1}
                      fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setInst({ release: v })} />
                  </div>
                </div>
              );
            })()}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, padding: 16, justifyContent: "center" }}>
              <Knob label="PITCH" size={44} value={ch.pitch ?? 0} min={-24} max={24}
                parse={(s) => numFrom(s) / 100}
                fmt={(v) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)}ct`} onChange={(v) => patch("pitch", v)} />
              <Knob label="ATTACK" value={ch.attack ?? 0.5} min={0} max={1} parse={(s) => numFrom(s) / 100}
                fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch("attack", v)} />
              <Knob label="DECAY" value={ch.decay ?? 0.5} min={0} max={1} parse={(s) => numFrom(s) / 100}
                fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch("decay", v)} />
              <Knob label="SUSTAIN" value={ch.sustain ?? 0.5} min={0} max={1} parse={(s) => numFrom(s) / 100}
                fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch("sustain", v)} />
              <Knob label="RELEASE" value={ch.release ?? 0.5} min={0} max={1} parse={(s) => numFrom(s) / 100}
                fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch("release", v)} />
            </div>
            <div style={{ fontSize: 9, color: DIM, padding: "0 16px 12px", textAlign: "center" }}>
              {ch.instrument?.type === "3xosc"
                ? "3xOsc uses its own ADSR above — these shape pitch and MIDI envelope offsets"
                : "50% = soundfont default · sustain is stored but not yet audible (engine limitation)"}
            </div>
          </FloatWin>
        );
      })()}

      {/* ---------- floating: reverb ---------- */}
      {pluginWin && reverbSlot && (
        <FloatWin title={`REVERB — ${inserts[pluginWin.insertIdx].name} · Slot ${pluginWin.slotIdx + 1}`}
          color={ACCENT2} x0={420} y0={180} w={430} z={zOrder.plugin}
          onFocus={() => bump("plugin")} onClose={() => setPluginWin(null)}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, padding: 16, justifyContent: "center" }}>
            <Knob label="LOWCUT" log value={reverbSlot.params.lowcut} min={20} max={2000}
              fmt={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz`} onChange={(v) => setReverbParam("lowcut", v)} />
            <Knob label="HIGHCUT" log value={reverbSlot.params.highcut} min={1000} max={20000}
              fmt={(v) => `${(v / 1000).toFixed(1)}k`} onChange={(v) => setReverbParam("highcut", v)} />
            <Knob label="PREDELAY" value={reverbSlot.params.predelay} min={0} max={200}
              fmt={(v) => `${Math.round(v)}ms`} onChange={(v) => setReverbParam("predelay", v)} />
            <Knob label="ROOM SIZE" value={reverbSlot.params.roomsize} min={0} max={100}
              fmt={(v) => `${Math.round(v)}`} onChange={(v) => setReverbParam("roomsize", v)} />
            <Knob label="DIFFUSION" value={reverbSlot.params.diffusion} min={0} max={100}
              fmt={(v) => `${Math.round(v)}`} onChange={(v) => setReverbParam("diffusion", v)} />
            <Knob label="DECAY" log value={reverbSlot.params.decay} min={0.1} max={10}
              fmt={(v) => `${v.toFixed(1)}s`} onChange={(v) => setReverbParam("decay", v)} />
            <Knob label="DRY" value={reverbSlot.params.dry} min={0} max={100}
              fmt={(v) => `${Math.round(v)}%`} onChange={(v) => setReverbParam("dry", v)} />
            <Knob label="REVERB" value={reverbSlot.params.wet} min={0} max={100}
              fmt={(v) => `${Math.round(v)}%`} onChange={(v) => setReverbParam("wet", v)} />
          </div>
          <div style={{ fontSize: 9, color: DIM, padding: "0 16px 12px", textAlign: "center" }}>
            UI only for now — the DSP wires in with the audio engine milestone
          </div>
        </FloatWin>
      )}

      {/* ---------- floating: project save & share ---------- */}
      {projOpen && (
        <FloatWin title="PROJECT — SAVE & SHARE" color={ACCENT2} x0={360} y0={110} w={370}
          z={zOrder.proj} onFocus={() => bump("proj")} onClose={() => setProjOpen(false)}>
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Save name"
                style={{ flex: 1, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 4, color: TEXT, padding: "4px 8px", fontSize: 11 }} />
              <Btn onClick={doSaveLocal}>Save here</Btn>
            </div>
            <div style={{ maxHeight: 150, overflowY: "auto", border: `1px solid ${LINE}`, borderRadius: 4 }}>
              {saves.length === 0 && (
                <div style={{ fontSize: 10, color: DIM, padding: 8 }}>No sequences saved in this browser yet</div>
              )}
              {saves.map((s) => (
                <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderBottom: `1px solid ${LINE}44` }}>
                  <span style={{ fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                  <span style={{ fontSize: 9, color: DIM, flexShrink: 0 }}>{new Date(s.ts).toLocaleDateString()}</span>
                  <Btn onClick={() => { const song = loadLocal(s.name); if (song) { applySong(song); toast(`Loaded "${s.name}"`); } }}>Load</Btn>
                  <button onClick={() => { deleteLocal(s.name); setSaves(listSaves()); }}
                    style={{ background: "none", border: "none", color: DIM, cursor: "pointer", fontSize: 11 }} title="Delete save">✕</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Btn onClick={doShareLink} style={{ borderColor: ACCENT2, color: ACCENT2 }}>Copy share link</Btn>
              <Btn onClick={doExport}>Export .json</Btn>
              <input ref={importInputRef} type="file" accept=".json,application/json" style={{ display: "none" }}
                onChange={(e) => { doImport(e.target.files?.[0]); e.target.value = ""; }} />
              <Btn onClick={() => importInputRef.current?.click()}>Import .json</Btn>
            </div>
            <div style={{ fontSize: 9, color: DIM, lineHeight: 1.5 }}>
              Saves live in this browser only. Share links pack the whole sequence into the URL — no server,
              permanent as long as the link exists. Whoever opens one loads their own soundfont to hear it.
            </div>
          </div>
        </FloatWin>
      )}

      {/* ---------- confirm channel delete ---------- */}
      {confirmDelCh != null && (() => {
        const ch = channels.find((c) => c.id === confirmDelCh);
        if (!ch) return null;
        const count = notesOnChannel(ch.id);
        return (
          <div onClick={() => setConfirmDelCh(null)} style={{
            position: "absolute", inset: 0, background: "rgba(8,10,20,0.6)", zIndex: 500,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div onClick={(e) => e.stopPropagation()} style={{
              width: 320, background: PANEL, border: `1px solid ${DANGER}`, borderRadius: 8,
              padding: 16, boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Delete {ch.name}?</div>
              <div style={{ fontSize: 11, color: DIM, lineHeight: 1.5, marginBottom: 14 }}>
                {count > 0
                  ? <>This removes the channel and <span style={{ color: DANGER, fontWeight: 700 }}>{count} note{count === 1 ? "" : "s"}</span> written on it across your patterns. This can't be undone.</>
                  : <>This removes the channel. It has no notes on it yet, so nothing else is affected.</>}
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <Btn onClick={() => setConfirmDelCh(null)}>Cancel</Btn>
                <Btn danger onClick={() => deleteChannel(ch.id)} style={{ borderColor: DANGER }}>Delete channel</Btn>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ---------- soundfont download progress ---------- */}
      {sfProgress && (
        <div style={{
          position: "absolute", bottom: 56, left: "50%", transform: "translateX(-50%)",
          background: PANEL, border: `1px solid ${ACCENT2}`, borderRadius: 6, padding: "10px 14px",
          zIndex: 900, width: 280, boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}>
          <div style={{ fontSize: 10, color: TEXT, marginBottom: 6 }}>
            {sfProgress.caching ? "Caching for next time…"
              : sfProgress.pct >= 100 ? "Loading into the synth…"
              : `Downloading soundfont — ${sfProgress.pct ?? 0}%`}
          </div>
          <div style={{ height: 5, background: PANEL2, borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              width: `${sfProgress.pct ?? 0}%`, height: "100%", background: ACCENT2,
              transition: "width 120ms linear",
            }} />
          </div>
          {sfProgress.total > 0 && (
            <div style={{ fontSize: 9, color: DIM, marginTop: 4, fontFamily: "ui-monospace, monospace" }}>
              {(sfProgress.loaded / 1048576).toFixed(0)} / {(sfProgress.total / 1048576).toFixed(0)} MB
            </div>
          )}
        </div>
      )}

      {/* ---------- toast ---------- */}
      {toastMsg && (
        <div style={{
          position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
          background: PANEL2, border: `1px solid ${ACCENT}`, color: TEXT, padding: "8px 16px",
          borderRadius: 6, fontSize: 12, zIndex: 999, boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}>{toastMsg}</div>
      )}
    </div>
  );
}
