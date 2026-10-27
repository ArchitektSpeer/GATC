"""Compares gatc_algos.mjs output with Biopython Restriction (REBASE), primer3 and SnapGene's
stored CDS translations. Usage: python ref_algos.py gatc-algos.json seqfile1 ...
"""
import json
import os
import sys

import primer3
from Bio import SeqIO
from Bio.Restriction import AllEnzymes
from Bio.Seq import Seq

gatc = json.load(open(sys.argv[1]))
fmt = lambda p: "snapgene" if p.endswith(".dna") else ("genbank" if p.endswith((".gb", ".gbk")) else "fasta")
records = {os.path.basename(p): SeqIO.read(p, fmt(p)) for p in sys.argv[2:]}
rebase = {str(e): e for e in AllEnzymes}
report = {"enzymes": {}, "cuts": {}, "tm": {}, "translations": {}}

# 1. Enzyme definitions vs REBASE.
same, differ, absent = 0, [], []
for e in gatc["enzymes"]:
    r = rebase.get(e["name"])
    if r is None:
        absent.append(e["name"])
        continue
    if r.site.upper() != e["site"].upper():
        differ.append(f"{e['name']}: site {e['site']} vs REBASE {r.site}")
    else:
        same += 1
print(f"[enzymes] {same} match REBASE site, {len(differ)} differ, {len(absent)} not in Biopython REBASE")
for d in differ[:15]:
    print("   ", d)
report["enzymes"] = {"match": same, "differ": differ, "absent": absent}

# 2. Cut positions per enzyme per sequence (top-strand cut, 0-based).
tot_ok = tot = 0
mism = []
for name, info in gatc["cuts"].items():
    rec = records[name]
    s = Seq(str(rec.seq).upper())
    linear = info["topology"] != "circular"
    for e in gatc["enzymes"]:
        r = rebase.get(e["name"])
        if r is None or r.site.upper() != e["site"].upper():
            continue
        ref = sorted({(p - 1) % len(s) for p in r.search(s, linear=linear)})
        got = info["sites"].get(e["name"], [])
        tot += 1
        if ref == got:
            tot_ok += 1
        else:
            mism.append((name, e["name"], ref[:6], got[:6]))
print(f"[cuts] {tot_ok}/{tot} enzyme x sequence combinations give identical cut positions")
for m in mism[:25]:
    print("   ", m)
report["cuts"] = {"ok": tot_ok, "total": tot, "mismatches": mism}

# 3. Tm vs primer3 (SantaLucia 1998 + Owczarzy 2008, same buffer).
diffs = []
for oligo, tm in gatc["tm"].items():
    ref = primer3.calc_tm(oligo, mv_conc=50, dv_conc=2, dntp_conc=0.8, dna_conc=250,
                          tm_method="santalucia", salt_corrections_method="owczarzy")
    diffs.append((abs(tm - ref), oligo, tm, ref))
diffs.sort(reverse=True)
within1 = sum(d[0] <= 1 for d in diffs)
print(f"[tm] {len(diffs)} oligos: mean |dTm| {sum(d[0] for d in diffs)/len(diffs):.2f} C, "
      f"max {diffs[0][0]:.2f} C, within 1 C: {within1}/{len(diffs)}")
for d in diffs[:5]:
    print(f"    {d[1]}  GATC {d[2]:.2f}  primer3 {d[3]:.2f}")
report["tm"] = {"n": len(diffs), "worst": diffs[:10]}

# 4. CDS translations vs the translation SnapGene stored in the file.
ok = n = 0
for name, items in gatc["translations"].items():
    for t in items:
        n += 1
        a, b = t["gatc"].rstrip("*"), t["snapgene"].rstrip("*")
        # SnapGene shows an alternative start codon as M.
        if a == b or (a[1:] == b[1:] and b[:1] == "M"):
            ok += 1
        else:
            print(f"    translation differs: {name} {t['name']}\n      GATC {a[:60]}\n      SG   {b[:60]}")
print(f"[translation] {ok}/{n} CDS translations match SnapGene's stored protein")
report["translations"] = {"ok": ok, "total": n}
json.dump(report, open(os.path.splitext(sys.argv[1])[0] + "-report.json", "w"), indent=1, default=str)
sys.exit(0 if not differ and not mism and ok == n and diffs[0][0] < 0.5 else 1)
