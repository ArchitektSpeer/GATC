import { describe, expect, it } from 'vitest';
import { multipleSequenceAlignment, pairwiseAlign } from './index';

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function randomDna(seed: number, length: number): string {
  const random = createRandom(seed);
  const alphabet = 'ACGT';
  let sequence = '';
  for (let index = 0; index < length; index += 1) {
    sequence += alphabet[Math.floor(random() * 4)];
  }
  return sequence;
}

function randomProtein(seed: number, length: number): string {
  const random = createRandom(seed);
  const alphabet = 'ACDEFGHIKLMNPQRSTVWY';
  let sequence = '';
  for (let index = 0; index < length; index += 1) {
    sequence += alphabet[Math.floor(random() * alphabet.length)];
  }
  return sequence;
}

function mutateSequence(
  seed: number,
  template: string,
  substitutionRate: number,
  indelEvents: number
): string {
  const random = createRandom(seed);
  const alphabet = 'ACGT';
  const characters = template.split('');
  for (let index = 0; index < characters.length; index += 1) {
    if (random() < substitutionRate) {
      const replacement = alphabet[Math.floor(random() * 4)];
      if (replacement !== characters[index]) characters[index] = replacement;
    }
  }
  let sequence = characters.join('');
  for (let event = 0; event < indelEvents; event += 1) {
    const position = Math.floor(random() * sequence.length);
    const length = 1 + Math.floor(random() * 3);
    if (random() < 0.5 && sequence.length - position > length + 8) {
      sequence = sequence.slice(0, position) + sequence.slice(position + length);
    } else {
      let insert = '';
      for (let base = 0; base < length; base += 1) {
        insert += alphabet[Math.floor(random() * 4)];
      }
      sequence = sequence.slice(0, position) + insert + sequence.slice(position);
    }
  }
  return sequence;
}

function ungapped(aligned: string): string {
  return aligned.replace(/-/g, '');
}

function affineScore(
  alignedA: string,
  alignedB: string,
  match = 2,
  mismatch = -1,
  gapOpen = -3,
  gapExtend = -1
): number {
  let score = 0;
  let inGapA = false;
  let inGapB = false;
  for (let index = 0; index < alignedA.length; index += 1) {
    const a = alignedA[index];
    const b = alignedB[index];
    if (a !== '-' && b !== '-') {
      score += a.toUpperCase() === b.toUpperCase() ? match : mismatch;
      inGapA = false;
      inGapB = false;
    } else if (a === '-') {
      score += inGapA ? gapExtend : gapOpen;
      inGapA = true;
      inGapB = false;
    } else {
      score += inGapB ? gapExtend : gapOpen;
      inGapB = true;
      inGapA = false;
    }
  }
  return score;
}

