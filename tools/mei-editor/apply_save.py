#!/usr/bin/env python3
"""
Apply a save from the Digital Louis MEI editor (artifact) to the repository.

The editor stores, per piece, the edited MEI and the facsimile traces it
added or removed. Re-serialising the MEI in the browser changes the file's
formatting, so instead of overwriting the file this script applies only the
content changes to the existing text:

  - attribute changes on elements with an xml:id (and on their <accid> child)
  - elements with an xml:id that were inserted, removed, or replaced by a
    <space> (deleted structural notes)
  - ornaments (<trill>, <mordent>, ...) added or removed per measure
  - noteheads / tenues added to or removed from the facsimile SVG

Anything else (new staves or layers, ...) is reported and left alone.

usage: apply_save.py SAVED.json PIECE [--repo PATH]
       SAVED.json is a works/<piece> document of the editor's database.
"""
import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET

NS = '{http://www.music-encoding.org/ns/mei}'
XID = '{http://www.w3.org/XML/1998/namespace}id'
ORN = ('trill', 'mordent', 'turn', 'fermata')
TRACE_STYLE = ('fill:none;stroke:#707070;stroke-opacity:0.75px;stroke-linecap:round;'
               'stroke-linejoin:miter;stroke-opacity:0.2')


def local(el):
    return el.tag.replace(NS, '')


def attrs_of(el):
    return {('xml:id' if k == XID else k): v for k, v in el.attrib.items()}


def child_accid(el):
    return next((c for c in el if local(c) == 'accid' and c.get(XID) is None), None)


def tag_span(text, xid):
    """(start, end_of_start_tag, end_of_element, self_closing) of the element with this id"""
    m = re.search(r'<([\w:]+)\b[^>]*?\sxml:id="%s"[^>]*?(/?)>' % re.escape(xid), text)
    if not m:
        return None
    if m.group(2):
        return m.start(), m.end(), m.end(), True
    end = text.index('</%s>' % m.group(1), m.end()) + len('</%s>' % m.group(1))
    return m.start(), m.end(), end, False


def line_start(text, pos):
    return text.rfind('\n', 0, pos) + 1


def render(el, indent):
    """element as text in the repository's style: one tag per line, ` />`"""
    def fmt_attrs(e):
        out = []
        for k, v in attrs_of(e).items():
            out.append(f'{k}="{v}"')
        return ' '.join(out)
    kids = list(el)
    head = f'<{local(el)} {fmt_attrs(el)}'.rstrip()
    if not kids:
        return head + ' />'
    inner = ''.join('\n' + indent + '   ' + render(k, indent + '   ') for k in kids)
    return head + '>' + inner + '\n' + indent + f'</{local(el)}>'


def set_attrs(text, xid, new):
    s, e, _, sc = tag_span(text, xid)
    tag = text[s:e]
    name = re.match(r'<([\w:]+)', tag).group(1)
    old = dict(re.findall(r'\s([\w:.]+)="([^"]*)"', tag))
    keep_order = [k for k in old if k in new] + [k for k in new if k not in old]
    body = ' '.join(f'{k}="{new[k]}"' for k in keep_order)
    close = ' />' if sc else '>'
    if sc and tag.endswith('"/>'):
        close = '/>'
    return text[:s] + f'<{name} {body}{close}' + text[e:]


