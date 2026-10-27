export type CodonUsageOrganism =
  | 'E. coli'
  | 'S. cerevisiae'
  | 'H. sapiens'
  | 'M. musculus'
  | 'P. pastoris'
  | 'D. melanogaster'
  | 'A. thaliana'
  | 'CHO';

const CODON_ORDER = [
  'TTT', 'TCT', 'TAT', 'TGT',
  'TTC', 'TCC', 'TAC', 'TGC',
  'TTA', 'TCA', 'TAA', 'TGA',
  'TTG', 'TCG', 'TAG', 'TGG',
  'CTT', 'CCT', 'CAT', 'CGT',
  'CTC', 'CCC', 'CAC', 'CGC',
  'CTA', 'CCA', 'CAA', 'CGA',
  'CTG', 'CCG', 'CAG', 'CGG',
  'ATT', 'ACT', 'AAT', 'AGT',
  'ATC', 'ACC', 'AAC', 'AGC',
  'ATA', 'ACA', 'AAA', 'AGA',
  'ATG', 'ACG', 'AAG', 'AGG',
  'GTT', 'GCT', 'GAT', 'GGT',
  'GTC', 'GCC', 'GAC', 'GGC',
  'GTA', 'GCA', 'GAA', 'GGA',
  'GTG', 'GCG', 'GAG', 'GGG',
];