describe('pairwise global and semiglobal alignment', () => {
  it('reports 100 percent identity and a perfect score for identical sequences', () => {
    const sequence = randomDna(101, 180);
    const result = pairwiseAlign(sequence, sequence);
    expect(result.identityPercent).toBe(100);
    expect(result.score).toBe(sequence.length * 2);
    expect(result.alignedA).toBe(sequence);
    expect(result.alignedB).toBe(sequence);
    expect(result.startA).toBe(0);
    expect(result.endA).toBe(sequence.length);
    expect(result.startB).toBe(0);
    expect(result.endB).toBe(sequence.length);
  });

  it('places a one base insertion in the correct column', () => {
    const result = pairwiseAlign('ACGTACGT', 'ACGTTACGT');
    expect(result.alignedA).toHaveLength(9);
    expect(result.alignedB).toBe('ACGTTACGT');
    expect(result.alignedA.replace(/-/g, '')).toBe('ACGTACGT');
    expect(result.alignedA.match(/-/g) ?? []).toHaveLength(1);
    expect(result.score).toBe(13);
    expect(result.identityPercent).toBe(100);
    expect(result.endA).toBe(8);
    expect(result.endB).toBe(9);
  });

  it('places a one base deletion in the correct column', () => {
    const result = pairwiseAlign('ACGTTACGT', 'ACGTACGT');
    expect(result.alignedA).toBe('ACGTTACGT');
    expect(result.alignedB.replace(/-/g, '')).toBe('ACGTACGT');
    expect(result.alignedB.match(/-/g) ?? []).toHaveLength(1);
    expect(result.score).toBe(13);
    expect(result.identityPercent).toBe(100);
  });

  it('leaves both sequence ends unpenalized in semiglobal mode', () => {
    const result = pairwiseAlign('TTTTACGTACGTGGGG', 'ACGTACGT', { mode: 'semiglobal' });
    expect(result.alignedA).toBe('ACGTACGT');
    expect(result.alignedB).toBe('ACGTACGT');
    expect(result.score).toBe(16);
    expect(result.identityPercent).toBe(100);
    expect(result.startA).toBe(4);
    expect(result.endA).toBe(12);
    expect(result.startB).toBe(0);
    expect(result.endB).toBe(8);
  });

  it('aligns an overlap with overhangs on both sequences in semiglobal mode', () => {
    const result = pairwiseAlign('AAAACGTACGT', 'ACGTACGTCCCC', { mode: 'semiglobal' });
    expect(result.alignedA).toBe('ACGTACGT');
    expect(result.alignedB).toBe('ACGTACGT');
    expect(result.score).toBe(16);
    expect(result.startA).toBe(3);
    expect(result.endA).toBe(11);
    expect(result.startB).toBe(0);
    expect(result.endB).toBe(8);
  });

  it('finds an embedded match in local mode', () => {
    const result = pairwiseAlign('TTTTACGTACGTGGGG', 'ACGTACGT', { mode: 'local' });
    expect(result.alignedA).toBe('ACGTACGT');
    expect(result.alignedB).toBe('ACGTACGT');
    expect(result.score).toBe(16);
    expect(result.startA).toBe(4);
    expect(result.endA).toBe(12);
    expect(result.startB).toBe(0);
    expect(result.endB).toBe(8);
  });

  it('aligns protein sequences with BLOSUM62 scoring', () => {
    const first = randomProtein(202, 90);
    const second = `${first.slice(0, 30)}W${first.slice(30)}`;
    const result = pairwiseAlign(first, second, { type: 'protein' });
    expect(ungapped(result.alignedA)).toBe(first);
    expect(ungapped(result.alignedB)).toBe(second);
    expect(result.alignedA.length).toBe(result.alignedB.length);
    expect(result.identityPercent).toBeGreaterThan(90);
    expect(result.score).toBeGreaterThan(0);
  });

  it('keeps both 10 kb reads intact and aligns them within the time budget', () => {
    const template = randomDna(303, 10000);
    const mutated = mutateSequence(404, template, 0.01, 8);
    const started = Date.now();
    const result = pairwiseAlign(template, mutated);
    const elapsed = Date.now() - started;
    expect(ungapped(result.alignedA)).toBe(template);
    expect(ungapped(result.alignedB)).toBe(mutated);
    expect(result.alignedA.length).toBe(result.alignedB.length);
    expect(result.identityPercent).toBeGreaterThan(95);
    expect(result.score).toBe(affineScore(result.alignedA, result.alignedB));
    expect(elapsed).toBeLessThan(1500);
  });
});

