/* Cosmic Wimpout — contextual hints.

   No scripted lesson and no rigged dice: the rules are explained at the moment
   the game actually applies them, over ordinary play. Each hint fires once ever
   and is remembered across sessions, so a returning player is never re-taught.

   Hints are non-blocking. Cosmic Wimpout already takes the choice away from you
   two thirds of the time (see ai.js on forced throws); a modal that also demands
   a tap before you may continue would be one interruption too many. */
(function (global) {
  'use strict';
  const CW = global.CW || (global.CW = {});

  const KEY = 'cw.hints.v1';
  const DWELL = 5200;          // ms on screen before it fades out
  const BOTTOM = 163;          // panel baseline, just clear of the message row

  const human = s => s.players[s.current].human;

  /* Event-driven hints come first so a dramatic moment is never pre-empted by a
     standing condition that happens to also be true. */
  const HINTS = [
    { id: 'supernova', when: (s, e) => e === 'supernova',
      text: 'SUPERNOVA. FIVE TENS IS TOO MANY POINTS AND YOU ARE OUT OF THE GAME' },
    { id: 'freight', when: (s, e) => e === 'freight',
      text: 'FREIGHT TRAIN. FIVE MATCHING FACES SCORE A HUNDRED TIMES THE FACE' },
    { id: 'flash', when: (s, e) => e === 'flash',
      text: 'FLASH. THREE MATCHING FACES IN ONE THROW SCORE TEN TIMES THE FACE VALUE' },
    { id: 'reroll', when: (s, e) => e === 'reroll',
      text: 'REROLL CLAUSE. YOU CANNOT KEEP THE FACE YOU FLASHED, SO IT GOES BACK FOR ANOTHER THROW' },
    { id: 'wimpout', when: (s, e) => e === 'wimpout',
      text: 'WIMPOUT. NO 5, NO 10 AND NO FLASH, SO THIS TURN SCORES NOTHING' },
    { id: 'bank', when: (s, e) => e === 'bank',
      text: 'BANKED POINTS ARE SAFE. NOTHING LATER IN THE GAME CAN TAKE THEM AWAY' },

    { id: 'roll', when: s => s.phase === 'READY' && s.turn.throws === 0 && human(s),
      text: 'ROLL TO THROW ALL FIVE CUBES' },
    { id: 'pick', when: s => s.phase === 'SELECT' && human(s) &&
                             s.turn.analysis && s.turn.analysis.optional.length > 0,
      text: 'THE LIT CUBES SCORE. TAP THE ONES YOU WANT TO KEEP, THEN TAKE' },
    { id: 'sun', when: s => s.phase === 'SELECT' && human(s) && s.turn.analysis &&
                            s.turn.analysis.optional.some(o => o.face === 'S'),
      text: 'THE BLACK SUN CUBE IS WILD. KEEP IT AS A 5 OR A 10, OR ROLL IT AGAIN' },
    { id: 'futtless', when: s => s.phase === 'READY' && s.turn.forbidden.length > 0 && human(s),
      text: 'FUTTLESS RULE. YOU MAY NOT BANK UNTIL YOU CLEAR THE FLASH' },
    { id: 'sweep', when: s => s.phase === 'READY' && s.turn.swept && human(s),
      text: 'ALL FIVE CUBES SCORED, SO YOU MUST PICK ALL FIVE BACK UP AND THROW AGAIN' },
    { id: 'need35', when: s => s.phase === 'READY' && human(s) &&
                               !s.players[s.current].onBoard && s.turn.points > 0,
      text: 'YOU NEED 35 TO GET ON THE BOARD. UNTIL THEN YOU CANNOT BANK' },
    { id: 'lastlicks', when: s => !!s.lastLicks,
      text: 'LAST LICKS. EVERY OTHER PLAYER GETS ONE FINAL TURN TO PASS THE LEADER' },
  ];

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch (e) { return {}; }                       // private mode, or corrupt
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S.seen)); } catch (e) { /* fine */ }
  }

  const S = {
    enabled: true,
    seen: load(),
    current: null,

    check(state, event, now) {
      if (!S.enabled || !state) return;
      for (const h of HINTS) {
        if (S.seen[h.id]) continue;
        let hit = false;
        try { hit = !!h.when(state, event); } catch (e) { hit = false; }
        if (!hit) continue;
        S.seen[h.id] = 1;
        save();
        S.current = { text: h.text, until: (now || performance.now()) + DWELL };
        return h.id;
      }
      return null;
    },

    draw(scr, t) {
      const c = S.current;
      if (!c) return;
      if (t > c.until) { S.current = null; return; }

      const lines = CW.ui.wrap(c.text, Math.floor((scr.w - 44) / 4));
      const wide = lines.reduce((m, l) => Math.max(m, scr.textWidth(l)), 0);
      const h = lines.length * 8 + 7;
      // Anchor the bottom and grow upward, so a two-line hint never creeps down
      // onto the message row however long the text runs.
      const top = BOTTOM - h;
      const y = top + 4;
      const x = Math.round(scr.w / 2 - wide / 2) - 6;

      scr.roundRect(x, top, wide + 12, h, [2, 1], 0);
      scr.roundFrame(x, top, wide + 12, h, [2, 1], 1);
      // fade the last moment so it reads as leaving rather than vanishing
      const ink = (c.until - t) < 700 && Math.sin(t * 0.02) < 0 ? 2 : 3;
      lines.forEach((l, i) => scr.textCenter(l, scr.w / 2, y + i * 8, ink));
    },

    setEnabled(on) { S.enabled = !!on; if (!on) S.current = null; },
    forget() { S.seen = {}; S.current = null; save(); },
    seenCount() { return Object.keys(S.seen).length; },
    total: HINTS.length,
  };

  CW.hints = S;
})(window);