def apply_mei(repo_text, saved_text, log):
    A = ET.fromstring(repo_text.encode('utf-8'))
    B = ET.fromstring(saved_text.encode('utf-8'))
    a_ids = {el.get(XID): el for el in A.iter() if el.get(XID)}
    b_ids = {el.get(XID): el for el in B.iter() if el.get(XID)}
    b_parent = {c: p for p in B.iter() for c in p}
    text = repo_text

    # 1. attribute changes (element and its <accid> child)
    for xid, b in b_ids.items():
        a = a_ids.get(xid)
        if a is None:
            continue
        if attrs_of(a) != attrs_of(b):
            text = set_attrs(text, xid, attrs_of(b))
            log.append(f'changed {local(b)} {xid}')
        ca, cb = child_accid(a), child_accid(b)
        if (ca is None) != (cb is None) or (ca is not None and attrs_of(ca) != attrs_of(cb)):
            s, e, end, sc = tag_span(text, xid)
            seg = text[s:end]
            if ca is not None and cb is not None:
                seg2 = re.sub(r'<accid\b[^>]*?/>', lambda m: render(cb, '').rstrip(), seg, count=1)
            elif ca is not None:  # accid removed
                seg2 = re.sub(r'\n[ \t]*<accid\b[^>]*?/>', '', seg, count=1)
            else:  # accid added -> becomes a container
                ind = text[line_start(text, s):s]
                if sc:
                    seg2 = seg[:-2].rstrip() + '>\n' + ind + '   ' + render(cb, '') + '\n' + ind + f'</{local(b)}>'
                else:
                    seg2 = seg.replace('>', '>\n' + ind + '   ' + render(cb, ''), 1)
            text = text[:s] + seg2 + text[end:]
            log.append(f'changed accidental of {xid}')

    # 2. removed elements (structural notes become <space>)
    for xid, a in a_ids.items():
        if xid in b_ids or local(a) not in ('note', 'chord'):
            continue
        sp = tag_span(text, xid)
        if not sp:
            continue
        s, _, end, _ = sp
        ls = line_start(text, s)
        if a.get('grace') is None and local(a) == 'note':
            space = f'<space dur="{a.get("dur", "4")}"' + (f' dots="{a.get("dots")}"' if a.get('dots') else '') + ' />'
            text = text[:s] + space + text[end:]
            log.append(f'replaced {xid} by a space')
        else:
            text = text[:ls].rstrip(' \t') + text[end:].lstrip(' \t') if False else text[:ls - 1] + text[end:]
            log.append(f'removed {local(a)} {xid}')

    # 3. inserted elements with an id: after the previous sibling that exists
    for xid, b in b_ids.items():
        if xid in a_ids or local(b) not in ('note', 'chord'):
            continue
        par = b_parent[b]
        sibs = list(par)
        i = sibs.index(b)
        anchor = next((s.get(XID) for s in reversed(sibs[:i]) if s.get(XID) and (s.get(XID) in a_ids or s.get(XID) in text)), None)
        if anchor and tag_span(text, anchor):
            _, _, end, _ = tag_span(text, anchor)
            ind = text[line_start(text, tag_span(text, anchor)[0]):tag_span(text, anchor)[0]]
            text = text[:end] + '\n' + ind + render(b, ind) + text[end:]
        else:
            nxt = next((s.get(XID) for s in sibs[i + 1:] if s.get(XID) and tag_span(text, s.get(XID))), None)
            if not nxt:
                log.append(f'!! could not place new {local(b)} {xid} (no neighbour with an id)')
                continue
            s = tag_span(text, nxt)[0]
            ls = line_start(text, s)
            ind = text[ls:s]
            text = text[:ls] + ind + render(b, ind) + '\n' + text[ls:]
        log.append(f'inserted {local(b)} {xid}')

    # 4. ornaments and ties per measure, matched by (element, startid, endid)
    def control_events(root):
        out = {}
        for m in root.iter(NS + 'measure'):
            for c in m:
                if local(c) in ORN + ('tie',):
                    out.setdefault(m.get(XID), []).append((local(c), c.get('startid'), c.get('endid')))
        return out
    oa, ob = control_events(A), control_events(B)
    for mid in set(oa) | set(ob):
        for tag, sid, eid in set(ob.get(mid, [])) - set(oa.get(mid, [])):
            s, e, end, _ = tag_span(text, mid)
            close = text.index('</measure>', e)
            ls = line_start(text, close)
            ends = f' endid="{eid}"' if eid else ''
            text = text[:ls] + ' ' * 21 + f'<{tag} startid="{sid}"{ends} />\n' + text[ls:]
            log.append(f'added {tag} {sid}' + (f' -> {eid}' if eid else ''))
        for tag, sid, eid in set(oa.get(mid, [])) - set(ob.get(mid, [])):
            k = 0
            for m in re.finditer(r'\n[ \t]*<%s\b[^>]*?/>' % tag, text):
                el = m.group(0)
                if f'startid="{sid}"' in el and (eid is None or f'endid="{eid}"' in el):
                    text = text[:m.start()] + text[m.end():]; k = 1
                    break
            log.append(f'removed {tag} {sid}' if k else f'!! could not remove {tag} {sid}')

    # 5. structure the script does not handle
    la = {(m.get('n'), l.get('type')) for m in A.iter(NS + 'measure') for l in m.iter(NS + 'layer')}
    lb = {(m.get('n'), l.get('type')) for m in B.iter(NS + 'measure') for l in m.iter(NS + 'layer')}
    for k in lb - la:
        log.append(f'!! new layer {k} not applied')
    ET.fromstring(text.encode('utf-8'))  # must still parse
    return text


def apply_svg(svg_text, traces, log):
    for pid in traces.get('removed', []):
        svg_text, k = re.subn(r'\n[ \t]*<path\b[^>]*?\sid="%s"[^>]*?/>' % re.escape(pid), '', svg_text, count=1, flags=re.S)
        log.append(f'removed trace {pid}' if k else f'!! trace {pid} not found')
    new = []
    for pid, t in traces.get('added', {}).items():
        if f'id="{pid}"' in svg_text:
            continue
        extra = '\n         sodipodi:nodetypes="ccc"' if t['kind'] == 'head' else ''
        new.append(f'\n      <path\n         style="{TRACE_STYLE}"\n         d="{t["d"]}"\n         id="{pid}"{extra} />')
        log.append(f'added {t["kind"]} {pid}')
    if new:
        end = svg_text.rindex('</g>')
        svg_text = svg_text[:end].rstrip() + ''.join(new) + '\n   </g>' + svg_text[end + 4:]
    return svg_text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('saved')
    ap.add_argument('piece')
    ap.add_argument('--repo', default='.')
    a = ap.parse_args()
    saved = json.load(open(a.saved))
    mei_path = f'{a.repo}/public/{a.piece}.mei'
    repo_mei = open(mei_path, encoding='utf-8-sig').read()
    bom = open(mei_path, 'rb').read(3) == b'\xef\xbb\xbf'
    log = []
    new_mei = apply_mei(repo_mei, saved['mei'], log)
    open(mei_path, 'w', encoding='utf-8-sig' if bom else 'utf-8').write(new_mei)
    target = re.search(r'target=["\']([^"\']+\.svg)', repo_mei)
    if target and saved.get('traces'):
        svg_path = f'{a.repo}/public/{target.group(1)}'
        svg = open(svg_path, encoding='utf-8').read()
        open(svg_path, 'w', encoding='utf-8').write(apply_svg(svg, saved['traces'], log))
    print('\n'.join(log) or 'no changes')
    if any(l.startswith('!!') for l in log):
        sys.exit(1)


if __name__ == '__main__':
    main()
