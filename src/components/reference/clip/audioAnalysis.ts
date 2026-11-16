// Waveform and beat detection for a clip's music, in plain JS on decoded PCM. No model: an onset
// envelope (spectral-free energy flux on short frames), a tempo estimated by autocorrelation of
// that envelope, then a beat grid phase-aligned on the strongest onsets.

export interface Analysis {
  // Peak per bucket, 0..1, for drawing the waveform.
  peaks: number[];
  beats: number[];
  bpm: number | null;
}

const HOP = 512;
const MIN_BPM = 70;
const MAX_BPM = 180;

// Mono mix of the channels of a decoded buffer.
export function mixDown(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
  return out;
}

export function computePeaks(samples: Float32Array, buckets: number): number[] {
  const out: number[] = new Array(buckets).fill(0);
  if (!samples.length || buckets <= 0) return out;
  const per = samples.length / buckets;
  let max = 0;
  for (let b = 0; b < buckets; b++) {
    const a = Math.floor(b * per);
    const e = Math.min(samples.length, Math.floor((b + 1) * per));
    let p = 0;
    for (let i = a; i < e; i++) { const v = Math.abs(samples[i]); if (v > p) p = v; }
    out[b] = p;
    if (p > max) max = p;
  }
  return max > 0 ? out.map((p) => p / max) : out;
}

// Onset strength per hop: positive change of log energy, so a soft attack in a quiet passage
// counts as much as a loud one in a dense passage.
export function onsetEnvelope(samples: Float32Array): Float32Array {
  const frames = Math.max(0, Math.floor((samples.length - HOP) / HOP));
  const env = new Float32Array(frames);
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const a = f * HOP;
    // Emphasise the attack: difference of consecutive samples (a crude high-pass) before energy.
    for (let i = a + 1; i < a + HOP * 2 && i < samples.length; i++) {
      const d = samples[i] - samples[i - 1];
      e += d * d;
    }
    const le = Math.log1p(e * 100);
    env[f] = Math.max(0, le - prev);
    prev = le;
  }
  // Remove the slow trend so sections of different loudness compare.
  const w = 16;
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0, n = 0;
    for (let k = Math.max(0, f - w); k <= Math.min(frames - 1, f + w); k++) { s += env[k]; n++; }
    out[f] = Math.max(0, env[f] - s / n);
  }
  return out;
}

// Tempo by autocorrelation of the onset envelope, as a lag in hops.
export function estimatePeriod(env: Float32Array, sampleRate: number): number | null {
  const hopSec = HOP / sampleRate;
  const minLag = Math.max(1, Math.floor(60 / MAX_BPM / hopSec));
  const maxLag = Math.ceil(60 / MIN_BPM / hopSec);
  if (env.length < maxLag * 4) return null;
  let best = 0, bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    // A light preference for tempos near 120 BPM settles octave ambiguity (60 vs 120 vs 240).
    const bpm = 60 / (lag * hopSec);
    const weight = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 1.2, 2));
    const score = s * weight;
    if (score > best) { best = score; bestLag = lag; }
  }
  return best > 0 ? refineLag(env, bestLag) : null;
}

// Sub-hop period from a parabola through the autocorrelation around the integer lag.
function refineLag(env: Float32Array, lag: number): number {
  const ac = (l: number) => { let s = 0; for (let i = l; i < env.length; i++) s += env[i] * env[i - l]; return s; };
  const a = ac(lag - 1), b = ac(lag), c = ac(lag + 1);
  const den = a - 2 * b + c;
  return den < 0 ? lag + (0.5 * (a - c)) / den : lag;
}

// Beat grid: the phase that gathers the most onset strength, then one beat per period, each nudged
// to the strongest onset nearby (a live track drifts).
export function beatGrid(env: Float32Array, period: number, sampleRate: number): number[] {
  const hopSec = HOP / sampleRate;
  const steps = Math.floor(period);
  let bestPhase = 0, best = -1;
  for (let p = 0; p < steps; p++) {
    let s = 0;
    for (let x = p; x < env.length; x += period) s += env[Math.round(x)] ?? 0;
    if (s > best) { best = s; bestPhase = p; }
  }
  const beats: number[] = [];
  const reach = Math.max(1, Math.round(period * 0.12));
  for (let x = bestPhase; x < env.length; x += period) {
    const c = Math.round(x);
    let at = c, top = env[c] ?? 0;
    for (let k = c - reach; k <= c + reach; k++) if ((env[k] ?? 0) > top) { top = env[k]; at = k; }
    beats.push(Math.round(at * hopSec * 1000) / 1000);
  }
  return beats;
}

export function analyse(samples: Float32Array, sampleRate: number, buckets = 2000): Analysis {
  const peaks = computePeaks(samples, buckets);
  const env = onsetEnvelope(samples);
  const period = estimatePeriod(env, sampleRate);
  if (!period) return { peaks, beats: [], bpm: null };
  const bpm = Math.round((60 / (period * (HOP / sampleRate))) * 10) / 10;
  return { peaks, beats: beatGrid(env, period, sampleRate), bpm };
}
