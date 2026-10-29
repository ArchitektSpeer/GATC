# GATC - Gene Assembly & Toolkit for Cloning
# Copyright (C) 2026 Xu Zhonghe
# SPDX-License-Identifier: GPL-3.0-or-later
#
# The Python side of the bridge: everything here is a thin call into Biopython,
# returning plain dicts the TypeScript side turns into its own types. Nothing in
# this file decides biology of its own - where Biopython has the answer it is
# asked for it, and where it has none (methylation blocking, buffer choice) the
# caller keeps its own rules.

from Bio.Data.IUPACData import ambiguous_dna_values
from Bio.Restriction import RestrictionBatch
from Bio.Seq import Seq

_COMPLEMENT = str.maketrans("ACGTRYSWKMBDHVN", "TGCAYRSWMKVHDBN")


def _revcomp(text):
    return text.translate(_COMPLEMENT)[::-1]


def _at(sequence, index):
    return sequence[index % len(sequence)]


def _matches(sequence, start, pattern, circular):
    """Whether `pattern`, an IUPAC motif, sits at `start`. Codes come from Biopython."""
    length = len(sequence)
    if not circular and (start < 0 or start + len(pattern) > length):
        return False
    for offset, code in enumerate(pattern):
        base = _at(sequence, start + offset)
        if base not in ambiguous_dna_values.get(code, code):
            return False
    return True


def restriction_sites(sequence, circular, names):
    """Where each named enzyme cuts `sequence`, as Bio.Restriction has it.

    Positions are 0-based. `search` gives the 1-based index of the base after the
    cut on the top strand; `ovhg` is the overhang, negative for a 5' overhang and
    positive for a 3' one, so the bottom-strand cut sits that many bases the other
    way. `fst5` is the cut's offset from the start of the recognition site, which
    is how the site each cut belongs to - and the strand it reads on - is found.
    """
    known, unknown = [], []
    for name in names:
        try:
            RestrictionBatch([name])
        except ValueError:
            unknown.append(name)
        else:
            known.append(name)
    if not known:
        return {"sites": [], "unknown": unknown}

    length = len(sequence)
    out = []
    for enzyme, positions in RestrictionBatch(known).search(Seq(sequence), linear=not circular).items():
        site = enzyme.site
        for position in positions:
            top = position - 1
            # `ovhg` does not hold for every enzyme - on one that leaves a long 3'
            # overhang reaching back before its site (TspRI, TscAI) it disagrees with
            # the enzyme's own elucidate() by a base. `fst3`, the bottom-strand cut
            # measured from the end of the site, always does; it is used below once
            # the site this cut belongs to has been placed.
            bottom = top - enzyme.ovhg
            # Which recognition site this cut belongs to. Read on the top strand the
            # site starts fst5 before the cut. Read on the bottom strand the enzyme's
            # own frame runs the other way, so the cut reported here is its
            # bottom-strand cut and the site starts fst3 after it.
            # An enzyme that cuts on both sides of its site has a second pair of
            # offsets, scd5/scd3, which behave exactly as fst5/fst3 do.
            pairs = [(enzyme.fst5, enzyme.fst3)]
            second = getattr(enzyme, "scd5", None)
            if second is not None:
                pairs.append((second, enzyme.scd3))

            start, strand, offsets = None, 1, None
            for five, three in pairs:
                for candidate, candidate_strand, pattern in (
                    (top - five, 1, site),
                    (top + three, -1, _revcomp(site)),
                ):
                    if _matches(sequence, candidate, pattern, circular):
                        start, strand, offsets = candidate, candidate_strand, (five, three)
                        break
                if start is not None:
                    break
            if start is not None:
                five, three = offsets
                bottom = start + len(site) + three if strand == 1 else start + len(site) - five
            low, high = sorted((top, bottom))
            out.append(
                {
                    "enzyme": str(enzyme),
                    "site": site,
                    "position": (start % length) if (start is not None and circular) else start,
                    "strand": strand,
                    "cutTop": (top % length) if circular else top,
                    "cutBottom": (bottom % length) if circular else bottom,
                    "ovhg": enzyme.ovhg,
                    "overhang": "".join(_at(sequence, i) for i in range(low, high)),
                }
            )
    out.sort(key=lambda hit: (hit["cutTop"], hit["enzyme"]))
    return {"sites": out, "unknown": unknown}


def versions():
    import Bio

    return {"biopython": Bio.__version__}
