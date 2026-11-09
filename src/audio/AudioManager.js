/**
 * Sky Combat — procedural audio.
 *
 * Everything is synthesised at runtime with the Web Audio API, so there are no files to
 * license and nothing to download. The sound is split into an engine bed (a low, filtered
 * drone that follows the throttle) and one-shot effects (the gun, hits, pickups and the menu).
 *
 * Browsers refuse to make sound until the user has interacted, so nothing is created here
 * until `unlock()` runs on the first gesture. The engine bed follows the aircraft that is on
 * screen — a run in flight, or the menu/hangar/shop demo — so the menu is only as loud as its
 * idling airframe and its button blips.
 *
 * This class is browser-only: it is intentionally never imported by the unit tests.
 */
export class AudioManager {
  #context = null;
  #master = null;
  #effects = null;
  #engineGain = null;
  #engineOsc = null;
  #engineFilter = null;
  #noise = null;

  #volume = 0.7;
  #muted = false;

  /** Create or resume the audio context. Idempotent; call on a user gesture. */
  unlock() {
    if (!this.#context) {
      const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Context) return;
      this.#context = new Context();
      this.#master = this.#context.createGain();
      this.#effects = this.#context.createGain();
      this.#master.connect(this.#context.destination);
      this.#effects.connect(this.#master);
      this.#applyGain();
    }
    if (this.#context.state === 'suspended') this.#context.resume().catch(() => {});
  }

  setVolume(volume) {
    this.#volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : this.#volume;
    this.#applyGain();
  }

  setMuted(muted) {
    this.#muted = Boolean(muted);
    this.#applyGain();
  }

  #applyGain() {
    if (!this.#master || !this.#context) return;
    const target = this.#muted ? 0 : this.#volume;
    this.#master.gain.setTargetAtTime(target, this.#context.currentTime, 0.03);
  }

  #ensureEngine() {
    if (this.#engineOsc || !this.#context) return;
    this.#engineOsc = this.#context.createOscillator();
    this.#engineOsc.type = 'sawtooth';
    this.#engineFilter = this.#context.createBiquadFilter();
    this.#engineFilter.type = 'lowpass';
    this.#engineGain = this.#context.createGain();
    this.#engineGain.gain.value = 0;
    this.#engineOsc.connect(this.#engineFilter);
    this.#engineFilter.connect(this.#engineGain);
    this.#engineGain.connect(this.#master);
    this.#engineOsc.start();
  }

