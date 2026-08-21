/* Lookahead scheduler.
   A 25 ms timer walks the playlist's clip windows and schedules every note
   onto the AudioContext clock ~180 ms ahead via SpessaSynth's eventOptions.time,
   so actual event timing is sample-accurate inside the worklet regardless of
   main-thread load. State is read live each tick, so edits during playback
   (FL-style) are picked up within one lookahead window.
*/
const TICK_MS = 25;
const LOOKAHEAD_S = 0.18;

/* Untrimmed clips (lenBars == null) follow their pattern's content, rounded up
   to whole measures — same rule the playlist uses to draw them. */
export const patternLenBars = (pattern, bpb) => Math.max(1, Math.ceil(
  pattern.notes.reduce((m, n) => Math.max(m, n.start + n.len), 0) / bpb || 1));

export class Scheduler {
  constructor(ctx, voice, getState) {
    this.ctx = ctx;
    this.voice = voice;         // { on(chId,pitch,vel,time), off(chId,pitch,time), panic(force) }
    this.getState = getState;   // () => { bpm, beatsPerBar, clips, patterns, mode, ... }
    this.playing = false;
    this.bpm = 140;
    this.anchorBeats = 0;
    this.anchorTime = 0;
    this.scheduledUpTo = 0;
    this.timer = null;
    this.stopGen = 0;
  }

  timeOf(beats) {
    return this.anchorTime + ((beats - this.anchorBeats) * 60) / this.bpm;
  }

  getBeats() {
    if (!this.playing) return this.anchorBeats;
    return Math.max(this.anchorBeats, this.anchorBeats + ((this.ctx.currentTime - this.anchorTime) * this.bpm) / 60);
  }

  play(fromBeats) {
    this.stop(false);
    this.stopGen++;                                // cancel any pending straggler sweeps
    const st = this.getState();
    this.bpm = st.bpm;
    this.playing = true;
    this.anchorBeats = fromBeats;
    this.anchorTime = this.ctx.currentTime + 0.06; // small runway before the first event
    this.scheduledUpTo = fromBeats - 1e-6;         // epsilon: notes exactly AT the marker must play
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  seek(beats) {
    if (!this.playing) { this.anchorBeats = beats; return; }
    this.voice.panic(true);
    this.anchorBeats = beats;
    this.anchorTime = this.ctx.currentTime + 0.25; // runway past the stale-event horizon
    this.scheduledUpTo = beats - 1e-6;             // epsilon: notes exactly AT the seek point must play
    // stale queued events fire within ~180 ms; sweep them just before new notes begin sounding
    const gen = ++this.stopGen;
    for (const ms of [90, 200]) {
      setTimeout(() => { if (this.stopGen === gen) this.voice.panic(true); }, ms);
    }
  }

  setBpm(bpm) {
    if (bpm === this.bpm) return;
    // re-anchor at the current position so the playhead doesn't jump
    this.anchorBeats = this.getBeats();
    this.anchorTime = this.ctx.currentTime;
    this.bpm = bpm;
    this.scheduledUpTo = Math.max(this.scheduledUpTo, this.anchorBeats);
  }

  stop(sendPanic = true) {
    this.playing = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (!sendPanic) return;
    // SpessaSynth has no API to cancel queued future events, so force-kill now and
    // sweep again across the lookahead horizon; the generation guard aborts the
    // sweeps the moment a new play() starts, so fresh playback is never clipped.
    const gen = ++this.stopGen;
    this.voice.panic(true);
    for (const ms of [70, 150, 240, 330]) {
      setTimeout(() => { if (this.stopGen === gen && !this.playing) this.voice.panic(true); }, ms);
    }
  }

  /* Pattern mode: loop the open pattern, ignoring the playlist entirely. */
  tickPattern(st, nowBeats) {
    const loop = Math.max(1e-6, st.patLoopBeats || st.beatsPerBar);
    const horizon = nowBeats + (LOOKAHEAD_S * this.bpm) / 60;
    if (horizon <= this.scheduledUpTo) return;
    const from = this.scheduledUpTo;
    const pattern = st.patterns.find((p) => p.id === st.patternId);
    if (pattern) {
      const kMin = Math.floor(from / loop), kMax = Math.floor(horizon / loop);
      for (let k = kMin; k <= kMax; k++) {
        if (k < 0) continue;
        for (const n of pattern.notes) {
          if (n.start >= loop) continue;                 // past the loop edge
          const songOn = k * loop + n.start;
          if (songOn <= from || songOn > horizon) continue;
          if (!this.voice.has(n.ch)) continue;
          const songOff = k * loop + Math.min(n.start + n.len, loop);
          const vel = n.vel ?? 0.78;
          this.voice.on(n.ch, n.pitch, vel, this.timeOf(songOn));
          this.voice.off(n.ch, n.pitch, this.timeOf(songOff));
        }
      }
    }
    this.scheduledUpTo = horizon;
  }

  tick() {
    if (!this.playing) return;
    const st = this.getState();
    if (st.bpm !== this.bpm) this.setBpm(st.bpm);
    const bpb = st.beatsPerBar;
    const nowBeats = this.getBeats();
    if (st.mode === "pattern") return this.tickPattern(st, nowBeats);
    // Hard cap: only ever queue up to LOOKAHEAD_S ahead of *real time*. The old
    // formula (max(now, scheduledUpTo) + lookahead) compounded every tick and
    // queued the whole song within seconds — which is why stop couldn't stop it.
    const horizon = nowBeats + (LOOKAHEAD_S * this.bpm) / 60;
    if (horizon <= this.scheduledUpTo) return;
    const from = this.scheduledUpTo;

    for (const clip of st.clips) {
      const pattern = st.patterns.find((p) => p.id === clip.patternId);
      if (!pattern) continue;
      const clipStart = clip.startBar * bpb;                       // song beats
      const w0 = (clip.offsetBars ?? 0) * bpb;                     // pattern-window start (pattern beats)
      const wEnd = w0 + (clip.lenBars ?? patternLenBars(pattern, bpb)) * bpb;  // pattern-window end

      for (const n of pattern.notes) {
        if (n.start < w0 || n.start >= wEnd) continue;             // must START inside the trim window
        const songOn = clipStart + (n.start - w0);
        if (songOn <= from || songOn > horizon) continue;
        if (!this.voice.has(n.ch)) continue;
        const cutEnd = Math.min(n.start + n.len, wEnd);            // clip boundary cuts the tail
        const songOff = clipStart + (cutEnd - w0);
        const vel = n.vel ?? 0.78;
        this.voice.on(n.ch, n.pitch, vel, this.timeOf(songOn));
        this.voice.off(n.ch, n.pitch, this.timeOf(songOff));
      }
    }
    this.scheduledUpTo = horizon;
  }
}
