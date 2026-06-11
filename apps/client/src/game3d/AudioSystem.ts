/**
 * Procedural audio: ambient dusk-wind bed + synthesized SFX via Web Audio.
 * No asset files — everything is oscillators and filtered noise, so it weighs
 * nothing and never 404s. Created lazily on the first user gesture (browser
 * autoplay policy). Mute persists in localStorage.
 */

export type SfxName =
  | 'attack' | 'ability' | 'hit' | 'hurt' | 'harvest' | 'build'
  | 'level' | 'perk' | 'horn' | 'die' | 'click';

const MUTE_KEY = 'fmr_muted';

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambient: GainNode | null = null;
  private mutedFlag = false;
  private disposed = false;

  constructor() {
    try { this.mutedFlag = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* private mode */ }
  }

  get muted(): boolean { return this.mutedFlag; }

  /** Call from a user-gesture handler; safe to call repeatedly. */
  ensure() {
    if (this.ctx || this.disposed) return;
    const AC = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.mutedFlag ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
      this.startAmbient();
    } catch {
      this.ctx = null;
    }
  }

  toggleMute(): boolean {
    this.mutedFlag = !this.mutedFlag;
    try { localStorage.setItem(MUTE_KEY, this.mutedFlag ? '1' : '0'); } catch { /* */ }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.mutedFlag ? 0 : 0.55, this.ctx.currentTime, 0.05);
    }
    return this.mutedFlag;
  }

  // ---- ambient bed -----------------------------------------------------------

  private startAmbient() {
    const ctx = this.ctx!;
    this.ambient = ctx.createGain();
    this.ambient.gain.value = 0.16;
    this.ambient.connect(this.master!);

    // Wind: looped brown noise through a slowly-wandering lowpass.
    const noise = ctx.createBufferSource();
    noise.buffer = this.brownNoise(4);
    noise.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    lp.Q.value = 0.4;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.5;
    noise.connect(lp).connect(windGain).connect(this.ambient);
    noise.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoAmp = ctx.createGain();
    lfoAmp.gain.value = 140;
    lfo.connect(lfoAmp).connect(lp.frequency);
    lfo.start();

    // Deep dusk drone: two detuned low sines, very quiet.
    for (const f of [54, 54.6]) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.05;
      o.connect(g).connect(this.ambient);
      o.start();
    }
  }

  private brownNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    return buf;
  }

  // ---- SFX -------------------------------------------------------------------

  sfx(name: SfxName) {
    if (!this.ctx || !this.master || this.mutedFlag) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'attack': this.noiseBurst(t, 0.09, 1700, 0.5, 'bandpass'); break;
      case 'ability':
        this.tone(t, 660, 990, 0.22, 'sine', 0.2);
        this.noiseBurst(t, 0.25, 2600, 0.12, 'highpass');
        break;
      case 'hit':
        this.tone(t, 180, 80, 0.1, 'square', 0.25);
        this.noiseBurst(t, 0.05, 900, 0.3, 'bandpass');
        break;
      case 'hurt': this.tone(t, 310, 110, 0.22, 'sawtooth', 0.3); break;
      case 'harvest':
        this.tone(t, 170, 120, 0.07, 'sine', 0.5);
        this.tone(t + 0.09, 150, 100, 0.07, 'sine', 0.4);
        break;
      case 'build':
        this.noiseBurst(t, 0.12, 420, 0.4, 'lowpass');
        this.tone(t + 0.08, 220, 330, 0.3, 'triangle', 0.25);
        break;
      case 'level':
        this.tone(t, 523, 523, 0.14, 'sine', 0.3);
        this.tone(t + 0.12, 659, 659, 0.14, 'sine', 0.3);
        this.tone(t + 0.24, 784, 784, 0.3, 'sine', 0.3);
        break;
      case 'perk': this.tone(t, 880, 1175, 0.4, 'triangle', 0.3); break;
      case 'horn': {
        // War horn: slow-attack stacked saws with a little vibrato.
        for (const [f, v] of [[110, 0.32], [220, 0.14], [165, 0.1]] as const) {
          const o = this.ctx.createOscillator();
          o.type = 'sawtooth'; o.frequency.value = f;
          const vib = this.ctx.createOscillator();
          vib.frequency.value = 5.2;
          const vibAmp = this.ctx.createGain(); vibAmp.gain.value = 2.4;
          vib.connect(vibAmp).connect(o.frequency);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(v, t + 0.35);
          g.gain.setValueAtTime(v, t + 0.9);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
          const lp = this.ctx.createBiquadFilter();
          lp.type = 'lowpass'; lp.frequency.value = 900;
          o.connect(lp).connect(g).connect(this.master);
          o.start(t); o.stop(t + 1.8); vib.start(t); vib.stop(t + 1.8);
        }
        break;
      }
      case 'die':
        this.tone(t, 400, 55, 0.3, 'sawtooth', 0.2);
        this.noiseBurst(t, 0.22, 600, 0.2, 'lowpass');
        break;
      case 'click': this.tone(t, 1250, 1250, 0.03, 'square', 0.12); break;
    }
  }

  private tone(at: number, from: number, to: number, dur: number, type: OscillatorType, vol: number) {
    if (!this.ctx || !this.master) return;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, at);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.master);
    o.start(at); o.stop(at + dur + 0.05);
  }

  private noiseBurst(at: number, dur: number, freq: number, vol: number, type: BiquadFilterType) {
    if (!this.ctx || !this.master) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.brownNoise(Math.max(0.1, dur));
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(at); src.stop(at + dur + 0.05);
  }

  dispose() {
    this.disposed = true;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.master = null;
  }
}
