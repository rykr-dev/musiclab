/* 3xOsc — a three-oscillator subtractive synth modeled on FL Studio's.

   Per oscillator: waveform, coarse (semitones), fine (cents), level, pan,
   phase offset (0..1 cycle, via phase-rotated PeriodicWave), stereo detune
   (0..1 → up to ±50 cents L/R spread), and polarity invert.
   Shared: amplitude ADSR and the classic "Osc 3 AM" switch, where oscillator 2's
   signal amplitude-modulates oscillator 3.

   Voices are per-note: each noteOn builds its own oscillator stack into a gain
   envelope, and noteOff releases and tears it down.
*/

export const WAVEFORMS = ["sine", "triangle", "square", "sawtooth", "noise"];

const defaultOsc = () => ({
  wave: "sawtooth", coarse: 0, fine: 0, level: 0.8, pan: 0,
  phase: 0, detune: 0, invert: false,
});

export const defaultThreeOsc = () => ({
  type: "3xosc",
  name: "3xOsc",
  oscs: [
    { ...defaultOsc(), level: 0.9 },
    { ...defaultOsc(), fine: -9, level: 0.65, pan: -0.35 },
    { ...defaultOsc(), fine: 9, level: 0.65, pan: 0.35 },
  ],
  osc3AM: false,
  attack: 0.02,     // 0..1, mapped to seconds below
  decay: 0.35,
  sustain: 0.85,    // 0..1 level
  release: 0.18,
});

const midiToHz = (p) => 440 * Math.pow(2, (p - 69) / 12);
const aSec = (v) => 0.002 + v * v * 2.0;
const dSec = (v) => 0.02 + v * v * 3.0;
const rSec = (v) => 0.01 + v * v * 3.0;
const DETUNE_CENTS = 50;   // detune knob at max = ±50 cents L/R

let noiseBuf = null;
function getNoise(ctx) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseBuf = buf;
  return buf;
}

/* Phase-offset waveforms: OscillatorNode has no phase input, so we rotate the
   Fourier series of the shape by n·φ per harmonic and bake a PeriodicWave.
   Cached per (shape, quantized phase). */
const waveCache = new Map();
const N_HARM = 64;
function harmonic(wave, n) {
  switch (wave) {
    case "sine": return n === 1 ? 1 : 0;
    case "square": return n % 2 ? 4 / (n * Math.PI) : 0;
    case "triangle": return n % 2 ? (8 / (Math.PI * Math.PI)) * (((n - 1) / 2) % 2 ? -1 : 1) / (n * n) : 0;
    case "sawtooth": return (2 / (n * Math.PI)) * (n % 2 ? 1 : -1);
    default: return 0;
  }
}
function getPhasedWave(ctx, wave, phase01) {
  const q = Math.round(phase01 * 64) / 64;             // quantize for cache hits
  const key = `${wave}:${q}`;
  let w = waveCache.get(key);
  if (w) return w;
  const real = new Float32Array(N_HARM + 1);
  const imag = new Float32Array(N_HARM + 1);
  const phi = 2 * Math.PI * q;
  for (let n = 1; n <= N_HARM; n++) {
    const b = harmonic(wave, n);
    if (!b) continue;
    real[n] = b * Math.sin(n * phi);
    imag[n] = b * Math.cos(n * phi);
  }
  w = ctx.createPeriodicWave(real, imag);
  waveCache.set(key, w);
  return w;
}

export class ThreeOsc {
  constructor(ctx, output) {
    this.ctx = ctx;
    this.out = output;
    this.params = defaultThreeOsc();
    this.pitchOffset = 0;         // channel-level tuning, in semitones (fractional = cents)
    this.voices = new Map();      // pitch -> array of voices (retriggers stack)
  }

  setParams(p) {
    if (!p) return;
    const d = defaultThreeOsc();
    this.params = {
      ...d, ...p,
      oscs: (p.oscs || d.oscs).map((o, i) => ({ ...defaultOsc(), ...d.oscs[i], ...o })),
    };
  }

  setPitchOffset(semis) { this.pitchOffset = semis || 0; }

  /* Builds one oscillator's source(s) into `dest`. Returns the started sources
     plus a mono tap of the raw (pre-pan) signal, used as the AM modulator. */
  buildOsc(o, pitch, t, dest) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = (o.invert ? -1 : 1) * o.level;
    const pan = ctx.createStereoPanner();
    pan.pan.value = o.pan ?? 0;
    g.connect(pan);
    pan.connect(dest);

