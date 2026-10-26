import type { PlasmidDocument, VirtualGelLane } from '../../types/schema';

export type LadderName =
  | 'NEB 1kb Plus'
  | 'NEB 1kb'
  | 'NEB 100bp'
  | 'Takara DL2000'
  | 'Takara DL5000';

export type GelConformation = 'linear' | 'supercoiled' | 'nicked';

export interface LadderBand {
  sizeBp: number;
  massNg: number;
  highlighted?: boolean;
}

export const DNA_LADDERS: Record<LadderName, LadderBand[]> = {
  'NEB 1kb Plus': [
    { sizeBp: 100, massNg: 22 },
    { sizeBp: 200, massNg: 26 },
    { sizeBp: 300, massNg: 30 },
    { sizeBp: 400, massNg: 34 },
    { sizeBp: 500, massNg: 38 },
    { sizeBp: 600, massNg: 42 },
    { sizeBp: 700, massNg: 46 },
    { sizeBp: 800, massNg: 50 },
    { sizeBp: 900, massNg: 54 },
    { sizeBp: 1000, massNg: 64, highlighted: true },
    { sizeBp: 1200, massNg: 58 },
    { sizeBp: 1500, massNg: 62 },
    { sizeBp: 2000, massNg: 66 },
    { sizeBp: 3000, massNg: 76, highlighted: true },
    { sizeBp: 4000, massNg: 70 },
    { sizeBp: 5000, massNg: 74 },
    { sizeBp: 6000, massNg: 78 },
    { sizeBp: 8000, massNg: 82 },
    { sizeBp: 10000, massNg: 88 }
  ],
  'NEB 1kb': [
    { sizeBp: 500, massNg: 40 },
    { sizeBp: 1000, massNg: 56, highlighted: true },
    { sizeBp: 1500, massNg: 48 },
    { sizeBp: 2000, massNg: 52 },
    { sizeBp: 2500, massNg: 54 },
    { sizeBp: 3000, massNg: 62, highlighted: true },
    { sizeBp: 4000, massNg: 58 },
    { sizeBp: 5000, massNg: 60 },
    { sizeBp: 6000, massNg: 64 },
    { sizeBp: 8000, massNg: 68 },
    { sizeBp: 10000, massNg: 72 }
  ],
  'NEB 100bp': [
    { sizeBp: 100, massNg: 24 },
    { sizeBp: 200, massNg: 28 },
    { sizeBp: 300, massNg: 32 },
    { sizeBp: 400, massNg: 36 },
    { sizeBp: 500, massNg: 48, highlighted: true },
    { sizeBp: 600, massNg: 42 },
    { sizeBp: 700, massNg: 46 },
    { sizeBp: 800, massNg: 50 },
    { sizeBp: 900, massNg: 54 },
    { sizeBp: 1000, massNg: 66, highlighted: true },
    { sizeBp: 1200, massNg: 58 },
    { sizeBp: 1517, massNg: 64 }
  ],
  'Takara DL2000': [
    { sizeBp: 100, massNg: 30 },
    { sizeBp: 250, massNg: 34 },
    { sizeBp: 500, massNg: 38 },
    { sizeBp: 750, massNg: 42 },
    { sizeBp: 1000, massNg: 52 },
    { sizeBp: 2000, massNg: 70, highlighted: true }
  ],
  'Takara DL5000': [
    { sizeBp: 100, massNg: 26 },
    { sizeBp: 250, massNg: 30 },
    { sizeBp: 500, massNg: 34 },
    { sizeBp: 750, massNg: 38 },
    { sizeBp: 1000, massNg: 46 },
    { sizeBp: 1500, massNg: 50 },
    { sizeBp: 2000, massNg: 54 },
    { sizeBp: 3000, massNg: 66, highlighted: true },
    { sizeBp: 4000, massNg: 62 },
    { sizeBp: 5000, massNg: 68 }
  ]
};

export interface GelSampleInput {
  id?: string;
  label: string;
  ladder?: LadderName;
  fragments?: Array<{
    sizeBp: number;
    conformation?: GelConformation;
    massNg?: number;
    doc?: PlasmidDocument;
  }>;
}

export interface GelRunParams {
  agarosePercent: number;
  voltage?: number;
  minutes?: number;
}

const CONFORMATION_FACTORS: Record<GelConformation, number> = {
  linear: 1,
  supercoiled: 0.68,
  nicked: 1.35
};

