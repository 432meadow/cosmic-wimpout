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

  const DRONE_LEVEL = 0.045;     // drone, under the master
  const SPARK_LEVEL = 0.018;     // sparkle peak, also under the master
  const FADE_IN = 2.5;
  const FADE_OUT = 2.0;          // -24 dB/s; 0.8s read as a cut, not a fade

  // a minor-ish stack; low enough to sit under everything without masking blips
  const DRONE = [55, 82.5, 110, 164.81];
  // pitched down from the original set: the top octave read as sharp
  const SPARK = [784, 880, 1046, 1174, 1396, 1567];

  /* One master gain carries the whole bed -- drone AND sparkles -- so a fade
     takes everything with it. Sparkles used to connect straight to the
     destination, which meant one still ringing when you started a game carried
     on at full volume over the board while the drone faded underneath it. */
  function Ambient(blips) {
    this.blips = blips;
    this.nodes = [];
    this.master = null;
    this.timer = null;
    this.on = false;
  }

  Ambient.prototype.start = function () {
    if (this.on) return;
    const ac = this.blips.ensure();
    if (!ac || ac.state !== 'running') return;      // still locked; try again later
    this.on = true;

    const master = ac.createGain();
    master.gain.setValueAtTime(0.0001, ac.currentTime);
    master.gain.exponentialRampToValueAtTime(1, ac.currentTime + FADE_IN);
    master.connect(ac.destination);
    this.master = master;

    const g = ac.createGain();               // drone bus, under the master
    g.gain.setValueAtTime(DRONE_LEVEL, ac.currentTime);
    g.connect(master);

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
    if (!ac || !this.blips.on || !this.master) return;
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
    g.gain.exponentialRampToValueAtTime(SPARK_LEVEL, t + 0.09);  // slow enough not to click
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);

    o.connect(lp); lp.connect(g); g.connect(this.master);   // fades with the bed
    o.start(); o.stop(t + 1.6);
  };

  Ambient.prototype.stop = function () {
    if (!this.on) return;
    this.on = false;
    clearTimeout(this.timer);
    const ac = this.blips.ctx;
    if (this.master && ac) {
      const now = ac.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(Math.max(0.0001, this.master.gain.value), now);
      this.master.gain.exponentialRampToValueAtTime(0.0001, now + FADE_OUT);
    }
    const dying = this.nodes.slice();
    this.nodes = [];
    // outlive the fade, or the oscillators are cut mid-ramp
    setTimeout(() => { for (const n of dying) { try { n.stop(); } catch (e) { /* already */ } } },
               FADE_OUT * 1000 + 300);
    this.master = null;
  };

  CW.Ambient = Ambient;
})(window);
