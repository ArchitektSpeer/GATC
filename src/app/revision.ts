// SPDX-License-Identifier: GPL-3.0-or-later
// Document revisions. Documents are immutable: every edit produces a new object,
// so a revision number is assigned per object, increasing with each new version.
// Undo/redo restore earlier objects and therefore their earlier revisions, which
// keeps caches computed for that exact content valid.
import type { PlasmidDocument } from '../types/schema';

const revisions = new WeakMap<PlasmidDocument, number>();
let latest = 0;

export function docRevision(doc: PlasmidDocument): number {
  let rev = revisions.get(doc);
  if (rev === undefined) {
    rev = ++latest;
    revisions.set(doc, rev);
  }
  return rev;
}
