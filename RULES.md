# Cosmic Wimpout — Rules Reference

Compiled for a Three.js recreation. Sourced primarily from the official rules sheet
(cosmicwimpout.com "How To Play"), the official FAQ and "More Fun Rules" pages, and
*Cosmic Wimpout: History and Design* (Chris M. Anderson, 2020) for the physical design.

Designed by the Cosmic Wimpout Clubhouse (C3, Inc.), circa 1975–76.

---

## 1. Components

**Five six-sided cubes.** Four "Common Cubes" (traditionally white) and one **Sun Cube**
(traditionally black or red, visually distinct).

### Face values

| Value | Symbol (current design) | Historical variants |
|---|---|---|
| 2 | Two shooting stars w/ comet tails | stars → flying saucers ("kiwis") → half moons → shooting stars |
| 3 | Three triangles / "pyramids" | briefly with an Eye-of-Providence detail ("Hot Foil" set) |
| 4 | Four-pointed starburst | also described as lightning bolts |
| 5 | Stylized numeral **5** | — |
| 6 | Six stars | — |
| 10 | Stylized numeral **10** | — |

**The Sun Cube replaces the `3` face with the Flaming Sun.** Its faces are therefore
`2, SUN, 4, 5, 6, 10` — it can never roll a 3.

### Physical note for the 3D model

Cosmic Wimpout cubes are **not** laid out like standard dice — opposite faces do *not*
sum to seven, and symbol placement was historically randomized per cube. (Early
manufacturers wanted to charge extra to arrange them conventionally; the designers
declined.) So: use a per-die face→normal map rather than assuming a standard d6 layout.
If you want authenticity, generate a different arrangement per cube.

**Rolling surface:** a felt/cloth board with a large sun in the centre and a score track
running around the perimeter in increments of 10. Later sets use a circular, lap-based
scorepad.

---

## 2. Scoring

### Singles

Only **5** and **10** score on their own — 5 and 10 points respectively.
`2`, `3`, `4`, `6` are worth nothing individually or as pairs.

### Flash — three matching faces **on the same throw**

Worth **10 × face value**:

| Flash | Points |
|---|---|
| Three 2s | 20 |
| Three 3s | 30 |
| Three 4s | 40 |
| Three 5s | 50 |
| Three 6s | 60 |
| Three 10s | 100 |

A flash must appear in a *single* throw. Assembling three of a kind across several rolls
in a turn is **not** a flash.

A **fourth** matching die in the same throw is **non-scoring** — it does not extend or
increase the flash. (Official example: `4 4 4 4 5` = 45 points — the flash of 40, the 5,
and the fourth starburst worth nothing.)

### Freight Train — five matching faces on the same throw

Worth **100 × face value**:

| Freight Train | Result |
|---|---|
| Five 2s | 200 |
| Five 4s | 400 |
| Five 5s | 500 |
| Five 6s | **Instant win** — game over |
| Five 10s | **Supernova** — "too many points", you are instantly out of the game |

> **Five 3s (300) is absent from the official chart.** Almost certainly because the Sun
> Cube has no `3` face, so a natural pyramid freight train is impossible. Under ruling A
> (§5) the Sun cannot complete a train either, so **a 300 freight train cannot occur in
> our implementation at all** — the official chart is complete as printed.

### The Flaming Sun (wild)

The Sun can be used as:
- a **5 or a 10** — and you *must* take it as one of these if it is the only scoring cube
  in that roll (otherwise you would wimp out);
- part of a **flash**;
- a **non-scoring cube**, which is then re-rolled.

It **cannot** complete a Freight Train — see ruling A in §5.

**The Flaming Sun Rule:** if you roll the Sun together with a **pair**, you *must* make it
a flash. This is not optional, and it drags the Futtless Rule (below) along with it.

---

## 3. Turn structure

1. Roll all five cubes.
2. Set aside the scoring cubes. **You may not un-set a scoring die you have taken.**
3. Either **stop and bank** your accumulated turn points, or **roll the remaining
   non-scoring cubes** and push your luck — *except* where a rule below forces you to roll.
4. Any roll that produces **no 5, no 10, no flash and no freight train** is a **Wimpout**.
   Your turn ends and you lose *everything accumulated that turn*. Banked points are never
   lost. Wimping out on a five-cube roll is a **Train Wreck**.

### The three forced-roll rules

**Opening Roll — 35 to get in.** You need at least 35 points before you can bank anything.
Below 35 you must keep rolling the non-scoring cubes until you reach it, or wimp out.

> Note: the maximum non-flash single roll is 30 (`10 10 5 5 x`), so **you cannot open
> without a flash unless you accumulate across several rolls.** 35 is deliberately set
> just above that ceiling.

