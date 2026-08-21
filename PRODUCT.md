# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: "Online Sequencer refugees."** Teens and young hobbyists who make music in a
browser tab — frequently on a school, library, or shared computer where no DAW is
installed, installing one is not permitted, and paying for one is not an option. They
arrive wanting to sketch a beat or a melody within minutes and hand someone a link to
hear it.

Their situation shapes everything: no install step, no signup wall, no local file to
manage, and a session that may end whenever they lose the machine.

Design target is **desktop-first, mouse + keyboard**. A real sequencer needs a pointer
and hotkeys; phones are out of scope beyond a graceful message, and touch/tablet parity
is not a requirement. Density and hotkey depth win over small-screen accommodation.

## Product Purpose

MUSIC LAB is a pattern-based web DAW: patterns and a piano roll, a channel rack, a
playlist arrangement, and a mixer — the FL Studio working model, running entirely in the
browser. It exists so someone with nothing but a browser tab can compose real
multi-track music and share the result.

Success is a user going from a cold page load to audible music quickly, staying long
enough to arrange a full song, and sending a link that plays for whoever opens it.

## Positioning

The differentiator is **DAW depth without any of the DAW's preconditions**. Browser
sequencers in this niche buy accessibility by amputating the instrument: a fixed sound
set, no real synthesis, no per-note expression, no mixer. MUSIC LAB keeps the depth —
a built-in 3xOsc-style subtractive synth with per-oscillator phase, stereo detune and AM;
loadable .sf2/.sf3/.dls soundfonts; per-note velocity, pan, release, fine pitch and
color; a mixer with inserts and a procedural-IR reverb; sample-accurate scheduling —
while never asking for an install, an account, or a payment.

The sharing model is its own claim: **the song is the link.** A project serializes to
JSON, deflates, and rides in the URL fragment. No server holds it, nothing expires,
nothing can be revoked. That is only possible because there is no backend, and it is a
property a server-backed competitor cannot truthfully copy.

## Operating Context

- Used in a single browser tab, often alongside whatever else the machine is doing, and
  frequently on hardware the user does not own or control.
- Audio requires a user gesture before anything sounds; the AudioContext is constructed
  only inside one. First interaction is therefore a real product moment, not a technicality.
- Work persists via localStorage saves (key `musiclab:saves`) and share links. There is
  no cloud copy and no cross-device sync.
- Large soundfonts are downloaded once and cached in IndexedDB, so the first use of a
  font has a real download cost and every later use is offline-capable.
- Deployment is a static-assets Cloudflare Worker; `git push` builds and deploys. There
  is no server runtime to add behavior to.

## Capabilities and Constraints

**Confirmed capabilities.** Patterns with a virtualized canvas piano roll (draw/select/
erase, marquee, velocity lane, note-properties popup, 12 note colors); a playlist of clips
that are trim windows into patterns; a channel rack with per-channel instrument choice
(3xOsc, the built-in SGM soundfont, or an uploaded .sf2/.sf3/.dls), volume, pan, insert
routing, pitch and ADSR; a mixer with Master plus 6 inserts and a reverb; PAT/SONG
transport modes; undo/redo; localStorage saves; share links.

**Durable technical constraints.**
- No backend of any kind. Every feature must be satisfiable by static assets plus the
  browser's own storage.
- MIDI channel budget: soundfont channels map to MIDI 0–15 skipping 9, so **15 soundfont
  channels maximum**. 3xOsc channels are unlimited and consume no slot.
- The engine may only be constructed inside a user gesture.
- Share links are immutable snapshots by design.
- Canvas surfaces must stay virtualized; a full-width canvas hits the browser's 32767 px
  dimension cap.

**Stored but not yet audible** (data exists; engine work pending): per-note pan, release,
fine pitch, slide and portamento; soundfont sustain level (no SpessaSynth control surface
exists for it — 3xOsc sustain *is* audible).

**Open product decisions — record, do not assume.**
- Accounts and the public "Sequences" browse page with owner-updatable publish links are
  **wanted but not committed**. Do not reserve space for them, do not design toward them,
  and do not describe them as planned in any user-facing copy.
- Hosting for the built-in SGM soundfont (229 MB, needs R2 or equivalent) is unresolved;
  until `VITE_SF_SGM_URL` points somewhere real, the SGM option reports that it "isn't
  hosted yet."

**Terminology** follows the FL Studio model already in the code: *pattern*, *clip*,
*channel rack*, *playlist*, *insert*, *PAT / SONG*, *grid / snap*. Reuse these names;
do not invent parallel vocabulary for the same objects.

## Brand Commitments

- **Name: MUSIC LAB.** Used as-is in the UI (`APP_NAME` in `src/constants.js`).
- **No account is ever required to make music.** Anyone can open the URL and produce
  sound immediately. If accounts ever ship, they stay optional on top of a fully working
  anonymous experience.
- **Free forever, no paywall.** No paid tier, no gated features, no upsell. Design must
  never make room for pricing, upgrade prompts, or feature-locking affordances.
- FL Studio's conventions are the product's current reference model and the source of its
  vocabulary, but the user has **not** made matching FL binding. Departing from an FL
  behavior is a legitimate design option when it serves this audience better; departing
  from it accidentally or inconsistently is not.

## Evidence on Hand

- The working application itself, and share links it produces, are the only demonstrations
  that exist.
- **There are no users, no usage numbers, no testimonials, no press, no case studies, no
  customer names, and no benchmarks.** None of these may be fabricated, implied, or used
  as social proof in any surface.
- No logo, wordmark, illustration set, or photography exists. The visual identity to date
  is the in-app chrome only.

## Product Principles

1. **Sound before signup.** Nothing may stand between opening the page and hearing
   something — no account, no download gate, no setup wizard. A fresh project makes sound
   immediately (which is why new channels default to 3xOsc).
2. **Depth is the point.** This audience was underserved by tools that traded capability
   for accessibility. When forced to choose, keep the capability and make it learnable
   rather than removing it.
3. **The song is the link.** Portability and permanence come from the artifact itself,
   never from a server. Preserve that property when adding sharing or persistence features.
4. **Borrowed muscle memory is an asset.** Users arriving from other sequencers already
   know a pattern grid, a piano roll, and a mixer. Meet that expectation before asking them
   to learn anything new.
5. **The instrument runs on the machine they have.** Assume modest, shared, sometimes
   locked-down desktop hardware; performance and density decisions answer to that, not to
   an ideal workstation.

## Accessibility & Inclusion

No formal standard has been established as a requirement. What follows from the confirmed
scope: the product assumes a pointer and a physical keyboard, and keyboard hotkeys are a
primary interaction path rather than a convenience — they should stay complete and
discoverable. Canvas-drawn surfaces (roll, playlist) carry no accessibility tree, which is
a known limitation of the current implementation, not a decision the user has ratified.
