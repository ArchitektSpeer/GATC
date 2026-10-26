import type { RestrictionEnzyme } from '../../types/schema';
import { defaultEnzymesByName } from '@teselagen/sequence-utils';

type BufferName = 'r1.1' | 'r2.1' | 'r3.1' | 'rCutSmart';
type NebBuffers = Record<BufferName, number>;
type MethylationSensitivity = NonNullable<RestrictionEnzyme['methylationSensitivity']>;

interface TeselagenEnzymeDefinition {
  site?: string;
  topSnipOffset?: number;
  bottomSnipOffset?: number;
  isType2S?: boolean;
}

interface ManualEnzymeDefinition {
  name: string;
  recognitionSeq: string;
  cutIndexTop: number;
  cutIndexBottom: number;
  isTypeIIS?: boolean;
}

const ENZYME_DB = defaultEnzymesByName as unknown as Record<
  string,
  TeselagenEnzymeDefinition | undefined
>;

// Canonical NEB enzymes whose recognition sequence and cut offsets are
// available in the shared Teselagen enzyme table.
const ENZYME_NAMES = [
  'EcoRI',
  'BamHI',
  'HindIII',
  'NotI',
  'XhoI',
  'NheI',
  'SpeI',
  'XbaI',
  'PstI',
  'SalI',
  'NdeI',
  'KpnI',
  'SacI',
  'SmaI',
  'EcoRV',
  'MluI',
  'NcoI',
  'BglII',
  'AscI',
  'PacI',
  'PmeI',
  'SbfI',
  'BsaI',
  'BsmBI',
  'BbsI',
  'SapI',
  'AarI',
  'DpnI',
  'AflII',
  'ApaI',
  'ApaLI',
  'AvrII',
  'BglI',
  'BstXI',
  'ClaI',
  'DraI',
  'EagI',
  'FseI',
  'HpaI',
  'PvuI',
  'PvuII',
  'ScaI',
  'SnaBI',
  'SphI',
  'SspI',
  'StuI',
  'SwaI',
  'XmaI',
  'SrfI',
  'Sse8387I',
  'PshAI',
  'SmiI',
  'HincII',
  'MboI',
  'MboII',
  'TaqI',
  'HaeII',
  'HaeIII',
  'AluI',
  'Sau3AI',
  'MspI',
  'MseI',
  'NlaIV',
] as const;

// Frequently used enzymes absent from the shared table. Offsets follow the
// same top-strand coordinate convention as the schema.
const MANUAL_ENZYMES: ManualEnzymeDefinition[] = [
  { name: 'AgeI', recognitionSeq: 'ACCGGT', cutIndexTop: 1, cutIndexBottom: 5 },
  { name: 'PaqCI', recognitionSeq: 'CACCTGC', cutIndexTop: 11, cutIndexBottom: 15, isTypeIIS: true },
  { name: 'BclI', recognitionSeq: 'TGATCA', cutIndexTop: 1, cutIndexBottom: 5 },
  { name: 'BstBI', recognitionSeq: 'TTCGAA', cutIndexTop: 1, cutIndexBottom: 5 },
  { name: 'KasI', recognitionSeq: 'GGCGCC', cutIndexTop: 1, cutIndexBottom: 5 },
  { name: 'MfeI', recognitionSeq: 'CAATTG', cutIndexTop: 1, cutIndexBottom: 5 },
  { name: 'MscI', recognitionSeq: 'TGGCCA', cutIndexTop: 3, cutIndexBottom: 3 },
  { name: 'NsiI', recognitionSeq: 'ATGCAT', cutIndexTop: 5, cutIndexBottom: 1 },
  { name: 'ZraI', recognitionSeq: 'GACGTC', cutIndexTop: 3, cutIndexBottom: 3 },
  { name: 'BspHI', recognitionSeq: 'TCATGA', cutIndexTop: 1, cutIndexBottom: 5 },
  { name: 'BspEI', recognitionSeq: 'TCCGGA', cutIndexTop: 1, cutIndexBottom: 5 },
  { name: 'BstZ17I', recognitionSeq: 'GTATAC', cutIndexTop: 3, cutIndexBottom: 3 },
  { name: 'PspOMI', recognitionSeq: 'GGGCCC', cutIndexTop: 1, cutIndexBottom: 5 },
  { name: 'Eco47III', recognitionSeq: 'AGCGCT', cutIndexTop: 3, cutIndexBottom: 3 },
  { name: 'HpaII', recognitionSeq: 'CCGG', cutIndexTop: 1, cutIndexBottom: 3 },
  { name: 'BstUI', recognitionSeq: 'CGCG', cutIndexTop: 2, cutIndexBottom: 2 },
  { name: 'DpnII', recognitionSeq: 'GATC', cutIndexTop: 0, cutIndexBottom: 4 },
  { name: 'BstNI', recognitionSeq: 'CCWGG', cutIndexTop: 2, cutIndexBottom: 3 },
  { name: 'CviQI', recognitionSeq: 'GTAC', cutIndexTop: 1, cutIndexBottom: 3 },
];

