# GATC - Gene Assembly & Toolkit for Cloning
# Copyright (C) 2026 Xu Zhonghe
# SPDX-License-Identifier: GPL-3.0-or-later
"""Checks the output of gatc_misc.mjs against Biopython, primer3 and pydna.

  python ref_misc.py gatc-misc.json

Covered: pairwise alignment scores (Biopython PairwiseAligner with the same affine-gap
scoring), single-fragment cloning products (known answers), site-directed mutagenesis
(Biopython translation of the mutated CDS and primer3 Tm of the designed primers), virtual gel
(a fragment's size read back off the ladder), and an LR reaction on a real entry vector with its
annotations removed (pydna gateway_assembly).
"""
import json
import sys

import primer3
from Bio import Align
from Bio.Seq import Seq
from pydna.assembly2 import gateway_assembly
from pydna.dseqrecord import Dseqrecord

got = json.load(open(sys.argv[1]))
failures = []


def check(name, ok, detail=""):
    print(f"  {'OK  ' if ok else 'FAIL'} {name}{'' if ok else '  ' + detail}")
    if not ok:
        failures.append(name)


def rc(s):
    return str(Seq(s).reverse_complement())


def canon_circular(s):
    s = s.upper()
    best = None
    for t in (s, rc(s)):
        d = t + t
        cand = min(d[i : i + len(t)] for i in range(len(t)))
        best = cand if best is None or cand < best else best
    return best


print("[pairwise alignment] vs Biopython PairwiseAligner (match 2, mismatch -1, gap -5/-1)")
for mode in ("global", "local"):
    aligner = Align.PairwiseAligner(
        mode=mode, match_score=2, mismatch_score=-1, open_gap_score=-5, extend_gap_score=-1
    )
    for row in got["pairwise"]:
        ref = aligner.score(row["a"], row["b"])
        mine = row["globalScore"] if mode == "global" else row["localScore"]
        check(
            f"{mode} score, {len(row['a'])} vs {len(row['b'])} bp",
            abs(ref - mine) < 1e-6,
            f"GATC {mine} vs Biopython {ref}",
        )

print("[single-fragment cloning] known answers")
sf = got["single_fragment"]
inputs = got["single_fragment_inputs"]
vector, insert = inputs["vector"], inputs["insert"]
check(
    "TA forward product is the vector followed by the insert",
    sf["ta_forward"]["product"] == vector + insert,
    f"got {sf['ta_forward']['product']}",
)
check(
    "TA reverse product carries the insert reverse-complemented",
    sf["ta_reverse"]["product"] == vector + rc(insert),
    f"got {sf['ta_reverse']['product']}",
)
check(
    "TA cloning into a blunt vector is refused",
    sf["ta_blunt_vector_rejected"]["product"] is None,
)
check(
    "GC cloning joins G/C overhangs",
    sf["gc_forward"]["product"] == vector + insert,
)
check(
    "GC cloning refuses a T-overhang vector",
    sf["gc_wrong_overhang_rejected"]["product"] is None,
)
check(
    "Zero Blunt TOPO joins blunt ends",
    sf["topo_blunt"]["product"] == vector + insert,
)
check(
    "directional TOPO keeps the CACC insert forward",
    sf["topo_directional"]["product"] == inputs["vectorDir"] + inputs["insertDir"]
    and sf["topo_directional"]["orientation"] == "forward",
    f"got {sf['topo_directional']['product']}",
)
check(
    "directional TOPO refuses an insert without CACC",
    sf["topo_directional_no_cacc"]["product"] is None,
)
check(
    "LIC joins complementary tails",
    sf["lic"]["product"] == inputs["vectorLic"] + inputs["insertLic"],
    f"got {sf['lic']['product']}",
)
check(
    "LIC refuses non-complementary tails",
    sf["lic_mismatched_tails"]["product"] is None,
)

