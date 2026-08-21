import { useState, useRef, useEffect } from "react";
import {
  PANEL, PANEL2, LINE, TEXT, DIM, ACCENT, ACCENT2, NOTE_COLORS,
  MIN_PITCH, MAX_PITCH, ROWS, ROW_H, KEYS_W, BEAT_W, PR_BARS, VEL_H,
  isBlack, pitchName, ALT_LABEL, CMD_LABEL, DEFAULT_VEL, SNAPS, uid, clamp, DANGER,
} from "../constants";
import { Knob, Btn, Select, numFrom, parsePan } from "./ui";

let noteClipboard = [];   // survives roll close; pastes across patterns

/* ================= piano roll ================= */
function PianoRoll({ pattern, channels, activeChId, updateNotes, snap, setSnap, beatsPerBar, clips, transportRef, size, setSize, audition, auditionOff, patStartBeats, scrubPattern, patLoopBeats }) {
  const canvasRef = useRef(null);
  const velRef = useRef(null);
  const scrollRef = useRef(null);
  const velScrollRef = useRef(null);
  const wrapRef = useRef(null);
  const [tool, setTool] = useState("draw");
  const [selection, setSelection] = useState([]);
  const [propNoteId, setPropNoteId] = useState(null);
  const [propPos, setPropPos] = useState({ x: 60, y: 40 });
  const [zoom, setZoom] = useState(1);
  const [velInfo, setVelInfo] = useState(null);
  const [hoverPitch, setHoverPitch] = useState(null);
  const zoomRef = useRef(1);
  const pendingZoom = useRef(null);
  const resizeDrag = useRef(null);
  const drag = useRef(null);
  const velDrag = useRef(false);
  const lastLen = useRef(null);
  const lastProps = useRef({ vel: DEFAULT_VEL, pan: 0, release: 0.5, fine: 0, slide: false, porta: false, color: 0 });
  const justCreated = useRef(null);
  const previewRef = useRef(null);
  const startPreview = (pitch, vel) => {
    if (!audition) return;
    audition(activeChId, pitch, vel ?? DEFAULT_VEL);
    previewRef.current = { ch: activeChId, pitch };
  };
  const stopPreview = () => {
    const p = previewRef.current;
    if (p && auditionOff) auditionOff(p.ch, p.pitch);
    previewRef.current = null;
  };

  const beatW = BEAT_W * zoom;
  /* Infinite-feeling roll: the canvas grows in 4-bar chunks as you scroll toward
     the edge, and always covers whatever the pattern already contains. */
  const [extraBars, setExtraBars] = useState(0);
  const contentEnd = pattern.notes.reduce((m, n) => Math.max(m, n.start + n.len), 0);
  const neededBars = Math.ceil(contentEnd / beatsPerBar) + 1;
  const bars = Math.max(PR_BARS + extraBars, neededBars);
  const totalBeats = bars * beatsPerBar;
  const W = KEYS_W + totalBeats * beatW;
  const growIfNearEdge = (el) => {
    if (!el) return;
    if (el.scrollLeft + el.clientWidth > W - 260) setExtraBars((b) => b + 4);
  };
  const growRef = useRef(growIfNearEdge);
  growRef.current = growIfNearEdge;
  const H = ROWS * ROW_H;
  const snapV = snap;
  if (lastLen.current == null) lastLen.current = snapV;

  const activeCh = channels.find((c) => c.id === activeChId) || channels[0];
  const noteColor = (n) => NOTE_COLORS[n.color ?? 0];

  /* ---- grid drawing ---- */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    // Cap the backing store: browsers refuse to render canvases past ~16-24M pixels.
    const dpr = Math.max(0.75, Math.min(window.devicePixelRatio || 1, Math.sqrt(16e6 / (W * H))));
    cv.width = Math.floor(W * dpr); cv.height = Math.floor(H * dpr);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    for (let r = 0; r < ROWS; r++) {
      const pitch = MAX_PITCH - r;
      ctx.fillStyle = isBlack(pitch) ? "#151827" : "#1b1f30";
      ctx.fillRect(KEYS_W, r * ROW_H, W - KEYS_W, ROW_H);
      if (pitch % 12 === 0) {
        ctx.fillStyle = "#3a4059";
        ctx.fillRect(KEYS_W, r * ROW_H + ROW_H - 1, W - KEYS_W, 1);
      }
    }
    const snapPx = snapV * beatW;
    for (let x = 0; x <= totalBeats / snapV; x++) {
      const px = KEYS_W + x * snapPx;
      const beat = x * snapV;
      const isBar = Math.abs(beat % beatsPerBar) < 1e-6;
      const isBeat = Math.abs(beat % 1) < 1e-6;
      ctx.fillStyle = isBar ? "#454c6b" : isBeat ? "#2c3149" : "#20243a";
      ctx.fillRect(Math.round(px), 0, 1, H);
    }
    // hovered row highlight
    if (hoverPitch != null) {
      ctx.fillStyle = "rgba(247,168,56,0.07)";
      ctx.fillRect(KEYS_W, (MAX_PITCH - hoverPitch) * ROW_H, W - KEYS_W, ROW_H);
    }
    // ghost notes (other channels)
    for (const n of pattern.notes) {
      if (n.ch === activeCh.id) continue;
      ctx.fillStyle = "rgba(140,148,185,0.22)";
      ctx.fillRect(KEYS_W + n.start * beatW, (MAX_PITCH - n.pitch) * ROW_H + 1, n.len * beatW - 1, ROW_H - 2);
    }
    // active channel notes — brightness follows velocity, fill follows note color
    for (const n of pattern.notes) {
      if (n.ch !== activeCh.id) continue;
      const x = KEYS_W + n.start * beatW, y = (MAX_PITCH - n.pitch) * ROW_H;
      const w = n.len * beatW;
      const sel = selection.includes(n.id);
      ctx.globalAlpha = 0.4 + 0.6 * (n.vel ?? 0.78);
      ctx.fillStyle = noteColor(n);
      ctx.fillRect(x, y + 1, w - 1, ROW_H - 2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = sel ? "#ffffff" : "rgba(0,0,0,0.45)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 1.5, w - 2, ROW_H - 3);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(x + w - 4, y + 2, 3, ROW_H - 4);        // resize grip
      if (n.slide) {                                        // FL slide marker
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.beginPath();
        ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + 8, y + ROW_H / 2); ctx.lineTo(x + 2, y + ROW_H - 2);
        ctx.closePath(); ctx.fill();
      }
      if (w >= 26) {                                        // pitch name on the note, like FL
        ctx.fillStyle = "rgba(0,0,0,0.72)";
        ctx.font = "9px ui-monospace, monospace";
        ctx.fillText(pitchName(n.pitch), x + (n.slide ? 11 : 3), y + ROW_H - 4);
      }
    }
    // marquee
    if (drag.current?.mode === "marquee") {
      const m = drag.current;
      ctx.strokeStyle = ACCENT2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1), Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
      ctx.setLineDash([]);
    }
    // keys column
    for (let r = 0; r < ROWS; r++) {
      const pitch = MAX_PITCH - r;
      const hovered = pitch === hoverPitch;
      ctx.fillStyle = hovered ? ACCENT : isBlack(pitch) ? "#20233a" : "#d7dbee";
      ctx.fillRect(0, r * ROW_H, KEYS_W, ROW_H - 1);
      if (pitch % 12 === 0 || hovered) {
        ctx.fillStyle = hovered ? "#1a1200" : isBlack(pitch) ? TEXT : "#333a55";
        ctx.font = hovered ? "bold 9px ui-monospace, monospace" : "9px ui-monospace, monospace";
        ctx.fillText(pitchName(pitch), 6, r * ROW_H + 10);
      }
    }
    ctx.fillStyle = LINE;
    ctx.fillRect(KEYS_W - 1, 0, 1, H);
  }, [pattern.notes, selection, snapV, activeCh.id, beatsPerBar, W, H, totalBeats, hoverPitch]);

  /* ---- velocity lane drawing ---- */
  useEffect(() => {
    const cv = velRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const dpr = Math.max(0.75, Math.min(window.devicePixelRatio || 1, Math.sqrt(16e6 / (W * VEL_H))));
    cv.width = Math.floor(W * dpr); cv.height = Math.floor(VEL_H * dpr);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, VEL_H);
    ctx.fillStyle = "#12152a";
    ctx.fillRect(0, 0, W, VEL_H);
    const snapPx = snapV * beatW;
    for (let x = 0; x <= totalBeats / snapV; x++) {
      const px = KEYS_W + x * snapPx;
      const beat = x * snapV;
      const isBar = Math.abs(beat % beatsPerBar) < 1e-6;
      ctx.fillStyle = isBar ? "#353c5a" : "#1c2038";
      ctx.fillRect(Math.round(px), 0, 1, VEL_H);
    }
    const notes = pattern.notes.filter((n) => n.ch === activeCh.id).sort((a, b) => a.start - b.start);
    for (const n of notes) {
      const x = KEYS_W + n.start * beatW + 1;
      const vel = n.vel ?? DEFAULT_VEL;
      const top = 4 + (1 - vel) * (VEL_H - 10);
      const col = noteColor(n);
      const sel = selection.includes(n.id);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, VEL_H - 2); ctx.lineTo(x, top + 3); ctx.stroke();
      // horizontal segment = note hold length, like FL
      ctx.globalAlpha = 0.75;
      ctx.beginPath(); ctx.moveTo(x, top + 3); ctx.lineTo(x + Math.max(3, n.len * beatW - 2), top + 3); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, top + 3, 3.2, 0, Math.PI * 2); ctx.fill();
      if (sel) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke(); }
    }
    // label strip over keys area
    ctx.fillStyle = PANEL;
    ctx.fillRect(0, 0, KEYS_W, VEL_H);
    ctx.fillStyle = DIM;
    ctx.font = "8px ui-monospace, monospace";
    ctx.fillText("VELOCITY", 5, 12);
    ctx.fillStyle = LINE;
    ctx.fillRect(KEYS_W - 1, 0, 1, VEL_H);
  }, [pattern.notes, selection, snapV, activeCh.id, beatsPerBar, W, totalBeats]);

  /* ---- helpers ---- */
  const evPos = (e, ref) => {
    const rect = (ref || canvasRef).current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const toMusic = ({ x, y }) => ({
    t: (x - KEYS_W) / beatW,
    pitch: MAX_PITCH - Math.floor(y / ROW_H),
  });
  const hitNote = ({ t, pitch }) => {
    const list = pattern.notes;
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (n.ch === activeCh.id && n.pitch === pitch && t >= n.start && t < n.start + n.len) return n;
    }
    return null;
  };
  const snapFloor = (t, free) => Math.max(0, free ? t : Math.floor(t / snapV + 1e-6) * snapV);
  const snapRound = (t, free) => Math.max(0, free ? t : Math.round(t / snapV) * snapV);

  const eraseAt = (pos) => {
    const n = hitNote(toMusic(pos));
    if (n) {
      updateNotes((notes) => notes.filter((x) => x.id !== n.id));
      setSelection((s) => s.filter((id) => id !== n.id));
      if (propNoteId === n.id) setPropNoteId(null);
    }
  };
  const patchNote = (id, patch) => {
    updateNotes((notes) => notes.map((n) => n.id === id ? { ...n, ...patch } : n));
    lastProps.current = { ...lastProps.current, ...patch };
  };

  /* ---- grid pointer handlers ---- */
  const onPointerDown = (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    canvasRef.current.setPointerCapture(e.pointerId);
    lastPointer.current = { x: e.clientX, y: e.clientY, alt: e.altKey };
    startAutoScroll();
    const pos = evPos(e);
    const mus = toMusic(pos);
    if (pos.x < KEYS_W) {
      if (e.button === 0) startPreview(clamp(mus.pitch, MIN_PITCH, MAX_PITCH), DEFAULT_VEL);
      return;
    }
    const free = e.altKey;

    if (e.button === 2) { eraseAt(pos); drag.current = { mode: "erasing" }; return; }

    const hit = hitNote(mus);

    if (tool === "erase") {
      if (hit) eraseAt(pos);
      drag.current = { mode: "erasing" };
      return;
    }

    if (tool === "draw") {
      if (hit) {
        const endPx = KEYS_W + (hit.start + hit.len) * beatW;
        if (pos.x > endPx - 7) {
          drag.current = { mode: "resize", id: hit.id, start: hit.start };
        } else {
          drag.current = { mode: "move", ids: [hit.id], grab: mus.t - hit.start, orig: { [hit.id]: { start: hit.start, pitch: hit.pitch } }, anchorPitch: mus.pitch, anchorStart: hit.start };
        }
        setSelection([hit.id]);
        startPreview(hit.pitch, hit.vel);
      } else {
        const id = uid();
        const start = snapFloor(mus.t, free);
        const note = { id, ch: activeCh.id, pitch: mus.pitch, start, len: lastLen.current, ...lastProps.current };
        updateNotes((notes) => [...notes, note]);
        setSelection([id]);
        justCreated.current = { id, t: Date.now() };
        drag.current = { mode: "move", ids: [id], grab: mus.t - start, orig: { [id]: { start, pitch: mus.pitch } }, anchorPitch: mus.pitch, anchorStart: start };
        startPreview(mus.pitch, lastProps.current.vel);
      }
      return;
    }

    if (tool === "select") {
      if (hit) {
        const ids = selection.includes(hit.id) ? selection : [hit.id];
        if (!selection.includes(hit.id)) setSelection([hit.id]);
        const orig = {};
        for (const n of pattern.notes) if (ids.includes(n.id)) orig[n.id] = { start: n.start, pitch: n.pitch };
        drag.current = { mode: "move", ids, grab: mus.t - hit.start, orig, anchorPitch: mus.pitch, anchorStart: hit.start };
        startPreview(hit.pitch, hit.vel);
      } else {
        drag.current = { mode: "marquee", x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y };
        setSelection([]);
      }
    }
  };

  const applyDragMove = (clientX, clientY, altKey) => {
    const pos = evPos({ clientX, clientY });
    const mus = toMusic(pos);
    if (pos.x >= KEYS_W - 1) {
      const p = clamp(mus.pitch, MIN_PITCH, MAX_PITCH);
      setHoverPitch((prev) => (prev === p ? prev : p));   // no-op re-render unless the row changed
    }
    const d = drag.current;
    if (!d) return;
    const free = altKey;

    if (d.mode === "erasing") { eraseAt(pos); return; }

    if (d.mode === "resize") {
      const end = free ? mus.t : Math.round(mus.t / snapV) * snapV;   // snap the note's END edge to the grid
      const len = Math.max(free ? 0.05 : snapV, end - d.start);
      lastLen.current = len;
      updateNotes((notes) => notes.map((n) => n.id === d.id ? { ...n, len } : n));
      return;
    }

    if (d.mode === "move") {
      const anchorNewStart = snapRound(mus.t - d.grab, free);
      const dStart = anchorNewStart - d.anchorStart;
      const dPitch = mus.pitch - d.anchorPitch;
      updateNotes((notes) => notes.map((n) => {
        if (!d.ids.includes(n.id)) return n;
        const o = d.orig[n.id];
        return {
          ...n,
          start: Math.max(0, o.start + dStart),
          pitch: clamp(o.pitch + dPitch, MIN_PITCH, MAX_PITCH),
        };
      }));
      const anchorOrig2 = d.orig[d.ids[0]];
      const newAnchorPitch = clamp(anchorOrig2.pitch + dPitch, MIN_PITCH, MAX_PITCH);
      if (previewRef.current && previewRef.current.pitch !== newAnchorPitch) {
        const vel = pattern.notes.find((nn) => nn.id === d.ids[0])?.vel;
        stopPreview();
        startPreview(newAnchorPitch, vel);
      }
      return;
    }

    if (d.mode === "marquee") {
      d.x1 = pos.x; d.y1 = pos.y;
      const t0 = (Math.min(d.x0, d.x1) - KEYS_W) / beatW, t1 = (Math.max(d.x0, d.x1) - KEYS_W) / beatW;
      const pHi = MAX_PITCH - Math.floor(Math.min(d.y0, d.y1) / ROW_H);
      const pLo = MAX_PITCH - Math.floor(Math.max(d.y0, d.y1) / ROW_H);
      setSelection(pattern.notes
        .filter((n) => n.ch === activeCh.id && n.pitch >= pLo && n.pitch <= pHi && n.start < t1 && n.start + n.len > t0)
        .map((n) => n.id));
    }
  };

  const applyMoveRef = useRef(applyDragMove);
  applyMoveRef.current = applyDragMove;                 // always the fresh closure — avoids stale notes in the rAF loop
  const lastPointer = useRef(null);
  const rulerDrag = useRef(false);
  const rollScrub = (e) => {
    if (!scrubPattern) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = (e.clientX - rect.left - KEYS_W) / beatW;
    scrubPattern(Math.max(0, e.altKey ? raw : Math.round(raw / snapV) * snapV));
  };
  const scrollRAF = useRef(null);
  const stopAutoScroll = () => {
    if (scrollRAF.current) { cancelAnimationFrame(scrollRAF.current); scrollRAF.current = null; }
  };
  const startAutoScroll = () => {
    if (scrollRAF.current) return;
    const EDGE = 36, MAXV = 14;
    const step = () => {
      if (!drag.current) { scrollRAF.current = null; return; }
      const el = scrollRef.current;
      const lp = lastPointer.current;
      if (el && lp) {
        const r = el.getBoundingClientRect();
        let dx = 0, dy = 0;
        if (lp.x < r.left + EDGE) dx = -Math.min(MAXV, Math.ceil(((r.left + EDGE - lp.x) / EDGE) * MAXV));
        else if (lp.x > r.right - EDGE) dx = Math.min(MAXV, Math.ceil(((lp.x - (r.right - EDGE)) / EDGE) * MAXV));
        if (lp.y < r.top + EDGE) dy = -Math.min(MAXV, Math.ceil(((r.top + EDGE - lp.y) / EDGE) * MAXV));
        else if (lp.y > r.bottom - EDGE) dy = Math.min(MAXV, Math.ceil(((lp.y - (r.bottom - EDGE)) / EDGE) * MAXV));
        if (dx || dy) {
          el.scrollLeft += dx;
          el.scrollTop += dy;
          if (dx > 0) growRef.current(el);              // dragging past the end: add more measures
          if (velScrollRef.current) velScrollRef.current.scrollLeft = el.scrollLeft;
          applyMoveRef.current(lp.x, lp.y, lp.alt);     // content moved under a still pointer — keep the drag following
        }
      }
      scrollRAF.current = requestAnimationFrame(step);
    };
    scrollRAF.current = requestAnimationFrame(step);
  };
  const onPointerMove = (e) => {
    lastPointer.current = { x: e.clientX, y: e.clientY, alt: e.altKey };
    applyDragMove(e.clientX, e.clientY, e.altKey);
  };

  const onPointerUp = () => { drag.current = null; stopAutoScroll(); stopPreview(); setSelection((s) => [...s]); };

  const onDoubleClick = (e) => {
    const pos = evPos(e);
    const hit = hitNote(toMusic(pos));
    if (!hit) return;
    const jc = justCreated.current;
    if (jc && jc.id === hit.id && Date.now() - jc.t < 600) return;   // don't pop on freshly drawn note
    const wr = wrapRef.current.getBoundingClientRect();
    setPropPos({
      x: clamp(e.clientX - wr.left + 8, 4, size.w - 232),
      y: clamp(e.clientY - wr.top + 8, 30, size.h + VEL_H - 200),
    });
    setPropNoteId(hit.id);
  };

  /* ---- velocity lane handlers ---- */
  const notesNearX = (px) => pattern.notes
    .filter((n) => n.ch === activeCh.id && Math.abs(KEYS_W + n.start * beatW + 1 - px) <= 6)
    .map((n) => n.id);
  const velApply = (e) => {
    const pos = evPos(e, velRef);
    if (pos.x < KEYS_W) return;
    const vel = clamp(1 - (pos.y - 4) / (VEL_H - 10), 0.02, 1);
    setVelInfo({ x: pos.x, vel });
    const ids = notesNearX(pos.x);
    if (!ids.length) return;
    lastProps.current.vel = vel;
    updateNotes((notes) => notes.map((n) => ids.includes(n.id) ? { ...n, vel } : n));
  };
  const velReset = (e) => {
    const pos = evPos(e, velRef);
    const ids = notesNearX(pos.x);
    if (!ids.length) return;
    updateNotes((notes) => notes.map((n) => ids.includes(n.id) ? { ...n, vel: DEFAULT_VEL } : n));
    setVelInfo({ x: pos.x, vel: DEFAULT_VEL });
  };

  /* ---- Cmd/Ctrl + scroll = horizontal zoom, anchored at the cursor ---- */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const t = (el.scrollLeft + sx - KEYS_W) / (BEAT_W * zoomRef.current);   // time under cursor
      const nz = clamp(zoomRef.current * (e.deltaY > 0 ? 1 / 1.15 : 1.15), 0.25, 4);
      if (nz === zoomRef.current) return;
      zoomRef.current = nz;
      pendingZoom.current = { t, sx };
      setZoom(nz);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  useEffect(() => {
    const p = pendingZoom.current;
    if (!p || !scrollRef.current) return;
    scrollRef.current.scrollLeft = Math.max(0, KEYS_W + p.t * BEAT_W * zoom - p.sx);   // keep cursor time fixed
    pendingZoom.current = null;
  }, [zoom]);

  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement;
      if (el && ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const chNotes = () => pattern.notes.filter((n) => n.ch === activeCh.id);
      const selNotes = () => pattern.notes.filter((n) => selection.includes(n.id));

      if ((e.key === "Delete" || e.key === "Backspace") && selection.length) {
        updateNotes((notes) => notes.filter((n) => !selection.includes(n.id)));
        setSelection([]);
        setPropNoteId(null);
        return;
      }
      if (mod && k === "a") {                            // select all (active channel)
        e.preventDefault();
        setSelection(chNotes().map((n) => n.id));
        return;
      }
      if (mod && k === "d") {                            // deselect (FL)
        e.preventDefault();
        setSelection([]);
        return;
      }
      if (mod && k === "b") {                            // duplicate selection after itself (FL)
        e.preventDefault();
        const sel = selNotes();
        if (!sel.length) return;
        const minS = Math.min(...sel.map((n) => n.start));
        const maxE = Math.max(...sel.map((n) => n.start + n.len));
        const span = Math.max(snapV, maxE - minS);
        const clones = sel.map((n) => ({ ...n, id: uid(), start: n.start + span }));
        updateNotes((ns) => [...ns, ...clones]);
        setSelection(clones.map((n) => n.id));
        return;
      }
      if (mod && (k === "c" || k === "x")) {             // copy / cut
        e.preventDefault();
        const sel = selNotes();
        if (!sel.length) return;
        noteClipboard = sel.map((n) => ({ ...n }));
        if (k === "x") {
          updateNotes((ns) => ns.filter((n) => !selection.includes(n.id)));
          setSelection([]);
        }
        return;
      }
      if (mod && k === "v") {                            // paste in place, onto the active channel
        e.preventDefault();
        if (!noteClipboard.length) return;
        const clones = noteClipboard.map((n) => ({ ...n, id: uid(), ch: activeCh.id }));
        updateNotes((ns) => [...ns, ...clones]);
        setSelection(clones.map((n) => n.id));
        return;
      }
      if (!mod && !e.shiftKey && (k === "p" || k === "e" || k === "d")) {  // tool switching (FL letters)
        setTool(k === "p" ? "draw" : k === "e" ? "select" : "erase");
        return;
      }
      if ((e.shiftKey || mod) && (e.key === "ArrowUp" || e.key === "ArrowDown") && selection.length) {
        e.preventDefault();                              // Shift = semitone, Cmd/Ctrl = octave
        const d = (e.key === "ArrowUp" ? 1 : -1) * (mod ? 12 : 1);
        updateNotes((ns) => ns.map((n) => selection.includes(n.id)
          ? { ...n, pitch: clamp(n.pitch + d, MIN_PITCH, MAX_PITCH) } : n));
        return;
      }
      if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && selection.length) {
        e.preventDefault();                              // Shift+left/right = nudge by grid
        const d = (e.key === "ArrowRight" ? 1 : -1) * snapV;
        updateNotes((ns) => ns.map((n) => selection.includes(n.id)
          ? { ...n, start: Math.max(0, n.start + d) } : n));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, updateNotes, pattern.notes, activeCh.id, snapV]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = (MAX_PITCH - 72) * ROW_H - 80;
  }, []);

  const propNote = propNoteId ? pattern.notes.find((n) => n.id === propNoteId) : null;

  const tools = [
    { id: "draw", label: "✏ Draw" },
    { id: "select", label: "▭ Select" },
    { id: "erase", label: "⌫ Erase" },
  ];

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "6px 10px", borderBottom: `1px solid ${LINE}`, background: PANEL }}>
        {tools.map((t) => <Btn key={t.id} on={tool === t.id} onClick={() => setTool(t.id)}>{t.label}</Btn>)}
        <span style={{ width: 1, height: 18, background: LINE, margin: "0 4px" }} />
        <span style={{ fontSize: 10, color: DIM }}>Grid</span>
        <Select value={String(snapV)} width={58}
          options={SNAPS.map((s) => ({ value: String(s.v), label: s.label }))}
          onChange={(v) => setSnap(Number(v))} />
        <span style={{ fontSize: 9, color: DIM, marginLeft: 6 }}>
          {ALT_LABEL}=free · {CMD_LABEL}+scroll=zoom · P/E/D=tools · {CMD_LABEL}+A/B/C/X/V · Shift+arrows=nudge
        </span>
      </div>
      <div ref={scrollRef}
        onScroll={(e) => {
          if (velScrollRef.current) velScrollRef.current.scrollLeft = e.target.scrollLeft;
          growIfNearEdge(e.target);
        }}
        style={{ width: size.w, height: size.h, overflow: "auto", background: "#141728" }}>
        {/* ruler — click or drag to set the pattern marker (switches transport to PAT mode) */}
        <div className="dragsurface"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            rulerDrag.current = true;
            rollScrub(e);
          }}
          onPointerMove={(e) => { if (rulerDrag.current) rollScrub(e); }}
          onPointerUp={() => { rulerDrag.current = false; }}
          title="Click or drag to play the pattern from here"
          style={{
            position: "sticky", top: 0, zIndex: 6, width: W, height: 22, cursor: "pointer",
            background: PANEL, borderBottom: `1px solid ${LINE}`,
          }}>
          <div style={{
            position: "sticky", left: 0, zIndex: 2, width: KEYS_W, height: 22, background: PANEL2,
            borderRight: `1px solid ${LINE}`, fontSize: 8, color: ACCENT, fontWeight: 700,
            letterSpacing: 0.6, paddingLeft: 6, paddingTop: 6, pointerEvents: "none",
          }}>PAT ▸</div>
          {Array.from({ length: bars }, (_, i) => (
            <div key={i} style={{
              position: "absolute", left: KEYS_W + i * beatsPerBar * beatW, top: 0,
              width: beatsPerBar * beatW, height: 22, borderLeft: `1px solid ${LINE}`,
              fontSize: 9, color: DIM, paddingLeft: 4, paddingTop: 5,
              fontFamily: "ui-monospace, monospace", pointerEvents: "none", boxSizing: "border-box",
              backgroundImage: `repeating-linear-gradient(to right, ${LINE}55 0 1px, transparent 1px ${beatW}px)`,
              backgroundPosition: "bottom", backgroundSize: "100% 5px", backgroundRepeat: "no-repeat",
            }}>{i + 1}</div>
          ))}
          <div style={{
            position: "absolute", left: KEYS_W + (patStartBeats ?? 0) * beatW - 5, top: 0,
            width: 0, height: 0, borderLeft: "6px solid transparent", borderRight: "6px solid transparent",
            borderTop: `10px solid ${ACCENT}`, pointerEvents: "none", zIndex: 3,
          }} />
          {patLoopBeats != null && (
            <div style={{
              position: "absolute", left: KEYS_W + patLoopBeats * beatW - 1, top: 0, width: 2, height: 22,
              background: DANGER, opacity: 0.7, pointerEvents: "none",
            }} title="pattern loop end" />
          )}
        </div>
        <div style={{ position: "relative", width: W, height: H }}>
          <canvas ref={canvasRef}
            style={{ width: W, height: H, display: "block", cursor: tool === "erase" ? "not-allowed" : "crosshair" }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
            onPointerLeave={() => setHoverPitch(null)}
            onDoubleClick={onDoubleClick}
            onContextMenu={(e) => e.preventDefault()} />
          <RollPlayhead transportRef={transportRef} clips={clips} patternId={pattern.id} beatsPerBar={beatsPerBar} beatW={beatW} height={H} />
        </div>
      </div>
      <div ref={velScrollRef} style={{ width: size.w, height: VEL_H, overflow: "hidden", borderTop: `1px solid ${LINE}` }}>
        <div style={{ position: "relative", width: W, height: VEL_H }}>
          <canvas ref={velRef}
            style={{ width: W, height: VEL_H, display: "block", cursor: "ns-resize" }}
            onPointerDown={(e) => {
              if (e.button === 2) { velReset(e); return; }
              if (e.button !== 0) return;
              velRef.current.setPointerCapture(e.pointerId);
              velDrag.current = true;
              velApply(e);
            }}
            onPointerMove={(e) => { if (velDrag.current) velApply(e); }}
            onPointerUp={() => { velDrag.current = false; setVelInfo(null); }}
            onContextMenu={(e) => e.preventDefault()} />
          <RollPlayhead transportRef={transportRef} clips={clips} patternId={pattern.id} beatsPerBar={beatsPerBar} beatW={beatW} height={VEL_H} />
          {velInfo && (
            <div style={{
              position: "absolute", left: clamp(velInfo.x + 8, KEYS_W, W - 46), top: 3,
              background: "#0a0e18", border: `1px solid ${ACCENT2}`, color: ACCENT2,
              fontFamily: "ui-monospace, monospace", fontSize: 9, padding: "1px 5px",
              borderRadius: 3, pointerEvents: "none",
            }}>{Math.round(velInfo.vel * 100)}%</div>
          )}
        </div>
      </div>
      {/* corner resize grip */}
      <div title="Drag to resize the piano roll"
        onPointerDown={(e) => {
          e.stopPropagation();
          resizeDrag.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = resizeDrag.current;
          if (!d) return;
          setSize({ w: clamp(d.w + e.clientX - d.x, 420, 1400), h: clamp(d.h + e.clientY - d.y, 200, 760) });
        }}
        onPointerUp={() => { resizeDrag.current = null; }}
        style={{
          position: "absolute", right: 0, bottom: 0, width: 18, height: 18, cursor: "nwse-resize",
          zIndex: 6, display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
          color: DIM, fontSize: 11, padding: 2, userSelect: "none",
        }}>⤡</div>

      {/* ---- note properties popup ---- */}
      {propNote && (
        <div style={{
          position: "absolute", left: propPos.x, top: propPos.y, width: 224, zIndex: 30,
          background: PANEL, border: `1px solid ${NOTE_COLORS[propNote.color ?? 0]}`, borderRadius: 8,
          boxShadow: "0 10px 30px rgba(0,0,0,0.6)", padding: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: TEXT }}>
              NOTE — {pitchName(propNote.pitch)}
            </span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setPropNoteId(null)} style={{ background: "none", border: "none", color: DIM, cursor: "pointer", fontSize: 12 }}>✕</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
            <Knob label="VEL" size={32} value={propNote.vel ?? 0.78} min={0} max={1} parse={(s) => numFrom(s) / 100}
              fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patchNote(propNote.id, { vel: v })} />
            <Knob label="PAN" size={32} value={propNote.pan ?? 0} min={-1} max={1} parse={parsePan}
              fmt={(v) => Math.abs(v) < 0.01 ? "C" : v < 0 ? `${Math.round(-v * 100)}L` : `${Math.round(v * 100)}R`}
              onChange={(v) => patchNote(propNote.id, { pan: v })} />
            <Knob label="RELEASE" size={32} value={propNote.release ?? 0.5} min={0} max={1} parse={(s) => numFrom(s) / 100}
              fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patchNote(propNote.id, { release: v })} />
            <Knob label="PITCH" size={32} value={propNote.fine ?? 0} min={-100} max={100}
              fmt={(v) => `${v >= 0 ? "+" : ""}${Math.round(v)}ct`} onChange={(v) => patchNote(propNote.id, { fine: v })} />
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", margin: "8px 0" }}>
            <Btn on={!!propNote.slide} onClick={() => patchNote(propNote.id, { slide: !propNote.slide })} style={{ fontSize: 10, padding: "3px 8px" }}>SLIDE</Btn>
            <Btn on={!!propNote.porta} onClick={() => patchNote(propNote.id, { porta: !propNote.porta })} style={{ fontSize: 10, padding: "3px 8px" }}>PORTA</Btn>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" }}>
            {NOTE_COLORS.map((c, i) => (
              <span key={c} onClick={() => patchNote(propNote.id, { color: i })} style={{
                width: 14, height: 14, borderRadius: 3, background: c, cursor: "pointer",
                border: (propNote.color ?? 0) === i ? "2px solid #fff" : "2px solid transparent", boxSizing: "border-box",
              }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= piano roll playhead ================= */
function RollPlayhead({ transportRef, clips, patternId, beatsPerBar, beatW, height }) {
  const [x, setX] = useState(null);
  useEffect(() => {
    let raf;
    const tick = () => {
      const t = transportRef.current;
      const base = t.mode === "pattern" ? (t.patStart ?? 0) : (t.startBeats ?? 0);
      const songBeats = t.getBeats
        ? t.getBeats()
        : t.playing
          ? base + ((performance.now() - t.t0) * t.bpm) / 60000
          : base;                                      // stopped → show the marker position
      if (t.mode === "pattern") {                     // PAT mode: straight pattern time, looped
        const loop = Math.max(1e-6, t.patLoopBeats || beatsPerBar);
        const pb = t.playing ? songBeats % loop : (t.patStart ?? 0);
        setX(KEYS_W + pb * beatW);
        raf = requestAnimationFrame(tick);
        return;
      }
      const songBars = songBeats / beatsPerBar;
      let px = null;
      for (const c of clips) {                         // find a clip of this pattern under the playhead
        if (c.patternId !== patternId) continue;
        const len = c.lenBars ?? 1;
        if (songBars >= c.startBar && songBars < c.startBar + len) {
          const patBars = songBars - c.startBar + (c.offsetBars ?? 0);   // clip trim offset shifts roll time
          px = KEYS_W + patBars * beatsPerBar * beatW;
          break;
        }
      }
      setX(px);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [transportRef, clips, patternId, beatsPerBar, beatW]);
  if (x == null) return null;
  return <div style={{
    position: "absolute", left: x, top: 0, height, width: 1,
    background: ACCENT2, boxShadow: `0 0 6px ${ACCENT2}`, pointerEvents: "none", zIndex: 3,
  }} />;
}


export default PianoRoll;
