# Promotional material

Rendered with `node scripts/promo-shots.mjs <dir>`, which turns every `.sheet[id]` in that
directory's `promo.html` into `<id>.png` at 2x. Edit the HTML and run it again.

| Directory | What it is |
|---|---|
| `.` | The original banners: `hero-zh`, `hero-en`, `social-zh`. They predate the multi-step plans, the sequencing attribution and the WebAssembly kernels, and the cross-check total printed on them has not been recomputed since — prefer `overview/` |
| `shots/` | The screenshots the sheets are built from, each kept once. Captured against `npm run preview` at 1480x940, deviceScaleFactor 2, with toasts hidden |
| `overview/` | The whole project: `hero` (1600x900), `views` (the six main screens), `verify` (the cross-check table, including what it does **not** cover). `post-zh.md` is the long write-up, `post-short-zh.md` a short one |
| `grid/` | Nine 1200x1200 squares for a 3x3 social post, each one readable on its own: cover, six capabilities, then the verification figures and the links. `post-zh.md` is the caption at about 400 characters, `post-short-zh.md` a 200-character one |
| `phase3/` | The third-phase release on its own: the multi-step dry run and the sequencing attribution |

Every screenshot is a real run on the bundled pUC19 (L09137) and pEGFP-N1 (U55762); none of
them is mocked up. Figures that quote cross-check numbers take them from
[CROSSCHECK.md](../CROSSCHECK.md) and say what is not covered, because a claim is only worth
as much as its stated scope.

Where a caption says what the project is built on, it has to separate the two things that
are easy to blur: the libraries it genuinely depends on (Teselagen's parsers, seqviz, and the
REBASE-derived enzyme data) and the references its own code is checked against (Biopython,
primer3, pydna). The cloning, thermodynamics and alignment code here is this project's own —
saying it comes from established packages would be an easier claim to make and a false one.

The longer caption quotes what a commercial alternative charges per seat. Whatever such a
figure says, it has to be the published one, carry the date it was read, and sit next to the
project's own licence rather than a conclusion drawn for the reader; re-read the vendor's
pricing page before reusing it, because a stale price is worse than none.

`SnapGene` is a trademark of Dotmatics; GATC is an independent implementation and is not
affiliated with it. The banners carry that notice and any new one should too.