describe('multiple sequence alignment', () => {
  it('keeps identical sequences unaligned and fully conserved', () => {
    const sequence = randomDna(505, 90);
    const input = [0, 1, 2].map(index => ({
      id: `seq-${index}`,
      name: `Sequence ${index + 1}`,
      sequence
    }));
    const result = multipleSequenceAlignment(input);
    expect(result.columns).toBe(sequence.length);
    expect(result.consensus).toBe(sequence);
    expect(result.conservation).toHaveLength(sequence.length);
    result.rows.forEach(row => {
      expect(row.aligned).toBe(sequence);
    });
    result.identityMatrix.forEach(row => {
      row.forEach(value => {
        expect(value).toBe(100);
      });
    });
    expect(result.guideTree.endsWith(';')).toBe(true);
    expect(result.guideTree).toContain('Sequence');
  });

  it('aligns a shared insertion and deletion against the ancestor', () => {
    const ancestor = 'ACGTACGTACGT';
    const insertion = 'ACGTACGTTACGT';
    const deletion = 'ACGTACGACGT';
    const input = [
      { id: 'ancestor', name: 'Ancestor', sequence: ancestor },
      { id: 'insertion', name: 'Insertion', sequence: insertion },
      { id: 'deletion', name: 'Deletion', sequence: deletion }
    ];
    const result = multipleSequenceAlignment(input);
    expect(result.rows[0].aligned).toBe('ACGTACG-TACGT');
    expect(result.columns).toBe(13);
    expect(result.rows[1].aligned).toBe('ACGTACGTTACGT');
    expect(result.rows[2].aligned).toBe('ACGTACG--ACGT');
    expect(result.consensus.replace(/-/g, '')).toBe(ancestor);
    for (let index = 0; index < input.length; index += 1) {
      expect(ungapped(result.rows[index].aligned)).toBe(input[index].sequence);
    }
  });

  it('recovers the ancestor as the consensus at a low mutation rate', () => {
    const ancestor = randomDna(606, 240);
    const input = [0, 1, 2, 3, 4, 5].map(index => ({
      id: `mutant-${index}`,
      name: `Mutant ${index + 1}`,
      sequence: mutateSequence(700 + index, ancestor, 0.004, 0)
    }));
    const result = multipleSequenceAlignment(input);
    expect(result.columns).toBe(ancestor.length);
    expect(result.consensus).toBe(ancestor);
    expect(result.conservation.every(value => value >= 0 && value <= 1)).toBe(true);
    input.forEach((sequence, index) => {
      expect(ungapped(result.rows[index].aligned)).toBe(sequence.sequence);
    });
  });

  it('reports pairwise identities from non-gap columns only', () => {
    const result = multipleSequenceAlignment([
      { id: 'a', name: 'A', sequence: 'ACGTACGT' },
      { id: 'b', name: 'B', sequence: 'ACGTTCGT' },
      { id: 'c', name: 'C', sequence: 'ACGTACGT' }
    ]);
    expect(result.identityMatrix[0][0]).toBe(100);
    expect(result.identityMatrix[0][2]).toBe(100);
    expect(result.identityMatrix[0][1]).toBeCloseTo((7 / 8) * 100, 5);
    expect(result.identityMatrix[1][0]).toBe(result.identityMatrix[0][1]);
  });

  it('supports protein profiles with BLOSUM62 scoring', () => {
    const first = randomProtein(808, 60);
    const second = `${first.slice(0, 20)}A${first.slice(20)}`;
    const third = first.slice(0, 40) + first.slice(42);
    const result = multipleSequenceAlignment(
      [
        { id: 'p1', name: 'Protein 1', sequence: first },
        { id: 'p2', name: 'Protein 2', sequence: second },
        { id: 'p3', name: 'Protein 3', sequence: third }
      ],
      { type: 'protein' }
    );
    expect(result.rows).toHaveLength(3);
    result.rows.forEach((row, index) => {
      expect(ungapped(row.aligned)).toBe([first, second, third][index]);
      expect(row.aligned).toHaveLength(result.columns);
    });
    expect(result.guideTree.endsWith(';')).toBe(true);
  });

  it('aligns eight 3 kb sequences within the time budget', () => {
    const ancestor = randomDna(909, 3000);
    const input = [0, 1, 2, 3, 4, 5, 6, 7].map(index => ({
      id: `sample-${index}`,
      name: `Sample ${index + 1}`,
      sequence: mutateSequence(1000 + index, ancestor, 0.006, 6)
    }));
    const started = Date.now();
    const result = multipleSequenceAlignment(input);
    const elapsed = Date.now() - started;

    expect(result.rows).toHaveLength(8);
    expect(result.columns).toBeGreaterThan(2900);
    expect(result.columns).toBeLessThan(3300);
    result.rows.forEach((row, index) => {
      expect(row.aligned).toHaveLength(result.columns);
      expect(ungapped(row.aligned)).toBe(input[index].sequence);
    });
    expect(result.conservation).toHaveLength(result.columns);
    expect(result.identityMatrix).toHaveLength(8);
    expect(elapsed).toBeLessThan(3000);
  }, 15000);
});
