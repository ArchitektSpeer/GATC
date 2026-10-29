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
            bottom = top - enzyme.ovhg
            # The site this cut belongs to lies fst5 bases before it on the strand
            # it reads; try the top strand first, then the bottom.
            start, strand = None, 1
            for candidate, candidate_strand, pattern in (
                (top - enzyme.fst5, 1, site),
                (top + enzyme.fst5 - len(site), -1, _revcomp(site)),
            ):
                if _matches(sequence, candidate, pattern, circular):
                    start, strand = candidate, candidate_strand
                    break
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
