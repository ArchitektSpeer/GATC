# GATC - Gene Assembly & Toolkit for Cloning
# Copyright (C) 2026 Qiu Shui
# SPDX-License-Identifier: GPL-3.0-or-later
"""Compare two normalized dumps (reference vs GATC). Prints per-file diffs, exits 1 on mismatch.

Usage: python compare.py ref.json gatc.json [--key-by-basename]
"""
import json
import os
import sys


def key(f):
    # Part order of a single origin-spanning segment is representation-specific; compare as a set.
    return (f["type"], f["label"], f["strand"], tuple(sorted(tuple(p) for p in f["parts"])))


def load(p):
    return {os.path.basename(k): v for k, v in json.load(open(p)).items()}


ref, got = load(sys.argv[1]), load(sys.argv[2])
bad = 0
for name, r in ref.items():
    g = got.get(name)
    issues = []
    if g is None or "error" in g or "error" in r:
        issues.append(f"error: ref={r.get('error')} gatc={g and g.get('error')}")
    else:
        if r["sequence"] != g["sequence"]:
            issues.append(f"sequence differs (len {len(r['sequence'])} vs {len(g['sequence'])})")
        if r["topology"] != g["topology"]:
            issues.append(f"topology {r['topology']} vs {g['topology']}")
        for kind in ("features", "primers"):
            rk = {key(f) for f in r[kind]}
            # GATC may surface primers as primer_bind features; pool both sides.
            gk = {key(f) for f in g[kind]}
            if kind == "features":
                gk = {k for k in gk if k[0] != "primer_bind"}
            else:
                gk |= {key(f) for f in g["features"] if f["type"] == "primer_bind"}
            for k in sorted(rk - gk, key=str):
                issues.append(f"{kind} missing in GATC: {k}")
            for k in sorted(gk - rk, key=str):
                issues.append(f"{kind} extra in GATC:   {k}")
    status = "OK  " if not issues else "DIFF"
    bad += bool(issues)
    print(f"{status} {name}")
    for i in issues:
        print("       " + i)
print(f"\n{len(ref) - bad}/{len(ref)} files identical")
sys.exit(1 if bad else 0)