const DEFAULT_BUFFERS: NebBuffers = {
  'r1.1': 100,
  'r2.1': 100,
  'r3.1': 100,
  rCutSmart: 100,
};

// NEB activity percentages for enzymes whose buffer performance is commonly
// queried; unlisted enzymes use the fully active profile above.
const BUFFER_OVERRIDES: Record<string, Partial<NebBuffers>> = {
  NotI: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 },
  AarI: { 'r1.1': 25, 'r2.1': 50, 'r3.1': 25, rCutSmart: 100 },
  PaqCI: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 },
  BsaI: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 },
  BsmBI: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 },
  BbsI: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 },
  SapI: { 'r1.1': 50, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 },
  DpnI: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 },
  PacI: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 },
  PmeI: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 },
  SbfI: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 },
  XbaI: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 },
  ClaI: { 'r1.1': 100, 'r2.1': 100, 'r3.1': 100, rCutSmart: 100 },
};

const DEFAULT_METHYLATION: MethylationSensitivity = {
  dam: 'insensitive',
  dcm: 'insensitive',
  cpg: 'insensitive',
};

const METHYLATION: Record<string, MethylationSensitivity> = {
  XbaI: { dam: 'blocked', dcm: 'insensitive', cpg: 'insensitive' },
  ClaI: { dam: 'blocked', dcm: 'insensitive', cpg: 'insensitive' },
  BclI: { dam: 'blocked', dcm: 'insensitive', cpg: 'insensitive' },
  BglII: { dam: 'blocked', dcm: 'insensitive', cpg: 'insensitive' },
  MboI: { dam: 'blocked', dcm: 'insensitive', cpg: 'insensitive' },
  Sau3AI: { dam: 'blocked', dcm: 'insensitive', cpg: 'insensitive' },
  // DpnI is the opposite of a blocked enzyme: it requires Dam methylation.
  // findCutSites enforces that positive requirement explicitly.
  DpnI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive' },
  DpnII: { dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive' },
  BstNI: { dam: 'insensitive', dcm: 'blocked', cpg: 'insensitive' },
  HpaII: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  BstUI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  NotI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  EagI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
};

function buildEnzyme(manual: ManualEnzymeDefinition): RestrictionEnzyme;
function buildEnzyme(name: string): RestrictionEnzyme;
function buildEnzyme(input: string | ManualEnzymeDefinition): RestrictionEnzyme {
  const manual = typeof input === 'string' ? undefined : input;
  const name = typeof input === 'string' ? input : input.name;
  const definition = ENZYME_DB[name.toLowerCase()];
  const recognitionSeq = (manual?.recognitionSeq ?? definition?.site ?? '').toUpperCase();
  const cutIndexTop = manual?.cutIndexTop ?? definition?.topSnipOffset;
  const cutIndexBottom = manual?.cutIndexBottom ?? definition?.bottomSnipOffset;

  if (!recognitionSeq || cutIndexTop === undefined || cutIndexBottom === undefined) {
    throw new Error(`Missing restriction enzyme definition for ${name}`);
  }

  return {
    name,
    recognitionSeq,
    cutIndexTop,
    cutIndexBottom,
    isTypeIIS: manual?.isTypeIIS ?? definition?.isType2S === true,
    methylationSensitivity: {
      ...(METHYLATION[name] ?? DEFAULT_METHYLATION),
    },
    suppliers: ['NEB'],
    nebBuffers: { ...DEFAULT_BUFFERS, ...(BUFFER_OVERRIDES[name] ?? {}) },
  };
}

export const COMMERCIAL_ENZYMES: RestrictionEnzyme[] = [
  ...ENZYME_NAMES.map((name) => buildEnzyme(name)),
  ...MANUAL_ENZYMES.map((enzyme) => buildEnzyme(enzyme)),
];

const ENZYMES_BY_NAME = new Map<string, RestrictionEnzyme>(
  COMMERCIAL_ENZYMES.map((enzyme) => [enzyme.name.toLowerCase(), enzyme]),
);

export function getEnzymeByName(name: string): RestrictionEnzyme | undefined {
  return ENZYMES_BY_NAME.get(name.trim().toLowerCase());
}
