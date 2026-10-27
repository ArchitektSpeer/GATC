export type SequenceType = 'dna' | 'protein';

export const DNA_ALPHABET = 'ACGTN';
export const PROTEIN_ALPHABET = 'ARNDCQEGHILKMFPSTWYVBZX*';

/**
 * Standard BLOSUM62 substitution scores in the residue order of
 * PROTEIN_ALPHABET.
 */
const BLOSUM62_ROWS: number[][] = [
  [4, -1, -2, -2, 0, -1, -1, 0, -2, -1, -1, -1, -1, -2, -1, 1, 0, -3, -2, 0, -2, -1, 0, -4],
  [-1, 5, 0, -2, -3, 1, 0, -2, 0, -3, -2, 2, -1, -3, -2, -1, -1, -3, -2, -3, -1, 0, -1, -4],
  [-2, 0, 6, 1, -3, 0, 0, 0, 1, -3, -3, 0, -2, -3, -2, 1, 0, -4, -2, -3, 3, 0, -1, -4],
  [-2, -2, 1, 6, -3, 0, 2, -1, -1, -3, -4, -1, -3, -3, -1, 0, -1, -4, -3, -3, 4, 1, -1, -4],
  [0, -3, -3, -3, 9, -3, -4, -3, -3, -1, -1, -3, -1, -2, -3, -1, -1, -2, -2, -1, -3, -3, -2, -4],
  [-1, 1, 0, 0, -3, 5, 2, -2, 0, -3, -2, 1, 0, -3, -1, 0, -1, -2, -1, -2, 0, 3, -1, -4],
  [-1, 0, 0, 2, -4, 2, 5, -2, 0, -3, -3, 1, -2, -3, -1, 0, -1, -3, -2, -2, 1, 4, -1, -4],
  [0, -2, 0, -1, -3, -2, -2, 6, -2, -4, -4, -2, -3, -3, -2, 0, -2, -2, -3, -3, -1, -2, -1, -4],
  [-2, 0, 1, -1, -3, 0, 0, -2, 8, -3, -3, -1, -2, -1, -2, -1, -2, -2, 2, -3, 0, 0, -1, -4],
  [-1, -3, -3, -3, -1, -3, -3, -4, -3, 4, 2, -3, 1, 0, -3, -2, -1, -3, -1, 3, -3, -3, -1, -4],
  [-1, -2, -3, -4, -1, -2, -3, -4, -3, 2, 4, -2, 2, 0, -3, -2, -1, -2, -1, 1, -4, -3, -1, -4],
  [-1, 2, 0, -1, -3, 1, 1, -2, -1, -3, -2, 5, -1, -3, -1, 0, -1, -3, -2, -2, 0, 1, -1, -4],
  [-1, -1, -2, -3, -1, 0, -2, -3, -2, 1, 2, -1, 5, 0, -2, -1, -1, -1, -1, 1, -3, -1, -1, -4],
  [-2, -3, -3, -3, -2, -3, -3, -3, -1, 0, 0, -3, 0, 6, -4, -2, -2, 1, 3, -1, -3, -3, -1, -4],
  [-1, -2, -2, -1, -3, -1, -1, -2, -2, -3, -3, -1, -2, -4, 7, -1, -1, -4, -3, -2, -2, -1, -2, -4],
  [1, -1, 1, 0, -1, 0, 0, 0, -1, -2, -2, 0, -1, -2, -1, 4, 1, -3, -2, -2, 0, 0, 0, -4],
  [0, -1, 0, -1, -1, -1, -1, -2, -2, -1, -1, -1, -1, -2, -1, 1, 5, -2, -2, 0, -1, -1, 0, -4],
  [-3, -3, -4, -4, -2, -2, -3, -2, -2, -3, -2, -3, -1, 1, -4, -3, -2, 11, 2, -3, -4, -3, -2, -4],
  [-2, -2, -2, -3, -2, -1, -2, -3, 2, -1, -1, -2, -1, 3, -3, -2, -2, 2, 7, -1, -3, -2, -1, -4],
  [0, -3, -3, -3, -1, -2, -2, -3, -3, 3, 1, -2, 1, -1, -2, -2, 0, -3, -1, 4, -3, -2, -1, -4],
  [-2, -1, 3, 4, -3, 0, 1, -1, 0, -3, -4, 0, -3, -3, -2, 0, -1, -4, -3, -3, 4, 1, -1, -4],
  [-1, 0, 0, 1, -3, 3, 4, -2, 0, -3, -3, 1, -1, -3, -1, 0, -1, -3, -2, -2, 1, 4, -1, -4],
  [0, -1, -1, -1, -2, -1, -1, -1, -1, -1, -1, -1, -1, -1, -2, 0, 0, -2, -1, -1, -1, -1, -1, -4],
  [-4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, 1]
];

