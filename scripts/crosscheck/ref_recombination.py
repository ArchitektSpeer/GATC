"""Gateway and site-specific recombination cross-check against pydna, on real Gateway vectors.

  python ref_recombination.py gen   scenarios.json donor1.dna ...   # write scenarios
  python ref_recombination.py check scenarios.json gatc-results.json

Gateway BP/LR products are compared with pydna's gateway_assembly (which uses the full
att consensus sites), Cre/Lox with pydna's cre_lox_excision_or_inversion and
cre_lox_integration. Both are independent implementations, not SnapGene.
"""
import json
import os
import random
import sys

from Bio import SeqIO
from Bio.Seq import Seq
from pydna.assembly2 import cre_lox_excision_or_inversion, gateway_assembly, recombinase_assembly
from pydna.recombinase import Recombinase
from pydna.dseqrecord import Dseqrecord

LOXP = "ATAACTTCGTATAATGTATGCTATACGAAGTTAT"
# attB1/attB2 flanking an insert is what a Gateway BP reaction needs; these are the
# consensus cores both GATC and pydna recognise.
ATTB1 = "ACAAGTTTGTACAAAAAAGCAGGCT"
ATTB2 = "ACCCAGCTTTCTTGTACAAAGTGGT"

rc = lambda s: str(Seq(s).reverse_complement())
# pydna writes a recombinase site with its crossover spacer in lower case.
# pydna writes a recombinase site with its crossover spacer in lower case; Cre uses the
# same loxP site on both partners.
_LOXP_SPACED = "ATAACTTCGTATA" + "atgtatgc" + "TATACGAAGTTAT"
CRE = Recombinase(_LOXP_SPACED, _LOXP_SPACED, "loxP", "loxP", name="Cre")


def canon_circular(s):
    s = s.upper()
    best = None
    for t in (s, rc(s)):
        d = t + t
        cand = min(d[i : i + len(t)] for i in range(len(t)))
        best = cand if best is None or cand < best else best
    return best


def load(path):
    rec = SeqIO.read(path, "snapgene" if path.endswith(".dna") else "fasta")
    return str(rec.seq).upper(), rec.annotations.get("topology", "linear") == "circular"


def gen(out, files):
    random.seed(23)
    scen = {"bp": [], "lr": [], "cre": []}
    donors = [f for f in files if "DONR" in os.path.basename(f).upper()]
    dests = [f for f in files if "DEST" in os.path.basename(f).upper()]
    bodies = []
    for f in files:
        s, _ = load(f)
        for _ in range(2):
            i = random.randrange(len(s) - 700)
            bodies.append(s[i : i + random.randint(300, 600)])

    for donor in donors:
        for body in random.sample(bodies, 3):
            scen["bp"].append({"donor": donor, "insert": "CCCC" + ATTB1 + body + ATTB2 + "GGGG"})
    # LR needs an entry clone, which is the product of a BP reaction; the scenario records the
    # BP inputs and the checker builds the entry clone with pydna before the LR step.
    for dest in dests:
        for i, donor in enumerate(donors[:2]):
            body = bodies[(i * 3) % len(bodies)]
            scen["lr"].append({
                "destination": dest,
                "donor": donor,
                "insert": "CCCC" + ATTB1 + body + ATTB2 + "GGGG",
            })
    # Cre/Lox: a floxed cassette on a circular plasmid excises into two circles; an insert
    # carrying one loxP integrates into a plasmid carrying one loxP.
    for f in files[:4]:
        s, _ = load(f)
        cut = random.randrange(len(s) - 1200)
        cassette = s[cut : cut + random.randint(400, 900)]
        backbone = s[:cut] + s[cut + len(cassette) :]
        scen["cre"].append({
            "kind": "excision",
            "sequence": backbone[: len(backbone) // 2] + LOXP + cassette + LOXP + backbone[len(backbone) // 2 :],
        })
        scen["cre"].append({
            "kind": "integration",
            "target": backbone[: len(backbone) // 2] + LOXP + backbone[len(backbone) // 2 :],
            "insert": cassette[:200] + LOXP + cassette[200:],
        })
    json.dump(scen, open(out, "w"), indent=1)
    print({k: len(v) for k, v in scen.items()})


def circ(seq):
    return Dseqrecord(seq, circular=True)


def check(scen_path, res_path):
    scen, res = json.load(open(scen_path)), json.load(open(res_path))
    summary = {}

    def compare(name, pairs):
        ok, bad, skipped = 0, [], 0
        for ref_products, got, label in pairs:
            if ref_products is None:
                skipped += 1
                continue
            refs = {canon_circular(str(p.seq)) for p in ref_products}
            g = got.get("product")
            if g and canon_circular(g) in refs:
                ok += 1
            else:
                bad.append((label, sorted(len(p) for p in ref_products), len(g or ""), got.get("warnings")))
        summary[name] = (ok, len(pairs) - skipped, bad[:8], skipped)

    pairs = []
    for sc, got in zip(scen["bp"], res["bp"]):
        donor, _ = load(sc["donor"])
        prods = gateway_assembly([Dseqrecord(sc["insert"]), circ(donor)], "BP", circular_only=True)
        pairs.append((prods or None, got, os.path.basename(sc["donor"])))
    compare("gateway BP", pairs)

    pairs = []
    for sc, got in zip(scen["lr"], res["lr"]):
        donor, _ = load(sc["donor"])
        dest, _ = load(sc["destination"])
        entries = gateway_assembly([Dseqrecord(sc["insert"]), circ(donor)], "BP", circular_only=True)
        prods = None
        if entries:
            prods = gateway_assembly([entries[0], circ(dest)], "LR", circular_only=True) or None
        pairs.append((prods, got, f"{os.path.basename(sc['donor'])}->{os.path.basename(sc['destination'])}"))
    compare("gateway LR", pairs)

    pairs = []
    for sc, got in zip(scen["cre"], res["cre"]):
        if sc["kind"] == "excision":
            prods = cre_lox_excision_or_inversion(circ(sc["sequence"])) or None
        else:
            # Two circular plasmids, one loxP each: Cre fuses them into one circle.
            prods = recombinase_assembly([circ(sc["target"]), circ(sc["insert"])], CRE, circular_only=True) or None
        pairs.append((prods, got, sc["kind"]))
    compare("cre/lox", pairs)

    allok = True
    for k, (o, n, bad, skipped) in summary.items():
        extra = f" ({skipped} skipped: pydna produced no product)" if skipped else ""
        print(f"[{k}] {o}/{n} products match pydna{extra}")
        for b in bad:
            print("    ", b)
        allok &= o == n
    sys.exit(0 if allok else 1)


if __name__ == "__main__":
    {"gen": lambda: gen(sys.argv[2], sys.argv[3:]), "check": lambda: check(sys.argv[2], sys.argv[3])}[sys.argv[1]]()