// Frequencies are per thousand codons. E. coli, S. cerevisiae and H. sapiens
// values follow the Kazusa Codon Usage Database (Nakamura et al., 2000);
// M. musculus, P. pastoris, D. melanogaster, A. thaliana and CHO use the same
// database's organism tables. Codons are ordered as CODON_ORDER above.
const ORGANISM_TABLES: Record<CodonUsageOrganism, number[]> = {
  'E. coli': [
    24.4, 13.1, 21.6, 5.9,
    13.9, 9.7, 11.7, 5.5,
    17.4, 13.1, 2.0, 1.1,
    12.9, 8.2, 0.3, 13.4,
    14.5, 9.5, 12.4, 15.9,
    9.5, 6.2, 7.3, 14.0,
    5.6, 9.1, 14.4, 4.8,
    37.4, 14.5, 26.7, 7.9,
    29.6, 13.1, 29.3, 13.2,
    19.4, 18.9, 20.3, 14.3,
    13.3, 15.1, 37.2, 7.1,
    23.7, 13.6, 15.3, 4.0,
    21.6, 18.9, 33.7, 23.7,
    13.1, 21.6, 17.9, 20.6,
    13.1, 23.0, 35.1, 13.6,
    19.9, 21.1, 19.4, 12.3,
  ],
  'S. cerevisiae': [
    26.1, 23.5, 18.8, 8.1,
    18.4, 14.2, 14.8, 4.8,
    26.2, 18.7, 1.1, 0.7,
    27.2, 8.6, 0.5, 10.4,
    12.3, 13.5, 13.6, 6.4,
    5.4, 6.8, 7.8, 2.6,
    13.4, 18.3, 27.3, 3.0,
    10.5, 5.3, 12.1, 1.7,
    30.1, 20.3, 35.7, 14.2,
    17.2, 12.7, 24.8, 9.8,
    17.8, 17.8, 41.9, 21.3,
    20.9, 8.0, 30.8, 9.2,
    22.1, 21.2, 37.6, 23.9,
    11.8, 12.6, 20.2, 9.8,
    11.8, 16.2, 45.6, 10.9,
    10.8, 6.2, 19.2, 6.0,
  ],
  'H. sapiens': [
    17.6, 15.2, 12.2, 10.6,
    20.3, 17.7, 15.3, 12.6,
    7.7, 12.2, 1.0, 1.6,
    12.9, 4.4, 0.8, 13.2,
    13.2, 17.5, 10.9, 4.5,
    19.6, 19.8, 15.1, 10.4,
    7.2, 16.9, 12.3, 6.2,
    39.6, 6.9, 34.2, 11.4,
    16.0, 13.1, 17.0, 12.1,
    20.8, 18.9, 19.1, 19.5,
    7.5, 15.1, 24.4, 12.2,
    22.0, 6.1, 31.9, 12.0,
    11.0, 18.4, 21.8, 10.8,
    14.5, 27.7, 25.1, 22.2,
    7.1, 15.8, 29.0, 16.5,
    28.1, 7.4, 39.6, 16.5,
  ],
  'M. musculus': [
    17.2, 16.2, 12.2, 11.4,
    21.8, 18.1, 16.1, 12.3,
    6.7, 11.8, 1.0, 1.6,
    13.4, 4.2, 0.8, 12.5,
    13.4, 18.4, 10.6, 4.7,
    20.2, 18.2, 15.3, 9.4,
    8.1, 17.3, 12.0, 6.6,
    39.5, 6.2, 34.1, 10.2,
    15.4, 13.7, 15.6, 12.7,
    22.5, 19.0, 20.3, 19.7,
    7.4, 16.0, 21.9, 12.1,
    22.8, 5.6, 33.6, 12.2,
    10.7, 20.0, 21.0, 11.4,
    15.4, 26.0, 26.0, 21.2,
    7.4, 15.8, 27.0, 16.8,
    28.4, 6.4, 39.4, 15.2,
  ],
  'P. pastoris': [
    24.1, 24.4, 16.0, 7.7,
    20.6, 16.5, 18.1, 4.4,
    15.6, 15.2, 0.8, 0.3,
    31.5, 7.4, 0.5, 10.3,
    15.9, 15.8, 11.8, 6.9,
    7.6, 6.8, 9.1, 2.2,
    10.7, 18.9, 25.4, 4.2,
    14.9, 3.9, 16.3, 1.9,
    31.1, 22.4, 25.1, 12.5,
    19.4, 14.5, 26.7, 7.6,
    11.1, 13.8, 29.9, 20.1,
    18.7, 6.0, 33.8, 6.6,
    26.9, 28.9, 35.7, 25.5,
    14.9, 16.6, 25.9, 8.1,
    9.9, 15.1, 37.4, 19.1,
    12.3, 3.9, 29.0, 5.8,
  ],
  'D. melanogaster': [
    13.2, 7.0, 10.8, 5.4,
    21.8, 19.6, 18.4, 13.2,
    4.5, 7.8, 0.8, 0.5,
    16.1, 16.6, 0.7, 9.9,
    9.0, 6.9, 10.8, 8.8,
    13.8, 18.1, 16.2, 18.0,
    8.2, 13.5, 15.6, 8.4,
    38.2, 15.8, 36.1, 8.2,
    16.6, 9.5, 21.0, 11.5,
    22.9, 21.3, 26.2, 20.4,
    9.5, 11.0, 17.0, 5.1,
    23.6, 14.4, 39.5, 6.3,
    11.0, 14.4, 27.6, 13.3,
    13.9, 33.6, 24.6, 26.7,
    6.4, 12.8, 21.1, 18.0,
    27.8, 14.0, 42.5, 4.7,
  ],
  'A. thaliana': [
    21.8, 25.2, 14.6, 10.5,
    20.7, 11.2, 13.7, 7.2,
    12.7, 18.3, 0.9, 1.2,
    20.9, 9.3, 0.5, 12.5,
    24.1, 18.7, 13.8, 9.0,
    16.1, 5.3, 8.7, 3.8,
    9.9, 16.1, 19.4, 6.3,
    9.8, 8.6, 15.2, 4.9,
    21.5, 17.5, 22.3, 14.0,
    18.5, 10.3, 20.9, 11.3,
    12.6, 15.7, 30.8, 19.0,
    24.5, 7.7, 32.7, 11.0,
    27.2, 28.3, 36.6, 22.2,
    12.8, 10.3, 17.2, 9.2,
    9.9, 17.5, 34.3, 24.2,
    17.4, 9.0, 32.2, 10.2,
  ],
  CHO: [
    19.6, 16.0, 13.1, 9.1,
    22.0, 16.5, 16.4, 10.3,
    6.4, 10.3, 0.6, 1.2,
    14.1, 3.4, 0.5, 13.1,
    13.2, 16.7, 10.2, 5.6,
    18.4, 17.0, 12.9, 9.3,
    7.6, 15.6, 10.3, 7.2,
    38.8, 4.3, 33.4, 10.1,
    17.4, 14.1, 17.4, 11.4,
    24.8, 20.3, 21.2, 16.4,
    6.9, 15.7, 24.6, 10.1,
    23.0, 4.5, 38.4, 10.2,
    11.6, 22.4, 24.6, 12.8,
    15.7, 25.9, 28.1, 21.3,
    7.8, 16.3, 28.4, 15.8,
    30.1, 5.0, 41.1, 13.4,
  ],
};

