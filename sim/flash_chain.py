#!/usr/bin/env python3
"""
Cosmic Wimpout — Monte Carlo analysis.

Originally written to test one question: does a "flash chain" mechanic (each
flash landed while a previous one is uncleared stacks a multiplier and forbids
another face) have a risk curve worth building a roguelike on?

It also now measures the base game, because the first version of this sim got
the Reroll Clause wrong in the same way the game engine did -- see below.

THE REROLL CLAUSE
-----------------
The printed rule: while clearing a flash you may not keep a cube showing a flash
face, and if you roll one you "must reroll ... until you can keep 'em or Wimp
out." That is a RE-THROW, not a loss. The earlier model treated a matching cube
as simply dead, so a throw with nothing else scoring ended the turn. That
overstates how punishing the game is, and it inverts one conclusion outright:
forbidding a face that does not score is *protective*, because every time you
roll it you get a free re-throw instead of busting.

Pass --legacy to reproduce the old (incorrect) model for comparison.

Rules per RULES.md §5:
  A  Sun face cannot complete a Freight Train (a natural 10 on the Sun Cube can)
  B  Two pairs + Sun -> player picks (modelled as: highest-value flash)
  C  Reroll Clause re-throws only the offending dice
  D  The Sun face never matches a flash face
  G  Flashes/trains mandatory; loose 5s, 10s and the Sun optional, min. one die
"""
import argparse
import json
import random
from collections import Counter

SUN = 'S'
COMMON = (2, 3, 4, 5, 6, 10)
SUNF = (2, SUN, 4, 5, 6, 10)
ALL_DICE = ('c0', 'c1', 'c2', 'c3', 's')

DEFAULT_SINGLES = {5: 5, 10: 10}
MAX_REROLLS = 80          # guard; the loop is a.s. finite but never trust that


def throw(hand, rng):
    return {d: rng.choice(SUNF if d == 's' else COMMON) for d in hand}


def resolve(result, forbidden, policy='greedy', singles_tbl=DEFAULT_SINGLES):
    """Score one throw as it lies.

    Returns points/used/flash/special plus `forced`: the cubes showing a flash
    face, which the Reroll Clause sends back. points == 0, special None and
    forced empty together mean a genuine Wimpout.
    """
    ids = list(result)

    # Freight Train: five cubes all showing the same numeric face.
    if len(ids) == 5:
        faces = list(result.values())
        f0 = faces[0]
        if f0 != SUN and all(f == f0 for f in faces):
            special = {6: 'instant_win', 10: 'supernova'}.get(f0, 'freight')
            pts = 100 * f0 if special == 'freight' else 0
            return {'points': pts, 'used': set(ids), 'flash': None,
                    'special': special, 'forced': []}

    # Ruling C+D: a cube on a flash face cannot be kept; the Sun never matches.
    legal, forced = {}, []
    for d, f in result.items():
        if f == SUN or f not in forbidden:
            legal[d] = f
        else:
            forced.append(d)

    sun_wild = result.get('s') == SUN
    numeric = Counter(f for f in legal.values() if f != SUN)

    points, used, flash, picked = 0, set(), None, []

    triples = [f for f, c in numeric.items() if c >= 3]
    if triples:
        flash = max(triples)
        picked = [d for d, f in legal.items() if f == flash][:3]
    elif sun_wild:
        # Flaming Sun Rule: Sun + a pair MUST become a flash.
        pairs = [f for f, c in numeric.items() if c == 2]
        if pairs:
            flash = max(pairs)                      # ruling B: best available
            picked = [d for d, f in legal.items() if f == flash][:2] + ['s']
    if flash is not None:
        points += 10 * flash
        used.update(picked)

    # Optional tier (ruling G): loose 5s, 10s and the Sun.
    singles = []
    for d, f in legal.items():
        if d in used:
            continue
        if f == SUN:
            singles.append((10, d))                 # Sun taken as a 10
        elif f in singles_tbl:
            singles.append((singles_tbl[f], d))
    singles.sort(reverse=True)

    if policy == 'greedy':
        take = singles
    elif flash is not None:
        take = []                                   # the flash alone scores
    else:
        take = singles[:1]                          # minimum one scoring cube

    for val, d in take:
        points += val
        used.add(d)

    return {'points': points, 'used': used, 'flash': flash,
            'special': None, 'forced': forced}


