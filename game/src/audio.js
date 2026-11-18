// Synthesized sound only: a ~100 BPM A-minor groove (bass, kick, hats,
// pads) plus effects. No audio files, no network. Everything is guarded
// so a browser without audio still plays fine.
export function createAudio() {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let engineOsc = null;
  let engineGain = null;
  let muted = false;
  let nextNote = 0;
  let step = 0;
  let timer = null;

  const BPM = 100;
  const BEAT = 60 / BPM;
  // A-minor bass line, one note per beat, two bars.
  const BASS = [55, 55, 65.41, 49, 55, 55, 82.41, 65.41];
  // Pad chords (Am, F, C, G) as frequency triples.
  const PADS = [
    [220, 261.63, 329.63],
    [174.61, 220, 261.63],
    [196, 246.94, 293.66],
    [164.81, 196, 246.94],
  ];

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.32;
      musicGain.connect(master);
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 42;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 320;
      engineOsc.connect(lp);
      lp.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      nextNote = ctx.currentTime + 0.1;
      timer = window.setInterval(schedule, 90);
      return true;
    } catch (e) {
      return false;
    }
  }

  function tone(freq, t, dur, type, gain, dest) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(dest || musicGain);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function hat(t) {
    const len = 0.05;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.value = 0.12;
    src.connect(hp);
    hp.connect(g);
    g.connect(musicGain);
    src.start(t);
  }

  function schedule() {
    if (!ctx || muted) return;
    if (nextNote < ctx.currentTime - 0.1) nextNote = ctx.currentTime + 0.05;
    while (nextNote < ctx.currentTime + 0.25) {
      const t = nextNote;
      const beatInBar = step % 8;
      if (beatInBar === 0 || beatInBar === 4) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(120, t);
        o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.5, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        o.connect(g);
        g.connect(musicGain);
        o.start(t);
        o.stop(t + 0.2);
      }
      hat(t);
      if (step % 2 === 0) hat(t + BEAT / 2);
      tone(BASS[beatInBar], t, BEAT * 0.9, 'triangle', 0.4);
      if (beatInBar === 0) {
        const chord = PADS[Math.floor(step / 8) % 4];
        for (const f of chord) tone(f, t, BEAT * 8, 'sine', 0.05);
      }
      step += 1;
      nextNote += BEAT;
    }
  }

  function blip(freq, dur, type, gain) {
    if (!ensure() || muted) return;
    tone(freq, ctx.currentTime, dur, type, gain, master);
  }

  function noiseBurst(dur, gain) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(master);
    src.start(t);
  }

  return {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); },
    setMuted(m) {
      muted = m;
      if (master) master.gain.value = m ? 0 : 0.5;
    },
    isMuted() { return muted; },
    setEngine(speed01) {
      if (!ctx || !engineOsc) return;
      engineOsc.frequency.value = 42 + speed01 * 110;
      engineGain.gain.value = muted ? 0 : 0.03 + speed01 * 0.05;
    },
    shoot() {
      noiseBurst(0.09, 0.5);
      if (!ctx || muted) return;
      tone(180, ctx.currentTime, 0.08, 'square', 0.18, master);
    },
    hit() { blip(520, 0.07, 'square', 0.2); },
    pickup() {
      if (!ensure() || muted) return;
      const t = ctx.currentTime;
      tone(660, t, 0.1, 'sine', 0.25, master);
      tone(880, t + 0.09, 0.16, 'sine', 0.25, master);
    },
    reload() { blip(300, 0.08, 'square', 0.15); },
    busted() {
      if (!ensure() || muted) return;
      const t = ctx.currentTime;
      tone(392, t, 0.18, 'sawtooth', 0.2, master);
      tone(311, t + 0.18, 0.3, 'sawtooth', 0.2, master);
    },
  };
}