export const CODON_USAGE: Record<CodonUsageOrganism, Record<string, number>> =
  Object.fromEntries(
    (Object.keys(ORGANISM_TABLES) as CodonUsageOrganism[]).map((organism) => [
      organism,
      Object.fromEntries(
        CODON_ORDER.map((codon, index) => [codon, ORGANISM_TABLES[organism][index]]),
      ),
    ]),
  ) as Record<CodonUsageOrganism, Record<string, number>>;

const CODON_TO_AMINO_ACID: Record<string, string> = {
  TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L',
  CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L',
  ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M',
  GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V',
  TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S',
  CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P',
  ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T',
  GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A',
  TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*',
  CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q',
  AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K',
  GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
  TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W',
  CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R',
  AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R',
  GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G',
};

const IUPAC_MASK: Record<string, number> = {
  A: 1,
  C: 2,
  G: 4,
  T: 8,
  U: 8,
  R: 5,
  Y: 10,
  S: 6,
  W: 9,
  K: 12,
  M: 3,
  B: 14,
  D: 13,
  H: 11,
  V: 7,
  N: 15,
};

const COMPLEMENT: Record<string, string> = {
  A: 'T',
  C: 'G',
  G: 'C',
  T: 'A',
  U: 'A',
  R: 'Y',
  Y: 'R',
  S: 'S',
  W: 'W',
  K: 'M',
  M: 'K',
  B: 'V',
  D: 'H',
  H: 'D',
  V: 'B',
  N: 'N',
};

const CODON_OPTIONS: Record<CodonUsageOrganism, Record<string, string[]>> =
  Object.fromEntries(
    (Object.keys(CODON_USAGE) as CodonUsageOrganism[]).map((organism) => {
      const byAminoAcid = new Map<string, string[]>();
      for (const codon of CODON_ORDER) {
        const aminoAcid = CODON_TO_AMINO_ACID[codon];
        if (!aminoAcid) continue;
        const list = byAminoAcid.get(aminoAcid) ?? [];
        list.push(codon);
        byAminoAcid.set(aminoAcid, list);
      }
      for (const list of byAminoAcid.values()) {
        list.sort(
          (left, right) =>
            CODON_USAGE[organism][right] - CODON_USAGE[organism][left] ||
            left.localeCompare(right),
        );
      }
      return [organism, Object.fromEntries(byAminoAcid)];
    }),
  ) as Record<CodonUsageOrganism, Record<string, string[]>>;

const MAX_FREQUENCY: Record<CodonUsageOrganism, Record<string, number>> =
  Object.fromEntries(
    (Object.keys(CODON_USAGE) as CodonUsageOrganism[]).map((organism) => {
      const maxima: Record<string, number> = {};
      for (const codon of CODON_ORDER) {
        const aminoAcid = CODON_TO_AMINO_ACID[codon];
        if (!aminoAcid) continue;
        maxima[aminoAcid] = Math.max(
          maxima[aminoAcid] ?? 0,
          CODON_USAGE[organism][codon] ?? 0,
        );
      }
      return [organism, maxima];
    }),
  ) as Record<CodonUsageOrganism, Record<string, number>>;

