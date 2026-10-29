// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Bio.Restriction has to find exactly the cut sites the built-in scanner finds; where
// it does not, the swap would change what the app reports.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PlasmidDocument } from '../../types/schema';
import { COMMERCIAL_ENZYMES, findCutSites, getEnzymeByName } from '../../modules/seq-engine';
import { loadSampleLibrary } from '../../app/samples';
import { restrictionSites, pythonVersions } from './index';

let pUC19: PlasmidDocument;

beforeAll(async () => {
  [pUC19] = (await loadSampleLibrary()).docs;
}, 120_000);

describe('Biopython in the page', () => {
  it('loads and reports its version', async () => {
    expect((await pythonVersions()).biopython).toMatch(/^\d+\.\d+/);
  }, 300_000);

  it('finds the same EcoRI and HindIII cuts as the built-in scanner', async () => {
    const names = ['EcoRI', 'HindIII', 'BamHI', 'PstI'];
    const ours = findCutSites(pUC19, names.map((n) => getEnzymeByName(n)!))
      .map((site) => `${site.enzyme.name}@${site.cutPositionTop}`)
      .sort();
    const theirs = (await restrictionSites(pUC19.sequence, true, names)).sites
      .map((hit) => `${hit.enzyme}@${hit.cutTop}`)
      .sort();
    expect(theirs).toEqual(ours);
  }, 300_000);

  it('agrees across the whole commercial set, and says which names it does not know', async () => {
    const names = COMMERCIAL_ENZYMES.map((e) => e.name);
    const result = await restrictionSites(pUC19.sequence, true, names);
    const known = new Set(result.sites.map((hit) => hit.enzyme));

    // Every site Biopython reports for an enzyme it knows must be one we report too.
    const ours = new Set(
      findCutSites(pUC19, COMMERCIAL_ENZYMES).map((s) => `${s.enzyme.name}@${s.cutPositionTop}`),
    );
    const disagree = result.sites
      .filter((hit) => !ours.has(`${hit.enzyme}@${hit.cutTop}`))
      .map((hit) => `${hit.enzyme}@${hit.cutTop}`);
    expect({ disagree: disagree.slice(0, 10), count: disagree.length }).toEqual({ disagree: [], count: 0 });

    // Both strands of the cut agree too, which is what the overhang is read from.
    const bothStrands = new Set(
      findCutSites(pUC19, COMMERCIAL_ENZYMES).map(
        (site) => `${site.enzyme.name}@${site.cutPositionTop}:${site.cutPositionBottom}`,
      ),
    );
    const wrongCut = result.sites
      .filter((hit) => !bothStrands.has(`${hit.enzyme}@${hit.cutTop}:${hit.cutBottom}`))
      .map((hit) => `${hit.enzyme}@${hit.cutTop}:${hit.cutBottom}`);
    expect({ wrongCut: wrongCut.slice(0, 8), count: wrongCut.length }).toEqual({ wrongCut: [], count: 0 });

    // Which recognition site each cut belongs to, and the strand it reads on: the
    // interface shows both, and the methylation check is keyed on the site.
    const placed = new Set(
      findCutSites(pUC19, COMMERCIAL_ENZYMES).map(
        (site) =>
          `${site.enzyme.name}@${site.position}/${site.strand}->${site.cutPositionTop}:${site.cutPositionBottom}`,
      ),
    );
    const wrongSite = result.sites
      .filter(
        (hit) =>
          !placed.has(`${hit.enzyme}@${hit.position}/${hit.strand}->${hit.cutTop}:${hit.cutBottom}`),
      )
      .map((hit) => `${hit.enzyme}@${hit.position}/${hit.strand}->${hit.cutTop}:${hit.cutBottom}`);
    expect({ wrongSite: wrongSite.slice(0, 8), count: wrongSite.length }).toEqual({
      wrongSite: [],
      count: 0,
    });

    // And the gap in coverage is a fact the UI would have to live with.
    console.log(
      `commercial enzymes: ${names.length}, known to Bio.Restriction: ${names.length - result.unknown.length}, ` +
        `unknown: ${result.unknown.length}, cutting pUC19: ${known.size}`,
    );
  }, 600_000);
});
