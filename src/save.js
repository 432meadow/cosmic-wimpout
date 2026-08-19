/* Cosmic Wimpout — match persistence.

   A phone will interrupt you mid-match: a call, a notification, iOS reclaiming
   memory from a backgrounded tab. Losing a game 200 points into a race is the
   difference between a page and an app, so the whole match is written to
   localStorage and picked back up on a cold start.

   The engine state is deliberately plain data with no functions or cycles, which
   is what makes this a stringify rather than a serialiser. The view snapshot
   rides along because set-aside cubes have no recorded face once `turn.result`
   is cleared on confirm -- without it, a restored board would come back blank. */
(function (global) {
  'use strict';
  const CW = global.CW || (global.CW = {});

  const KEY = 'cw.save.v1';
  const VERSION = 1;

  // Enough of a shape check that a half-written or stale record is discarded
  // rather than crashing the boot.
  function valid(s) {
    return !!s && Array.isArray(s.players) && s.players.length >= 2 &&
           s.players.every(p => p && typeof p.name === 'string' &&
                                typeof p.banked === 'number') &&
           !!s.turn && Array.isArray(s.turn.hand) &&
           Array.isArray(s.turn.forbidden) &&
           typeof s.phase === 'string' && typeof s.current === 'number' &&
           s.current >= 0 && s.current < s.players.length;
  }

  const S = {
    write(state, view) {
      if (!state) return;
      try {
        localStorage.setItem(KEY, JSON.stringify({
          v: VERSION,
          at: Date.now(),
          state: state,
          faces: view ? view.faces : {},
          aside: view ? view.aside : {},
        }));
      } catch (e) { /* private mode or quota: play on, just without a save */ }
    },

    read() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const o = JSON.parse(raw);
        if (!o || o.v !== VERSION || !valid(o.state)) return null;
        return o;
      } catch (e) { return null; }
    },

    clear() { try { localStorage.removeItem(KEY); } catch (e) { /* fine */ } },
  };

  CW.save = S;
})(window);
