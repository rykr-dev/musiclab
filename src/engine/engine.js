/* Audio engine.
   One WorkletSynthesizer (per SpessaSynth's own guidance) with per-MIDI-channel
   outputs tapped via connectChannel() into our own graph:

     synth ch N ─ chGain(vol) ─ chPan(pan) ─→ insert input
     insert:   input ─ [reverb slots…] ─ insertVol ─→ master input
     master:   input ─ [reverb slots…] ─ masterVol ─→ destination

   DAW channels map onto MIDI channels 0–15 (skipping 9, the GM drum channel),
   so up to 15 sounding channels for now.
*/
import { WorkletSynthesizer } from "spessasynth_lib";
import { createReverbNode } from "./reverb";
import { Scheduler } from "./scheduler";
import { ThreeOsc } from "./threeosc";

const MIDI_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

export class Engine {
  constructor(getState, callbacks = {}) {
    this.getState = getState;
    this.onPresets = callbacks.onPresets || (() => {});
    this.onStatus = callbacks.onStatus || (() => {});
    this.ready = false;
    this.ctx = null;
    this.synth = null;
    this.scheduler = null;
    this.presets = [];
    this.chanNodes = new Map();   // channelId -> { midiCh, gain, pan, insertId, program }
    this.insertNodes = [];        // index-aligned with state inserts (0 = Master)
    this.synthClockOffset = 0;    // see trackSynthClock()
    this.clockSamples = [];
  }

  async init() {
    if (this.ctx) return;
    this.ctx = new AudioContext({ sampleRate: 44100 });
    // A suspended context never runs anything, so the synth's ready signal
    // would never arrive and loading would hang forever.
    try { await this.ctx.resume(); } catch { /* needs a user gesture; retried on load */ }

    // build Master + 6 insert strips
    const st = this.getState();
    this.insertNodes = st.inserts.map((ins, i) => {
      const input = this.ctx.createGain();
      const vol = this.ctx.createGain();
      vol.gain.value = ins.vol;
      const wrapper = { input, vol, chain: [], sig: "" };
      if (i === 0) vol.connect(this.ctx.destination);
      // non-master vol outputs connect to master input below (after map completes)
      return wrapper;
    });
    for (let i = 1; i < this.insertNodes.length; i++) {
      this.insertNodes[i].vol.connect(this.insertNodes[0].input);
    }
    this.insertNodes.forEach((w, i) => this.rebuildInsertChain(i, st.inserts[i]));

    this.scheduler = new Scheduler(this.ctx, {
      has: (chId) => this.chanNodes.has(chId),
      on: (chId, pitch, vel, time) => this.voiceOn(chId, pitch, vel, time),
      off: (chId, pitch, time) => this.voiceOff(chId, pitch, time),
      panic: (force) => this.panic(force),
    }, this.getState);
    this.ready = true;
  }

  /* SpessaSynth's worklet is ~400 KB and only soundfont channels need it, so it
     loads lazily. 3xOsc channels work with no soundfont and no worklet at all. */
  async ensureSynth() {
    if (this.synth) return this.synth;
    if (!this.synthPromise) {
      this.synthPromise = (async () => {
        await this.ctx.audioWorklet.addModule("/spessasynth_processor.min.js");
        const synth = new WorkletSynthesizer(this.ctx);
        // Every message the worklet posts is stamped with the processor's clock,
        // but the library's event API drops that field, so read the port directly.
        // Wrap rather than replace: the lib's own handler must still run.
        // `worklet` is TS-protected, not private at runtime — but if a future
        // version of the library renames it, fall back to uncompensated timing
        // rather than breaking playback outright.
        const port = synth.worklet?.port;
        if (port) {
          const libHandler = port.onmessage;
          port.onmessage = (e) => {
            const t = e.data?.currentTime;
            if (typeof t === "number" && Number.isFinite(t)) this.trackSynthClock(t);
            libHandler?.call(port, e);
          };
        } else {
          console.warn("[music lab] no worklet port to read the synth clock from; " +
            "soundfont note timing will not be drift-compensated.");
        }
        synth.eventHandler.addEvent("presetListChange", "musiclab", (l) => this.setPresets(l));
        this.synth = synth;
        for (const [, node] of this.chanNodes) {          // hook up channels created earlier
          if (node.midiCh != null) synth.connectChannel(node.gain, node.midiCh);
        }
        return synth;
      })().catch((err) => { this.synthPromise = null; throw err; });
    }
    return this.synthPromise;
  }

