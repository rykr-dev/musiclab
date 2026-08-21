import { useState, useRef } from "react";
import { PANEL, PANEL2, RAISED, LINE, TEXT, DIM, ACCENT, DANGER, clamp } from "../constants";

/* ================= small ui bits ================= */
/* Typed-value parsing: strips units, understands "k" (1.5k = 1500) */
function numFrom(s) {
  s = String(s).trim().toLowerCase().replace(",", ".");
  const k = /k(hz)?\s*$/.test(s);
  const num = parseFloat(s.replace(/[^0-9+\-.]/g, ""));
  if (Number.isNaN(num)) return NaN;
  return k ? num * 1000 : num;
}
/* Pan entry: "C", "30L", "30R", "-30", "0.3" all work */
function parsePan(s) {
  const t = String(s).trim().toLowerCase();
  if (t === "c" || t === "center") return 0;
  const n = numFrom(t);
  if (Number.isNaN(n)) return NaN;
  const v = Math.abs(n) > 1 ? n / 100 : n;
  return /l/.test(t) ? -Math.abs(v) : /r/.test(t) ? Math.abs(v) : v;
}

function Knob({ label, value, min, max, onChange, fmt, size = 38, log = false, parse }) {
  const drag = useRef(null);
  const [editing, setEditing] = useState(false);
  const toNorm = (v) => log
    ? (Math.log(v / min) / Math.log(max / min))
    : (v - min) / (max - min);
  const fromNorm = (n) => log
    ? min * Math.pow(max / min, clamp(n, 0, 1))
    : min + (max - min) * clamp(n, 0, 1);

  const onDown = (e) => {
    e.preventDefault();
    drag.current = { y: e.clientY, n: toNorm(value) };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    if (!drag.current) return;
    const dn = (drag.current.y - e.clientY) / 140;
    onChange(fromNorm(drag.current.n + dn));
  };
  const onUp = () => { drag.current = null; };

  const commit = (text) => {
    const v = (parse || numFrom)(text);
    if (!Number.isNaN(v)) onChange(clamp(v, min, max));
    setEditing(false);
  };

  const n = toNorm(value);
  const a0 = -230, a1 = 50;
  const ang = a0 + (a1 - a0) * n;
  const r = size / 2 - 4;
  const cx = size / 2, cy = size / 2;
  const arc = (from, to, color, w) => {
    const large = to - from > 180 ? 1 : 0;
    const p = (a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
    const [x0, y0] = p(from), [x1, y1] = p(to);
    return <path d={`M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`} stroke={color} strokeWidth={w} fill="none" strokeLinecap="round" />;
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, width: size + 14 }}>
      <svg width={size} height={size} style={{ cursor: "ns-resize", touchAction: "none" }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
        onDoubleClick={() => setEditing(true)}>
        <circle cx={cx} cy={cy} r={r - 3} fill={RAISED} stroke={LINE} />
        {arc(a0, a1, LINE, 3)}
        {n > 0.005 && arc(a0, ang, ACCENT, 3)}
        <line x1={cx} y1={cy} x2={cx + (r - 7) * Math.cos((ang * Math.PI) / 180)} y2={cy + (r - 7) * Math.sin((ang * Math.PI) / 180)}
          stroke={TEXT} strokeWidth={2} strokeLinecap="round" />
      </svg>
      <div style={{ fontSize: 9, color: DIM, letterSpacing: 0.4 }}>{label}</div>
      {editing ? (
        <input autoFocus defaultValue={fmt(value)}
          onFocus={(e) => e.target.select()}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.target.blur();
            if (e.key === "Escape") setEditing(false);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            width: size + 20, background: PANEL2, border: `1px solid ${ACCENT}`, borderRadius: 3,
            color: TEXT, fontSize: 9, fontFamily: "ui-monospace, monospace", textAlign: "center", padding: "1px 2px",
          }} />
      ) : (
        <div title="Click to type a value" onClick={() => setEditing(true)}
          style={{ fontSize: 9, color: TEXT, fontFamily: "ui-monospace, monospace", cursor: "text" }}>{fmt(value)}</div>
      )}
    </div>
  );
}
function Btn({ children, on, onClick, title, danger, style }) {
  return (
    <button title={title} onClick={onClick} style={{
      background: on ? ACCENT : PANEL2, color: on ? "#1a1200" : danger ? DANGER : TEXT,
      border: `1px solid ${on ? ACCENT : LINE}`, borderRadius: 4, padding: "4px 10px",
      fontSize: 11, cursor: "pointer", fontWeight: on ? 700 : 500, letterSpacing: 0.3, ...style,
    }}>{children}</button>
  );
}

function Select({ value, options, onChange, width }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{
      background: PANEL2, color: TEXT, border: `1px solid ${LINE}`, borderRadius: 4,
      padding: "3px 6px", fontSize: 11, width, cursor: "pointer",
    }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function RenameInput({ initial, onDone, width = 110 }) {
  return (
    <input autoFocus defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => onDone(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") onDone(initial); }}
      style={{ background: PANEL2, border: `1px solid ${LINE}`, color: TEXT, fontSize: 11, borderRadius: 3, padding: "2px 4px", width }} />
  );
}

/* ================= floating window ================= */
function FloatWin({ title, color, x0, y0, w, z, onFocus, onClose, children, headerExtras, maximized, onHeaderDoubleClick }) {
  const [pos, setPos] = useState({ x: x0, y: y0 });
  const drag = useRef(null);
  return (
    <div onPointerDown={onFocus} style={{
      position: "absolute", zIndex: z,
      ...(maximized
        ? { left: 8, top: 8, right: 8, bottom: 8, width: "auto" }
        : { left: pos.x, top: pos.y, width: w }),
      background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8,
      boxShadow: "0 12px 40px rgba(0,0,0,0.55)", overflow: "hidden",
    }}>
      <div
        onDoubleClick={onHeaderDoubleClick}
        onPointerDown={(e) => {
          e.preventDefault();
          if (maximized) return;                    // fullscreen windows don't drag
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setPos({ x: Math.max(0, e.clientX - drag.current.dx), y: Math.max(0, e.clientY - drag.current.dy) });
        }}
        onPointerUp={() => { drag.current = null; }}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "grab",
          background: PANEL2, borderBottom: `1px solid ${LINE}`, userSelect: "none", touchAction: "none",
        }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: color || ACCENT }} />
        <span title={onHeaderDoubleClick ? "Double-click to toggle fullscreen" : undefined}
          style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: TEXT, flex: "0 0 auto" }}>{title}</span>
        <div style={{ flex: 1, display: "flex", gap: 6, alignItems: "center" }} onPointerDown={(e) => e.stopPropagation()}>
          {headerExtras}
        </div>
        <button onClick={onClose} onPointerDown={(e) => e.stopPropagation()} style={{
          background: "none", border: "none", color: DIM, cursor: "pointer", fontSize: 13, padding: 2,
        }}>✕</button>
      </div>
      {children}
    </div>
  );
}


export { Knob, Btn, Select, RenameInput, FloatWin, numFrom, parsePan };