const BASE_CODE: Record<string, number> = {
  A: 1,
  C: 2,
  G: 4,
  T: 8,
  U: 8,
};

function reverseComplement(sequence: string): string {
  let result = '';
  for (let index = sequence.length - 1; index >= 0; index -= 1) {
    result += COMPLEMENT[sequence[index]] ?? 'N';
  }
  return result;
}

function normalizeSite(site: string): string | null {
  const normalized = (site ?? '').toUpperCase().replace(/\s+/g, '').replace(/U/g, 'T');
  if (!normalized || !/^[ACGTURYSWKMBDHVN]+$/.test(normalized)) return null;
  for (const letter of normalized) {
    if (IUPAC_MASK[letter] === undefined) return null;
  }
  return normalized;
}

function siteMasks(site: string): Uint8Array {
  const masks = new Uint8Array(site.length);
  for (let index = 0; index < site.length; index += 1) {
    masks[index] = IUPAC_MASK[site[index]];
  }
  return masks;
}

function matchesAt(
  dna: string,
  masks: Uint8Array,
  start: number,
): boolean {
  for (let offset = 0; offset < masks.length; offset += 1) {
    const code = BASE_CODE[dna[start + offset]] ?? 0;
    if ((code & masks[offset]) === 0) return false;
  }
  return true;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function chooseWeighted(
  codons: string[],
  usage: Record<string, number>,
  random: () => number,
): string {
  let total = 0;
  for (const codon of codons) total += usage[codon] ?? 0;
  if (total <= 0) return codons[0];
  let threshold = random() * total;
  for (const codon of codons) {
    threshold -= usage[codon] ?? 0;
    if (threshold <= 0) return codon;
  }
  return codons[codons.length - 1];
}

interface Occurrence {
  start: number;
  end: number;
  motif: string;
}

function findOccurrences(dna: string, motifs: string[]): Occurrence[] {
  const occurrences: Occurrence[] = [];
  for (const motif of motifs) {
    if (motif.length === 0 || motif.length > dna.length) continue;
    const masks = siteMasks(motif);
    const lastStart = dna.length - motif.length;
    for (let start = 0; start <= lastStart; start += 1) {
      if (!matchesAt(dna, masks, start)) continue;
      occurrences.push({ start, end: start + motif.length, motif });
    }
  }
  occurrences.sort(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      left.motif.localeCompare(right.motif),
  );
  return occurrences;
}

function eliminateSites(
  dna: string,
  organism: CodonUsageOrganism,
  avoidSites: string[],
): string {
  if (avoidSites.length === 0) return dna;
  const motifs: string[] = [];
  const seenMotifs = new Set<string>();
  for (const requested of avoidSites) {
    const site = normalizeSite(requested);
    if (!site) throw new Error(`Invalid IUPAC avoidance site: ${requested}`);
    for (const motif of [site, reverseComplement(site)]) {
      if (seenMotifs.has(motif)) continue;
      seenMotifs.add(motif);
      motifs.push(motif);
    }
  }

  let current = dna;
  const visited = new Set<string>([current]);
  const maxPasses = Math.max(200, dna.length * 2);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const occurrences = findOccurrences(current, motifs);
    if (occurrences.length === 0) return current;
    const target = occurrences[0];

    const firstCodon = Math.max(0, Math.floor(target.start / 3) - 1);
    const lastCodon = Math.min(
      Math.floor((current.length - 1) / 3),
      Math.floor(Math.max(target.start, target.end - 1) / 3) + 1,
    );
    let best: { dna: string; count: number; targetRemains: boolean } | null = null;

    for (let codonIndex = firstCodon; codonIndex <= lastCodon; codonIndex += 1) {
      const codonStart = codonIndex * 3;
      const codon = current.slice(codonStart, codonStart + 3);
      const aminoAcid = CODON_TO_AMINO_ACID[codon];
      if (!aminoAcid) continue;
      const options = CODON_OPTIONS[organism][aminoAcid] ?? [];
      for (const replacement of options) {
        if (replacement === codon) continue;
        const next =
          current.slice(0, codonStart) + replacement + current.slice(codonStart + 3);
        if (visited.has(next)) continue;
        const nextOccurrences = findOccurrences(next, motifs);
        if (nextOccurrences.length === 0) return next;
        const targetRemains = nextOccurrences.some(
          (occurrence) =>
            occurrence.start < target.end && occurrence.end > target.start,
        );
        if (
          !best ||
          nextOccurrences.length < best.count ||
          (nextOccurrences.length === best.count &&
            best.targetRemains &&
            !targetRemains)
        ) {
          best = {
            dna: next,
            count: nextOccurrences.length,
            targetRemains,
          };
        }
      }
    }

    if (!best || best.targetRemains) {
      // A synonymous change can occasionally move a site rather than remove
      // it. Retry with the best remaining candidate, but stop on repetition.
      if (!best) {
        throw new Error(
          `Unable to remove avoidance site ${target.motif} without changing the protein`,
        );
      }
    }
    current = best.dna;
    visited.add(current);
  }
  throw new Error('Unable to remove all avoidance sites without changing the protein');
}

