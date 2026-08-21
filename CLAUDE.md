# MUSIC LAB — project context

A browser-based DAW inspired by FL Studio, built to surpass Online Sequencer.
React + Vite frontend, Web Audio engine, no backend — deployed as a Cloudflare
Worker (static assets) with auto-deploy on git push. Built iteratively with
Claude; this file is the full context handoff.

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — production build to `dist/`
- Deploy: `git push` (Workers Builds runs `npm run build` then `npx wrangler deploy`)
- `postinstall` copies `spessasynth_processor.min.js` from node_modules → `public/`

## Deployment

- `wrangler.jsonc`: static-assets-only Worker serving `./dist`, SPA fallback.
  **The `name` field must match the Worker's dashboard name** or deploys create a
  second Worker while the custom domain points at the old one.
- Env var `VITE_SF_SGM_URL` points the built-in SGM soundfont at its host
  (Cloudflare R2 recommended; the 229 MB .sf2 cannot live in git — GitHub blocks
  >100 MB — or be served by Pages/Workers assets, 25 MiB per-file cap).
  Local dev: drop the .sf2 in `public/soundfonts/` (gitignored).

## File map

- `src/constants.js` — design tokens + type roles. Palette is authored in OKLCH and
  **shipped as hex** (canvas `fillStyle` can't be trusted to parse `oklch()` on older
  Chromebooks): warm-neutral graphite chrome at hue 75, FL-orange `ACCENT`, VFD-cyan
  `ACCENT2` for readouts/playheads, `ON_ACCENT` for text on an orange fill. `ROLL`
  holds the canvas-drawn roll/playlist surface colors. `NOTE_COLORS` sit at uniform
  OKLCH lightness (0.785) so no note shouts, and skip hue 190–215° so none collides
  with the playhead. `TYPE` holds the type roles (`wordmark`/`label`/`micro`/`ui`/
  `uiStrong`/`data`/`lcd`) — they set family, weight, width axis, case and tracking
  only; **font sizes stay at the call sites** so the rack keeps its density.
  `LCD_GLOW` is the three-stop VFD bloom; `CANVAS_MONO(px, weight)` builds canvas
  font shorthand. Plus music constants, `SNAPS`, `uid`/`bumpUid`, `clamp`,
  `defaultReverb`, `APP_NAME`, platform labels (`ALT_LABEL`, `CMD_LABEL`)
- `public/fonts/` — self-hosted variable woff2 (Archivo, 62–125 width axis, for all
  chrome; Chivo Mono for every number). Self-hosted, not CDN: no backend, and it has
  to work on a locked-down school network. `index.html` preloads the two latin files;
  latin-ext is fetched only when a song title needs it. Canvas text does NOT reflow
  when a webfont lands — `useFontsReady()` in PianoRoll forces one repaint on
  `document.fonts.ready`, or pitch names stay in the fallback face all session.
- `src/components/ui.jsx` — `Knob` (drag + click-value-to-type, unit-aware `parse`),
  `Btn`, `Select`, `RenameInput`, `FloatWin` (draggable window; `maximized` +
  `onHeaderDoubleClick` for fullscreen)
- `src/components/PianoRoll.jsx` — canvas roll: Draw/Select/Erase, right-click
  erase, marquee, note move/resize with absolute-position snapping, velocity lane
  (FL-style length stems, drag-paint, right-click reset to 78%), note-properties
  popup (vel/pan/release/fine-pitch/slide/porta/12 colors; new notes inherit last
  props), pitch names on notes, hover key highlight, Cmd/Ctrl+scroll zoom anchored
  at cursor, edge auto-scroll during drags (rAF loop re-applies the drag as content
  moves).
  **Virtualized canvas**: a spacer div carries the scroll extent (grown 4 bars at a
  time near the right edge, guarded by `growPending` so one gesture adds one chunk)
  while the canvas is only viewport-sized, `position: sticky; left: 0`, and repainted
  at `scrollX`. Keeps the backing store constant, keeps the piano keys pinned, and
  avoids the browser's 32767 px canvas dimension cap (~85 bars at 1x) that a
  full-width canvas hits. Pointer coords are viewport-relative, so `toMusic` adds
  `scrollXRef.current`; the marquee stores CONTENT-space x for the same reason.
  Ruler is mode-aware (`PAT ▸` / `SONG ▸`, `markerBeats` + `scrubRuler` props); roll
  playhead maps song time through clip trim windows in SONG mode / loops in PAT.