**You May Not Want To But You Must (Y.M.N.W.T.B.Y.M.).** If at any point all five dice
have been set aside as scoring, you must pick all five up and roll again. Points carry
forward and accumulate.

**The Futtless Rule — all flashes must be cleared.** After a flash you cannot stop. You
must score additional points by rolling the non-scoring cubes (or all five, if all five
scored) — or wimp out.

- **Reroll Clause:** while clearing, you may not match any of the flash faces. If you do,
  you must reroll, *"until you can keep 'em or Wimp out."*

> **This is a re-throw, not a loss.** Matching a flash face sends those cubes back to be
> thrown again — it does not end your turn. You only wimp out when a throw yields no score
> *and* no cube matched a flash face. Getting this wrong makes the game far harsher than it
> is: with five cubes and both 5s and 10s forbidden, treating a match as a wimpout gives a
> 72% bust rate against the correct 44%.
>
> A consequence worth noticing: **flashing a face that doesn't score is protective.** With
> 4s forbidden a five-cube throw busts only 2% of the time, against 5.8% with nothing
> forbidden, because every 4 you roll buys a free re-throw instead of killing the turn.

---

## 4. Ending the game

Agree a **Game Goal** up front — traditionally **300 or 500** points. (The classic
scorepad begins at 35 and triggers the endgame when a total exceeds 300; some boards go
to 1200.)

Two published endings:

- **Last Licks** (default): when a player reaches the goal, every other player gets one
  last chance to catch and pass the leader. If the leader *is* passed, the previous leader
  gets another chance. Continues until all but one player has failed.
- **End Game** (simpler variant): everyone gets exactly one final turn after the goal is
  reached. Highest score wins, no further attempts.

Two instant results override all of this: a **Freight Train of 6s** wins immediately, and
a **Supernova** (five 10s) eliminates that player immediately.

---

## 5. Resolved rulings

House decisions, settled 2026-08-09. Each should be a flag in the engine so we can flip it
later without surgery.

| # | Question | Ruling |
|---|---|---|
| A | Can the Sun complete a Freight Train? | **No.** Five natural matching faces only. |
| B | Two pairs + Sun — which pair does it join? | **Player's choice.** |
| C | Reroll Clause scope | **Only the offending dice.** Dice that scored in the same batch are kept. |
| D | Does the Sun match a flash face while clearing? | **Never.** It scores as 5 or 10 and clears the flash. |
| E | Full House, Cosmic Sampler, board-position rules | **Out of scope for v1.** Build as toggleable flags later. |
| F | Do points accumulate across rolls in a turn? | **Yes.** The official example's arithmetic is simply wrong. |
| G | Must you set aside every scoring die? | **No — free choice, minimum one.** With the caveat below. |

### G's consequence: flashes must stay mandatory

Free choice of set-aside dice is a real departure from the printed rules, and taken
literally it would gut the game. If a flash could be *declined*, a player would simply
refuse it to dodge the Futtless Rule — and the Flaming Sun Rule's "you **must** make a
flash" would mean nothing at all.

So the ruling is split:

- **Flashes and Freight Trains are mandatory.** Roll one, you take it, and you owe the
  Futtless obligation that comes with it.
- **Loose 5s, 10s and the Sun are optional.** Decline them to keep more cubes live.
- **At least one scoring die must be taken** per throw.

A side effect: this makes the printed "the Sun must score if it is the only scoring cube"
rule redundant — if the Sun is the only scorer, minimum-one already forces it.

### A structural fact worth knowing

**All five dice scoring always implies a flash or a freight train.** Proof: without a
flash, every die must individually be a 5, 10 or Sun. There is only one Sun Cube, so at
least four dice come from `{5, 10}`, and a cap of two each (three would be a flash) forces
exactly `5 5 10 10 SUN` — at which point the Flaming Sun Rule fires on a pair and forces a
flash anyway.

Consequence: **Y.M.N.W.T.B.Y.M. and the Futtless Rule always co-occur.** There is no such
thing as a clean five-dice sweep. Under ruling G a player may decline loose dice to avoid
triggering YMNWTBYM — but never to escape Futtless.

### Difficulty note

C, D and G all landed on the more forgiving side, and they compound: clearing a flash is
now substantially easier than in the printed game, and declining dice hands the player real
control over risk. Expect longer turns and faster-climbing scores. Worth playtesting the
Game Goal — **500 may suit this ruleset better than 300.**

---

## 6. Optional / house rules

The game explicitly invites this — **The Guiding Light** says any new rule may be added at
any time provided all players agree, taking effect the next time the situation arises.

