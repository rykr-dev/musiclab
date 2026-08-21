/* 3xOsc — a three-oscillator subtractive synth in the spirit of FL Studio's.

   Per oscillator: waveform, coarse (semitones), fine (cents), level, pan.
   Shared: amplitude ADSR. Unlike the soundfont path, sustain here is a real
   envelope stage, so the Sustain control actually does something.

   Voices are per-note: each noteOn builds its own oscillator stack into a gain
   envelope, and noteOff releases and tears it down.
*/

export const WAVEFORMS = ["sine", "triangle", "square", "sawtooth", "noise"];

export const defaultThreeOsc = () => ({
  type: "3xosc",
  name: "3xOsc",
  oscs: [
    { wave: "sawtooth", coarse: 0, fine: 0, level: 0.9, pan: 0 },
    { wave: "sawtooth", coarse: 0, fine: -9, level: 0.65, pan: -0.35 },
    { wave: "sawtooth", coarse: 0, fine: 9, level: 0.65, pan: 0.35 },
  ],
  attack: 0.02,     // 0..1, mapped to seconds below
  decay: 0.35,
  sustain: 0.85,    // 0..1 level
  release: 0.18,
});

const midiToHz = (p) => 440 * Math.pow(2, (p - 69) / 12);
const aSec = (v) => 0.002 + v * v * 2.0;
const dSec = (v) => 0.02 + v * v * 3.0;
const rSec = (v) => 0.01 + v * v * 3.0;

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

export class ThreeOsc {
  constructor(ctx, output) {
    this.ctx = ctx;
    this.out = output;
    this.params = defaultThreeOsc();
    this.voices = new Map();      // pitch -> array of voices (retriggers stack)
  }

  setParams(p) {
    if (p) this.params = { ...defaultThreeOsc(), ...p };
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
    for (const o of p.oscs) {
      if (!o || o.level <= 0.001) continue;
      const g = ctx.createGain();
      g.gain.value = o.level;
      const pan = ctx.createStereoPanner();
      pan.pan.value = o.pan ?? 0;

      let src;
      if (o.wave === "noise") {
        src = ctx.createBufferSource();
        src.buffer = getNoise(ctx);
        src.loop = true;
      } else {
        src = ctx.createOscillator();
        src.type = o.wave;
        src.frequency.value = midiToHz(pitch + (o.coarse || 0) + (o.fine || 0) / 100);
      }
      src.connect(g); g.connect(pan); pan.connect(amp);
      src.start(t);
      sources.push(src);
    }

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
