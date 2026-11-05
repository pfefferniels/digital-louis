#!/usr/bin/env python3
"""
Learn the tenue model from the traced Bauyn facsimiles.

The facsimile SVGs in public/ contain the scan of the Bauyn manuscript plus
hand-traced noteheads (closed paths) and tenues (open paths); the MEI files
link notes to these traces via @corresp. This script

  1. extracts every traced tenue and associates it with the notehead it
     emanates from (via @corresp where available, geometrically otherwise),
  2. measures staff lines on the scan to express everything in staff spaces,
  3. fits a cubic Bézier to every tenue and learns
       - where tenues start relative to their notehead,
       - how much they rise depending on their length and register,
       - their shape (inner control points in the chord frame, regressed on
         length and register; residual PCA),
       - how high they end, how they end (direction), and
       - the broad-nib pen (ink width as a function of stroke direction),
  4. writes the model consumed by src/utils/tenues (bauynModel.json) and a
     corpus file used by evaluate.ts.

usage:
  python3 tools/tenue-model/fit_bauyn_model.py \
      [--pieces prelude7 prelude10] \
      [--out src/utils/tenues/bauynModel.json] \
      [--corpus tools/tenue-model/out/corpus.json]

requires: numpy, pillow, svgpathtools
"""
import argparse
import base64
import io
import json
import math
import os
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image
from svgpathtools import parse_path

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SVG = '{http://www.w3.org/2000/svg}'
MEI = '{http://www.music-encoding.org/ns/mei}'
XMLID = '{http://www.w3.org/XML/1998/namespace}id'
XLINK = '{http://www.w3.org/1999/xlink}href'

# the part a voice plays in the texture, by the type of its layer
VOICES = {'cantus': 'top', 'bassus': 'bass'}
ROLES = ['top', 'inner', 'bass']


# ---------------------------------------------------------------- loading --

def load_piece(piece):
    mei = ET.parse(os.path.join(ROOT, 'public', piece + '.mei')).getroot()
    source = next((s for s in mei.iter(MEI + 'source') if s.get('target')), None)
    if source is None:
        raise SystemExit(f'{piece}: no <source @target> pointing to a facsimile SVG')
    svg = ET.parse(os.path.join(ROOT, 'public', source.get('target'))).getroot()

    img = svg.find('.//' + SVG + 'image')
    data = base64.b64decode(img.get(XLINK).split(',', 1)[1])
    scan = Image.open(io.BytesIO(data)).convert('L')
    imgbox = dict(x=float(img.get('x', 0)), y=float(img.get('y', 0)),
                  w=float(img.get('width')), h=float(img.get('height')))

    paths = {}
    for p in svg.iter(SVG + 'path'):
        d = p.get('d')
        if not d:
            continue
        path = parse_path(d)
        pts = np.array([[z.real, z.imag] for z in (path.point(i / 59) for i in range(60))])
        paths[p.get('id')] = dict(pts=pts, closed=d.strip().lower().endswith('z'),
                                  bbox=(pts[:, 0].min(), pts[:, 1].min(), pts[:, 0].max(), pts[:, 1].max()))

    corresp = {}
    for el in mei.iter(MEI + 'note'):
        refs = (el.get('corresp') or el.get('corrsp') or '').split()
        corresp[el.get(XMLID) or id(el)] = [r.lstrip('#') for r in refs]
    # the voice each traced head belongs to: the top voice, the bass, or one between
    voices = {}
    for layer in mei.iter(MEI + 'layer'):
        voice = VOICES.get(layer.get('type'), 'inner')
        for el in layer.iter(MEI + 'note'):
            for r in (el.get('corresp') or el.get('corrsp') or '').split():
                voices.setdefault(r.lstrip('#'), voice)
    return dict(scan=scan, imgbox=imgbox, paths=paths, corresp=corresp, voices=voices)


