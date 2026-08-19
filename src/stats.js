/* Cosmic Wimpout — lifetime records.

   Solo play needs something that accumulates across sessions, otherwise every
   match starts and ends in a vacuum. Turn-level records track the human only:
   an Oracle's lucky flash is not the player's achievement. */
(function (global) {
  'use strict';
  const CW = global.CW || (global.CW = {});

  const KEY = 'cw.stats.v1';
  const BLANK = {
    games: 0, wins: 0,
    bestTurn: 0, bestFlash: 0, bestGame: 0,
    flashes: 0, freights: 0, supernovas: 0, wimpouts: 0, trainWrecks: 0,
  };

  function load() {
    try {
      const o = JSON.parse(localStorage.getItem(KEY));
      return o && typeof o === 'object' ? Object.assign({}, BLANK, o) : Object.assign({}, BLANK);
    } catch (e) { return Object.assign({}, BLANK); }
  }

  const S = {
    data: load(),

    save() {
      try { localStorage.setItem(KEY, JSON.stringify(S.data)); } catch (e) { /* fine */ }
    },

    // an event the human caused; `n` carries points where the record is a max
    note(kind, n) {
      const d = S.data;
      if (kind === 'flash') { d.flashes++; if (n > d.bestFlash) d.bestFlash = n; }
      else if (kind === 'bank') { if (n > d.bestTurn) d.bestTurn = n; }
      else if (kind === 'freight') d.freights++;
      else if (kind === 'supernova') d.supernovas++;
      else if (kind === 'wimpout') { d.wimpouts++; if (n) d.trainWrecks++; }
      S.save();
    },

    gameOver(state) {
      const d = S.data;
      d.games++;
      if (state.winner === 0) d.wins++;
      const mine = state.players[0].banked;
      if (mine > d.bestGame) d.bestGame = mine;
      S.save();
    },

    reset() { S.data = Object.assign({}, BLANK); S.save(); },
    any() { return S.data.games > 0 || S.data.bestTurn > 0; },
  };

  CW.stats = S;
})(window);