def throw_and_resolve(hand, forbidden, rng, policy=('greedy'),
                      singles_tbl=DEFAULT_SINGLES, reroll_clause=True,
                      stats=None):
    """One throw, plus any re-throws the Reroll Clause forces."""
    result = throw(hand, rng)
    if not reroll_clause:
        return result, resolve(result, forbidden, policy, singles_tbl)

    for _ in range(MAX_REROLLS):
        r = resolve(result, forbidden, policy, singles_tbl)
        if r['special'] or r['points'] > 0 or not r['forced']:
            return result, r
        if stats is not None:
            stats[0] += 1
        result.update(throw(r['forced'], rng))      # ruling C: offenders only
    return result, resolve(result, forbidden, policy, singles_tbl)


# ---------------------------------------------------------------------------
# Hazard: outcome probabilities conditional on (hand size, forbidden faces)
# ---------------------------------------------------------------------------
def hazard(hand_size, forbidden, trials, rng, policy='greedy',
           singles_tbl=DEFAULT_SINGLES, reroll_clause=True):
    hand = list(ALL_DICE) if hand_size == 5 else list(ALL_DICE[:hand_size - 1]) + ['s']
    out = Counter()
    for _ in range(trials):
        _, r = throw_and_resolve(hand, forbidden, rng, policy, singles_tbl,
                                 reroll_clause)
        if r['special'] in ('supernova', 'instant_win', 'freight'):
            out[r['special']] += 1
        elif r['points'] == 0:
            out['wimpout'] += 1
        elif r['flash'] is not None:
            out['extends'] += 1
        else:
            out['clears'] += 1
    return {k: v / trials for k, v in out.items()}


# ---------------------------------------------------------------------------
# Full turn
# ---------------------------------------------------------------------------
def simulate_turn(rng, policy='greedy', on_board=True, chase_to=0,
                  chain_mode='strict', mult=lambda k: 1,
                  singles_tbl=DEFAULT_SINGLES, reroll_clause=True, stats=None):
    hand = list(ALL_DICE)
    base, chain, best_chain, forbidden, throws = 0, 0, 0, set(), 0

    while True:
        _, r = throw_and_resolve(hand, forbidden, rng, policy, singles_tbl,
                                 reroll_clause, stats)
        throws += 1

        if r['special'] == 'supernova':
            return {'points': 0, 'chain': best_chain, 'end': 'supernova', 'throws': throws}
        if r['special'] == 'instant_win':
            return {'points': 0, 'chain': best_chain, 'end': 'instant_win', 'throws': throws}
        if r['points'] == 0:
            return {'points': 0, 'chain': best_chain, 'end': 'wimpout', 'throws': throws}

        base += r['points']
        if r['flash'] is not None:
            chain += 1
            best_chain = max(best_chain, chain)
            forbidden = forbidden | {r['flash']}
        elif chain_mode == 'strict':
            chain, forbidden = 0, set()             # flash cleared, chain broken
        # chain_mode == 'turn': chain and forbidden persist for the whole turn

        hand = [d for d in hand if d not in r['used']]
        swept = not hand
        if swept:
            hand = list(ALL_DICE)                   # Y.M.N.W.T.B.Y.M.

        must_roll = r['flash'] is not None or swept or (not on_board and base < 35)
        if not must_roll and best_chain >= chase_to:
            return {'points': base * mult(best_chain), 'chain': best_chain,
                    'end': 'banked', 'throws': throws}


def run(rng, n, **kw):
    depths, ends, pts = Counter(), Counter(), 0
    for _ in range(n):
        t = simulate_turn(rng, **kw)
        depths[t['chain']] += 1
        ends[t['end']] += 1
        pts += t['points']
    return depths, ends, pts / n


def pct(x):
    return f'{100 * x:5.1f}%'


