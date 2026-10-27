"""Cloning-simulation cross-check against pydna and against constructions with a known answer.

  python ref_cloning.py gen  scenarios.json seqfile1.dna ...   # write random scenarios
  python ref_cloning.py check scenarios.json gatc-results.json  # compare GATC output with pydna
"""
import json
import os
import random
import sys

from Bio import SeqIO
from Bio.Restriction import CommOnly
from Bio.Seq import Seq
from pydna.amplify import pcr
from pydna.dseqrecord import Dseqrecord

rc = lambda s: str(Seq(s).reverse_complement())


def canon_circular(s):
    """Rotation- and strand-independent key for a circular sequence."""
    s = s.upper()
    best = None
    for t in (s, rc(s)):
        d = t + t
        cand = min(d[i : i + len(t)] for i in range(len(t)))
        best = cand if best is None or cand < best else best
    return best


def load(path):
    return SeqIO.read(path, "snapgene" if path.endswith(".dna") else "fasta")


def gen(out, files):
    random.seed(11)
    recs = {os.path.basename(f): (f, str(load(f).seq).upper()) for f in files}
    comm = sorted(str(e) for e in CommOnly)
    from Bio.Restriction import RestrictionBatch

    scen = {"digest": [], "pcr": [], "restriction_cloning": [], "gibson": []}
    for name, (path, s) in recs.items():
        cutters = [e for e in comm if 0 < len(RestrictionBatch([e]).search(Seq(s), linear=False)[RestrictionBatch([e]).get(e)]) <= 4]
        for _ in range(25):
            scen["digest"].append({"file": path, "enzymes": random.sample(cutters, random.randint(1, 3))})
        n = len(s)
        for _ in range(15):
            i = random.randrange(n)
            size = random.randint(200, min(3000, n - 50))
            j = (i + size) % n
            fwd = (s + s)[i : i + 20]
            rev = rc((s + s)[i + size - 20 : i + size])
            tail_f = random.choice(["", "GAATTCAA", "GCGGCCGCTT"])
            tail_r = random.choice(["", "GGATCCAA", "CTCGAGTT"])
            scen["pcr"].append({"file": path, "fwd": tail_f + fwd, "rev": tail_r + rev})
        # Gibson: cut the plasmid into 2-6 linear pieces sharing 20-40 bp overlaps, some reversed;
        # the answer is the plasmid.
        for _ in range(4):
            k, ov = random.randint(2, 6), random.randint(20, 40)
            cuts = sorted(random.sample(range(n), k))
            pieces = []
            for i in range(k):
                a, b = cuts[i], cuts[(i + 1) % k] + (n if i == k - 1 else 0)
                piece = (s + s + s)[a : b + ov]
                pieces.append(rc(piece) if random.random() < 0.3 else piece)
            scen["gibson"].append({"file": path, "fragments": pieces, "expected": s})

    # Golden Gate (BsaI): split a BsaI-free plasmid into 3-4 parts, each flanked by BsaI sites that
    # expose 4-nt overhangs taken from the plasmid itself; the answer is the plasmid.
    scen["golden_gate"] = []
    for name, (path, s) in recs.items():
        if "GGTCTC" in s + s[:5] or "GAGACC" in s + s[:5]:
            continue
        n = len(s)
        for _ in range(10):
            k = random.randint(2, 5)
            cuts = sorted(random.sample(range(n), k))
            ohs = [(s + s)[c : c + 4] for c in cuts]
            if len(set(ohs)) < k or any(o == rc(o) for o in ohs):
                continue
            parts = []
            for i in range(k):
                a, b = cuts[i], cuts[(i + 1) % k] + (n if i == k - 1 else 0)
                parts.append("TTGGTCTCA" + (s + s)[a : b + 4] + "TGAGACCAA")
            scen["golden_gate"].append({"file": path, "parts": parts, "expected": s})

    # Restriction cloning: PCR an insert with enzyme tails, clone into a vector cut with the same pair.
    pairs = [("EcoRI", "BamHI"), ("NheI", "XhoI"), ("HindIII", "XbaI"), ("BglII", "NotI"), ("NcoI", "XhoI")]
    sites = {e: str(getattr(__import__("Bio.Restriction", fromlist=[e]), e).site) for p in pairs for e in p}
    for vname, (vpath, vs) in recs.items():
        for a, b in pairs:
            batch = RestrictionBatch([a, b])
            found = batch.search(Seq(vs), linear=False)
            if any(len(found[batch.get(e)]) != 1 for e in (a, b)):
                continue
            for iname, (ipath, isq) in random.sample(list(recs.items()), 2):
                if iname == vname:
                    continue
                st = random.randrange(len(isq) - 900)
                body = isq[st : st + random.randint(300, 800)]
                if any(len(RestrictionBatch([e]).search(Seq(body), linear=True)[RestrictionBatch([e]).get(e)]) for e in (a, b)):
                    continue
                scen["restriction_cloning"].append({
                    "vector": vpath, "insert": ipath, "enzymes": [a, b],
                    "fwd": "TTGA" + sites[a] + body[:20], "rev": "TTGA" + sites[b] + rc(body[-20:]),
                })
                break
    json.dump(scen, open(out, "w"), indent=1)
    print({k: len(v) for k, v in scen.items()})


