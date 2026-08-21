/* ================= design tokens =================
   Neutral graphite chrome (no blue cast) + FL-style warm orange accent,
   mint green for the LCD / playheads. */
const BG = "#131418";
const PANEL = "#1b1d22";
const PANEL2 = "#25282e";
const RAISED = "#30343b";
const LINE = "#34383f";
const TEXT = "#d9dbe0";
const DIM = "#8a8f99";
const ACCENT = "#ff9838";   // FL orange — active states
const ACCENT2 = "#5ee6a8";  // mint — LCD / playhead
const DANGER = "#ff6473";

const PATTERN_COLORS = ["#ff9838", "#5ee6a8", "#66c7ff", "#c792ff", "#ff7d9e", "#ffd76e", "#6effd9", "#9eb1ff"];

/* FL-style note color presets (pattern paint colors) */
const NOTE_COLORS = [
  "#ff9838", "#5ee6a8", "#66c7ff", "#ff7d9e",
  "#c792ff", "#ffd76e", "#6effd9", "#ff8f6e",
  "#9eb1ff", "#ff6ee7", "#a8f76e", "#e8edf7",
];

/* piano-roll / playlist surface colors (canvas-drawn, so they live here) */
const ROLL = {
  bg: "#141519",
  rowBlack: "#17181d", rowWhite: "#1d2025",
  octaveLine: "#3a3e46",
  barLine: "#4b505a", beatLine: "#2e323a", subLine: "#22252c",
  hoverRow: "rgba(255,152,56,0.07)",
  ghost: "rgba(150,156,168,0.22)",
  keyWhite: "#e6e4dd", keyBlack: "#26282e", keyTextWhite: "#3a3d46",
  velBg: "#101114", velBar: "#323841", velBeat: "#1e2127",
  trackA: "#191b1f", trackB: "#1c1e23",
  lcdBg: "#0e0f12",
};

/* ================= music constants ================= */
const MIN_PITCH = 24, MAX_PITCH = 96;             // C1 .. C7
const ROWS = MAX_PITCH - MIN_PITCH + 1;
const ROW_H = 14;
const KEYS_W = 56;
const BEAT_W = 96;                                 // px per beat in piano roll
const PR_BARS = 8;                                 // bars visible in roll
const VEL_H = 68;                                  // velocity lane height
const PL_BAR_W = 72;                               // px per bar in playlist
const SONG_BARS = 32;
const N_TRACKS = 8;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const isBlack = (p) => [1, 3, 6, 8, 10].includes(p % 12);
const pitchName = (p) => NOTE_NAMES[p % 12] + (Math.floor(p / 12) - 1);
const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || "");
const ALT_LABEL = IS_MAC ? "⌥ Option" : "Alt";
const CMD_LABEL = IS_MAC ? "⌘ Cmd" : "Ctrl";
const DEFAULT_VEL = 0.78;

const SNAPS = [
  { label: "1/1", v: 1 },
  { label: "1/2", v: 1 / 2 },
  { label: "1/3", v: 1 / 3 },
  { label: "1/4", v: 1 / 4 },
  { label: "1/6", v: 1 / 6 },
  { label: "1/8", v: 1 / 8 },
];

let _id = 10;
const uid = () => ++_id;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const defaultReverb = () => ({
  lowcut: 100, highcut: 12000, predelay: 20, roomsize: 50,
  diffusion: 70, decay: 2.5, dry: 100, wet: 30,
});


export const APP_NAME = "MUSIC LAB";
export function bumpUid(n) { if (n > _id) _id = n; }

export {
  BG, PANEL, PANEL2, RAISED, LINE, TEXT, DIM, ACCENT, ACCENT2, DANGER,
  PATTERN_COLORS, NOTE_COLORS, ROLL,
  MIN_PITCH, MAX_PITCH, ROWS, ROW_H, KEYS_W, BEAT_W, PR_BARS, VEL_H,
  PL_BAR_W, SONG_BARS, N_TRACKS, NOTE_NAMES, isBlack, pitchName,
  IS_MAC, ALT_LABEL, CMD_LABEL, DEFAULT_VEL, SNAPS, uid, clamp, defaultReverb,
};