  /** The engine bed: throttle raises the pitch and the loudness, boost adds a hard edge. */
  updateEngine(throttle = 0, boost = false) {
    if (!this.#context) return;
    const t = Math.min(1, Math.max(0, Number.isFinite(throttle) ? throttle : 0));
    this.#ensureEngine();

    const now = this.#context.currentTime;
    const frequency = 48 + t * 72 + (boost ? 26 : 0);
    const gain = (0.015 + t * 0.055) * (boost ? 1.7 : 1);
    this.#engineOsc.frequency.setTargetAtTime(frequency, now, 0.12);
    this.#engineFilter.frequency.setTargetAtTime(180 + t * 760, now, 0.12);
    this.#engineGain.gain.setTargetAtTime(t > 0.02 ? gain : 0, now, 0.1);
  }

  /** Stop the engine dead, used when a run ends. */
  stopEngine() {
    if (!this.#context || !this.#engineGain) return;
    this.#engineGain.gain.setTargetAtTime(0, this.#context.currentTime, 0.06);
  }

  /** A shot, shaped by the weapon kind. */
  fire({ kind = 'standard' } = {}) {
    if (!this.#context) return;
    if (kind === 'laser') {
      this.#tone({ from: 1200, to: 320, duration: 0.12, gain: 0.12, type: 'sine' });
      return;
    }
    if (kind === 'spread') {
      this.#noiseBurst({ duration: 0.14, gain: 0.2, filter: 1200, type: 'lowpass' });
      this.#tone({ from: 320, to: 90, duration: 0.14, gain: 0.14, type: 'square' });
      return;
    }
    if (kind === 'homing') {
      this.#noiseBurst({ duration: 0.3, gain: 0.16, filter: 700, type: 'bandpass', q: 1.6 });
      return;
    }
    // Standard bullets: a short, sharp down-chirp.
    this.#tone({ from: 240, to: 70, duration: 0.07, gain: 0.12, type: 'square' });
  }

  /** A hit, a kill, or a hit the player takes. */
  impact(kind = 'hit') {
    if (!this.#context) return;
    if (kind === 'kill') {
      this.#noiseBurst({ duration: 0.5, gain: 0.26, filter: 520, type: 'lowpass' });
      this.#tone({ from: 180, to: 40, duration: 0.4, gain: 0.2, type: 'sine' });
      return;
    }
    if (kind === 'damage') {
      this.#noiseBurst({ duration: 0.22, gain: 0.24, filter: 900, type: 'highpass' });
      return;
    }
    this.#noiseBurst({ duration: 0.1, gain: 0.16, filter: 1600, type: 'highpass' });
  }

  /** Pickups each get their own short, friendly blip. */
  pickup(kind = 'coin') {
    if (!this.#context) return;
    if (kind === 'powerup') {
      this.#tone({ from: 660, to: 660, duration: 0.08, gain: 0.12, type: 'triangle' });
      setTimeout(() => this.#tone({ from: 990, to: 990, duration: 0.1, gain: 0.12, type: 'triangle' }), 70);
      return;
    }
    if (kind === 'fuel') {
      this.#tone({ from: 440, to: 720, duration: 0.09, gain: 0.12, type: 'triangle' });
      return;
    }
    this.#tone({ from: 900, to: 1400, duration: 0.06, gain: 0.08, type: 'sine' });
  }

  /** Menu / interface interactions. */
  uiClick() {
    this.#tone({ from: 520, to: 660, duration: 0.05, gain: 0.06, type: 'triangle' });
  }

  /** The short, low two-note sting when the flight ends. */
  gameOver() {
    if (!this.#context) return;
    this.#tone({ from: 220, to: 110, duration: 0.3, gain: 0.16, type: 'sawtooth' });
    setTimeout(() => this.#tone({ from: 165, to: 55, duration: 0.5, gain: 0.14, type: 'sawtooth' }), 220);
  }

  /** An oscillator sweep into the effects bus. */
  #tone({ from = 440, to = 440, duration = 0.1, gain = 0.1, type = 'sine' } = {}) {
    if (!this.#context) return;
    const now = this.#context.currentTime;
    const osc = this.#context.createOscillator();
    const envelope = this.#context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, from), now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + duration);
    envelope.gain.setValueAtTime(gain, now);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(envelope);
    envelope.connect(this.#effects);
    osc.start(now);
    osc.stop(now + duration);
  }

  /** A filtered burst of shared white noise. */
  #noiseBurst({ duration = 0.15, gain = 0.15, filter = 1000, type = 'lowpass', q = 0.8 } = {}) {
    if (!this.#context) return;
    if (!this.#noise) {
      const buffer = this.#context.createBuffer(1, this.#context.sampleRate, this.#context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      this.#noise = buffer;
    }

    const now = this.#context.currentTime;
    const source = this.#context.createBufferSource();
    source.buffer = this.#noise;
    const band = this.#context.createBiquadFilter();
    band.type = type;
    band.frequency.value = filter;
    band.Q.value = q;
    const envelope = this.#context.createGain();
    envelope.gain.setValueAtTime(gain, now);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(band);
    band.connect(envelope);
    envelope.connect(this.#effects);
    source.start(now);
    source.stop(now + duration);
  }

  dispose() {
    if (this.#context) {
      this.#context.close().catch(() => {});
      this.#context = null;
    }
    this.#engineOsc = null;
    this.#engineGain = null;
    this.#engineFilter = null;
    this.#master = null;
    this.#effects = null;
    this.#noise = null;
  }
}