const STAINING_EFFICIENCY: Record<GelConformation, number> = {
  linear: 1,
  supercoiled: 0.9,
  nicked: 0.68
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Ferguson-style mobility model: log(mu) = log(mu0) - Kr * C.
 * The retardation coefficient is expressed with the logarithmic fragment-size
 * model that dominates in the small-fragment regime, and is amplified by the
 * agarose concentration.
 */
export function computeMigration(apparentBp: number, params: GelRunParams): number {
  const size = Math.max(1, Number.isFinite(apparentBp) ? apparentBp : 1);
  const concentration = clamp(
    Number.isFinite(params.agarosePercent) ? params.agarosePercent : 1,
    0.5,
    3
  );
  const minutes = clamp(
    Number.isFinite(params.minutes) ? (params.minutes as number) : 45,
    1,
    600
  );
  const voltage = clamp(
    Number.isFinite(params.voltage) ? (params.voltage as number) : 5,
    0.5,
    30
  );

  const normalizedLogSize = Math.log10(size + 1) / 2;
  const retardation =
    0.25 * Math.pow(concentration, 1.3) * Math.pow(normalizedLogSize, 2.2);
  const mobility = Math.exp(-retardation);
  const runFactor = clamp((minutes / 45) * (voltage / 5), 0.05, 4);
  const migration = 1 - Math.pow(1 - mobility, runFactor);
  return clamp(migration, 0, 0.995);
}

function ladderIntensities(bands: LadderBand[]): number[] {
  let maximumMass = 1;
  for (const band of bands) maximumMass = Math.max(maximumMass, band.massNg);
  return bands.map(band => {
    const base = 0.22 + 0.78 * (band.massNg / maximumMass);
    const scaled = band.highlighted ? base * 1.9 : base;
    return clamp(scaled, 0.1, 1);
  });
}

function fragmentIntensities(
  fragments: Array<{ sizeBp: number; conformation: GelConformation; massNg: number }>
): number[] {
  let maximumMass = 1;
  for (const fragment of fragments) maximumMass = Math.max(maximumMass, fragment.massNg);
  return fragments.map(fragment => {
    const massFraction = fragment.massNg / maximumMass;
    const efficiency = STAINING_EFFICIENCY[fragment.conformation];
    return clamp(0.1 + 0.9 * massFraction * efficiency, 0.1, 1);
  });
}

export function simulateVirtualGel(samples: GelSampleInput[], params: GelRunParams): VirtualGelLane[] {
  return samples.map((sample, index) => {
    const id = sample.id || `lane-${index + 1}`;
    if (sample.ladder) {
      const ladderBands = DNA_LADDERS[sample.ladder] ?? [];
      const intensities = ladderIntensities(ladderBands);
      const bands = ladderBands.map((band, bandIndex) => ({
        sizeBp: band.sizeBp,
        conformation: 'linear' as const,
        apparentBp: band.sizeBp,
        migrationY: computeMigration(band.sizeBp, params),
        relativeIntensity: intensities[bandIndex]
      }));
      bands.sort((left, right) => right.apparentBp - left.apparentBp);
      return {
        id,
        label: sample.label || sample.ladder,
        isLadder: true,
        bands
      };
    }

    const sourceFragments = (sample.fragments ?? [])
      .map(fragment => {
        const rawSize = fragment.sizeBp > 0 ? fragment.sizeBp : fragment.doc?.length ?? 0;
        const sizeBp = Math.max(0, rawSize);
        const conformation = fragment.conformation ?? 'linear';
        const massNg = fragment.massNg && fragment.massNg > 0 ? fragment.massNg : sizeBp;
        return {
          sizeBp,
          conformation,
          massNg,
          doc: fragment.doc
        };
      })
      .filter(fragment => fragment.sizeBp > 0);

    const intensities = fragmentIntensities(sourceFragments);
    const bands = sourceFragments.map((fragment, bandIndex) => {
      const apparentBp = fragment.sizeBp * CONFORMATION_FACTORS[fragment.conformation];
      const band: VirtualGelLane['bands'][number] = {
        sizeBp: fragment.sizeBp,
        conformation: fragment.conformation,
        apparentBp,
        migrationY: computeMigration(apparentBp, params),
        relativeIntensity: intensities[bandIndex]
      };
      if (fragment.doc) band.fragmentDoc = fragment.doc;
      return band;
    });
    bands.sort((left, right) => right.apparentBp - left.apparentBp);

    return {
      id,
      label: sample.label,
      isLadder: false,
      bands
    };
  });
}