  /* ---- soundfont clock drift ----
     SpessaSynth queues timed events against the PROCESSOR's own clock, which is
     seeded once at construction and then advanced purely by rendered samples
     (`currentTime += sampleCount * sampleTime`). It never resyncs to the
     AudioContext. So any stall of the audio render thread leaves that clock
     permanently behind real time — and parsing a large .sf2 happens inside the
     worklet, which is exactly such a stall. A note stamped for absolute time T
     then waits for the lagging clock to reach T and sounds late by the length of
     the stall, while 3xOsc (native nodes on the real context clock) stays on the
     beat. That is the rhythm drift.

     The library already solves this for its Worker variant — WorkerSynthesizer
     keeps `timeOffset = message.currentTime - context.currentTime` and offsets
     everything by it. WorkletSynthesizer simply assumes the two clocks stay
     locked. We measure the same offset from the messages the worklet stamps.

     Delivery to the main thread only ever COSTS time, so any single reading is
     biased low (too negative). The true offset is the maximum across a short
     window, which also lets a genuine new stall pull the estimate down once the
     stale samples age out. */
  trackSynthClock(synthTime) {
    const now = this.ctx.currentTime;
    const s = this.clockSamples;
    s.push({ at: now, off: synthTime - now });
    while (s.length && now - s[0].at > 2) s.shift();
    let max = -Infinity;
    for (const x of s) if (x.off > max) max = x.off;
    if (Number.isFinite(max)) this.synthClockOffset = max;
  }

  setPresets(list) {
    const arr = (list || this.synth.presetList || []).map((p) => ({
      bank: p.bankMSB ?? p.bank ?? 0,
      program: p.program ?? 0,
      name: (p.name ?? p.presetName ?? `Preset ${p.program ?? "?"}`) + (p.isDrum ? " 🥁" : ""),
    })).sort((a, b) => a.bank - b.bank || a.program - b.program);
    this.presets = arr;
    this.onPresets(arr);
  }

