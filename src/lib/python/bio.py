# GATC - Gene Assembly & Toolkit for Cloning
# Copyright (C) 2026 Xu Zhonghe
# SPDX-License-Identifier: GPL-3.0-or-later
#
# The Python side of the bridge. The cutting itself is Biopython's: finding the
# recognition site, working out where each strand is cut and what overhang that
# leaves. What this file adds is a way to hand Biopython an enzyme it does not
# carry - most of REBASE, and anything a user defines later - built as the same
# kind of class Biopython builds for its own, so both go through one code path.
#
# Methylation blocking and buffer choice stay on the TypeScript side; no package
# has them.

import re

from Bio.Data.IUPACData import ambiguous_dna_values
from Bio.Restriction import Restriction as R
from Bio.Restriction import RestrictionBatch
from Bio.Seq import Seq

_COMPLEMENT = str.maketrans("ACGTRYSWKMBDHVN", "TGCAYRSWMKVHDBN")
# The base order Biopython itself builds its enzyme classes in; any other order
# has no consistent method resolution.
_TAIL = ("AbstractCut", "RestrictionType")
_built = {}


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
        if _at(sequence, start + offset) not in ambiguous_dna_values.get(code, code):
            return False
    return True


def _pattern(site):
    """An IUPAC motif as the regex Biopython searches with."""
    out = []
    for code in site:
        bases = ambiguous_dna_values.get(code, code)
        out.append("." if len(bases) == 4 else bases if len(bases) == 1 else "[%s]" % bases)
    return "".join(out)


def _define(name, site, cut_top, cut_bottom, second):
    """Build the enzyme class Biopython would have built, from REBASE numbers.

    `cut_top` and `cut_bottom` are offsets from the start of the recognition site,
    which is how REBASE states them and what Biopython's fst5 and fst3 are derived
    from: fst5 is the top-strand cut from the start of the site, fst3 the
    bottom-strand cut from its end.
    """
    size = len(site)
    fst5, fst3 = cut_top, cut_bottom - size
    scd5, scd3 = (second[0], second[1] - size) if second else (None, None)
    ovhg = cut_top - cut_bottom
    key = re.sub(r"\W", "_", name)

    reverse = _revcomp(site)
    palindromic = site == reverse
    compsite = "(?=(?P<%s>%s))" % (key, _pattern(site))
    if not palindromic:
        compsite += "|(?=(?P<%s_as>%s))" % (key, _pattern(reverse))

    # The overhang as Biopython writes it: the bases between the two cuts, with an
    # N wherever that falls outside the recognition site.
    low, high = sorted((cut_top, cut_bottom))
    ovhgseq = "".join(site[i] if 0 <= i < size else "N" for i in range(low, high))

    frequency = 4.0**size
    for code in site:
        frequency /= len(ambiguous_dna_values.get(code, code))

    chosen = [
        "Palindromic" if palindromic else "NonPalindromic",
        "TwoCuts" if second else "OneCut",
        "Blunt" if ovhg == 0 else ("Ov5" if ovhg < 0 else "Ov3"),
        "Defined" if set(site) <= set("ACGT") else "Ambiguous",
        # Methylation is decided by the caller, which knows the host.
        "Meth_Undep",
        "Not_available",
    ]
    bases = tuple(getattr(R, n) for n in chosen + list(_TAIL))
    attributes = {
        "size": size,
        "site": site,
        "substrat": "DNA",
        "fst5": fst5,
        "fst3": fst3,
        "scd5": scd5,
        "scd3": scd3,
        "ovhg": ovhg,
        "ovhgseq": ovhgseq,
        "results": None,
        "dna": None,
        "charac": (fst5, fst3, scd5, scd3, site),
        "compsite": compsite,
        "suppl": (),
        "freq": frequency,
    }
    meta = type.__new__(R.RestrictionType, "RestrictionType", bases, {})
    return meta(key, bases, attributes)


def _enzyme(definition):
    """Biopython's own enzyme where it has one, otherwise one built from REBASE."""
    name = definition["name"]
    for candidate in (name, re.sub(r"\W", "_", name)):
        try:
            return RestrictionBatch([candidate]).get(candidate), False
        except ValueError:
            continue
    cached = _built.get(name)
    if cached is None:
        second = definition.get("second")
        cached = _define(
            name,
            definition["site"].upper(),
            definition["cutTop"],
            definition["cutBottom"],
            (second["top"], second["bottom"]) if second else None,
        )
        _built[name] = cached
    return cached, True


def restriction_sites(sequence, circular, definitions):
    """Where each enzyme cuts `sequence`, with the site and strand each cut belongs to.

    Positions are 0-based. `search` gives the 1-based index of the base after the
    cut on the top strand. Read on the bottom strand the enzyme's own frame runs
    the other way, so the cut reported there is its bottom-strand cut and the site
    starts fst3 after it rather than fst5 before it.
    """
    # Objects handed over from JavaScript arrive as proxies, not dicts.
    if hasattr(definitions, "to_py"):
        definitions = definitions.to_py()

    length = len(sequence)
    if not length:
        return {"sites": [], "built": []}

    enzymes, built, by_enzyme = [], [], {}
    for definition in definitions:
        enzyme, was_built = _enzyme(definition)
        enzymes.append(enzyme)
        by_enzyme[str(enzyme)] = definition["name"]
        if was_built:
            built.append(definition["name"])

    out = []
    seq = Seq(sequence)
    for enzyme, positions in RestrictionBatch(enzymes).search(seq, linear=not circular).items():
        site = enzyme.site
        name = by_enzyme.get(str(enzyme), str(enzyme))
        # A palindromic site reads the same on either strand, so it has no
        # orientation to report and only the forward placement is tried.
        palindromic = site == _revcomp(site)
        pairs = [(enzyme.fst5, enzyme.fst3)]
        if enzyme.scd5 is not None:
            pairs.append((enzyme.scd5, enzyme.scd3))
        for position in positions:
            top = position - 1
            start, strand, offsets = None, 1, pairs[0]
            for five, three in pairs:
                tries = [(top - five, 1, site)]
                if not palindromic:
                    tries.append((top + three, -1, _revcomp(site)))
                for candidate, candidate_strand, pattern in tries:
                    if _matches(sequence, candidate, pattern, circular):
                        start, strand, offsets = candidate, candidate_strand, (five, three)
                        break
                if start is not None:
                    break
            five, three = offsets
            if start is None:
                bottom = top - enzyme.ovhg
            else:
                bottom = start + len(site) + three if strand == 1 else start + len(site) - five
            low, high = sorted((top, bottom))
            out.append(
                {
                    "enzyme": name,
                    "site": site,
                    "position": (start % length) if (start is not None and circular) else start,
                    "strand": strand,
                    "cutTop": (top % length) if circular else top,
                    "cutBottom": (bottom % length) if circular else bottom,
                    "overhang": "".join(_at(sequence, i) for i in range(low, high)),
                }
            )
    out.sort(key=lambda hit: (hit["cutTop"], hit["enzyme"]))
    return {"sites": out, "built": built}


def versions():
    import Bio

    return {"biopython": Bio.__version__}