# ---------------------------------------------------------------------------
HAZARD_CASES = [
    ('5 cubes, nothing forbidden',       5, frozenset()),
    ('5 cubes, forbidden {4}',           5, frozenset({4})),
    ('5 cubes, forbidden {2,3,4,6}',     5, frozenset({2, 3, 4, 6})),
    ('5 cubes, forbidden {10}',          5, frozenset({10})),
    ('5 cubes, forbidden {5,10}',        5, frozenset({5, 10})),
    ('2 cubes, clearing a flash of 4s',  2, frozenset({4})),
    ('2 cubes, clearing a flash of 10s', 2, frozenset({10})),
    ('1 cube,  clearing a flash of 10s', 1, frozenset({10})),
]

SCORING_VARIANTS = {
    'base rules (5,10 score)': {5: 5, 10: 10},
    '+ half moons score 5':    {2: 5, 5: 5, 10: 10},
    '+ pyramids score 5':      {3: 5, 5: 5, 10: 10},
    '+ both 2s and 3s score':  {2: 5, 3: 5, 5: 5, 10: 10},
}


def collect(n, seed, reroll_clause=True):
    """Run every experiment and return the numbers as plain data."""
    rng = random.Random(seed)
    data = {'trials': n, 'seed': seed, 'reroll_clause': reroll_clause}

    data['hazard'] = []
    for label, hs, fb in HAZARD_CASES:
        h = hazard(hs, fb, n, rng, reroll_clause=reroll_clause)
        data['hazard'].append({
            'case': label,
            'wimpout': h.get('wimpout', 0), 'clears': h.get('clears', 0),
            'extends': h.get('extends', 0),
            'train': h.get('freight', 0) + h.get('supernova', 0) + h.get('instant_win', 0),
        })

    data['baseline'] = []
    for label, on_board in [('opening turn (needs 35)', False), ('normal turn', True)]:
        stats = [0]
        d, e, mean = run(rng, n, on_board=on_board, chase_to=0,
                         reroll_clause=reroll_clause, stats=stats)
        tot = sum(d.values())
        data['baseline'].append({
            'case': label, 'wimpout': e['wimpout'] / tot, 'mean_points': mean,
            'rerolls_per_turn': stats[0] / tot,
        })

    data['chain_depth'] = []
    for mode in ('strict', 'turn'):
        for policy in ('greedy', 'minimal'):
            d, e, mean = run(rng, n, policy=policy, chain_mode=mode, chase_to=99,
                             reroll_clause=reroll_clause)
            tot = sum(d.values())
            data['chain_depth'].append({
                'chain_mode': mode, 'policy': policy,
                'depths': {str(k): d[k] / tot for k in range(5)},
            })

    schemes = {'no mult': lambda k: 1, 'x(1+k)': lambda k: 1 + k, 'x2^k': lambda k: 2 ** k}
    data['chasing'] = []
    for mode in ('strict', 'turn'):
        for chase in (0, 1, 2, 3):
            row = {'chain_mode': mode, 'chase_to': chase}
            for name, fn in schemes.items():
                _, _, mean = run(rng, max(1, n // 2), chain_mode=mode,
                                 chase_to=chase, mult=fn,
                                 reroll_clause=reroll_clause)
                row[name] = mean
            data['chasing'].append(row)

    data['scoring_surface'] = []
    for label, tbl in SCORING_VARIANTS.items():
        _, e, mean = run(rng, n, singles_tbl=tbl, reroll_clause=reroll_clause)
        h2 = hazard(5, frozenset({2}), n, rng, singles_tbl=tbl,
                    reroll_clause=reroll_clause)
        h10 = hazard(5, frozenset({10}), n, rng, singles_tbl=tbl,
                     reroll_clause=reroll_clause)
        data['scoring_surface'].append({
            'rule': label, 'turn_wimpout': e['wimpout'] / n, 'mean_points': mean,
            'forbid_2': h2.get('wimpout', 0), 'forbid_10': h10.get('wimpout', 0),
        })
    return data


def compare_reroll_clause(n, seed):
    """Section 6: what the Reroll Clause is actually worth."""
    rows = []
    for label, hs, fb in HAZARD_CASES:
        if not fb:
            continue
        rng_a = random.Random(seed)
        rng_b = random.Random(seed)
        old = hazard(hs, fb, n, rng_a, reroll_clause=False).get('wimpout', 0)
        new = hazard(hs, fb, n, rng_b, reroll_clause=True).get('wimpout', 0)
        rows.append({'case': label, 'legacy': old, 'correct': new,
                     'delta': new - old})
    return rows


def report(data, cmp_rows):
    W = 78
    print('=' * W)
    print(f"1. HAZARD PER THROW   ({data['trials']:,} trials each)")
    print('=' * W)
    print(f"{'state':<36}{'wimp':>9}{'clears':>9}{'extends':>9}{'train':>9}")
    for r in data['hazard']:
        print(f"{r['case']:<36}{pct(r['wimpout']):>9}{pct(r['clears']):>9}"
              f"{pct(r['extends']):>9}{pct(r['train']):>9}")

    print()
    print('=' * W)
    print('2. BASELINE TURNS   (bank as soon as legal, no chain mechanic)')
    print('=' * W)
    for r in data['baseline']:
        print(f"  {r['case']:<28} wimpout {pct(r['wimpout'])}   "
              f"mean {r['mean_points']:6.1f} pts   "
              f"rerolls/turn {r['rerolls_per_turn']:.2f}")

    print()
    print('=' * W)
    print('3. HOW DEEP DO FLASH CHAINS GO?')
    print('=' * W)
    for r in data['chain_depth']:
        depths = '  '.join(f"{k}:{pct(v).strip()}" for k, v in r['depths'].items())
        print(f"  {r['chain_mode']:<7} {r['policy']:<8} {depths}")

    print()
    print('=' * W)
    print('4. IS CHASING A CHAIN WORTH IT?   mean points per turn')
    print('=' * W)
    mode = None
    for r in data['chasing']:
        if r['chain_mode'] != mode:
            mode = r['chain_mode']
            print(f"\n  chain_mode = {mode}")
            print(f"    {'chase to':<12}{'no mult':>12}{'x(1+k)':>12}{'x2^k':>12}")
        print(f"    depth {r['chase_to']:<6}{r['no mult']:>12.1f}"
              f"{r['x(1+k)']:>12.1f}{r['x2^k']:>12.1f}")

    print()
    print('=' * W)
    print('5. SCORING-SURFACE SCARCITY')
    print('=' * W)
    print(f"{'scoring rule':<28}{'turn wimp':>11}{'mean':>8}"
          f"{'forbid{2}':>12}{'forbid{10}':>12}")
    for r in data['scoring_surface']:
        print(f"{r['rule']:<28}{pct(r['turn_wimpout']):>11}{r['mean_points']:>8.1f}"
              f"{pct(r['forbid_2']):>12}{pct(r['forbid_10']):>12}")

    print()
    print('=' * W)
    print('6. WHAT THE REROLL CLAUSE IS WORTH   (wimpout rate per throw)')
    print('=' * W)
    print(f"{'state':<36}{'legacy':>10}{'correct':>10}{'delta':>10}")
    for r in cmp_rows:
        print(f"{r['case']:<36}{pct(r['legacy']):>10}{pct(r['correct']):>10}"
              f"{pct(r['delta']):>10}")
    print('\n  legacy  = a cube on a flash face is dead, and a scoreless throw busts')
    print('  correct = that cube is re-thrown until keepable or genuinely busted')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-n', '--trials', type=int, default=200_000)
    ap.add_argument('--seed', type=int, default=20260818)
    ap.add_argument('--legacy', action='store_true',
                    help='reproduce the old, incorrect Reroll Clause model')
    ap.add_argument('--json', metavar='PATH', help='also write results as JSON')
    args = ap.parse_args()

    data = collect(args.trials, args.seed, reroll_clause=not args.legacy)
    cmp_rows = compare_reroll_clause(args.trials, args.seed)
    data['reroll_comparison'] = cmp_rows
    report(data, cmp_rows)

    if args.json:
        with open(args.json, 'w') as fh:
            json.dump(data, fh, indent=1)
        print(f'\nwrote {args.json}')


if __name__ == '__main__':
    main()