let blosum62Flat: Float64Array | null = null;

function proteinTable(): Float64Array {
  if (blosum62Flat) return blosum62Flat;
  const size = PROTEIN_ALPHABET.length;
  const table = new Float64Array(size * size);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      table[row * size + column] = BLOSUM62_ROWS[row][column];
    }
  }
  blosum62Flat = table;
  return table;
}

const DNA_INDEX: Record<string, number> = {
  A: 0,
  C: 1,
  G: 2,
  T: 3,
  U: 3,
  N: 4
};

const PROTEIN_INDEX: Record<string, number> = (() => {
  const index: Record<string, number> = {};
  for (let position = 0; position < PROTEIN_ALPHABET.length; position += 1) {
    index[PROTEIN_ALPHABET[position]] = position;
  }
  index.U = index.C;
  index.O = index.X;
  index.J = index.X;
  return index;
})();

export function alphabetSize(type: SequenceType): number {
  return type === 'dna' ? DNA_ALPHABET.length : PROTEIN_ALPHABET.length;
}

export function residueCode(base: string, type: SequenceType): number {
  if (type === 'dna') return DNA_INDEX[base.toUpperCase()] ?? DNA_INDEX.N;
  return PROTEIN_INDEX[base.toUpperCase()] ?? PROTEIN_INDEX.X;
}

export function encodeResidues(sequence: string, type: SequenceType): Uint8Array {
  const codes = new Uint8Array(sequence.length);
  for (let position = 0; position < sequence.length; position += 1) {
    codes[position] = residueCode(sequence[position], type);
  }
  return codes;
}

export interface SubstitutionScoring {
  table: Float64Array;
  size: number;
}

export function buildSubstitutionTable(
  type: SequenceType,
  match: number,
  mismatch: number
): SubstitutionScoring {
  if (type === 'protein') {
    return { table: proteinTable(), size: PROTEIN_ALPHABET.length };
  }
  const size = DNA_ALPHABET.length;
  const table = new Float64Array(size * size);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (row === 4 || column === 4) {
        table[row * size + column] = 0;
      } else {
        table[row * size + column] = row === column ? match : mismatch;
      }
    }
  }
  return { table, size };
}

export function detectSequenceType(sequences: string[], explicit?: SequenceType): SequenceType {
  if (explicit) return explicit;
  let deoxyribonucleotides = 0;
  let aminoAcids = 0;
  for (const sequence of sequences) {
    for (const character of sequence.toUpperCase()) {
      if (character === 'A' || character === 'C' || character === 'G' || character === 'T' ||
          character === 'U' || character === 'N') {
        deoxyribonucleotides += 1;
      } else if (character >= 'A' && character <= 'Z') {
        aminoAcids += 1;
      }
    }
  }
  if (deoxyribonucleotides === 0 && aminoAcids === 0) return 'dna';
  return aminoAcids > deoxyribonucleotides * 0.1 ? 'protein' : 'dna';
}

export function normalizeSequence(sequence: string): string {
  return sequence.replace(/\s+/g, '');
}
