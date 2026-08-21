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
  }

  async init() {
    if (this.ctx) return;
    this.ctx = new AudioContext({ sampleRate: 44100 });
    await this.ctx.audioWorklet.addModule("/spessasynth_processor.min.js");
    // A suspended context never runs the worklet, so the synth's ready signal
    // would never arrive and loading would hang forever.
    try { await this.ctx.resume(); } catch { /* needs a user gesture; retried on load */ }
    this.synth = new WorkletSynthesizer(this.ctx);

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

    this.synth.eventHandler.addEvent("presetListChange", "seqlab", (list) => {
      this.setPresets(list);
    });

    this.scheduler = new Scheduler(this.ctx, {
      has: (chId) => this.chanNodes.has(chId),
      on: (chId, pitch, vel, time) => this.voiceOn(chId, pitch, vel, time),
      off: (chId, pitch, time) => this.voiceOff(chId, pitch, time),
      panic: (force) => this.panic(force),
    }, this.getState);
    this.ready = true;
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
    if (midiCh != null) this.synth.connectChannel(gain, midiCh);
    node = { midiCh, gain, pan, osc: null, insertId: null, program: null };
    this.chanNodes.set(chId, node);
    return node;
  }

  syncChannels(channels) {
    if (!this.ready) return;
    // drop nodes for deleted channels
    for (const [id, node] of [...this.chanNodes]) {
      if (!channels.some((c) => c.id === id)) {
        this.synth.stopAll(true);
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
        continue;                                          // built-in synth: no MIDI program work
      }
      if (node.osc) {                                      // switched back to a soundfont
        node.osc.dispose();
        node.osc = null;
      }
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
    else this.synth.noteOn(node.midiCh, pitch, Math.max(1, Math.min(127, Math.round(vel * 127))),
      time == null ? undefined : { time });
  }
  voiceOff(chId, pitch, time) {
    const node = this.chanNodes.get(chId);
    if (!node) return;
    if (node.osc) node.osc.noteOff(pitch, time);
    else this.synth.noteOff(node.midiCh, pitch, time == null ? undefined : { time });
  }
  panic(force = true) {
    try { this.synth.stopAll(force); } catch { /* not ready */ }
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