def staves_from_scan(P):
    """Staff lines from the horizontal ink profile -> staff space, staves."""
    im = np.asarray(P['scan'], float)
    ib = P['imgbox']
    s = im.shape[1] / ib['w']
    prof = (im < 110)[:, int(im.shape[1] * .3):int(im.shape[1] * .7)].mean(axis=1)
    rows = np.where(prof > 0.2)[0]
    groups = []
    for r in rows:
        if groups and r - groups[-1][-1] <= 2:
            groups[-1].append(r)
        else:
            groups.append([r])
    ys = [np.mean(g) / s + ib['y'] for g in groups]
    # staff lines traced in the SVG (long, flat open paths) complete the scan
    for p in P['paths'].values():
        b = p['bbox']
        if not p['closed'] and b[2] - b[0] > 60 and b[3] - b[1] < 2:
            ys.append((b[1] + b[3]) / 2)
    ys = np.array(sorted(ys))
    d = np.diff(ys)
    d = d[d > 1]
    ss0 = np.sort(d)[len(d) // 5]
    ss = float(np.median(d[(d > 0.7 * ss0) & (d < 1.4 * ss0)]))
    merged = [ys[0]]
    for y in ys[1:]:
        if y - merged[-1] < 0.4 * ss:
            merged[-1] = (merged[-1] + y) / 2
        else:
            merged.append(y)
    ys = np.array(merged)
    staves, cur = [], [ys[0]]
    for y in ys[1:]:
        if y - cur[-1] < 2.6 * ss:
            cur.append(y)
        else:
            staves.append(cur)
            cur = [y]
    staves.append(cur)
    out = []
    for g in staves:
        if g[-1] - g[0] < 2.5 * ss:
            continue
        out.append((g[0], max(g[-1], g[0] + 4 * ss)))
    return ss, out


# ------------------------------------------------------------ association --

def centre(b):
    return np.array([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2])


def associate(P, ss):
    """[(tenue path id, head path id, linked)] — start of tenue near its head."""
    heads = {k: centre(p['bbox']) for k, p in P['paths'].items() if p['closed']}
    linked = {}
    for refs in P['corresp'].values():
        hs = [r for r in refs if r in heads]
        ts = [r for r in refs if r in P['paths'] and not P['paths'][r]['closed']]
        for t in ts:
            if hs:
                linked.setdefault(t, hs[0])
    out = []
    for k, p in P['paths'].items():
        if p['closed']:
            continue
        b = p['bbox']
        if b[2] - b[0] > 12 * ss and b[3] - b[1] < 0.5 * ss:
            continue  # traced staff line
        if k in linked:
            out.append((k, linked[k], True))
            continue
        a, e = p['pts'][0], p['pts'][-1]
        best = None
        for hk, hc in heads.items():
            for end, other in ((a, e), (e, a)):
                dx, dy = (end - hc) / ss
                if dx < -0.6 or dx > 4.5 or abs(dy) > 2.6 or other[0] < end[0]:
                    continue
                dd = math.hypot(dx - 1.5, dy * 1.5)
                if best is None or dd < best[0]:
                    best = (dd, hk)
        if best:
            out.append((k, best[1], False))
    return heads, out


# --------------------------------------------------------------- geometry --

def bezier(P, t):
    t = t[:, None]
    return (1 - t) ** 3 * P[0] + 3 * (1 - t) ** 2 * t * P[1] + 3 * (1 - t) * t * t * P[2] + t ** 3 * P[3]


def fit_bezier(Q):
    seg = np.linalg.norm(np.diff(Q, axis=0), axis=1)
    t = np.concatenate([[0], np.cumsum(seg)]) / seg.sum()
    P0, P3 = Q[0], Q[-1]
    tt = np.linspace(0, 1, 400)
    for _ in range(30):
        A = np.stack([3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2], 1)
        R = Q - np.outer((1 - t) ** 3, P0) - np.outer(t ** 3, P3)
        X = np.linalg.lstsq(A, R, rcond=None)[0]
        P = np.array([P0, X[0], X[1], P3])
        C = bezier(P, tt)
        t = tt[np.argmin(np.linalg.norm(Q[:, None] - C[None], axis=2), axis=1)]
        t[0], t[-1] = 0, 1
    err = np.mean(np.min(np.linalg.norm(Q[:, None] - bezier(P, tt)[None], axis=2), axis=1))
    return P, err


def resample(Q, n):
    """n points equally spaced along the polyline Q"""
    cs = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(Q, axis=0), axis=1))])
    u = np.linspace(0, cs[-1], n)
    return np.stack([np.interp(u, cs, Q[:, 0]), np.interp(u, cs, Q[:, 1])], 1)


def robust_lstsq(X, Y, iters=10, k=2.5):
    W = np.ones(len(Y))
    Y2 = Y if Y.ndim == 2 else Y[:, None]
    for _ in range(iters):
        B = np.linalg.lstsq(X * W[:, None], Y2 * W[:, None], rcond=None)[0]
        res = Y2 - X @ B
        d = np.linalg.norm(res / (res.std(0) + 1e-9), axis=1)
        W = np.where(d < k, 1.0, k / d)
    return B, res, W


def mad_sd(v):
    return float(1.4826 * np.median(np.abs(v - np.median(v))))