print("[site-directed mutagenesis] vs Biopython translation and primer3 Tm")
CDS = "ATGGCTAGCAAAGGCGAAGAACTGTTTACCGGCGTTGTTCCGATTCTGGTTGAACTGGATGGCGATGTTAAC"
OFFSET = 13
for row in got["mutagenesis"]:
    mutation = row["mutation"]
    kind = mutation["kind"]
    start = mutation["position"] - OFFSET
    if kind == "substitution":
        expected_cds = CDS[:start] + mutation["replacement"] + CDS[start + len(mutation["replacement"]) :]
    elif kind == "deletion":
        expected_cds = CDS[:start] + CDS[start + mutation["length"] :]
    else:
        expected_cds = CDS[:start] + mutation["insertion"] + CDS[start:]
    label = f"{kind} at {start}"
    sequence = row["mutatedSequence"]
    if sequence is None:
        check(label, False, "no mutated sequence")
        continue
    cds_start, cds_end = row["cdsStart"], row["cdsEnd"]
    actual_cds = sequence[cds_start:cds_end]
    check(
        f"{label}: mutated CDS matches the intended edit",
        actual_cds == expected_cds,
        f"got {actual_cds[:60]} vs {expected_cds[:60]}",
    )
    check(
        f"{label}: protein matches Biopython translation",
        str(Seq(actual_cds).translate()) == str(Seq(expected_cds).translate()),
    )
    forward = row["forward"]
    if forward and row["forwardTm"]:
        # The reported Tm is for the annealing region; primer3 on the whole oligo is the
        # closest independent figure, so allow the tail to shift it.
        ref_tm = primer3.calc_tm(
            forward, mv_conc=50, dv_conc=2, dntp_conc=0.8, dna_conc=250,
            tm_method="santalucia", salt_corrections_method="owczarzy",
        )
        check(
            f"{label}: forward primer Tm within 8 C of primer3",
            abs(ref_tm - row["forwardTm"]) < 8,
            f"GATC {row['forwardTm']:.1f} vs primer3 {ref_tm:.1f}",
        )
    else:
        check(f"{label}: mutagenesis primers were designed", False, str(row["warnings"]))

print("[virtual gel] fragment size read back off the 1 kb ladder")
ladder = sorted(
    ((band["sizeBp"], band["migration"]) for band in got["gel"]["ladder"] if band["sizeBp"]),
    key=lambda b: b[1],
)
mig_to_size = [(m, s) for s, m in ladder]
for band in got["gel"]["sample"]:
    size, migration = band["sizeBp"], band["migration"]
    inside = mig_to_size[0][0] <= migration <= mig_to_size[-1][0]
    if not inside:
        print(f"  --   {size} bp runs outside the ladder, skipped")
        continue
    # Log-linear interpolation between the two flanking ladder bands.
    lower = max((b for b in mig_to_size if b[0] <= migration), key=lambda b: b[0])
    upper = min((b for b in mig_to_size if b[0] >= migration), key=lambda b: b[0])
    if upper[0] == lower[0]:
        estimate = lower[1]
    else:
        import math

        weight = (migration - lower[0]) / (upper[0] - lower[0])
        estimate = 10 ** (math.log10(lower[1]) + weight * (math.log10(upper[1]) - math.log10(lower[1])))
    error = abs(estimate - size) / size
    check(f"{size} bp reads back as {estimate:.0f} bp", error < 0.12, f"{error:.0%} off")
by_size = sorted(got["gel"]["sample"], key=lambda band: -band["sizeBp"])
migrations = [band["migration"] for band in by_size]
check(
    "migration increases monotonically as fragment size falls",
    all(a < b for a, b in zip(migrations, migrations[1:])),
    str([round(m, 3) for m in migrations]),
)

print("[Gateway LR on an unannotated real entry vector] vs pydna")
lr = got["unannotated_lr"]
refs = gateway_assembly(
    [Dseqrecord(lr["entry"], circular=True), Dseqrecord(lr["destination"], circular=True)],
    "LR",
    circular_only=True,
)
if not refs:
    check("pydna produced an LR product", False)
elif not lr["product"]:
    check("GATC produced an LR product", False, str(lr["warnings"]))
else:
    check(
        "expression clone matches pydna",
        canon_circular(lr["product"]) in {canon_circular(str(p.seq)) for p in refs},
        f"GATC {len(lr['product'])} bp vs pydna {[len(p) for p in refs]}",
    )

print()
if failures:
    print(f"{len(failures)} check(s) failed: " + ", ".join(failures[:8]))
    sys.exit(1)
print("all checks passed")
