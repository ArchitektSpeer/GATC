# Promotional material

Rendered with `node scripts/promo-shots.mjs <dir>`, which turns every `.sheet[id]` in that
directory's `promo.html` into `<id>.png` at 2x. Edit the HTML and run it again.

| Directory | What it is |
|---|---|
| `.` | The original banners: `hero-zh`, `hero-en`, `social-zh`. They predate the multi-step plans, the sequencing attribution and the WebAssembly kernels, and the cross-check total printed on them has not been recomputed since — prefer `overview/` |
| `shots/` | The screenshots the sheets are built from, each kept once. Captured against `npm run preview` at 1480x940, deviceScaleFactor 2, with toasts hidden |
| `overview/` | The whole project: `hero` (1600x900), `views` (the six main screens), `verify` (the cross-check table, including what it does **not** cover). `post-zh.md` is the long write-up, `post-short-zh.md` a short one |
| `grid/` | Nine 1200x1200 squares for a 3x3 social post, each one readable on its own: cover, six capabilities, then the verification figures and the links. `post-zh.md` is the caption, under 200 characters |
| `phase3/` | The third-phase release on its own: the multi-step dry run and the sequencing attribution |

Every screenshot is a real run on the bundled pUC19 (L09137) and pEGFP-N1 (U55762); none of
them is mocked up. Figures that quote cross-check numbers take them from
[CROSSCHECK.md](../CROSSCHECK.md) and say what is not covered, because a claim is only worth
as much as its stated scope.

`SnapGene` is a trademark of Dotmatics; GATC is an independent implementation and is not
affiliated with it. The banners carry that notice and any new one should too.
