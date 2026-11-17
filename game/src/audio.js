// Port Meridian — all sound synthesized with WebAudio. No audio files.
// Engine hum, siren, one-shot effects, and a quiet chord-loop music bed
// that turns tenser while the wanted level is 3 or more.
export function makeAudio() {
  const audio = {
    ctx: null, master: null, musicGain: null, engineOsc: null, engineGain: null,
    sirenOsc: null, sirenGain: null, sirenLfo: null, musicTimer: null,
    volume: 0.7, muted: false, musicStep: 0, chordIdx: 0,
    chords: [[110, 130.8, 164.8], [87.3, 110, 130.8], [98, 123.5, 146.8], [82.4, 98, 123.5]],
    tenseChords: [[110, 130.8, 155.6], [103.8, 123.5, 155.6], [98, 116.5, 146.8], [92.5, 110, 138.6]],

    init() {
      if (this.ctx) return;
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
        // Engine: sawtooth through a low-pass filter.
        this.engineOsc = this.ctx.createOscillator();
        this.engineOsc.type = 'sawtooth';
        this.engineOsc.frequency.value = 50;
        const engineFilter = this.ctx.createBiquadFilter();
        engineFilter.type = 'lowpass';
        engineFilter.frequency.value = 400;
        this.engineGain = this.ctx.createGain();
        this.engineGain.gain.value = 0;
        this.engineOsc.connect(engineFilter);
        engineFilter.connect(this.engineGain);
        this.engineGain.connect(this.master);
        this.engineOsc.start();
        // Siren: sine with a slow LFO sweeping its pitch.
        this.sirenOsc = this.ctx.createOscillator();
        this.sirenOsc.type = 'sine';
        this.sirenOsc.frequency.value = 700;
        this.sirenLfo = this.ctx.createOscillator();
        this.sirenLfo.type = 'sine';
        this.sirenLfo.frequency.value = 0.6;
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = 250;
        this.sirenLfo.connect(lfoGain);
        lfoGain.connect(this.sirenOsc.frequency);
        this.sirenGain = this.ctx.createGain();
        this.sirenGain.gain.value = 0;
        this.sirenOsc.connect(this.sirenGain);
        this.sirenGain.connect(this.master);
        this.sirenOsc.start();
        this.sirenLfo.start();
        // Music bed: bass note + three-note arpeggio, cycling four chords.
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.12;
        this.musicGain.connect(this.master);
        this.musicTimer = setInterval(() => this.musicTick(), 420);
      } catch (e) { /* audio is optional; the game plays without it */ }
    },

    musicTick() {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const tense = (window.__game?.police?.wanted ?? 0) >= 3;
      const chords = tense ? this.tenseChords : this.chords;
      const chord = chords[this.chordIdx % chords.length];
      this.chordIdx++;
      const step = this.musicStep++;
      const t = this.ctx.currentTime;
      const play = (freq, when, dur, type, vol) => {
        const o = this.ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(vol, when + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, when + dur);
        o.connect(g);
        g.connect(this.musicGain);
        o.start(when);
        o.stop(when + dur + 0.05);
      };
      if (step % 4 === 0) play(chord[0] / 2, t, 1.6, 'triangle', 0.5);
      play(chord[step % 3] * 2, t, 0.35, 'sine', 0.22);
      if (step % 2 === 0) play(6000, t, 0.05, 'square', 0.02); // soft hat tick
    },

    setEngine(speed, maxSpeed) {
      if (!this.ctx) return;
      const k = Math.abs(speed) / Math.max(1, maxSpeed);
      this.engineOsc.frequency.setTargetAtTime(50 + k * 160, this.ctx.currentTime, 0.08);
      this.engineGain.gain.setTargetAtTime(0.02 + k * 0.05, this.ctx.currentTime, 0.1);
    },

    siren(on) {
      if (!this.ctx) return;
      this.sirenGain.gain.setTargetAtTime(on ? 0.05 : 0, this.ctx.currentTime, 0.3);
    },

    setVolume(v) {
      this.volume = v;
      if (this.master) this.master.gain.value = v;
    },

    blip(freq = 440, dur = 0.12, type = 'sine', vol = 0.2) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.02);
    },

    noise(dur = 0.15, vol = 0.3, freq = 800) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const len = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.value = vol;
      src.connect(f);
      f.connect(g);
      g.connect(this.master);
      src.start(t);
    },

    gunshot() { this.noise(0.18, 0.5, 1200); this.blip(120, 0.12, 'square', 0.3); },
    punch() { this.noise(0.1, 0.35, 300); this.blip(90, 0.1, 'sine', 0.3); },
    crash() { this.noise(0.3, 0.45, 500); this.blip(60, 0.25, 'sawtooth', 0.25); },
    chime() { this.blip(880, 0.15, 'sine', 0.25); setTimeout(() => this.blip(1320, 0.2, 'sine', 0.22), 90); },
    token() { this.blip(1046, 0.1, 'sine', 0.25); setTimeout(() => this.blip(1568, 0.18, 'sine', 0.22), 70); },
    fanfare() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.25, 'triangle', 0.25), i * 110)); },
    missionComplete() { [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => this.blip(f, 0.3, 'triangle', 0.25), i * 120)); },
    busted() { [400, 350, 300, 200].forEach((f, i) => setTimeout(() => this.blip(f, 0.35, 'sawtooth', 0.2), i * 160)); },
    ui() { this.blip(660, 0.07, 'sine', 0.15); },
    footstep() { this.noise(0.05, 0.08, 400); },
  };
  return audio;
}
