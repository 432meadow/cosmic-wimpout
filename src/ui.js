/* Cosmic Wimpout — shared widgets. Every scene lays out touch targets through
   this, so button size and hit-testing are defined in exactly one place. */
(function (global) {
  'use strict';
  const CW = global.CW || (global.CW = {});

  // 26 logical px clears Apple's 44pt minimum at iPhone landscape scale (~1.8x).
  const BTN_H = 26;
  const CORNER = [4, 2, 1];

  function Buttons() { this.list = []; }

  Buttons.prototype.clear = function () { this.list.length = 0; return this; };

  Buttons.prototype.add = function (label, x, y, w, action, opts) {
    opts = opts || {};
    this.list.push({
      label: label, action: action,
      x: Math.round(x), y: Math.round(y),
      w: Math.round(w), h: opts.h || BTN_H,
      enabled: opts.enabled !== false,
      scale: opts.scale || 2,
      quiet: !!opts.quiet,               // low-emphasis (back, menu)
    });
    return this;
  };

  // A centred row of equal-width buttons.
  Buttons.prototype.row = function (cx, y, w, items, gap) {
    gap = gap == null ? 12 : gap;
    const total = items.length * w + (items.length - 1) * gap;
    let x = cx - total / 2;
    for (const it of items) { this.add(it.label, x, y, w, it.action, it); x += w + gap; }
    return this;
  };

  // A centred vertical stack, for menus.
  Buttons.prototype.stack = function (cx, y, w, items, gap) {
    gap = gap == null ? 8 : gap;
    let cy = y;
    for (const it of items) {
      this.add(it.label, cx - w / 2, cy, w, it.action, it);
      cy += (it.h || BTN_H) + gap;
    }
    return this;
  };

  Buttons.prototype.draw = function (scr) {
    for (const b of this.list) {
      const lit = b.enabled;
      const fill = b.quiet ? 0 : (lit ? 1 : 0);
      const edge = lit ? (b.quiet ? 2 : 3) : 1;
      scr.roundRect(b.x, b.y, b.w, b.h, CORNER, fill);
      scr.roundFrame(b.x, b.y, b.w, b.h, CORNER, edge);
      const th = 5 * b.scale;
      scr.textCenter(b.label, b.x + b.w / 2, b.y + Math.round((b.h - th) / 2),
                     lit ? (b.quiet ? 2 : 3) : 1, b.scale);
    }
  };

  function inside(b, x, y) {
    return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
  }

  Buttons.prototype.hit = function (x, y) {
    for (const b of this.list) if (b.enabled && inside(b, x, y)) return b.action;
    return null;
  };

  /* Greedy wrap at the 3x5 font, which is a fixed 4px per character including
     its trailing gap. Returns an array of lines. */
  function wrap(text, maxChars) {
    const out = [];
    for (const para of String(text).split('\n')) {
      if (!para) { out.push(''); continue; }
      let line = '';
      for (const word of para.split(' ')) {
        if (!line) line = word;
        else if (line.length + 1 + word.length <= maxChars) line += ' ' + word;
        else { out.push(line); line = word; }
      }
      out.push(line);
    }
    return out;
  }

  CW.ui = { Buttons, BTN_H, wrap, inside };
})(window);