- `src/App.jsx` — transport, playlist (beat-grid that also draws the selected Grid
  subdivision, clips that fill their measures and auto-follow the pattern's length
  until trimmed, clip trimming via edge drags with offset+length windows, mini note
  previews drawn in true musical pixels, scrub ruler + start marker), channel rack
  (rename/delete-with-confirm, vol/pan, FX insert routing, per-channel instrument
  picker = 3xOsc / SGM / upload, ⚙ settings window: pitch in cents via RPN + ADSR
  via MIDI CCs 73/75/72, ADSR hidden for 3xOsc since those CCs only reach soundfont
  channels; sustain is data-only for soundfonts), mixer
  (Master + 6 inserts, slots, reverb), undo/redo (400 ms-coalesced JSON snapshots,
  depth 150, Ctrl/Cmd+Z / Shift+Z / Y), Save/Share window, soundfont picker with
  download progress, PAT/SONG toggle, universal Grid selector in topbar
- `src/engine/engine.js` — AudioContext + graph. **SpessaSynth loads lazily**
  (`ensureSynth()`), only when a soundfont loads; 3xOsc needs no worklet.
  **The engine is only ever constructed inside a user gesture** — App installs a
  one-shot `pointerdown`/`keydown` unlock listener. Building it from an effect (e.g.
  because a channel defaults to 3xOsc) creates a suspended AudioContext at page load
  and trips the browser's "needs a user gesture" policy. Per-DAW-
  channel: synth `connectChannel` output (or ThreeOsc) → gain(vol) → pan → routed
  insert → chain → insertVol → Master chain → destination. Unified voice API
  `voiceOn/voiceOff/panic` branches soundfont vs built-in. DAW channels map to
  MIDI channels 0–15 skipping 9 (drums): 15 soundfont channels max; 3xOsc channels
  don't consume slots.
- `src/engine/scheduler.js` — 25 ms lookahead loop, events stamped sample-accurate
  via SpessaSynth `eventOptions.time`. **Horizon is hard-capped at now+180 ms**
  (it previously compounded past the prior horizon and queued the whole song,
  making stop impossible). Stop/seek force-kill then sweep at intervals across the
  horizon, generation-guarded so a quick re-play isn't clipped. `tickPattern` loops
  the open pattern in PAT mode. Epsilon on play/seek boundaries so notes exactly
  at the marker fire.