    const sources = [];
    const addSrc = (detuneCents, sidePan) => {
      let src;
      if (o.wave === "noise") {
        src = ctx.createBufferSource();
        src.buffer = getNoise(ctx);
        src.loop = true;
      } else {
        src = ctx.createOscillator();
        if ((o.phase ?? 0) > 0.002) src.setPeriodicWave(getPhasedWave(ctx, o.wave, o.phase));
        else src.type = o.wave;
        src.frequency.value = midiToHz(pitch + this.pitchOffset + (o.coarse || 0) + (o.fine || 0) / 100);
        src.detune.value = detuneCents;
      }
      if (sidePan == null) src.connect(g);
      else {
        const sp = ctx.createStereoPanner();
        sp.pan.value = sidePan;
        src.connect(sp); sp.connect(g);
      }
      src.start(t);
      sources.push(src);
      return src;
    };

    const spread = (o.detune ?? 0) * DETUNE_CENTS;
    if (spread >= 0.5 && o.wave !== "noise") {
      addSrc(-spread, -1);                    // stereo detune: L low, R high
      addSrc(+spread, +1);
    } else {
      addSrc(0, null);
    }
    return { sources, tap: g };
  }

  noteOn(pitch, vel = 0.78, time) {
    const ctx = this.ctx;
    const t = Math.max(time ?? ctx.currentTime, ctx.currentTime);
    const p = this.params;

    const amp = ctx.createGain();
    const peak = Math.max(0.0005, vel * 0.25);          // headroom for 3 stacked oscs
    const sus = Math.max(0.0002, peak * p.sustain);
    const at = aSec(p.attack), dt = dSec(p.decay);

    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + at);
    amp.gain.setTargetAtTime(sus, t + at, Math.max(0.008, dt / 3));
    amp.connect(this.out);

    const sources = [];
    let osc2Tap = null;
    p.oscs.forEach((o, i) => {
      if (!o || o.level <= 0.001) return;
      let dest = amp;
      if (i === 2 && p.osc3AM && osc2Tap) {
        // Osc 3 AM: osc2's signal drives osc3's amplitude (ring-mod style)
        const am = ctx.createGain();
        am.gain.value = 0;
        osc2Tap.connect(am.gain);
        am.connect(amp);
        dest = am;
      }
      const built = this.buildOsc(o, pitch, t, dest);
      sources.push(...built.sources);
      if (i === 1) osc2Tap = built.tap;
    });

    const voice = { amp, sources, t };
    const list = this.voices.get(pitch) || [];
    list.push(voice);
    this.voices.set(pitch, list);
    return voice;
  }

  releaseVoice(voice, time) {
    const ctx = this.ctx;
    const t = Math.max(time ?? ctx.currentTime, ctx.currentTime);
    const rt = rSec(this.params.release);
    const g = voice.amp.gain;
    try { g.cancelAndHoldAtTime(t); } catch { g.cancelScheduledValues(t); }
    g.setTargetAtTime(0.0001, t, Math.max(0.005, rt / 3));
    const stopAt = t + rt + 0.12;
    for (const s of voice.sources) { try { s.stop(stopAt); } catch { /* already stopped */ } }
    setTimeout(() => { try { voice.amp.disconnect(); } catch { /* gone */ } },
      Math.max(0, (stopAt - ctx.currentTime) * 1000) + 120);
  }

  noteOff(pitch, time) {
    const list = this.voices.get(pitch);
    if (!list || !list.length) return;
    const voice = list.shift();                          // oldest voice for this pitch
    if (!list.length) this.voices.delete(pitch);
    this.releaseVoice(voice, time);
  }

  allOff(force = false) {
    for (const [, list] of this.voices) {
      for (const v of list) {
        if (force) {
          try { v.amp.gain.cancelScheduledValues(this.ctx.currentTime); } catch { /* ok */ }
          try { v.amp.gain.setValueAtTime(0.0001, this.ctx.currentTime); } catch { /* ok */ }
          for (const s of v.sources) { try { s.stop(); } catch { /* ok */ } }
          try { v.amp.disconnect(); } catch { /* ok */ }
        } else {
          this.releaseVoice(v);
        }
      }
    }
    this.voices.clear();
  }

  dispose() {
    this.allOff(true);
  }
}