def passes_over(P, heads, hk, pts, staff, ss):
    """Where the notes a tenue passes over lie on its staff: 1 all below its
    note, -1 all above, 0 as many either way or none."""
    hc = heads[hk]
    x0, x1 = P['paths'][hk]['bbox'][2], pts[-1][0]
    above = below = 0
    for k, c in heads.items():
        if k == hk or not x0 < c[0] < x1 or not staff[0] - 3 * ss < c[1] < staff[1] + 3 * ss:
            continue
        if c[1] < hc[1] - 0.4 * ss:  # (y down)
            above += 1
        elif c[1] > hc[1] + 0.4 * ss:
            below += 1
    return (below - above) / max(1, below + above)


def context_features(r):
    """The tenue's voice (top, bass, or between) and where the notes it passes over lie."""
    return [float(r['voice'] == 'top'), float(r['voice'] == 'bass'), r['passes']]


def side_features(r):
    return [1.0, *context_features(r), np.clip(r['hpos'], -4, 4) / 4, min(r['L'], 16) / 8]


def logistic(X, y, l2=0.1, iters=50):
    """Logistic regression by Newton's method, lightly regularised."""
    b = np.zeros(X.shape[1])
    for _ in range(iters):
        p = 1 / (1 + np.exp(-X @ b))
        g = X.T @ (p - y) + l2 * b
        H = X.T @ (X * (p * (1 - p))[:, None]) + l2 * np.eye(len(b))
        b -= np.linalg.solve(H, g)
    return b


def shape_features(r):
    h = np.clip(r['hpos'], -4, 4) / 4
    L = r['L']
    return [1.0, h, min(L, 16) / 8, h * float(np.clip(1 - L / 8, 0, 1)), *context_features(r)]


# ------------------------------------------------------------- ink width --

def ink_widths(P, ss, tenue_pts_svg):
    """(direction in degrees y-up, width in staff spaces) along a tenue."""
    im = np.asarray(P['scan'], float)
    ib = P['imgbox']
    s = im.shape[1] / ib['w']
    Q = tenue_pts_svg
    seg = np.linalg.norm(np.diff(Q, axis=0), axis=1)
    cs = np.concatenate([[0], np.cumsum(seg)])
    u = np.linspace(0, cs[-1], 40)
    Q = np.stack([np.interp(u, cs, Q[:, 0]), np.interp(u, cs, Q[:, 1])], 1)
    out = []
    for i in range(8, 32):  # central part only (ends taper)
        tx, ty = Q[i + 1] - Q[i - 1]
        ln = math.hypot(tx, ty) or 1
        tx, ty = tx / ln, ty / ln
        cx, cy = (Q[i][0] - ib['x']) * s, (Q[i][1] - ib['y']) * s
        ts = np.linspace(-1.2 * ss * s, 1.2 * ss * s, 81)
        xs = np.clip((cx - ts * ty).astype(int), 0, im.shape[1] - 1)
        ys = np.clip((cy + ts * tx).astype(int), 0, im.shape[0] - 1)
        win = im[max(0, int(cy) - 40):int(cy) + 40, max(0, int(cx) - 40):int(cx) + 40]
        if win.size == 0:
            continue  # off the scan
        dark = np.where(im[ys, xs] < np.percentile(win, 90) - 60)[0]
        if len(dark) == 0:
            continue
        runs, st, pv = [], dark[0], dark[0]
        for k in dark[1:]:
            if k != pv + 1:
                runs.append((st, pv))
                st = k
            pv = k
        runs.append((st, pv))
        r = min(runs, key=lambda r_: 0 if r_[0] <= 40 <= r_[1] else min(abs(r_[0] - 40), abs(r_[1] - 40)))
        if not (r[0] - 6 <= 40 <= r[1] + 6):
            continue
        w = (r[1] - r[0] + 1) * (ts[1] - ts[0]) / s
        w = max(w - 1 / s, 0) / ss  # subtract one pixel of blur
        out.append((math.degrees(math.atan2(-ty, tx)), w))
    return out


