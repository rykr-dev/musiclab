/* ================= design tokens ================= */
const BG = "#111320";
const PANEL = "#1a1d2b";
const PANEL2 = "#232738";
const RAISED = "#2b3045";
const LINE = "#2e3349";
const TEXT = "#ccd2e8";
const DIM = "#7d84a6";
const ACCENT = "#f7a838";   // amber — active states
const ACCENT2 = "#6ee7ff";  // cyan — LCD / playhead
const DANGER = "#ff6e8a";

const PATTERN_COLORS = ["#f7a838", "#6ee7ff", "#b48bff", "#7dff9e", "#ff7d9e", "#ffd76e", "#6effd9", "#9eb1ff"];

/* FL-style note color presets (pattern paint colors) */
const NOTE_COLORS = [
  "#f7a838", "#6ee7ff", "#7dff9e", "#ff7d9e",
  "#b48bff", "#ffd76e", "#6effd9", "#ff9c6e",
  "#9eb1ff", "#ff6ee7", "#a8f76e", "#e8edf7",
];

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
  PATTERN_COLORS, NOTE_COLORS,
  MIN_PITCH, MAX_PITCH, ROWS, ROW_H, KEYS_W, BEAT_W, PR_BARS, VEL_H,
  PL_BAR_W, SONG_BARS, N_TRACKS, NOTE_NAMES, isBlack, pitchName,
  IS_MAC, ALT_LABEL, CMD_LABEL, DEFAULT_VEL, SNAPS, uid, clamp, defaultReverb,
};