export function backTranslate(
  protein: string,
  organism: CodonUsageOrganism,
  opts: {
    strategy?: 'most-frequent' | 'weighted';
    avoidSites?: string[];
    seed?: number;
  } = {},
): string {
  const usage = CODON_USAGE[organism];
  if (!usage) throw new Error(`Unknown codon usage organism: ${organism}`);

  const sequence = (protein ?? '').toUpperCase().replace(/\s+/g, '');
  if (!sequence) return '';
  if (!/^[ACDEFGHIKLMNPQRSTVWY*]+$/.test(sequence)) {
    throw new Error('Protein contains unsupported amino-acid letters');
  }

  const strategy = opts.strategy ?? 'most-frequent';
  if (strategy !== 'most-frequent' && strategy !== 'weighted') {
    throw new Error(`Unknown back-translation strategy: ${strategy}`);
  }
  const random = mulberry32(opts.seed ?? 1);

  let dna = '';
  for (const aminoAcid of sequence) {
    const options = CODON_OPTIONS[organism][aminoAcid] ?? [];
    if (options.length === 0) {
      throw new Error(`No codon available for residue ${aminoAcid}`);
    }
    const codon =
      strategy === 'weighted'
        ? chooseWeighted(options, usage, random)
        : options[0];
    dna += codon;
  }

  return eliminateSites(dna, organism, opts.avoidSites ?? []);
}

export function codonAdaptationIndex(
  dna: string,
  organism: CodonUsageOrganism,
): number {
  const usage = CODON_USAGE[organism];
  if (!usage) throw new Error(`Unknown codon usage organism: ${organism}`);
  const sequence = (dna ?? '').toUpperCase().replace(/\s+/g, '').replace(/U/g, 'T');
  let logSum = 0;
  let count = 0;
  for (let position = 0; position + 3 <= sequence.length; position += 3) {
    const codon = sequence.slice(position, position + 3);
    const aminoAcid = CODON_TO_AMINO_ACID[codon];
    if (!aminoAcid || aminoAcid === '*') continue;
    const maximum = MAX_FREQUENCY[organism][aminoAcid] ?? 0;
    if (maximum <= 0) continue;
    const relative = Math.max((usage[codon] ?? 0) / maximum, 1e-9);
    logSum += Math.log(relative);
    count += 1;
  }
  if (count === 0) return 0;
  return Math.min(1, Math.exp(logSum / count));
}
