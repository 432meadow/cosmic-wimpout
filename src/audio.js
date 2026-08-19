/* Cosmic Wimpout — ambient bed for the menus.

   A slow drone plus occasional star sparkles. Deliberately quiet and slightly
   detuned: two oscillators a few cents apart beat against each other, which is
   what stops a sustained tone sounding like a test signal.

   iOS will not start an AudioContext outside a user gesture, so this can only
   begin after the first tap. start() is safe to call before then -- it simply
   does nothing until an unlocked context exists. */
(function (global) {
  'use strict';
  const CW = global.CW || (global.CW = {});

  // a minor-ish stack; low enough to sit under everything without masking blips
  const DRONE = [55, 82.5, 110, 164.81];
  // pitched down from the original set: the top octave read as sharp
  const SPARK = [784, 880, 1046, 1174, 1396, 1567];

  function Ambient(blips) {
    this.blips = blips;
    this.nodes = [];
    this.gain = null;
    this.timer = null;
    this.on = false;
  }

  Ambient.prototype.start = function () {
    if (this.on) return;
    const ac = this.blips.ensure();
    if (!ac || ac.state !== 'running') return;      // still locked; try again later
    this.on = true;

    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.045, ac.currentTime + 2.5);
    g.connect(ac.destination);
    this.gain = g;

    DRONE.forEach((f, i) => {
      // one pair per note, detuned against itself so the bed breathes
      for (const cents of [-4, 5]) {
        const o = ac.createOscillator();
        o.type = i < 2 ? 'sine' : 'triangle';
        o.frequency.setValueAtTime(f, ac.currentTime);
        o.detune.setValueAtTime(cents, ac.currentTime);
        const vg = ac.createGain();
        vg.gain.setValueAtTime(i < 2 ? 0.5 : 0.16, ac.currentTime);
        // very slow amplitude drift, so no two listens sound identical
        const lfo = ac.createOscillator();
        const lg = ac.createGain();
        lfo.frequency.setValueAtTime(0.03 + i * 0.017 + cents / 900, ac.currentTime);
        lg.gain.setValueAtTime(i < 2 ? 0.16 : 0.07, ac.currentTime);
        lfo.connect(lg); lg.connect(vg.gain);
        o.connect(vg); vg.connect(g);
        o.start(); lfo.start();
        this.nodes.push(o, lfo);
      }
    });

    this.schedule();
  };

  // star sparkles: sparse, random, never on a grid
  Ambient.prototype.schedule = function () {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.on) { this.sparkle(); this.schedule(); }
    }, 2200 + Math.random() * 4800);
  };

  /* Softened: the first version peaked at 0.05 with a 20ms attack and reached
     into the top octave, which read as a sharp ping over a quiet drone. Now it
     is a third of the level, eases in, and passes through a gentle lowpass so
     it arrives as a shimmer rather than a spike. */
  Ambient.prototype.sparkle = function () {
    const ac = this.blips.ctx;
    if (!ac || !this.blips.on || !this.gain) return;
    const f = SPARK[(Math.random() * SPARK.length) | 0];
    const t = ac.currentTime;

    const o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.Q.setValueAtTime(0.4, t);

    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 1.015, t + 0.8);

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.018, t + 0.09);   // slow enough not to click
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);

    o.connect(lp); lp.connect(g); g.connect(ac.destination);
    o.start(); o.stop(t + 1.6);
  };

  Ambient.prototype.stop = function () {
    if (!this.on) return;
    this.on = false;
    clearTimeout(this.timer);
    const ac = this.blips.ctx;
    if (this.gain && ac) {
      // fade rather than cut, or it clicks
      this.gain.gain.cancelScheduledValues(ac.currentTime);
      this.gain.gain.setValueAtTime(this.gain.gain.value || 0.04, ac.currentTime);
      this.gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.8);
    }
    const dying = this.nodes.slice();
    this.nodes = [];
    setTimeout(() => { for (const n of dying) { try { n.stop(); } catch (e) { /* already */ } } }, 900);
    this.gain = null;
  };

  CW.Ambient = Ambient;
})(window);
