# MUSIC LAB ✦

A pattern-based web DAW.

A web-based DAW inspired by FL Studio. React + Vite frontend; Node/Express backend
and Web Audio engine coming in later milestones.

## Run it

```
npm install
npm run dev
```

## Current features (skeleton milestone)

- Patterns + floating, resizable piano roll (Draw / Select / Erase, right-click erase,
  Alt/Option free placement, Cmd/Ctrl+scroll zoom anchored at cursor)
- Velocity lane with FL-style length stems, drag-paint, live readout, right-click reset
- Note properties popup (velocity, pan, release, fine pitch, slide/porta, 12 note colors)
- Playlist with beat-grid snapping, clip trimming (offset + length windows into patterns),
  mini note previews, scrub-to-seek ruler with start marker, Space to play
- Channel rack (rename/delete with confirmation, vol/pan, FX insert routing)
- Mixer (Master + 6 inserts, reverb plugin UI with 8 parameters)
- BPM / title / time signature / grid snap

## Audio engine (current milestone)

- `src/engine/engine.js` — one SpessaSynth WorkletSynthesizer; per-MIDI-channel outputs
  tapped via `connectChannel()` into per-channel vol/pan nodes, routed to mixer inserts,
  reverb chains, then Master. DAW channels map to MIDI channels 0-15 (skipping 9, the GM
  drum channel) = 15 sounding channels for now.
- `src/engine/scheduler.js` — 25 ms lookahead loop scheduling notes sample-accurately via
  SpessaSynth `eventOptions.time`. Reads live state each tick, so editing during playback
  is heard within ~180 ms. Handles seek, stop, and BPM re-anchoring.
- `src/engine/reverb.js` — procedural impulse-response convolver; Room Size/Decay/Diffusion
  regenerate the IR, the other five params are live node values.
- `public/spessasynth_processor.min.js` — the synth's AudioWorklet, copied from
  node_modules by `scripts/copy-worklet.mjs` (postinstall). Re-copy when updating the lib.

Load any .sf2/.sf3/.dls via the "Load SF" button in the channel rack, pick per-channel
instruments, press play. Not yet audible (stored in data, engine work pending): per-note
pan/release/fine-pitch, slide/porta.

## Soundfonts

The channel rack's picker offers built-in fonts plus "Load from file…" for any
local .sf2/.sf3/.dls.

Built-ins are defined in `src/soundfonts.js`. They're fetched over HTTP with a
progress bar and then cached in IndexedDB, so each browser downloads a font once
and every later load is instant and offline-capable.

Large fonts cannot be committed or served from Pages (GitHub blocks files >100 MB;
Pages caps assets at 25 MiB), so host them separately:

1. Cloudflare dashboard → R2 → create a bucket → upload the .sf2
2. Give the bucket a public custom domain (e.g. `sf.rsage.dev`)
3. In R2 → Settings → CORS, allow GET from your site origin
4. Set `VITE_SF_SGM_URL` in the Pages project's environment variables

For local dev, drop the file in `public/soundfonts/` instead — no env var needed.

## Keyboard

- `Space` play / stop
- `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` or `Ctrl+Y` redo
- Piano roll: `Alt/Option` free placement, `Ctrl/Cmd+scroll` zoom

## Roadmap

1. Backend: Express + SQLite, publish links (nanoid), accounts, curated soundfont hosting
2. Pattern/Song mode toggle, per-note pan/fine-pitch via key tuning, more plugins, automation

## Layout

- `src/constants.js` — design tokens, music constants, shared helpers
- `src/components/ui.jsx` — Knob, Btn, Select, RenameInput, FloatWin
- `src/components/PianoRoll.jsx` — roll canvas, velocity lane, note properties, roll playhead
- `src/App.jsx` — transport, playlist, channel rack, mixer, windows, state