# ------------------------------------------------------------------- main --

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pieces', nargs='+', default=['prelude7', 'prelude10'])
    ap.add_argument('--out', default=os.path.join(ROOT, 'src', 'utils', 'tenues', 'bauynModel.json'))
    ap.add_argument('--corpus', default=os.path.join(ROOT, 'tools', 'tenue-model', 'out', 'corpus.json'))
    args = ap.parse_args()

    rows, widths, corpus = [], [], {}
    for piece in args.pieces:
        P = load_piece(piece)
        ss, staves = staves_from_scan(P)
        heads, assoc = associate(P, ss)
        half_w = np.median([(p['bbox'][2] - p['bbox'][0]) / 2 for p in P['paths'].values() if p['closed']]) / ss
        to_sp = lambda q: np.stack([q[:, 0] / ss, -q[:, 1] / ss], 1)  # noqa: E731  (y up)
        corpus[piece] = dict(
            staffSpace=ss,
            heads=[dict(id=k, box=dict(x0=P['paths'][k]['bbox'][0] / ss, x1=P['paths'][k]['bbox'][2] / ss,
                                       y0=-P['paths'][k]['bbox'][3] / ss, y1=-P['paths'][k]['bbox'][1] / ss))
                   for k in heads],
            tenues=[])
        print(f'{piece}: staff space {ss:.2f}, {len(staves)} staves, {len(heads)} heads, '
              f'{len(assoc)} tenues ({sum(a[2] for a in assoc)} linked via @corresp)')
        for k, hk, is_linked in assoc:
            pts = P['paths'][k]['pts']
            hc = heads[hk]
            if np.linalg.norm(pts[-1] - hc) < np.linalg.norm(pts[0] - hc):
                pts = pts[::-1]
            staff = min(staves, key=lambda st: abs((st[0] + st[1]) / 2 - hc[1]))
            if abs((staff[0] + staff[1]) / 2 - hc[1]) > 6 * ss:
                # staff not recognised on the scan: assume the head sits in it
                staff = (hc[1] - 2 * ss, hc[1] + 2 * ss)
            top, bot = -staff[0] / ss, -staff[1] / ss
            A = to_sp(pts)
            hcs = np.array([hc[0] / ss, -hc[1] / ss])
            Q = A - hcs
            Pz, err = fit_bezier(Q)
            c = Pz[3] - Pz[0]
            L = float(np.linalg.norm(c))
            u = c / L
            n = np.array([-u[1], u[0]])
            hpos = float(hcs[1] - (top + bot) / 2)
            R = resample(Q, 50)
            y = R[:, 1]
            bulge = (R - R[0]) @ n
            bulge = float(bulge[np.argmax(np.abs(bulge))])
            tan1 = math.degrees(math.atan2(*(R[-1] - R[-4])[::-1]))
            voice = P['voices'].get(hk, 'inner')
            passes = passes_over(P, heads, hk, pts, staff, ss)
            rows.append(dict(
                L=L, run=float(c[0]), rise=float(c[1]), hpos=hpos, voice=voice, passes=passes, bulge=bulge,
                gap=float(Q[0, 0] - half_w), dy=float(Q[0, 1]),
                c=[float((Pz[1] - Pz[0]) @ u / L), float((Pz[1] - Pz[0]) @ n / L),
                   float((Pz[2] - Pz[0]) @ u / L), float((Pz[2] - Pz[0]) @ n / L)],
                end_above_top=float(A[-1, 1] - top), tan1=tan1, drop=float(y.max() - y[-1]), err=err))
            widths += ink_widths(P, ss, pts)
            corpus[piece]['tenues'].append(dict(id=k, head=hk, voice=voice, linked=is_linked, staffTop=top, staffBottom=bot,
                                                pts=[dict(x=float(a), y=float(b)) for a, b in A]))

    N = len(rows)
    errs = np.array([r['err'] for r in rows])
    print(f'{N} tenues; single cubic Bézier fit error: median {np.median(errs):.3f}, p90 {np.percentile(errs, 90):.3f} sp')

    # start point: how far after the head, and how high (by voice and the notes passed over)
    gap = np.array([r['gap'] for r in rows])
    dy = np.array([r['dy'] for r in rows])
    bdy, res_dy, _ = robust_lstsq(np.array([[1, *context_features(r)] for r in rows]), dy, k=2.0)

    # rise ~ run (saturating) and register
    max_run = 12
    Xr = np.array([[1, min(r['run'], max_run), np.clip(r['hpos'], -4, 4), *context_features(r)] for r in rows])
    yr = np.array([r['rise'] for r in rows])
    br, res_r, _ = robust_lstsq(Xr, yr, k=2.0)
    rise_sd = mad_sd(res_r[:, 0])

    # shape: inner control points in the chord frame. A tenue either arches
    # over (bulges to the left of its way) or sags: one mean shape for each
    # side, and which side is likely, by its context
    X = np.array([shape_features(r) for r in rows])
    Y = np.array([r['c'] for r in rows])
    arches = np.array([r['bulge'] > 0 for r in rows])
    B_arch, res_a, W_a = robust_lstsq(X[arches], Y[arches])
    B_sag, res_s, W_s = robust_lstsq(X[~arches], Y[~arches])
    res = np.concatenate([res_a * W_a[:, None], res_s * W_s[:, None]])
    ev, evec = np.linalg.eigh(np.cov(res.T))
    order = np.argsort(ev)[::-1]
    S = np.array([side_features(r) for r in rows])
    b_side = logistic(S, arches.astype(float))
    p_arch = 1 / (1 + np.exp(-S @ b_side))
    print(f'side: arch {arches.mean():.0%} of tenues; predicted right for {np.mean((p_arch > 0.5) == arches):.0%}')

    # ends
    eat = np.array([r['end_above_top'] for r in rows])
    long_ = [r for r in rows if r['L'] >= 8]
    print(f'long tenues (L>=8): end tangent >= 0 in {np.mean([r["tan1"] >= 0 for r in long_]):.0%}, '
          f'descent after peak p90 {np.percentile([r["drop"] for r in long_], 90):.2f} sp')

    # broad-nib pen: w = hairline + (full - hairline) * (1 - |cos(dir - nib)|)
    Wd = np.array(widths)
    best = None
    for nib in range(0, 180):
        x = 1 - np.abs(np.cos(np.radians(Wd[:, 0] - nib)))
        A_ = np.stack([np.ones_like(x), x], 1)
        coef = np.linalg.lstsq(A_, Wd[:, 1], rcond=None)[0]
        e = np.mean((A_ @ coef - Wd[:, 1]) ** 2)
        if best is None or e < best[0]:
            best = (e, nib, coef)
    _, nib, (hair, slope) = best
    print(f'pen: nib edge {nib}°, hairline {hair:.3f} sp, full width {hair + slope:.3f} sp ({len(Wd)} measurements)')

    r4 = lambda v: round(float(v), 4)  # noqa: E731
    model = dict(
        source=f'Bauyn manuscript ({", ".join(args.pieces)}): {N} traced tenues',
        units='staff spaces; x right, y up',
        start=dict(gap=r4(np.median(gap)), gapSd=r4(mad_sd(gap)), dy=r4(np.median(dy)), dySd=r4(mad_sd(res_dy[:, 0])),
                   gapByVoice={v: r4(np.median([r['gap'] for r in rows if r['voice'] == v])) for v in ROLES},
                   dyFeatures=['1', 'top', 'bass', 'passes'], dyCoef=[r4(v) for v in bdy[:, 0]]),
        context=dict(note='top/bass: the voice of the tenue\'s note (cantus, bassus; else between); '
                          'passes: where the notes it passes over on its staff lie, 1 all below, -1 all above'),
        rise=dict(features=['1', 'min(run,maxRun)', 'clip(hpos,-4,4)', 'top', 'bass', 'passes'],
                  coef=[r4(v) for v in br[:, 0]], sd=r4(rise_sd), maxRun=max_run),
        side=dict(note='the probability that a tenue arches over rather than sags: logistic in these features',
                  features=['1', 'top', 'bass', 'passes', 'clip(hpos,-4,4)/4', 'min(L,16)/8'],
                  coef=[r4(v) for v in b_side]),
        shape=dict(features=['1', 'clip(hpos,-4,4)/4', 'min(L,16)/8', 'clip(hpos,-4,4)/4 * clip(1-L/8,0,1)', 'top', 'bass', 'passes'],
                   arch=[[r4(v) for v in row] for row in B_arch],
                   sag=[[r4(v) for v in row] for row in B_sag],
                   pcs=[[r4(v) for v in evec[:, i]] for i in order],
                   pcSd=[r4(math.sqrt(ev[i])) for i in order],
                   maxBulgeLength=20),
        endAboveTop=dict(median=r4(np.median(eat)), q75=r4(np.percentile(eat, 75)), p90=r4(np.percentile(eat, 90))),
        endTangent=dict(note='long tenues end rising or flat; short ones may hook',
                        fromLength=6, fullLength=8, minAngle=0, maxDropAfterPeak=0.3),
        pen=dict(nibAngle=int(nib), hairline=r4(hair), full=r4(hair + slope), entry=0.1, exit=0.35, exitWidth=0.35),
    )
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, 'w') as f:
        json.dump(model, f, indent=2)
        f.write('\n')
    os.makedirs(os.path.dirname(os.path.abspath(args.corpus)), exist_ok=True)
    with open(args.corpus, 'w') as f:
        json.dump(corpus, f)
    print('wrote', os.path.relpath(args.out, ROOT), 'and', os.path.relpath(args.corpus, ROOT))


if __name__ == '__main__':
    main()
