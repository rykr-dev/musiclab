/* Algorithmic-ish reverb: procedurally generated impulse response + convolver.
   Room Size / Decay / Diffusion regenerate the IR; the rest are live node params.

   input ─┬─ dry gain ──────────────────────────────────────┬─ output
          └─ predelay → lowcut(HP) → highcut(LP) → convolver → wet gain ┘
*/
export function createReverbNode(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const predelay = ctx.createDelay(1.0);
  const lowcut = ctx.createBiquadFilter();
  lowcut.type = "highpass";
  const highcut = ctx.createBiquadFilter();
  highcut.type = "lowpass";
  const conv = ctx.createConvolver();
  const wet = ctx.createGain();

  input.connect(dry);
  dry.connect(output);
  input.connect(predelay);
  predelay.connect(lowcut);
  lowcut.connect(highcut);
  highcut.connect(conv);
  conv.connect(wet);
  wet.connect(output);

  let irKey = "";
  function buildIR(p) {
    // only regenerate when the shaping params actually changed
    const key = `${Math.round(p.roomsize)}|${Math.round(p.diffusion)}|${Math.round(p.decay * 20)}`;
    if (key === irKey) return;
    irKey = key;

    const dur = Math.max(0.15, p.decay * (0.35 + p.roomsize / 110)); // room size stretches the tail
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    const baseDensity = 0.12 + 0.88 * (p.diffusion / 100); // low diffusion = sparse early reflections

    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const density = Math.min(1, baseDensity + (1 - baseDensity) * t * 1.5); // always densifies into the tail
        if (Math.random() < density) {
          d[i] = (Math.random() * 2 - 1) * Math.exp(-6.9 * t); // -60 dB by the end of the buffer
        }
      }
    }
    conv.buffer = buf;
  }

  function update(p) {
    dry.gain.value = p.dry / 100;
    wet.gain.value = (p.wet / 100) * 0.8;
    predelay.delayTime.value = Math.min(0.99, p.predelay / 1000);
    lowcut.frequency.value = p.lowcut;
    highcut.frequency.value = p.highcut;
    buildIR(p);
  }
  update(params);

  return { input, output, update };
}
