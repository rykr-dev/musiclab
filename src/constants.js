/* ================= design tokens =================
   Palette built in OKLCH and shipped as hex — the roll and playlist paint through
   canvas fillStyle, which can't be trusted to parse oklch() on older Chromebooks.

   Neutrals sit at hue 75 with almost no chroma: warm graphite, the colour of
   painted rack steel, not the blue-grey every dark UI defaults to. The chrome is
   near-achromatic on purpose so that hue only ever means something — orange is
   "this is active", cyan is "this is the machine reporting back".

   ACCENT keeps FL's orange (the incumbent identity). ACCENT2 is a vacuum-
   fluorescent cyan rather than a mint: hardware sequencers paired amber LEDs with
   VFD readouts, and it separates the transport display from every note colour. */
const BG = "#11100e";
const PANEL = "#1d1b18";
const PANEL2 = "#292724";
const RAISED = "#393632";
const LINE = "#403d39";
const TEXT = "#e2e0dc";
const DIM = "#a6a39d";      // 4.78:1 on RAISED, the tightest pairing it has to survive
const ACCENT = "#ff9430";   // FL orange — active states
const ACCENT2 = "#92f1f6";  // VFD cyan — readouts / playheads
const DANGER = "#f64e4d";
const ON_ACCENT = "#1e1006"; // text on an orange fill — 8.4:1

/* Pattern + note colours share one ramp: uniform OKLCH lightness (0.785) so no
   colour shouts louder than another on the roll, hues spaced around the wheel but
   skipping 190–215° — that window belongs to the playhead, and a note wearing it
   would swallow the line. Index 0 is the accent, so untouched notes read as brand.
   Index 11 is a warm off-white for anyone who wants no colour at all. */
const PATTERN_COLORS = ["#ff9e4d", "#b1c549", "#13d7ae", "#36c9ff", "#a8b2ff", "#ee94e6", "#e1b22a", "#cca2ff"];

const NOTE_COLORS = [
  "#ff9e4d", "#e1b22a", "#b1c549", "#6ed380",
  "#13d7ae", "#36c9ff", "#83bdff", "#a8b2ff",
  "#cca2ff", "#ee94e6", "#ff91bc", "#d4d0c8",
];

/* piano-roll / playlist surface colors (canvas-drawn, so they live here) */
const ROLL = {
  bg: "#0f0e0c",
  rowBlack: "#161513", rowWhite: "#1e1c1a",
  octaveLine: "#4c4844",
  barLine: "#5c5954", beatLine: "#33312e", subLine: "#23211f",
  hoverRow: "rgba(255,148,48,0.07)",
  ghost: "rgba(214,206,193,0.22)",
  keyWhite: "#e4dfd5", keyBlack: "#201e1b", keyTextWhite: "#4b4742",
  velBg: "#0b0a08", velBar: "#504c48", velBeat: "#1c1a18",
  trackA: "#191715", trackB: "#1e1c1a",
  lcdBg: "#060e0f",
};

/* ================= typography =================
   Two faces, self-hosted, both from Omnibus-Type so they share a skeleton.

   Archivo carries the chrome. It ships a real 62–125 width axis, so panel labels
   get genuinely condensed letterforms — the way hardware silkscreen is drawn —
   instead of a default sans stretched apart with letter-spacing.

   Chivo Mono carries every number. Monospace here is not costume: knob values,
   the transport readout and the mixer levels all change in place, and figures
   that shift width make a value look like it's twitching when it isn't.

   Sizes stay at the call sites. This ramp only sets family, weight, width, case
   and tracking, so the rack keeps the density it was built at. */
const FONT_UI = `Archivo, "Helvetica Neue", Arial, sans-serif`;
const FONT_MONO = `"Chivo Mono", ui-monospace, "SF Mono", Menlo, monospace`;

const TYPE = {
  /* the wordmark, and nothing else */
  wordmark: {
    fontFamily: FONT_UI, fontWeight: 800, fontVariationSettings: '"wdth" 76',
    letterSpacing: "0.05em", textTransform: "uppercase",
  },
  /* panel headers: PATTERNS, CHANNEL RACK, 3x OSC */
  label: {
    fontFamily: FONT_UI, fontWeight: 700, fontVariationSettings: '"wdth" 84',
    letterSpacing: "0.14em", textTransform: "uppercase",
  },
  /* the 8px silkscreen tier: FX, AMP ENV, OSC rows */
  micro: {
    fontFamily: FONT_UI, fontWeight: 700, fontVariationSettings: '"wdth" 86',
    letterSpacing: "0.11em", textTransform: "uppercase",
  },
  /* buttons, selects, names — anything the user reads as words */
  ui: { fontFamily: FONT_UI, fontWeight: 500, letterSpacing: "0.005em" },
  uiStrong: { fontFamily: FONT_UI, fontWeight: 700, letterSpacing: "0.01em" },
  /* every number outside the transport display */
  data: {
    fontFamily: FONT_MONO, fontWeight: 500, letterSpacing: "-0.005em",
    fontVariantNumeric: "tabular-nums",
  },
  /* the transport readout, behind glass */
  lcd: {
    fontFamily: FONT_MONO, fontWeight: 600, letterSpacing: "0.07em",
    fontVariantNumeric: "tabular-nums",
  },
};

/* A VFD doesn't halo evenly — it has a hot core and a fast falloff. Three stops
   instead of one flat blur is the whole difference between "lit" and "glowing". */
const LCD_GLOW = `0 0 1px ${ACCENT2}e6, 0 0 7px ${ACCENT2}70, 0 0 20px ${ACCENT2}2b`;

/* Canvas needs font shorthand strings, not style objects. */
const CANVAS_MONO = (px, weight = 500) => `${weight} ${px}px ${FONT_MONO}`;

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
  BG, PANEL, PANEL2, RAISED, LINE, TEXT, DIM, ACCENT, ACCENT2, DANGER, ON_ACCENT,
  PATTERN_COLORS, NOTE_COLORS, ROLL,
  FONT_UI, FONT_MONO, TYPE, LCD_GLOW, CANVAS_MONO,
  MIN_PITCH, MAX_PITCH, ROWS, ROW_H, KEYS_W, BEAT_W, PR_BARS, VEL_H,
  PL_BAR_W, SONG_BARS, N_TRACKS, NOTE_NAMES, isBlack, pitchName,
  IS_MAC, ALT_LABEL, CMD_LABEL, DEFAULT_VEL, SNAPS, uid, clamp, defaultReverb,
};
