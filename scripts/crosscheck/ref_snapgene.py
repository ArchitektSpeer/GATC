"""Dump .dna files via Biopython's independent SnapGene parser as normalized JSON.

Usage: python ref_snapgene.py out.json file1.dna [file2.dna ...]
"""
import json
import re
import struct
import sys

from Bio import SeqIO


def raw_features(path):
    """Name and directionality straight from the Features XML packet (type 10), in file order.

    Biopython reports features without a directionality attribute as strand +1 and prefers
    the "label" qualifier over the feature name; SnapGene itself shows such features as
    non-directional and titles them with the name attribute.
    """
    data = open(path, "rb").read()
    i, out = 0, []
    while i < len(data):
        t, n = data[i], struct.unpack(">I", data[i + 1 : i + 5])[0]
        if t == 10:
            xml = data[i + 5 : i + 5 + n].decode("utf8", "replace")
            for m in re.finditer(r"<Feature ([^>]*)>(.*?)</Feature>", xml, re.S):
                attrs = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
                d = attrs.get("directionality", "0")
                starts = frozenset(int(r) - 1 for r in re.findall(r'<Segment range="(\d+)-', m.group(2)))
                out.append((starts, attrs.get("name", ""), {"1": 1, "2": -1}.get(d, 0)))
        i += 5 + n
    return out


def norm_feature(f):
    parts = [[int(p.start), int(p.end)] for p in f.location.parts]
    strand = f.location.strand or 0
    q = f.qualifiers
    label = (q.get("label") or q.get("name") or q.get("gene") or [""])[0]
    return {"type": f.type, "label": label, "strand": strand, "parts": parts}


def dump(path):
    rec = SeqIO.read(path, "snapgene")
    feats = [norm_feature(f) for f in rec.features]
    raw = raw_features(path)
    for f in feats:
        if f["type"] == "primer_bind":
            continue
        # Match on the set of segment start positions (Biopython splits origin-spanning
        # segments, so test containment of the XML starts in the parsed parts).
        starts = {p[0] for p in f["parts"]}
        hit = next((r for r in raw if r[0] <= starts), None)
        if hit:
            raw.remove(hit)
            f["label"], f["strand"] = hit[1], hit[2]
    return {
        "sequence": str(rec.seq).upper(),
        "topology": rec.annotations.get("topology", "linear"),
        "features": [f for f in feats if f["type"] != "primer_bind"],
        "primers": [f for f in feats if f["type"] == "primer_bind"],
    }


out = {}
for p in sys.argv[2:]:
    try:
        out[p] = dump(p)
    except Exception as e:  # report, keep going
        out[p] = {"error": f"{type(e).__name__}: {e}"}
json.dump(out, open(sys.argv[1], "w"), indent=1)
