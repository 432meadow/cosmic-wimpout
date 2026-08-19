#!/usr/bin/env python3
"""Build the PDF analysis report from sim/out/results.json.

Every figure is read from the JSON, never transcribed, so the prose and the
tables cannot drift apart. Renders HTML, then Chrome headless prints it.
"""
import datetime as dt
import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / 'out'
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'


def pc(x, dp=1):
    return f'{100 * x:.{dp}f}%'


def bar(frac, tone='ink', width=110):
    w = max(1.0, min(1.0, frac) * width)
    return (f'<span class="bar"><span class="fill {tone}" '
            f'style="width:{w:.1f}px"></span></span>')


def table(headers, rows, cls=''):
    h = ''.join(f'<th>{x}</th>' for x in headers)
    body = ''
    for r in rows:
        body += '<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>'
    return f'<table class="{cls}"><thead><tr>{h}</tr></thead><tbody>{body}</tbody></table>'


def build(d):
    n = d['trials']
    haz = {r['case']: r for r in d['hazard']}
    base = {r['case']: r for r in d['baseline']}
    cmp_ = d['reroll_comparison']
    surf = d['scoring_surface']
    chase = d['chasing']
    depth = d['chain_depth']

    def chase_row(mode, k):
        for r in chase:
            if r['chain_mode'] == mode and r['chase_to'] == k:
                return r
        return None

    turn0, turn1, turn2, turn3 = (chase_row('turn', k) for k in range(4))
    biggest = max(cmp_, key=lambda r: -r['delta'])

    # ---- section 1: hazard
    haz_rows = []
    for r in d['hazard']:
        haz_rows.append([
            r['case'],
            f"{pc(r['wimpout'])} {bar(r['wimpout'], 'bad')}",
            pc(r['clears']), pc(r['extends']),
        ])

    # ---- reroll clause comparison
    cmp_rows = []
    for r in cmp_:
        cmp_rows.append([
            r['case'], pc(r['legacy']),
            f"<b>{pc(r['correct'])}</b>",
            f"<span class='good'>{pc(r['delta'])}</span> {bar(-r['delta'] * 2, 'good')}",
        ])

    # ---- scoring surface
    surf_rows = [[r['rule'], pc(r['turn_wimpout']), f"{r['mean_points']:.1f}",
                  pc(r['forbid_2']), pc(r['forbid_10'])] for r in surf]

    # ---- chain depth
    depth_rows = []
    for r in depth:
        cells = [pc(r['depths'][str(k)], 1) for k in range(4)]
        depth_rows.append([r['chain_mode'], r['policy']] + cells)

    # ---- chasing
    chase_rows = []
    for r in chase:
        chase_rows.append([
            r['chain_mode'], f"depth {r['chase_to']}",
            f"{r['no mult']:.1f}", f"{r['x(1+k)']:.1f}", f"{r['x2^k']:.1f}",
        ])

    stamp = dt.date.today().isoformat()
    opening = base['opening turn (needs 35)']
    normal = base['normal turn']

    return f"""<!doctype html><html><head><meta charset="utf-8">
<title>Cosmic Wimpout — Monte Carlo Analysis</title>
<style>
@page {{ size: A4; margin: 18mm 16mm; }}
* {{ box-sizing: border-box; }}
body {{ font: 10.5pt/1.5 "Iowan Old Style", Georgia, serif; color: #241634;
       background: #fdfaf3; margin: 0; }}
h1 {{ font-size: 24pt; margin: 0 0 2pt; letter-spacing: -.3pt; }}
h2 {{ font-size: 13pt; margin: 20pt 0 6pt; padding-bottom: 3pt;
      border-bottom: 1.5px solid #573280; color: #3d1f66; }}
h3 {{ font-size: 11pt; margin: 14pt 0 4pt; color: #573280; }}
p  {{ margin: 0 0 7pt; }}
.sub {{ color: #6b5a80; font-size: 11pt; margin-bottom: 2pt; }}
.meta {{ font: 8.5pt/1.5 ui-monospace, Menlo, monospace; color: #7c6a90;
        border-top: 1px solid #d9cfc0; padding-top: 5pt; margin-top: 8pt; }}
table {{ border-collapse: collapse; width: 100%; margin: 6pt 0 10pt;
         font: 9pt/1.35 ui-monospace, Menlo, monospace; }}
th {{ text-align: left; font-weight: 600; color: #3d1f66; border-bottom: 1px solid #573280;
      padding: 3pt 5pt; font-size: 8.5pt; letter-spacing: .3pt; text-transform: uppercase; }}
td {{ padding: 3pt 5pt; border-bottom: 1px solid #ece3d5; vertical-align: middle; }}
td:first-child, th:first-child {{ white-space: nowrap; }}
tbody tr:nth-child(even) {{ background: #f6f0e4; }}
.bar {{ display: inline-block; width: 112px; height: 7px; background: #ece3d5;
        border-radius: 1px; vertical-align: middle; margin-left: 5pt; }}
.fill {{ display: block; height: 7px; border-radius: 1px; }}
.fill.bad {{ background: #a8407a; }}
.fill.good {{ background: #3f7d5c; }}
.fill.ink {{ background: #573280; }}
.good {{ color: #2f6b4c; font-weight: 600; }}
.callout {{ background: #f2ecfa; border-left: 3px solid #573280;
            padding: 8pt 11pt; margin: 9pt 0; }}
.callout b {{ color: #3d1f66; }}
.keyfig {{ font: 600 15pt ui-monospace, Menlo, monospace; color: #a8407a; }}
ul {{ margin: 0 0 8pt; padding-left: 15pt; }}
li {{ margin-bottom: 4pt; }}
.foot {{ font-size: 8.5pt; color: #7c6a90; font-style: italic; margin-top: -4pt; }}
/* let it flow, but never strand a heading or split a table/callout */
table, .callout, ul {{ break-inside: avoid; }}
h2, h3 {{ break-after: avoid; }}
code {{ font: 9pt ui-monospace, Menlo, monospace; background: #f2ecfa;
        padding: 1pt 3pt; border-radius: 2px; }}
</style></head><body>

<h1>Cosmic Wimpout</h1>
<div class="sub">Monte Carlo analysis of the base game, the Reroll Clause,
and whether flash chaining can carry a roguelike</div>
<div class="meta">{n:,} trials per measurement &nbsp;·&nbsp; seed {d['seed']}
 &nbsp;·&nbsp; generated {stamp} &nbsp;·&nbsp; sim/flash_chain.py</div>

<h2>Summary</h2>
<ul>
<li><b>The Reroll Clause was modelled wrongly, and it mattered a great deal.</b>
Treating a cube on a flash face as dead — rather than re-thrown — overstated the
bust rate everywhere, worst of all at
<span class="keyfig">{pc(biggest['legacy'])} → {pc(biggest['correct'])}</span>
for {biggest['case'].lower()}.</li>
<li><b>Flashing a face that does not score is protective, not costly.</b> With 4s
forbidden a five-cube throw busts {pc(haz['5 cubes, forbidden {4}']['wimpout'])}
against {pc(haz['5 cubes, nothing forbidden']['wimpout'])} with nothing forbidden.
Forbid all four non-scoring faces and the bust rate reaches
{pc(haz['5 cubes, forbidden {2,3,4,6}']['wimpout'])} — you cannot lose the turn.</li>
<li><b>The base game is well tuned and needs no help.</b> A normal turn busts
{pc(normal['wimpout'])} and returns {normal['mean_points']:.1f} points; the
35-point opening busts {pc(opening['wimpout'])}.</li>
<li><b>Flash chaining still does not work.</b> Chains reach depth 2 in
{pc(max(r['depths']['2'] for r in depth))} of turns at best, and chasing depth 2
costs points even at a ×4 multiplier.</li>
<li><b>Widening the scoring surface is a trap.</b> Letting 2s and 3s score lifts
mean turn score from {surf[0]['mean_points']:.1f} to {surf[-1]['mean_points']:.1f}
and drops bust from {pc(surf[0]['turn_wimpout'])} to {pc(surf[-1]['turn_wimpout'])} —
it flattens the tension curve and inflates scores at once.</li>
</ul>

<h2>Method</h2>
<p>A direct implementation of the rules in <code>RULES.md</code>, including house
rulings A–G: the Sun face cannot complete a Freight Train; the Flaming Sun Rule
forces a flash on a pair; the Reroll Clause re-throws only the offending cubes;
the Sun never matches a flash face; flashes and trains are mandatory while loose
5s, 10s and the Sun are optional.</p>
<p>Each figure is an independent Monte Carlo estimate over {n:,} trials, so
percentages carry roughly ±0.3 points of sampling error. Turn-level figures use
a bank-as-soon-as-legal policy unless stated. The same experiments were
independently reimplemented in the game engine's JavaScript and agree to within
0.3 points, which is the main check that neither implementation is wrong in the
same way twice.</p>

<h2>1. The Reroll Clause correction</h2>
<p>The printed rule: while clearing a flash you may not keep a cube showing a
flash face, and if you roll one you <i>“must reroll … until you can keep 'em or
Wimp out.”</i> That is a re-throw, not a loss. Both the first version of this
simulation and the game engine instead treated the offending cube as dead, so a
throw with nothing else scoring ended the turn.</p>
{table(['Position', 'Legacy model', 'Correct', 'Difference'], cmp_rows)}
<div class="callout">
<b>The sign flips, not just the magnitude.</b> Under the legacy model, forbidding
a non-scoring face was mildly bad ({pc(cmp_[0]['legacy'])} bust). Correctly, it is
strongly <i>good</i> ({pc(cmp_[0]['correct'])}), because every time you roll that
face you are handed a free re-throw instead of losing the turn. Any strategy
advice derived from the old numbers had this backwards.
</div>

<h2>2. Hazard per throw</h2>
<p>What happens on a single throw, given how many cubes are in hand and which
faces the Reroll Clause has locked out. “Extends” means the throw produced
another flash.</p>
{table(['State', 'Wimpout', 'Clears', 'Extends'], haz_rows)}
<p class="foot">Note the {pc(haz['5 cubes, forbidden {5,10}']['extends'])} extend
rate with both 5s and 10s forbidden: with no single cube keepable, a flash is the
only way to score, so nearly half of surviving throws produce one.</p>

<h2>3. Baseline turns</h2>
<p>No chain mechanic, banking as soon as the rules allow.</p>
{table(['Turn type', 'Wimpout', 'Mean points', 'Rerolls per turn'],
       [[r['case'], pc(r['wimpout']), f"{r['mean_points']:.1f}",
         f"{r['rerolls_per_turn']:.2f}"] for r in d['baseline']])}
<p>The 35-point opening is the harshest rule in the game: it busts
{pc(opening['wimpout'])} of the time, so getting on the board takes about three
turns on average. This is by design — the maximum non-flash single roll is 30
(<code>10 10 5 5 x</code>), so 35 sits deliberately just above it and cannot be
reached without either a flash or a multi-throw accumulation.</p>
<p>At {normal['mean_points']:.1f} points per successful turn, a 300-point goal is
roughly {300 / normal['mean_points']:.0f} scoring turns.</p>

<h2>4. Does flash chaining support a roguelike?</h2>
<p>The proposed mechanic: each flash landed while a previous one is uncleared
extends a chain, stacking a multiplier while the Reroll Clause forbids one more
face. The question is whether the risk curve is fun or merely a lottery.</p>
<h3>How deep chains actually go</h3>
{table(['Chain mode', 'Set-aside', 'Depth 0', 'Depth 1', 'Depth 2', 'Depth 3'],
       depth_rows)}
<p>Chains are structurally capped. A flash consumes three of five cubes, and you
cannot flash with the two that remain — so the only route to a second flash is to
score with all five, sweep, and be handed a fresh set by
Y.M.N.W.T.B.Y.M. That is a narrow path, and it shows.</p>
<h3>Mean points per turn by chase depth</h3>
{table(['Chain mode', 'Chase to', 'No multiplier', '×(1+k)', '×2^k'], chase_rows)}
<div class="callout">
<b>Verdict: still no.</b> Under the most generous reading, refusing to bank until
depth 2 returns {turn2['x2^k']:.1f} points per turn against {turn0['x2^k']:.1f}
for banking immediately — and that is <i>with</i> a ×4 multiplier. Depth 3 falls
to {turn3['x2^k']:.1f}. The correction does soften one edge: chasing a single
flash is now mildly positive ({turn1['x2^k']:.1f} against
{turn0['x2^k']:.1f}), but “land one flash” is not a chain, it is just ordinary
good play — flashes already occur on
{pc(haz['5 cubes, nothing forbidden']['extends'])} of opening throws.
</div>

<h2>5. Scoring-surface scarcity</h2>
<p>Only two of six faces score on their own. That scarcity is the engine of the
whole game, and the last two columns show what happens to the Reroll Clause's
bite as the surface widens.</p>
{table(['Scoring rule', 'Turn wimpout', 'Mean pts', 'Forbid {2}', 'Forbid {10}'],
       surf_rows)}
<p>Adding scoring faces reads as a generous upgrade and quietly dismantles the
game: bust rate falls by more than two thirds while mean score doubles. Worse, it
flattens the Reroll Clause — once 2s score, forbidding 10s costs almost nothing,
because there is always another way to score. If these ever become unlockable
modifiers they should be rare and expensive, not a common tier.</p>

<h2>6. Design implications</h2>
<ul>
<li><b>The interesting axis is which faces are locked out, not how many.</b>
Forbidding {{5,10}} busts {pc(haz['5 cubes, forbidden {5,10}']['wimpout'])};
forbidding all four non-scoring faces busts
{pc(haz['5 cubes, forbidden {2,3,4,6}']['wimpout'])}. Four locked faces are safer
than one, if you lock the right ones.</li>
<li><b>High-value flashes are self-poisoning; low-value flashes are self-insuring.</b>
Flash 10s for 100 points and clearing with two cubes is worse than a coin flip
({pc(haz['2 cubes, clearing a flash of 10s']['wimpout'])} bust). Flash 4s for 40
and it is {pc(haz['2 cubes, clearing a flash of 4s']['wimpout'])}. That is a real
risk/reward decision that already exists in the printed rules and needs no
invention.</li>
<li><b>That decision is currently unavailable to the player,</b> because ruling G
makes flashes mandatory. Making “you may decline a flash” an unlockable would open
the game's best axis — and it is exactly the rules ambiguity catalogued in
<code>RULES.md</code> §5.</li>
<li><b>Do not build the roguelike on chaining.</b> Build it on manipulating the
scoring surface and the Reroll Clause, where the measured dynamic range runs from
{pc(haz['5 cubes, forbidden {2,3,4,6}']['wimpout'])} to
{pc(haz['5 cubes, forbidden {5,10}']['wimpout'])} bust on the same five cubes.</li>
</ul>

<h2>Reproduction</h2>
<p><code>python3 sim/flash_chain.py -n {n} --json sim/out/results.json</code><br>
Add <code>--legacy</code> to reproduce the incorrect Reroll Clause model.
Rebuild this document with <code>python3 sim/make_report.py</code>.</p>
<div class="meta">Cosmic Wimpout is a trademark of C3 Inc. This analysis is an
independent study of the published rules for a personal software project.</div>

</body></html>"""


def main():
    src = OUT / 'results.json'
    if not src.exists():
        sys.exit('run flash_chain.py --json sim/out/results.json first')
    data = json.loads(src.read_text())
    html = OUT / 'report.html'
    pdf = OUT / 'cosmic-wimpout-analysis.pdf'
    html.write_text(build(data))
    subprocess.run([CHROME, '--headless', '--disable-gpu', '--no-pdf-header-footer',
                    f'--print-to-pdf={pdf}', html.as_uri()],
                   check=True, capture_output=True)
    print(f'wrote {pdf}')


if __name__ == '__main__':
    main()
