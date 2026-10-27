#!/usr/bin/env bash
# GATC - Gene Assembly & Toolkit for Cloning
# Copyright (C) 2026 Qiu Shui
# SPDX-License-Identifier: GPL-3.0-or-later
# Cross-checks GATC against independent tools on real SnapGene-authored files:
#   1. .dna interoperability: GATC import vs Biopython's SnapGene parser, and GATC export read back by Biopython
#   2. restriction sites vs REBASE, primer Tm vs primer3, CDS translations vs SnapGene's stored proteins
#   3. digest / PCR / restriction cloning vs pydna; Gibson and Golden Gate against known answers
#   4. Gateway BP/LR and Cre/lox vs pydna, on real Gateway vectors
#   5. pairwise alignment vs Biopython, TA/TOPO/LIC/GC and gel read-back, mutagenesis vs primer3
# Usage: npm run crosscheck            (work files go to .crosscheck/, which is git-ignored)
set -euo pipefail
cd "$(dirname "$0")/../.."
W=.crosscheck
mkdir -p "$W/refdata/snapgene" "$W/refdata/biopython" "$W/refdata/gateway" "$W/out"

if [ ! -x "$W/venv/bin/python" ]; then
  if command -v uv >/dev/null; then uv venv -q "$W/venv" && uv pip install -q -p "$W/venv" biopython primer3-py pydna
  else python3 -m venv "$W/venv" && "$W/venv/bin/pip" install -q biopython primer3-py pydna; fi
fi
PY="$W/venv/bin/python -I"

BP=https://raw.githubusercontent.com/biopython/biopython/master/Tests/SnapGene
for f in linebreak_in_qualifier_text looped_feature looped_feature_origin pFA-KanMX4 sample-d sample-e sample-f sample-hybridization-params; do
  [ -s "$W/refdata/biopython/$f.dna" ] || curl -sfL -o "$W/refdata/biopython/$f.dna" "$BP/$f.dna"
done
SG='https://www.snapgene.com/local/fetch.php?set='
for p in "basic_cloning_vectors&plasmid=pUC19" "basic_cloning_vectors&plasmid=pBR322" \
         "basic_cloning_vectors&plasmid=pACYC184" "basic_cloning_vectors&plasmid=pBluescript_II_KS(%2B)" \
         "mammalian_expression_vectors&plasmid=pcDNA3.1(%2B)" "fluorescent_protein_genes_and_plasmids&plasmid=pEGFP-N1" \
         "yeast_plasmids&plasmid=pYES2"; do
  n=$(echo "$p" | sed 's/.*plasmid=//; s/%2B/+/g')
  [ -s "$W/refdata/snapgene/$n.dna" ] || curl -sfL -o "$W/refdata/snapgene/$n.dna" "$SG$p" || rm -f "$W/refdata/snapgene/$n.dna"
done
GW='https://www.snapgene.com/local/fetch.php?set=gateway_cloning_vectors&plasmid='
for n in pDONR221 pDONR207 pDONR201 pDONR_Zeo pENTR1A pDEST14 pDEST15 pDEST17 pDEST27 pcDNA-DEST40 pET-DEST42 pLenti6_V5-DEST; do
  [ -s "$W/refdata/gateway/$n.dna" ] || curl -sfL -o "$W/refdata/gateway/$n.dna" "$GW$n" || rm -f "$W/refdata/gateway/$n.dna"
done
find "$W/refdata" -size 0 -delete
ALL=("$W"/refdata/snapgene/*.dna "$W"/refdata/biopython/*.dna)
SGF=("$W"/refdata/snapgene/*.dna)
GWF=("$W"/refdata/gateway/*.dna)

status=0
echo "== 1. .dna interoperability (${#ALL[@]} SnapGene-authored files) =="
$PY scripts/crosscheck/ref_snapgene.py "$W/out/ref.json" "${ALL[@]}"
node scripts/crosscheck/gatc_dump.mjs "$W/out/gatc.json" "$W/out/export" "${ALL[@]}" 2>/dev/null
echo "-- import: GATC vs Biopython"; python3 scripts/crosscheck/compare.py "$W/out/ref.json" "$W/out/gatc.json" | tail -1 || status=1
$PY scripts/crosscheck/ref_snapgene.py "$W/out/rt.json" "$W/out/export"/*.dna
echo "-- export: GATC-written .dna read by Biopython"; python3 scripts/crosscheck/compare.py "$W/out/ref.json" "$W/out/rt.json" | tail -1 || status=1

echo "== 2. enzymes, Tm, translation =="
$PY - "$W/random40k.fasta" "$W/oligos.txt" <<'PYEOF'
import random, sys
random.seed(7)
open(sys.argv[1], "w").write(">random40k\n" + "".join(random.choice("ACGT") for _ in range(40000)) + "\n")
olig = ["GTAAAACGACGGCCAGT", "CAGGAAACAGCTATGAC", "TAATACGACTCACTATAGGG", "GCTAGTTATTGCTCAGCGG"]
for _ in range(300):
    gc = random.uniform(0.25, 0.75)
    olig.append("".join(random.choice("GC") if random.random() < gc else random.choice("AT") for _ in range(random.randint(15, 35))))
open(sys.argv[2], "w").write("\n".join(olig))
PYEOF
node scripts/crosscheck/gatc_algos.mjs "$W/out/algos.json" "$W/oligos.txt" "${SGF[@]}" "$W/random40k.fasta" 2>/dev/null
$PY scripts/crosscheck/ref_algos.py "$W/out/algos.json" "${SGF[@]}" "$W/random40k.fasta" | grep -v "^    [ACGT]" || status=1

echo "== 3. cloning simulations =="
$PY scripts/crosscheck/ref_cloning.py gen "$W/out/scen.json" "${SGF[@]}" >/dev/null
node scripts/crosscheck/gatc_cloning.mjs "$W/out/scen.json" "$W/out/cloning.json" 2>/dev/null
$PY scripts/crosscheck/ref_cloning.py check "$W/out/scen.json" "$W/out/cloning.json" | grep -v "ref skipped" || status=1

echo "== 4. Gateway and site-specific recombination =="
$PY scripts/crosscheck/ref_recombination.py gen "$W/out/rec.json" "${GWF[@]}" >/dev/null
node scripts/crosscheck/gatc_recombination.mjs "$W/out/rec.json" "$W/out/rec-gatc.json" 2>/dev/null
$PY scripts/crosscheck/ref_recombination.py check "$W/out/rec.json" "$W/out/rec-gatc.json" || status=1

echo "== 5. alignment, single-fragment cloning, mutagenesis, gel =="
node scripts/crosscheck/gatc_misc.mjs "$W/out/misc.json" \
  "$W/refdata/gateway/pENTR1A.dna" "$W/refdata/gateway/pDEST14.dna" 2>/dev/null
$PY scripts/crosscheck/ref_misc.py "$W/out/misc.json" | grep -vE "^  OK " || status=1
exit $status
