import type { PlasmidDocument, VirtualGelLane } from '../../types/schema';

export type LadderName =
  | 'NEB 1kb Plus'
  | 'NEB 1kb'
  | 'NEB 100bp'
  | 'Takara DL2000'
  | 'Takara DL5000'
  | 'NEB 2-Log'
  | 'NEB 50bp'
  | 'NEB Low Molecular Weight'
  | 'NEB PCR Marker'
  | 'Thermo GeneRuler 1 kb'
  | 'Thermo GeneRuler 100 bp'
  | 'Thermo GeneRuler 100 bp Plus'
  | 'Thermo GeneRuler 1 kb Plus'
  | 'Thermo GeneRuler DNA Ladder Mix'
  | 'Thermo GeneRuler High Range'
  | 'Thermo GeneRuler Low Range'
  | 'Thermo GeneRuler 50 bp'
  | "Thermo O'GeneRuler 100 bp Plus"
  | "Thermo O'GeneRuler 1 kb Plus"
  | 'Thermo FastRuler Low Range'
  | 'Thermo FastRuler Middle Range'
  | 'Thermo FastRuler High Range'
  | 'Invitrogen 1 kb Plus'
  | 'Invitrogen 100 bp'
  | 'Invitrogen 1 kb'
  | 'Invitrogen Low DNA Mass'
  | 'Promega 100 bp'
  | 'Promega 1 kb'
  | 'Promega BenchTop 100 bp'
  | 'Promega BenchTop 1 kb'
  | 'Promega Lambda/HindIII'
  | 'λ/HindIII'
  | 'Thermo Lambda/EcoRI+HindIII'
  | 'Takara DL15000'
  | 'Takara DL10000'
  | 'Takara 1 kb DNA Ladder';

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
  ],
  'NEB 2-Log': [
    { sizeBp: 100, massNg: 20 },
    { sizeBp: 200, massNg: 22 },
    { sizeBp: 300, massNg: 24 },
    { sizeBp: 400, massNg: 26 },
    { sizeBp: 500, massNg: 28 },
    { sizeBp: 600, massNg: 30 },
    { sizeBp: 700, massNg: 32 },
    { sizeBp: 800, massNg: 34 },
    { sizeBp: 900, massNg: 36 },
    { sizeBp: 1000, massNg: 48, highlighted: true },
    { sizeBp: 1200, massNg: 38 },
    { sizeBp: 1500, massNg: 42 },
    { sizeBp: 2000, massNg: 46 },
    { sizeBp: 3000, massNg: 58, highlighted: true },
    { sizeBp: 4000, massNg: 50 },
    { sizeBp: 5000, massNg: 54 },
    { sizeBp: 6000, massNg: 58 },
    { sizeBp: 8000, massNg: 62 },
    { sizeBp: 10000, massNg: 68 }
  ],
  'NEB 50bp': [
    { sizeBp: 50, massNg: 20 },
    { sizeBp: 100, massNg: 22 },
    { sizeBp: 150, massNg: 24 },
    { sizeBp: 200, massNg: 26 },
    { sizeBp: 250, massNg: 28 },
    { sizeBp: 300, massNg: 30 },
    { sizeBp: 350, massNg: 32 },
    { sizeBp: 400, massNg: 34 },
    { sizeBp: 450, massNg: 36 },
    { sizeBp: 500, massNg: 48, highlighted: true },
    { sizeBp: 550, massNg: 38 },
    { sizeBp: 600, massNg: 40 },
    { sizeBp: 650, massNg: 42 },
    { sizeBp: 700, massNg: 44 },
    { sizeBp: 750, massNg: 46 },
    { sizeBp: 800, massNg: 48 },
    { sizeBp: 850, massNg: 50 },
    { sizeBp: 900, massNg: 52 },
    { sizeBp: 950, massNg: 54 },
    { sizeBp: 1000, massNg: 62 },
    { sizeBp: 1250, massNg: 58 },
    { sizeBp: 1500, massNg: 60 }
  ],
  'NEB Low Molecular Weight': [
    { sizeBp: 25, massNg: 16 },
    { sizeBp: 50, massNg: 18 },
    { sizeBp: 75, massNg: 20 },
    { sizeBp: 100, massNg: 34, highlighted: true },
    { sizeBp: 125, massNg: 24 },
    { sizeBp: 150, massNg: 26 },
    { sizeBp: 175, massNg: 28 },
    { sizeBp: 200, massNg: 30 },
    { sizeBp: 225, massNg: 32 },
    { sizeBp: 250, massNg: 34 },
    { sizeBp: 275, massNg: 36 },
    { sizeBp: 300, massNg: 38 },
    { sizeBp: 325, massNg: 40 },
    { sizeBp: 350, massNg: 42 },
    { sizeBp: 375, massNg: 44 },
    { sizeBp: 400, massNg: 46 },
    { sizeBp: 425, massNg: 48 },
    { sizeBp: 450, massNg: 50 },
    { sizeBp: 475, massNg: 52 },
    { sizeBp: 500, massNg: 60, highlighted: true }
  ],
  'NEB PCR Marker': [
    { sizeBp: 50, massNg: 20 },
    { sizeBp: 150, massNg: 24 },
    { sizeBp: 300, massNg: 28 },
    { sizeBp: 500, massNg: 44, highlighted: true },
    { sizeBp: 766, massNg: 34 },
    { sizeBp: 1000, massNg: 52, highlighted: true },
    { sizeBp: 1500, massNg: 40 }
  ],
  'Thermo GeneRuler 1 kb': [
    { sizeBp: 250, massNg: 20 },
    { sizeBp: 500, massNg: 28 },
    { sizeBp: 750, massNg: 32 },
    { sizeBp: 1000, massNg: 52, highlighted: true },
    { sizeBp: 1500, massNg: 36 },
    { sizeBp: 2000, massNg: 40 },
    { sizeBp: 2500, massNg: 44 },
    { sizeBp: 3000, massNg: 52, highlighted: true },
    { sizeBp: 4000, massNg: 46 },
    { sizeBp: 5000, massNg: 50 },
    { sizeBp: 6000, massNg: 54 },
    { sizeBp: 8000, massNg: 58 },
    { sizeBp: 10000, massNg: 64 }
  ],
  'Thermo GeneRuler 100 bp': [
    { sizeBp: 100, massNg: 20 },
    { sizeBp: 200, massNg: 22 },
    { sizeBp: 300, massNg: 24 },
    { sizeBp: 400, massNg: 26 },
    { sizeBp: 500, massNg: 48, highlighted: true },
    { sizeBp: 600, massNg: 30 },
    { sizeBp: 700, massNg: 32 },
    { sizeBp: 800, massNg: 34 },
    { sizeBp: 900, massNg: 36 },
    { sizeBp: 1000, massNg: 50, highlighted: true },
    { sizeBp: 1200, massNg: 40 },
    { sizeBp: 1500, massNg: 44 },
    { sizeBp: 2000, massNg: 48 },
    { sizeBp: 2500, massNg: 52 },
    { sizeBp: 3000, massNg: 60 }
  ],
  'Thermo GeneRuler 100 bp Plus': [
    { sizeBp: 100, massNg: 20 },
    { sizeBp: 200, massNg: 22 },
    { sizeBp: 300, massNg: 24 },
    { sizeBp: 400, massNg: 26 },
    { sizeBp: 500, massNg: 46, highlighted: true },
    { sizeBp: 600, massNg: 30 },
    { sizeBp: 700, massNg: 32 },
    { sizeBp: 800, massNg: 34 },
    { sizeBp: 900, massNg: 36 },
    { sizeBp: 1000, massNg: 52, highlighted: true },
    { sizeBp: 1200, massNg: 40 },
    { sizeBp: 1500, massNg: 44 },
    { sizeBp: 2000, massNg: 48 },
    { sizeBp: 2500, massNg: 52 },
    { sizeBp: 3000, massNg: 62 }
  ],
  'Thermo GeneRuler 1 kb Plus': [
    { sizeBp: 75, massNg: 16 },
    { sizeBp: 200, massNg: 18 },
    { sizeBp: 300, massNg: 20 },
    { sizeBp: 400, massNg: 22 },
    { sizeBp: 500, massNg: 24 },
    { sizeBp: 600, massNg: 26 },
    { sizeBp: 700, massNg: 28 },
    { sizeBp: 800, massNg: 30 },
    { sizeBp: 900, massNg: 32 },
    { sizeBp: 1000, massNg: 54, highlighted: true },
    { sizeBp: 1200, massNg: 36 },
    { sizeBp: 1500, massNg: 40 },
    { sizeBp: 2000, massNg: 44 },
    { sizeBp: 3000, massNg: 56, highlighted: true },
    { sizeBp: 4000, massNg: 48 },
    { sizeBp: 5000, massNg: 52 },
    { sizeBp: 6000, massNg: 56 },
    { sizeBp: 8000, massNg: 60 },
    { sizeBp: 10000, massNg: 66 },
    { sizeBp: 15000, massNg: 70 },
    { sizeBp: 20000, massNg: 74 }
  ],
  'Thermo GeneRuler DNA Ladder Mix': [
    { sizeBp: 100, massNg: 18 },
    { sizeBp: 200, massNg: 20 },
    { sizeBp: 300, massNg: 22 },
    { sizeBp: 400, massNg: 24 },
    { sizeBp: 500, massNg: 26 },
    { sizeBp: 600, massNg: 28 },
    { sizeBp: 700, massNg: 30 },
    { sizeBp: 800, massNg: 32 },
    { sizeBp: 900, massNg: 34 },
    { sizeBp: 1000, massNg: 56, highlighted: true },
    { sizeBp: 1200, massNg: 38 },
    { sizeBp: 1500, massNg: 42 },
    { sizeBp: 2000, massNg: 46 },
    { sizeBp: 2500, massNg: 50 },
    { sizeBp: 3000, massNg: 58, highlighted: true },
    { sizeBp: 4000, massNg: 52 },
    { sizeBp: 5000, massNg: 56 },
    { sizeBp: 6000, massNg: 60 },
    { sizeBp: 8000, massNg: 64 },
    { sizeBp: 10000, massNg: 68 }
  ],
  'Thermo GeneRuler High Range': [
    { sizeBp: 1000, massNg: 30 },
    { sizeBp: 2000, massNg: 34 },
    { sizeBp: 3000, massNg: 54, highlighted: true },
    { sizeBp: 4000, massNg: 40 },
    { sizeBp: 5000, massNg: 44 },
    { sizeBp: 6000, massNg: 48 },
    { sizeBp: 8000, massNg: 52 },
    { sizeBp: 10000, massNg: 60, highlighted: true },
    { sizeBp: 12000, massNg: 56 },
    { sizeBp: 15000, massNg: 60 },
    { sizeBp: 20000, massNg: 64 }
  ],
  'Thermo GeneRuler Low Range': [
    { sizeBp: 25, massNg: 16 },
    { sizeBp: 50, massNg: 18 },
    { sizeBp: 75, massNg: 20 },
    { sizeBp: 100, massNg: 40, highlighted: true },
    { sizeBp: 125, massNg: 24 },
    { sizeBp: 150, massNg: 26 },
    { sizeBp: 175, massNg: 28 },
    { sizeBp: 200, massNg: 30 },
    { sizeBp: 225, massNg: 32 },
    { sizeBp: 250, massNg: 34 },
    { sizeBp: 275, massNg: 36 },
    { sizeBp: 300, massNg: 46, highlighted: true },
    { sizeBp: 350, massNg: 40 },
    { sizeBp: 400, massNg: 42 },
    { sizeBp: 500, massNg: 46 }
  ],
  'Thermo GeneRuler 50 bp': [
    { sizeBp: 50, massNg: 18 },
    { sizeBp: 100, massNg: 20 },
    { sizeBp: 150, massNg: 22 },
    { sizeBp: 200, massNg: 24 },
    { sizeBp: 250, massNg: 26 },
    { sizeBp: 300, massNg: 28 },
    { sizeBp: 350, massNg: 30 },
    { sizeBp: 400, massNg: 32 },
    { sizeBp: 450, massNg: 34 },
    { sizeBp: 500, massNg: 46, highlighted: true },
    { sizeBp: 550, massNg: 36 },
    { sizeBp: 600, massNg: 38 },
    { sizeBp: 650, massNg: 40 },
    { sizeBp: 700, massNg: 42 },
    { sizeBp: 750, massNg: 44 },
    { sizeBp: 800, massNg: 46 },
    { sizeBp: 850, massNg: 48 },
    { sizeBp: 900, massNg: 50 },
    { sizeBp: 950, massNg: 52 },
    { sizeBp: 1000, massNg: 58 },
    { sizeBp: 1250, massNg: 54 },
    { sizeBp: 1500, massNg: 56 }
  ],
  "Thermo O'GeneRuler 100 bp Plus": [
    { sizeBp: 100, massNg: 20 },
    { sizeBp: 200, massNg: 22 },
    { sizeBp: 300, massNg: 24 },
    { sizeBp: 400, massNg: 26 },
    { sizeBp: 500, massNg: 46, highlighted: true },
    { sizeBp: 600, massNg: 30 },
    { sizeBp: 700, massNg: 32 },
    { sizeBp: 800, massNg: 34 },
    { sizeBp: 900, massNg: 36 },
    { sizeBp: 1000, massNg: 52, highlighted: true },
    { sizeBp: 1200, massNg: 40 },
    { sizeBp: 1500, massNg: 44 },
    { sizeBp: 2000, massNg: 48 },
    { sizeBp: 2500, massNg: 52 },
    { sizeBp: 3000, massNg: 62 }
  ],
  "Thermo O'GeneRuler 1 kb Plus": [
    { sizeBp: 75, massNg: 16 },
    { sizeBp: 200, massNg: 18 },
    { sizeBp: 300, massNg: 20 },
    { sizeBp: 400, massNg: 22 },
    { sizeBp: 500, massNg: 24 },
    { sizeBp: 600, massNg: 26 },
    { sizeBp: 700, massNg: 28 },
    { sizeBp: 800, massNg: 30 },
    { sizeBp: 900, massNg: 32 },
    { sizeBp: 1000, massNg: 54, highlighted: true },
    { sizeBp: 1200, massNg: 36 },
    { sizeBp: 1500, massNg: 40 },
    { sizeBp: 2000, massNg: 44 },
    { sizeBp: 3000, massNg: 56, highlighted: true },
    { sizeBp: 4000, massNg: 48 },
    { sizeBp: 5000, massNg: 52 },
    { sizeBp: 6000, massNg: 56 },
    { sizeBp: 8000, massNg: 60 },
    { sizeBp: 10000, massNg: 66 },
    { sizeBp: 15000, massNg: 70 },
    { sizeBp: 20000, massNg: 74 }
  ],
  'Thermo FastRuler Low Range': [
    { sizeBp: 50, massNg: 20 },
    { sizeBp: 100, massNg: 22 },
    { sizeBp: 150, massNg: 24 },
    { sizeBp: 200, massNg: 26 },
    { sizeBp: 300, massNg: 28 },
    { sizeBp: 400, massNg: 30 },
    { sizeBp: 500, massNg: 44, highlighted: true }
  ],
  'Thermo FastRuler Middle Range': [
    { sizeBp: 100, massNg: 20 },
    { sizeBp: 200, massNg: 22 },
    { sizeBp: 300, massNg: 24 },
    { sizeBp: 400, massNg: 26 },
    { sizeBp: 500, massNg: 44, highlighted: true },
    { sizeBp: 750, massNg: 30 },
    { sizeBp: 1000, massNg: 50, highlighted: true },
    { sizeBp: 1500, massNg: 36 },
    { sizeBp: 2000, massNg: 40 }
  ],
  'Thermo FastRuler High Range': [
    { sizeBp: 1000, massNg: 28 },
    { sizeBp: 1500, massNg: 32 },
    { sizeBp: 2000, massNg: 36 },
    { sizeBp: 2500, massNg: 40 },
    { sizeBp: 3000, massNg: 54, highlighted: true },
    { sizeBp: 4000, massNg: 44 },
    { sizeBp: 5000, massNg: 48 },
    { sizeBp: 6000, massNg: 52 },
    { sizeBp: 8000, massNg: 56 },
    { sizeBp: 10000, massNg: 60 }
  ],
  'Invitrogen 1 kb Plus': [
    { sizeBp: 100, massNg: 20 },
    { sizeBp: 200, massNg: 22 },
    { sizeBp: 300, massNg: 24 },
    { sizeBp: 400, massNg: 26 },
    { sizeBp: 500, massNg: 28 },
    { sizeBp: 650, massNg: 30 },
    { sizeBp: 850, massNg: 32 },
    { sizeBp: 1000, massNg: 54, highlighted: true },
    { sizeBp: 1650, massNg: 38 },
    { sizeBp: 2000, massNg: 42 },
    { sizeBp: 3000, massNg: 60, highlighted: true },
    { sizeBp: 4000, massNg: 46 },
    { sizeBp: 5000, massNg: 50 },
    { sizeBp: 6000, massNg: 54 },
    { sizeBp: 8000, massNg: 58 },
    { sizeBp: 10000, massNg: 64 }
  ],
  'Invitrogen 100 bp': [
    { sizeBp: 100, massNg: 20 },
    { sizeBp: 200, massNg: 22 },
    { sizeBp: 300, massNg: 24 },
    { sizeBp: 400, massNg: 26 },
    { sizeBp: 500, massNg: 46, highlighted: true },
    { sizeBp: 600, massNg: 30 },
    { sizeBp: 700, massNg: 32 },
    { sizeBp: 800, massNg: 34 },
    { sizeBp: 900, massNg: 36 },
    { sizeBp: 1000, massNg: 52, highlighted: true },
    { sizeBp: 1200, massNg: 40 },
    { sizeBp: 1500, massNg: 44 },
    { sizeBp: 2000, massNg: 48 },
    { sizeBp: 2500, massNg: 52 },
    { sizeBp: 3000, massNg: 58 }
  ],
  'Invitrogen 1 kb': [
    { sizeBp: 500, massNg: 26 },
    { sizeBp: 1000, massNg: 48, highlighted: true },
    { sizeBp: 1500, massNg: 34 },
    { sizeBp: 2000, massNg: 38 },
    { sizeBp: 2500, massNg: 42 },
    { sizeBp: 3000, massNg: 52, highlighted: true },
    { sizeBp: 4000, massNg: 46 },
    { sizeBp: 5000, massNg: 50 },
    { sizeBp: 6000, massNg: 54 },
    { sizeBp: 8000, massNg: 58 },
    { sizeBp: 10000, massNg: 64 }
  ],
  'Invitrogen Low DNA Mass': [
    { sizeBp: 100, massNg: 10 },
    { sizeBp: 200, massNg: 20 },
    { sizeBp: 400, massNg: 40 },
    { sizeBp: 800, massNg: 60 },
    { sizeBp: 1200, massNg: 80 },
    { sizeBp: 2000, massNg: 100, highlighted: true }
  ],
  'Promega 100 bp': [
    { sizeBp: 100, massNg: 20 },
    { sizeBp: 200, massNg: 22 },
    { sizeBp: 300, massNg: 24 },
    { sizeBp: 400, massNg: 26 },
    { sizeBp: 500, massNg: 46, highlighted: true },
    { sizeBp: 600, massNg: 30 },
    { sizeBp: 700, massNg: 32 },
    { sizeBp: 800, massNg: 34 },
    { sizeBp: 900, massNg: 36 },
    { sizeBp: 1000, massNg: 50, highlighted: true },
    { sizeBp: 1500, massNg: 42 }
  ],
  'Promega 1 kb': [
    { sizeBp: 1000, massNg: 50, highlighted: true },
    { sizeBp: 2000, massNg: 38 },
    { sizeBp: 3000, massNg: 56, highlighted: true },
    { sizeBp: 4000, massNg: 46 },
    { sizeBp: 5000, massNg: 50 },
    { sizeBp: 6000, massNg: 54 },
    { sizeBp: 8000, massNg: 60 },
    { sizeBp: 10000, massNg: 66 }
  ],
  'Promega BenchTop 100 bp': [
    { sizeBp: 100, massNg: 20 },
    { sizeBp: 200, massNg: 22 },
    { sizeBp: 300, massNg: 24 },
    { sizeBp: 400, massNg: 26 },
    { sizeBp: 500, massNg: 46, highlighted: true },
    { sizeBp: 600, massNg: 30 },
    { sizeBp: 700, massNg: 32 },
    { sizeBp: 800, massNg: 34 },
    { sizeBp: 900, massNg: 36 },
    { sizeBp: 1000, massNg: 54, highlighted: true },
    { sizeBp: 1200, massNg: 40 },
    { sizeBp: 1500, massNg: 44 },
    { sizeBp: 2000, massNg: 48 },
    { sizeBp: 3000, massNg: 58 }
  ],
  'Promega BenchTop 1 kb': [
    { sizeBp: 500, massNg: 26 },
    { sizeBp: 1000, massNg: 50, highlighted: true },
    { sizeBp: 1500, massNg: 34 },
    { sizeBp: 2000, massNg: 38 },
    { sizeBp: 2500, massNg: 42 },
    { sizeBp: 3000, massNg: 56, highlighted: true },
    { sizeBp: 4000, massNg: 46 },
    { sizeBp: 5000, massNg: 50 },
    { sizeBp: 6000, massNg: 54 },
    { sizeBp: 8000, massNg: 60 },
    { sizeBp: 10000, massNg: 66 }
  ],
  'Promega Lambda/HindIII': [
    { sizeBp: 125, massNg: 18 },
    { sizeBp: 564, massNg: 24 },
    { sizeBp: 2027, massNg: 38 },
    { sizeBp: 2322, massNg: 40 },
    { sizeBp: 4361, massNg: 54, highlighted: true },
    { sizeBp: 6557, massNg: 58 },
    { sizeBp: 9416, massNg: 64 },
    { sizeBp: 23130, massNg: 74, highlighted: true }
  ],
  'λ/HindIII': [
    { sizeBp: 125, massNg: 18 },
    { sizeBp: 564, massNg: 24 },
    { sizeBp: 2027, massNg: 38 },
    { sizeBp: 2322, massNg: 40 },
    { sizeBp: 4361, massNg: 54, highlighted: true },
    { sizeBp: 6557, massNg: 58 },
    { sizeBp: 9416, massNg: 64 },
    { sizeBp: 23130, massNg: 74, highlighted: true }
  ],
  'Thermo Lambda/EcoRI+HindIII': [
    { sizeBp: 125, massNg: 16 },
    { sizeBp: 564, massNg: 20 },
    { sizeBp: 831, massNg: 22 },
    { sizeBp: 947, massNg: 24 },
    { sizeBp: 1375, massNg: 26 },
    { sizeBp: 1584, massNg: 28 },
    { sizeBp: 1904, massNg: 30 },
    { sizeBp: 2027, massNg: 42, highlighted: true },
    { sizeBp: 3530, massNg: 36 },
    { sizeBp: 4268, massNg: 40 },
    { sizeBp: 4973, massNg: 50, highlighted: true },
    { sizeBp: 5148, massNg: 52 },
    { sizeBp: 21226, massNg: 70 }
  ],
  'Takara DL15000': [
    { sizeBp: 1000, massNg: 30 },
    { sizeBp: 2500, massNg: 40 },
    { sizeBp: 5000, massNg: 56, highlighted: true },
    { sizeBp: 7500, massNg: 50 },
    { sizeBp: 10000, massNg: 62 },
    { sizeBp: 15000, massNg: 70, highlighted: true }
  ],
  'Takara DL10000': [
    { sizeBp: 1000, massNg: 30 },
    { sizeBp: 2000, massNg: 36 },
    { sizeBp: 3000, massNg: 54, highlighted: true },
    { sizeBp: 4000, massNg: 42 },
    { sizeBp: 5000, massNg: 46 },
    { sizeBp: 6000, massNg: 50 },
    { sizeBp: 8000, massNg: 58 },
    { sizeBp: 10000, massNg: 66, highlighted: true }
  ],
  'Takara 1 kb DNA Ladder': [
    { sizeBp: 1000, massNg: 30 },
    { sizeBp: 2000, massNg: 36 },
    { sizeBp: 3000, massNg: 56, highlighted: true },
    { sizeBp: 4000, massNg: 42 },
    { sizeBp: 5000, massNg: 46 },
    { sizeBp: 6000, massNg: 50 },
    { sizeBp: 8000, massNg: 58 },
    { sizeBp: 10000, massNg: 66 }
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