  async loadSoundfont(arrayBuffer) {
    await this.init();
    try { await this.ctx.resume(); } catch { /* already running */ }
    await this.ensureSynth();

    // Never await the worklet forever — surface a real error instead of hanging.
    const guard = (p, ms, what) => Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms)),
    ]);

    await guard(this.synth.isReady, 20000, "Synth startup");
    await guard(this.synth.soundBankManager.addSoundBank(arrayBuffer, "main"), 180000, "Soundfont parsing");
    await guard(this.synth.isReady, 60000, "Soundfont load");

    this.setPresets(this.synth.presetList);
    this.syncChannels(this.getState().channels);
    const driftMs = Math.round(-this.synthClockOffset * 1000);
    if (driftMs > 5) {
      console.info(`[music lab] soundfont worklet clock is ${driftMs} ms behind the audio ` +
        `context (the .sf2 parse stalled the render thread); note timing is compensated by that much.`);
    }
    this.onStatus("Soundfont loaded");
  }

  /* ---- channel graph ---- */
  ensureChannelNode(chId) {
    let node = this.chanNodes.get(chId);
    if (node) return node;
    const used = new Set([...this.chanNodes.values()].map((n) => n.midiCh));
    const midiCh = MIDI_SLOTS.find((m) => !used.has(m)) ?? null;
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();
    gain.connect(pan);
    // Only soundfont channels need a MIDI slot; built-in synths (3xOsc) feed `gain` directly,
    // so running out of slots doesn't silence them.
    if (midiCh != null && this.synth) this.synth.connectChannel(gain, midiCh);
    node = { midiCh, gain, pan, osc: null, insertId: null, program: null };
    this.chanNodes.set(chId, node);
    return node;
  }

  syncChannels(channels) {
    if (!this.ready) return;
    // drop nodes for deleted channels
    for (const [id, node] of [...this.chanNodes]) {
      if (!channels.some((c) => c.id === id)) {
        this.synth?.stopAll(true);
        node.osc?.dispose();
        try { node.pan.disconnect(); node.gain.disconnect(); } catch { /* already gone */ }
        this.chanNodes.delete(id);
      }
    }
    for (const c of channels) {
      const node = this.ensureChannelNode(c.id);
      if (!node) continue;
      node.gain.gain.value = c.vol;
      node.pan.pan.value = c.pan;
      const insertId = c.insert ?? 0;
      if (node.insertId !== insertId) {
        try { node.pan.disconnect(); } catch { /* first connect */ }
        node.pan.connect((this.insertNodes[insertId] || this.insertNodes[0]).input);
        node.insertId = insertId;
      }
      if (c.instrument?.type === "3xosc") {
        if (!node.osc) {
          node.osc = new ThreeOsc(this.ctx, node.gain);   // sits in front of channel vol/pan
          node.program = null;
        }
        node.osc.setParams(c.instrument);
        node.osc.setPitchOffset(c.pitch ?? 0);
        continue;                                          // built-in synth: no MIDI program work
      }
      if (node.osc) {                                      // switched back to a soundfont
        node.osc.dispose();
        node.osc = null;
      }
      if (!this.synth) continue;                           // soundfont work needs the worklet
      if (c.instrument && node.midiCh == null) {
        this.onStatus("Soundfont channels are limited to 15 — use 3xOsc on extra channels");
        continue;
      }
      if (c.instrument) {
        const key = `${c.instrument.bank}:${c.instrument.program}`;
        if (node.program !== key) {
          this.synth.controllerChange(node.midiCh, 0, c.instrument.bank); // bank select MSB
          this.synth.programChange(node.midiCh, c.instrument.program);
          node.program = key;
        }
      }
      // envelope: standard MIDI sound controllers (73 attack, 75 decay, 72 release), 64 = neutral
      const env = `${c.attack ?? 0.5}|${c.decay ?? 0.5}|${c.release ?? 0.5}`;
      if (node.env !== env) {
        this.synth.controllerChange(node.midiCh, 73, Math.round((c.attack ?? 0.5) * 127));
        this.synth.controllerChange(node.midiCh, 75, Math.round((c.decay ?? 0.5) * 127));
        this.synth.controllerChange(node.midiCh, 72, Math.round((c.release ?? 0.5) * 127));
        node.env = env;
      }
      // pitch: RPN 2 (coarse tune, semitones) + RPN 1 (fine tune, cents)
      const pitch = c.pitch ?? 0;
      if (node.pitch !== pitch) {
        const semis = Math.max(-24, Math.min(24, Math.trunc(pitch)));
        const cents = Math.round((pitch - semis) * 100);
        const rpn = (lsb, dataMSB) => {
          this.synth.controllerChange(node.midiCh, 101, 0);   // RPN MSB
          this.synth.controllerChange(node.midiCh, 100, lsb); // RPN LSB
          this.synth.controllerChange(node.midiCh, 6, dataMSB);
          this.synth.controllerChange(node.midiCh, 101, 127); // RPN null
          this.synth.controllerChange(node.midiCh, 100, 127);
        };
        rpn(2, 64 + semis);                                          // coarse: semitones
        rpn(1, Math.max(0, Math.min(127, 64 + Math.round((cents / 100) * 64)))); // fine: cents
        node.pitch = pitch;
      }
    }
  }

  /* ---- insert / effect graph ---- */
  rebuildInsertChain(i, insertState) {
    const w = this.insertNodes[i];
    if (!w) return;
    const sig = insertState.slots.map((s) => (s ? s.type : "-")).join(",");
    if (sig !== w.sig) {
      // tear down and rebuild input → slots → vol
      try { w.input.disconnect(); } catch { /* fresh */ }
      for (const fx of w.chain) { try { fx.output.disconnect(); } catch { /* ok */ } }
      w.chain = [];
      let head = w.input;
      for (const s of insertState.slots) {
        if (!s) continue;
        if (s.type === "reverb") {
          const fx = createReverbNode(this.ctx, s.params);
          head.connect(fx.input);
          head = fx.output;
          w.chain.push(fx);
        }
      }
      head.connect(w.vol);
      w.sig = sig;
    }
    // live params
    let fxIdx = 0;
    for (const s of insertState.slots) {
      if (!s) continue;
      w.chain[fxIdx]?.update?.(s.params);
      fxIdx++;
    }
    w.vol.gain.value = insertState.vol;
  }

  syncInserts(inserts) {
    if (!this.ready) return;
    inserts.forEach((ins, i) => this.rebuildInsertChain(i, ins));
  }

  /* ---- unified voice routing: soundfont channels vs built-in synths ---- */
  voiceOn(chId, pitch, vel, time) {
    const node = this.chanNodes.get(chId);
    if (!node) return;
    if (node.osc) node.osc.noteOn(pitch, vel, time);
    else if (this.synth && node.midiCh != null) {
      this.synth.noteOn(node.midiCh, pitch, Math.max(1, Math.min(127, Math.round(vel * 127))),
        time == null ? undefined : { time: time + this.synthClockOffset });
    }
  }
  voiceOff(chId, pitch, time) {
    const node = this.chanNodes.get(chId);
    if (!node) return;
    if (node.osc) node.osc.noteOff(pitch, time);
    else if (this.synth && node.midiCh != null) {
      this.synth.noteOff(node.midiCh, pitch,
        time == null ? undefined : { time: time + this.synthClockOffset });
    }
  }
  panic(force = true) {
    try { this.synth?.stopAll(force); } catch { /* not ready */ }
    for (const [, node] of this.chanNodes) node.osc?.allOff(force);
  }

  /* ---- note audition (piano roll preview) ---- */
  audition(chId, pitch, vel = 0.78) {
    if (!this.ready) return;
    this.ctx.resume();
    this.syncChannels(this.getState().channels);   // cheap diff; guarantees program/vol/pan are applied
    this.voiceOn(chId, pitch, vel);
  }
  auditionOff(chId, pitch) {
    this.voiceOff(chId, pitch);
  }

  /* ---- transport ---- */
  async play(fromBeats) {
    if (!this.ready) return;
    await this.ctx.resume();
    this.syncChannels(this.getState().channels);
    this.scheduler.play(fromBeats);
  }
  seek(beats) { this.scheduler?.seek(beats); }
  stop() { this.scheduler?.stop(); }
  getBeats() { return this.scheduler ? this.scheduler.getBeats() : 0; }
  get playing() { return !!this.scheduler?.playing; }
}