- `src/engine/threeosc.js` — 3xOsc: three oscillators (sine/tri/square/saw/noise,
  coarse ±24 st, fine ±100 ct, level, pan, **phase offset** via phase-rotated
  `PeriodicWave` (cached per shape+phase), **stereo detune** up to ±50 ct spread as
  two hard-panned voices, **polarity invert**) + **Osc 3 AM** (osc 2 modulates osc
  3's amplitude) + real amp ADSR (sustain audible, unlike soundfont path).
  `setPitchOffset()` applies the channel's PITCH knob. Per-note voices;
  `allOff(force)` for panic.
- `src/engine/reverb.js` — procedural-IR convolver; RoomSize/Decay/Diffusion
  regenerate the IR, Lowcut/Highcut/Predelay/Dry/Wet are live nodes.
- `src/store.js` — localStorage saves (key `musiclab:saves`, migration chain from
  old names) + share links: song JSON → deflate (CompressionStream) → base64url →
  URL fragment `#s=…`. Links are immutable snapshots (the song IS the link).
- `src/soundfonts.js` — built-in soundfont catalog; fetch with progress, cached in
  IndexedDB (one download per browser, offline after). `looksLikeSoundfont()` checks
  the RIFF magic before trusting or caching a payload — the SPA fallback answers a
  missing .sf2 with index.html and HTTP 200, which used to "download" fine and then
  fail deep inside the parser; a previously cached bad payload is purged on read.

## Song document (serialization = undo = saves = share links)

`{ v, title, bpm, timeSig:{num,den}, snap, patterns, channels, inserts, clips }`
- note: `{ id, ch, pitch, start, len, vel, pan, release, fine, slide, porta, color }`
  — start/len in **beats**, pattern-relative
- channel: `{ id, name, vol, pan, insert, instrument, pitch, attack, decay,
  sustain, release }`; instrument is `{bank, program, name}` (soundfont) or
  `{type:"3xosc", oscs:[…], attack, decay, sustain, release}` (spread from
  `defaultThreeOsc()`)
- clip: `{ id, patternId, track, startBar, offsetBars, lenBars }` — a trim window
  into the pattern; scheduler plays only notes STARTING inside the window, cuts
  tails at the boundary. **`lenBars: null` = auto**: the clip spans the pattern's
  content rounded up to whole measures and grows with it, until an edge drag pins
  an explicit length (`patternLenBars()` in scheduler.js is the shared rule)
- after loading any document call `bumpUid(maxId)` to avoid id collisions

## Transport & modes

- `transportRef.current` mirrors live state each render: `{ playing, t0, bpm,
  startBeats, mode, patStart, patLoopBeats, from, getBeats? }`
- SONG mode: playlist ruler scrub sets `startBeats`. PAT mode: roll ruler scrub sets
  `patStart`. Play reads whichever mode owns the marker; stop returns to marker,
  stop-while-stopped rewinds to 0. Opening a roll (`focusPattern`) does NOT change
  mode — the PAT/SONG toggle alone decides what plays, as in FL.
- **The roll ruler is one marker in two coordinate systems.** In SONG mode, clicking
  it converts the pattern position to song time through the clips that play this
  pattern (`rollToSong`, nearest clip edge when the spot is outside every window,
  toast when the pattern isn't placed at all) and moves the SONG marker, so playback
  starts there with every other pattern stacked at that point. `songToRoll` is the
  inverse, used to draw the roll marker while the song owns it. In PAT mode the same
  ruler moves the pattern's own loop marker.
- Playheads read `t.getBeats()` (engine/audio clock, installed on play) or a
  mode-aware `performance.now()` fallback. **Keybind handlers must call through
  refs** (`togglePlayRef`) — an empty-deps listener once froze mode/marker at
  first-render values (the "always plays from the beginning" bug).
- Space play/stop; ignored while typing.

## Conventions & gotchas

- All drag surfaces need `touch-action: none` (class `dragsurface` or canvas rule
  in `index.css`) + `preventDefault` on pointerdown, or browsers pan the page.
- Snapping is always applied to the **resulting absolute position/edge**, never to
  the drag delta, so off-grid items pull onto the grid when moved.
- Playlist placement/moves snap to whole bars ("patterns fill the measure");
  trim edges follow the universal Grid; Alt/Option = free everywhere.
- Knobs: `parse` prop for typed entry when display scale ≠ stored value
  (`numFrom(s)/100` for %, `parsePan`, cents→semitones for channel pitch).
- Copyright: `noteClipboard` in PianoRoll survives roll close (Cmd+C/X/V, A, B
  duplicate, Shift+arrows nudge — hotkeys P/E/D switch tools).
- Undo history suppresses capture while `histRef.current.applying` is set.

## Instruments

Every channel picks its instrument from one dropdown with exactly three sources:
**3xOsc** (built-in, the default for new channels so a fresh project makes sound
immediately), **SGM** (downloads + caches on demand), or **an uploaded .sf2**.
Choosing SGM/upload remembers the channel in `assignSfChRef` and assigns it the
first preset once the font parses. There is no separate global soundfont picker —
the rack header only shows which font is loaded.

## Known limitations (deliberate)

- Soundfont sustain level: no MIDI control surface exists in SpessaSynth — stored
  in data, not audible (3xOsc sustain IS audible).
- Per-note pan/release/fine/slide/porta: stored, not yet audible (slide needs
  pitch-ramp code; fine-pitch could use SpessaSynth `tuneKeys`).
- Share links: immutable by design; owner-updatable short links would need
  Cloudflare Pages Functions/Workers + KV (free tier, serverless — planned).
- 15 soundfont channels (MIDI slots); unlimited 3xOsc channels.

## Roadmap (user's stated goals)

1. Host SGM on R2 + set `VITE_SF_SGM_URL` (see `.env.example`) — **still the one
   blocker on the SGM option; without it the picker reports "isn't hosted yet"**
2. "Sequences" public browse page + accounts + owner-updatable publish links (KV)
3. Slides/portamento audible; per-note fine pitch; more mixer plugins
4. ~~Viewport-virtualized roll canvas~~ — done; the roll now grows without limit