| Rule | Effect |
|---|---|
| **Full House ("Amherst Rule")** | After a flash, rolling a pair on the two remaining cubes earns a bonus roll or turn — but you must still clear the flash. |
| **Cosmic Sampler** | Five non-matching dice score 25. |
| **And Where Do You Think You're Going? / Keep Rolling** | No two players may occupy the same space on the board. If your score would land on an occupied space, you must roll on. |
| **No Eclipse** | You may not take a score that puts you in a direct line with another player's marker through the sun at the centre of the board. |
| **You're Going To Where I Just Came From** | Scoring exactly enough to "tag" an opponent swaps the two players' positions. |
| **Wellenda** | Re-roll if the dice touch an opponent's marker or land stacked on each other. |

Most of these are board-position rules and only matter if we build the physical score
track rather than a plain numeric scoreboard.

---

## 7. Implementation sketch

### Turn state machine

```
IDLE
 └─ ROLL(all 5)
     ├─ no scoring dice ................. WIMPOUT (Train Wreck if 5 cubes)
     └─ scoring dice
         └─ SELECT
             │   flashes / freight trains applied automatically (mandatory)
             │   loose 5s, 10s and the Sun offered as choices (min. one die total)
             ├─ forced: turnTotal < 35 ........... must ROLL
             ├─ forced: unclearedFlash ........... must ROLL   (Futtless)
             ├─ forced: allFiveSetAside .......... must ROLL all 5 (YMNWTBYM)
             └─ optional: BANK  or  ROLL(remaining)
```

Note the ordering: a flash that also uses up all five dice triggers Futtless *and*
YMNWTBYM — you pick up all five and the flash is still uncleared. Per the structural fact
in §5 this is not an edge case but the *only* way to sweep all five dice.

### State to track

- `bankedScore[player]` — permanent, never lost
- `turnScore` — forfeited on wimpout
- `diceSetAside[]` / `diceInHand[]`
- `activeFlashFaces[]` — for the Reroll Clause; emptied once the flash is cleared. Note
  this can hold more than one face if a second flash lands before the first is cleared
- `mustRoll` — derived from the three forced-roll rules
- `isOnBoard[player]` — has cleared the 35-point opening
- `eliminated[player]` — supernova

### Scoring a throw

Resolve in this order — the mandatory tier first, then offer the optional tier as choices.

**Mandatory tier**

1. Five natural matching faces → Freight Train. Five 6s wins the game, five 10s is a
   Supernova. Done, nothing further to resolve. (The Sun never participates — ruling A.)
2. Three matching faces → Flash. Must be taken. Any 4th matching die is **non-scoring** and
   returns to the hand.
3. Sun present **and** a pair on the table → forced flash (Flaming Sun Rule). If two pairs
   are available, the player picks which (ruling B).

**Optional tier** — the player may take any subset, including none, provided at least one
scoring die is taken overall.

4. The Sun, as either 5 or 10.
5. Each loose 5 and 10.

**Then:** if nothing at all scored → Wimpout (Train Wreck if it was a five-cube throw).

Because steps 3–5 involve genuine player choice, the engine should **enumerate legal
scoring selections** for a throw rather than auto-scoring it — otherwise it will silently
make choices the player wanted to make differently. A reasonable shape:

```
legalSelections(throw, activeFlashFaces) -> Selection[]
   // each Selection = { dice: DieRef[], points: number, mandatory: boolean }
```

### Reroll Clause check (ruling C + D)

Applied to each batch as it lands, while `activeFlashFaces` is non-empty:

- A die matching any face in `activeFlashFaces` is **illegal to keep** and must be
  re-thrown — but **only that die**. Others in the same batch are unaffected and may be
  kept or scored normally.
- The Sun is **never** a match, whatever was flashed. It can score as 5 or 10 and thereby
  clear the flash.
- The flash is cleared — and `activeFlashFaces` emptied — as soon as the player banks any
  additional points from a clean batch.

---

## Sources

- [Cosmic Wimpout — How To Play (official rules sheet, PDF)](https://jmac.org/gamelab2011/cosmic_wimpout.pdf)
- [How to Play — cosmicwimpout.com](https://cosmicwimpout.com/how-to-play)
- [FAQ — cosmicwimpout.com](https://cosmicwimpout.com/p/8/FAQ)
- [More Fun Rules — cosmicwimpout.com](https://cosmicwimpout.com/p/5/More-Fun-Rules)
- [Cosmic Wimpout: History and Design, Chris M. Anderson, 2020 (PDF)](http://dicecollector.com/docs/diceinfo_cosmic_wimpout_history_chris_anderson.pdf)
- [Cosmic Wimpout — Wikipedia](https://en.wikipedia.org/wiki/Cosmic_Wimpout)
- [Cosmic Wimpout — gambiter.com](https://gambiter.com/dice/Cosmic_wimpout.html)
