/* Cosmic Wimpout — scene registry.

   Everything that owns a full screen (menu, rules, the board) registers here and
   the shell in game.js routes the loop and input to whichever is active. Scenes
   are plain objects; every hook is optional:

     enter(opts)   activated
     exit()        deactivated
     tick(now)     per-frame logic
     draw(scr, t)  render
     press(x, y)   pointer down, logical coords; return true if handled
     key(k, e)     keydown, lowercased key; return true if handled
*/
(function (global) {
  'use strict';
  const CW = global.CW || (global.CW = {});
  const map = {};

  const S = {
    name: '',
    active: null,
    prev: '',

    register(name, scene) { map[name] = scene; return scene; },
    has(name) { return !!map[name]; },

    go(name, opts) {
      const next = map[name];
      if (!next) throw new Error('unknown scene: ' + name);
      if (S.active === next) return;
      if (S.active && S.active.exit) S.active.exit();
      S.prev = S.name;
      S.name = name;
      S.active = next;
      if (next.enter) next.enter(opts || {});
    },

    back(fallback) { S.go(S.prev || fallback || 'menu'); },

    tick(now) { if (S.active && S.active.tick) S.active.tick(now); },
    draw(scr, t) { if (S.active && S.active.draw) S.active.draw(scr, t); },
    press(x, y) { return !!(S.active && S.active.press && S.active.press(x, y)); },
    key(k, e) { return !!(S.active && S.active.key && S.active.key(k, e)); },
  };

  CW.scenes = S;
})(window);