def check(scen_path, res_path):
    scen, res = json.load(open(scen_path)), json.load(open(res_path))
    from Bio import Restriction

    seqcache = {}

    def dseq(path):
        if path not in seqcache:
            r = load(path)
            seqcache[path] = (str(r.seq).upper(), r.annotations.get("topology", "linear") == "circular")
        s, circ = seqcache[path]
        return Dseqrecord(s, circular=circ)

    summary = {}
    # Digest: compare fragment lengths and top strands.
    ok, bad, skipped = 0, [], 0
    missing = set(res.get("missingEnzymes", []))
    for sc, got in zip(scen["digest"], res["digest"]):
        enz = [getattr(Restriction, e) for e in sc["enzymes"]]
        try:
            if missing & set(sc["enzymes"]):
                raise ValueError("enzyme absent from GATC")
            frags = dseq(sc["file"]).cut(*enz)
        except ValueError:  # overlapping cuts (e.g. NarI + PluTI on one site) or unknown enzyme
            skipped += 1
            continue
        # GATC stores each fragment's top strand (5' overhangs on the left end, 3' on the right),
        # which is pydna's watson strand; pydna's len() also counts the protruding bottom strand.
        ref = sorted(str(f.seq.watson).upper() for f in frags)
        if ref == sorted(got["sequences"]):
            ok += 1
        else:
            bad.append((os.path.basename(sc["file"]), sc["enzymes"], sorted(map(len, ref))[:8], sorted(got["lengths"])[:8]))
    summary["digest"] = (ok, len(scen["digest"]) - skipped, bad[:8])
    print(f"(digest: {skipped} scenarios skipped: overlapping cuts or enzyme not in GATC)")

    ok, bad = 0, []
    for sc, got in zip(scen["pcr"], res["pcr"]):
        try:
            prod = str(pcr(sc["fwd"], sc["rev"], dseq(sc["file"]), limit=15).seq).upper()
        except Exception as e:
            prod = f"error {e}"[:60]
        flagged = any("binding sites" in w or "opposite strand" in w for w in got.get("warnings") or [])
        if prod == (got.get("product") or "") or (prod.startswith("error PCR not specific") and flagged):
            ok += 1  # identical product, or both tools flag the primers as non-specific
        else:
            bad.append((os.path.basename(sc["file"]), len(prod), len(got.get("product") or ""), got.get("warnings")))
    summary["pcr"] = (ok, len(scen["pcr"]), bad[:8])

    ok, bad, rc_skipped = 0, [], 0
    for sc, got in zip(scen["restriction_cloning"], res["restriction_cloning"]):
        a, b = (getattr(Restriction, e) for e in sc["enzymes"])
        try:
            insert = pcr(sc["fwd"], sc["rev"], dseq(sc["insert"]), limit=15)
        except ValueError as e:  # pydna refuses non-specific PCRs; GATC should warn too
            print(f"    (cloning ref skipped: {str(e).splitlines()[0]})")
            rc_skipped += 1
            continue
        ins_frag = sorted(insert.cut(a, b), key=len)[-1]
        vec_frag = sorted(dseq(sc["vector"]).cut(a, b), key=len)[-1]
        try:
            prod = (vec_frag + ins_frag).looped()
        except TypeError:  # site order in the vector is reversed relative to the insert
            prod = (vec_frag + ins_frag.reverse_complement()).looped()
        ref = canon_circular(str(prod.seq))
        g = got.get("product")
        if g and canon_circular(g) == ref:
            ok += 1
        else:
            bad.append((os.path.basename(sc["vector"]), sc["enzymes"], len(prod), len(g or ""), got.get("warnings")))
    summary["restriction_cloning"] = (ok, len(scen["restriction_cloning"]) - rc_skipped, bad[:8])

    ok, bad = 0, []
    for sc, got in zip(scen["gibson"], res["gibson"]):
        g = got.get("product")
        if g and canon_circular(g) == canon_circular(sc["expected"]):
            ok += 1
        else:
            bad.append((os.path.basename(sc["file"]), len(sc["expected"]), len(g or ""), got.get("warnings")))
    summary["gibson (known answer)"] = (ok, len(scen["gibson"]), bad[:8])

    ok, bad = 0, []
    for sc, got in zip(scen.get("golden_gate", []), res.get("golden_gate", [])):
        g = got.get("product")
        if g and canon_circular(g) == canon_circular(sc["expected"]):
            ok += 1
        else:
            bad.append((os.path.basename(sc["file"]), len(sc["expected"]), len(g or ""), got.get("warnings")))
    summary["golden gate (known answer)"] = (ok, len(scen.get("golden_gate", [])), bad[:8])

    allok = True
    for k, (o, n, b) in summary.items():
        print(f"[{k}] {o}/{n} identical")
        for x in b:
            print("    ", x)
        allok &= o == n
    sys.exit(0 if allok else 1)


if __name__ == "__main__":
    {"gen": lambda: gen(sys.argv[2], sys.argv[3:]), "check": lambda: check(sys.argv[2], sys.argv[3])}[sys.argv[1]]()
