// Enzyme definitions are derived from @teselagen/sequence-utils (MIT) and
// public REBASE catalogue metadata; no third-party source files are copied.
import type { RestrictionEnzyme } from '../../types/schema';
import { aliasedEnzymesByName } from '@teselagen/sequence-utils';
import { ENZYME_SUPPLIER_CATALOG } from './enzyme-catalog';
import { ENZYME_DIGEST_CONDITIONS } from './digest-buffer';
import { REBASE_OVERRIDES, REBASE_UNKNOWN_CUT } from './rebase-overrides';

type BufferName = 'r1.1' | 'r2.1' | 'r3.1' | 'rCutSmart';
type NebBuffers = Record<BufferName, number>;
type MethylationSensitivity = NonNullable<RestrictionEnzyme['methylationSensitivity']>;

interface TeselagenEnzymeDefinition {
  name?: string;
  aliases?: string[];
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
  suppliers?: string[];
}

const ENZYME_DB = aliasedEnzymesByName as unknown as Record<
  string,
  TeselagenEnzymeDefinition | undefined
>;

const RECOGNITION_PATTERN = /^[ACGTURYSWKMBDHVN]+$/;

function normalizeRecognition(site: string | undefined): string | null {
  if (typeof site !== 'string') return null;
  const recognition = site.trim().toUpperCase().replace(/\s+/g, '').replace(/U/g, 'T');
  if (!recognition || !RECOGNITION_PATTERN.test(recognition)) return null;
  return recognition;
}

function validCutIndex(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// Canonical NEB enzymes whose recognition sequence and cut offsets are
// available in the shared Teselagen enzyme table. This list is kept first so
// existing callers observe the same ordering and metadata as before.
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

// Homing endonucleases are not part of the Teselagen table. Their cut
// coordinates are expressed relative to the 5' end of the recognition site,
// using the negative offsets reported by NEB/REBASE.
const HOMING_ENZYMES: RestrictionEnzyme[] = [
  {
    name: 'I-SceI',
    recognitionSeq: 'TAGGGATAACAGGGTAAT',
    cutIndexTop: -9,
    cutIndexBottom: -13,
    isTypeIIS: false,
    suppliers: ['NEB', 'Thermo'],
  },
  {
    name: 'I-CeuI',
    recognitionSeq: 'TAACTATAACGGTCCTAAGGTAGCGAA',
    cutIndexTop: -9,
    cutIndexBottom: -13,
    isTypeIIS: false,
    suppliers: ['NEB', 'Thermo'],
  },
  {
    name: 'PI-SceI',
    recognitionSeq: 'ATCTATGTCGGGTGCGGAGAAAGAGGTAAT',
    cutIndexTop: -15,
    cutIndexBottom: -19,
    isTypeIIS: false,
    suppliers: ['NEB'],
  },
  {
    name: 'PI-PspI',
    recognitionSeq: 'TGGCAAACAGCTATTATGGGTATTATGGGT',
    cutIndexTop: -13,
    cutIndexBottom: -17,
    isTypeIIS: false,
    suppliers: ['NEB', 'Thermo'],
  },
];

function buildDatabaseEnzyme(
  definition: TeselagenEnzymeDefinition,
  name: string,
): RestrictionEnzyme | null {
  const recognitionSeq = normalizeRecognition(definition.site);
  if (
    !recognitionSeq ||
    !validCutIndex(definition.topSnipOffset) ||
    !validCutIndex(definition.bottomSnipOffset)
  ) {
    return null;
  }
  return {
    name,
    recognitionSeq,
    cutIndexTop: definition.topSnipOffset,
    cutIndexBottom: definition.bottomSnipOffset,
    isTypeIIS: definition.isType2S === true,
  };
}

function buildDatabase(): RestrictionEnzyme[] {
  const byName = new Map<string, RestrictionEnzyme>();
  for (const definition of Object.values(ENZYME_DB)) {
    if (!definition) continue;
    const name = definition.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (byName.has(key) || REBASE_UNKNOWN_CUT.has(name)) continue;
    const enzyme = buildDatabaseEnzyme(definition, name);
    if (!enzyme) continue;
    const override = REBASE_OVERRIDES[name];
    if (override) {
      const { recognitionSeq, cutIndexTop, cutIndexBottom, secondCut } = override;
      const outside =
        secondCut !== undefined ||
        Math.min(cutIndexTop, cutIndexBottom) < 0 ||
        Math.max(cutIndexTop, cutIndexBottom) > recognitionSeq.length;
      Object.assign(enzyme, { recognitionSeq, cutIndexTop, cutIndexBottom, isTypeIIS: outside || enzyme.isTypeIIS });
      if (secondCut) enzyme.secondCut = { ...secondCut };
    }
    byName.set(key, enzyme);
  }
  for (const enzyme of HOMING_ENZYMES) {
    const key = enzyme.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, { ...enzyme });
  }
  return [...byName.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export const ENZYME_DATABASE: RestrictionEnzyme[] = buildDatabase();

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

const NEB_CONDITIONS_BY_NAME = new Map(
  Object.entries(ENZYME_DIGEST_CONDITIONS).map(([name, condition]) => [
    name.toLowerCase(),
    condition,
  ]),
);

function buffersFor(name: string): NebBuffers {
  const condition = NEB_CONDITIONS_BY_NAME.get(name.toLowerCase());
  if (condition) {
    return { ...DEFAULT_BUFFERS, ...condition.activities };
  }
  return { ...DEFAULT_BUFFERS, ...(BUFFER_OVERRIDES[name] ?? {}) };
}

const DEFAULT_METHYLATION: MethylationSensitivity = {
  dam: 'insensitive',
  dcm: 'insensitive',
  cpg: 'insensitive',
};

// Metadata for the original 82 commercial entries is intentionally stable;
// downstream callers and released digest results depend on these values.
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

// Additional Dam/Dcm/CpG sensitivities for catalogued enzymes. Values use
// NEB's Dam-Dcm and CpG methylation reference and distinguish outright blocks
// from impaired cleavage.
const ADDITIONAL_METHYLATION: Record<string, MethylationSensitivity> = {
  AatII: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  AccI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  Acc65I: { dam: 'insensitive', dcm: 'impaired', cpg: 'impaired' },
  AciI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  AclI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  AfeI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  AgeI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  AlwI: { dam: 'blocked', dcm: 'insensitive', cpg: 'insensitive' },
  AlwNI: { dam: 'insensitive', dcm: 'blocked', cpg: 'insensitive' },
  ApaI: { dam: 'insensitive', dcm: 'blocked', cpg: 'blocked' },
  AvaI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  AvaII: { dam: 'insensitive', dcm: 'blocked', cpg: 'blocked' },
  BanI: { dam: 'insensitive', dcm: 'blocked', cpg: 'impaired' },
  BcgI: { dam: 'impaired', dcm: 'insensitive', cpg: 'blocked' },
  BsaI: { dam: 'insensitive', dcm: 'impaired', cpg: 'blocked' },
  BsaBI: { dam: 'blocked', dcm: 'insensitive', cpg: 'impaired' },
  BsaHI: { dam: 'insensitive', dcm: 'blocked', cpg: 'blocked' },
  BslI: { dam: 'insensitive', dcm: 'blocked', cpg: 'impaired' },
  BsmFI: { dam: 'insensitive', dcm: 'blocked', cpg: 'impaired' },
  BspDI: { dam: 'blocked', dcm: 'insensitive', cpg: 'blocked' },
  BspEI: { dam: 'blocked', dcm: 'insensitive', cpg: 'impaired' },
  BspHI: { dam: 'impaired', dcm: 'insensitive', cpg: 'insensitive' },
  BssHII: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  BssKI: { dam: 'insensitive', dcm: 'blocked', cpg: 'insensitive' },
  BstBI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  BstXI: { dam: 'insensitive', dcm: 'blocked', cpg: 'insensitive' },
  BstZ17I: { dam: 'insensitive', dcm: 'insensitive', cpg: 'impaired' },
  BtgZI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'impaired' },
  DpnII: { dam: 'blocked', dcm: 'insensitive', cpg: 'insensitive' },
  EaeI: { dam: 'insensitive', dcm: 'blocked', cpg: 'blocked' },
  EcoO109I: { dam: 'insensitive', dcm: 'blocked', cpg: 'insensitive' },
  EcoRV: { dam: 'insensitive', dcm: 'insensitive', cpg: 'impaired' },
  FokI: { dam: 'insensitive', dcm: 'impaired', cpg: 'impaired' },
  FseI: { dam: 'insensitive', dcm: 'blocked', cpg: 'blocked' },
  HaeII: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  HhaI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  HphI: { dam: 'blocked', dcm: 'blocked', cpg: 'insensitive' },
  Hpy188I: { dam: 'blocked', dcm: 'insensitive', cpg: 'insensitive' },
  Hpy188III: { dam: 'blocked', dcm: 'insensitive', cpg: 'impaired' },
  KasI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  MboII: { dam: 'blocked', dcm: 'insensitive', cpg: 'insensitive' },
  MluI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  MscI: { dam: 'insensitive', dcm: 'blocked', cpg: 'insensitive' },
  NaeI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  NarI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  NlaIV: { dam: 'insensitive', dcm: 'blocked', cpg: 'impaired' },
  NruI: { dam: 'blocked', dcm: 'insensitive', cpg: 'blocked' },
  PflMI: { dam: 'insensitive', dcm: 'blocked', cpg: 'insensitive' },
  PpuMI: { dam: 'insensitive', dcm: 'blocked', cpg: 'insensitive' },
  PspGI: { dam: 'insensitive', dcm: 'blocked', cpg: 'insensitive' },
  PspOMI: { dam: 'insensitive', dcm: 'impaired', cpg: 'blocked' },
  PvuI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  SacII: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  SalI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  Sau96I: { dam: 'insensitive', dcm: 'blocked', cpg: 'impaired' },
  ScrFI: { dam: 'insensitive', dcm: 'blocked', cpg: 'impaired' },
  SexAI: { dam: 'insensitive', dcm: 'blocked', cpg: 'insensitive' },
  SfiI: { dam: 'insensitive', dcm: 'blocked', cpg: 'impaired' },
  SfoI: { dam: 'insensitive', dcm: 'blocked', cpg: 'blocked' },
  SmaI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  SnaBI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  SrfI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked' },
  StuI: { dam: 'insensitive', dcm: 'blocked', cpg: 'insensitive' },
  StyD4I: { dam: 'insensitive', dcm: 'blocked', cpg: 'impaired' },
  TaqI: { dam: 'blocked', dcm: 'insensitive', cpg: 'insensitive' },
  XmaI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'impaired' },
  XhoI: { dam: 'insensitive', dcm: 'insensitive', cpg: 'impaired' },
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
    suppliers: manual?.suppliers ?? ['NEB'],
    nebBuffers: buffersFor(name),
  };
}

const SUPPLIERS_BY_NAME = new Map<string, string[]>();
for (const [catalogSupplier, names] of Object.entries(ENZYME_SUPPLIER_CATALOG)) {
  const supplier = catalogSupplier === 'Thermo Fisher' ? 'Thermo' : catalogSupplier;
  for (const name of names) {
    const key = name.toLowerCase();
    const suppliers = SUPPLIERS_BY_NAME.get(key);
    if (suppliers) {
      if (!suppliers.includes(supplier)) suppliers.push(supplier);
    } else {
      SUPPLIERS_BY_NAME.set(key, [supplier]);
    }
  }
}

function buildCommercialDatabaseEntry(
  definition: TeselagenEnzymeDefinition,
  name: string,
  suppliers: string[],
): RestrictionEnzyme | null {
  const enzyme = buildDatabaseEnzyme(definition, name);
  if (!enzyme) return null;
  return {
    ...enzyme,
    methylationSensitivity: {
      ...(ADDITIONAL_METHYLATION[name] ?? DEFAULT_METHYLATION),
    },
    suppliers: [...suppliers],
    nebBuffers: buffersFor(name),
  };
}

// These redundant isoschizomers remain available through ENZYME_DATABASE and
// getEnzymeByName, but are omitted from the default commercial preset so a
// default digest of a large repetitive plasmid stays responsive.
const OMITTED_FROM_COMMERCIAL_PRESET = new Set([
  'Cac8I',
  'FatI',
  'HpyCH4V',
  'NlaIII',
  'NspI',
  'BbuI',
  'Hsp92II',
  'BstC8I',
  'BstNSI',
  'FaeI',
  'FaiI',
  'Hin1II',
  'Mph1103I',
  'PaeI',
  'XceI',
  'Zsp2I',
]);

function buildCommercialEnzymes(): RestrictionEnzyme[] {
  const byName = new Map<string, RestrictionEnzyme>();
  for (const name of ENZYME_NAMES) {
    const enzyme = buildEnzyme(name);
    byName.set(enzyme.name.toLowerCase(), enzyme);
  }
  for (const manual of MANUAL_ENZYMES) {
    const enzyme = buildEnzyme(manual);
    byName.set(enzyme.name.toLowerCase(), enzyme);
  }

  const catalogNames = new Set<string>();
  for (const names of Object.values(ENZYME_SUPPLIER_CATALOG)) {
    for (const name of names) catalogNames.add(name);
  }
  for (const catalogName of catalogNames) {
    const key = catalogName.toLowerCase();
    if (byName.has(key)) continue;
    const definition = ENZYME_DB[key];
    if (!definition) continue;
    const name = definition.name?.trim();
    if (!name) continue;
    const suppliers = SUPPLIERS_BY_NAME.get(key) ?? [];
    const enzyme = buildCommercialDatabaseEntry(definition, name, suppliers);
    if (enzyme) byName.set(key, enzyme);
  }
  return [...byName.values()].filter(
    (enzyme) => !OMITTED_FROM_COMMERCIAL_PRESET.has(enzyme.name),
  );
}

export const COMMERCIAL_ENZYMES: RestrictionEnzyme[] = buildCommercialEnzymes();

const COMMERCIAL_BY_NAME = new Map<string, RestrictionEnzyme>(
  COMMERCIAL_ENZYMES.map((enzyme) => [enzyme.name.toLowerCase(), enzyme]),
);
const DATABASE_BY_NAME = new Map<string, RestrictionEnzyme>(
  ENZYME_DATABASE.map((enzyme) => [enzyme.name.toLowerCase(), enzyme]),
);
const ALIAS_TO_NAME = new Map<string, string>();
for (const definition of Object.values(ENZYME_DB)) {
  if (!definition?.name) continue;
  const canonical = definition.name.toLowerCase();
  for (const alias of definition.aliases ?? []) {
    ALIAS_TO_NAME.set(alias.toLowerCase(), canonical);
  }
}

export function getEnzymeByName(name: string): RestrictionEnzyme | undefined {
  const key = (name ?? '').trim().toLowerCase();
  if (!key) return undefined;
  return (
    COMMERCIAL_BY_NAME.get(key) ??
    DATABASE_BY_NAME.get(key) ??
    DATABASE_BY_NAME.get(ALIAS_TO_NAME.get(key) ?? '')
  );
}

function compareEnzymeNames(
  left: RestrictionEnzyme,
  right: RestrictionEnzyme,
): number {
  return left.name.localeCompare(right.name);
}

export function findIsoschizomers(
  enzyme: RestrictionEnzyme,
  pool: RestrictionEnzyme[] = ENZYME_DATABASE,
): { isoschizomers: RestrictionEnzyme[]; neoschizomers: RestrictionEnzyme[] } {
  const recognition = normalizeRecognition(enzyme.recognitionSeq);
  if (!recognition) {
    return { isoschizomers: [], neoschizomers: [] };
  }
  const selfName = enzyme.name.toLowerCase();
  const isoschizomers: RestrictionEnzyme[] = [];
  const neoschizomers: RestrictionEnzyme[] = [];
  const seen = new Set<string>();
  for (const candidate of pool) {
    if (!candidate || candidate.name.toLowerCase() === selfName) continue;
    const candidateRecognition = normalizeRecognition(candidate.recognitionSeq);
    if (candidateRecognition !== recognition) continue;
    const key = candidate.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (
      candidate.cutIndexTop === enzyme.cutIndexTop &&
      candidate.cutIndexBottom === enzyme.cutIndexBottom
    ) {
      isoschizomers.push(candidate);
    } else {
      neoschizomers.push(candidate);
    }
  }
  isoschizomers.sort(compareEnzymeNames);
  neoschizomers.sort(compareEnzymeNames);
  return { isoschizomers, neoschizomers };
}

export interface EnzymeSet {
  id: string;
  name: string;
  description: string;
  enzymeNames: string[];
}

function makeEnzymeSet(
  id: string,
  name: string,
  description: string,
  names: string[],
): EnzymeSet {
  const enzymeNames: string[] = [];
  const seen = new Set<string>();
  for (const requested of names) {
    const enzyme = getEnzymeByName(requested);
    if (!enzyme) continue;
    const key = enzyme.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    enzymeNames.push(enzyme.name);
  }
  return { id, name, description, enzymeNames };
}

const COMMON_SIX_PLUS = [
  'EcoRI', 'BamHI', 'HindIII', 'NotI', 'XhoI', 'NheI', 'SpeI', 'XbaI',
  'PstI', 'SalI', 'NdeI', 'KpnI', 'SacI', 'SmaI', 'EcoRV', 'MluI',
  'NcoI', 'BglII', 'AscI', 'PacI', 'PmeI', 'SbfI', 'AgeI', 'ApaI',
  'ApaLI', 'AvrII', 'BstXI', 'ClaI', 'DraI', 'EagI', 'FseI', 'HpaI',
  'PvuI', 'PvuII', 'ScaI', 'SnaBI', 'SphI', 'SspI', 'StuI', 'SwaI',
  'XmaI', 'SrfI', 'Sse8387I', 'PshAI', 'AflII', 'BglI', 'BstBI',
  'KasI', 'MfeI', 'MscI', 'NsiI', 'ZraI', 'BspHI', 'BspEI',
  'BstZ17I', 'PspOMI', 'Eco47III',
];

const NEB_HF = [
  'EcoRI', 'BamHI', 'HindIII', 'NotI', 'XhoI', 'NheI', 'SpeI', 'XbaI',
  'PstI', 'SalI', 'NdeI', 'KpnI', 'SacI', 'SmaI', 'EcoRV', 'MluI',
  'NcoI', 'BglII', 'AgeI', 'ApaI', 'AscI', 'AvrII', 'BstXI', 'ClaI',
  'EagI', 'FseI', 'HpaI', 'PacI', 'PmeI', 'PvuI', 'PvuII', 'SacII',
  'ScaI', 'SbfI', 'SnaBI', 'SphI', 'SspI', 'StuI', 'XmaI', 'AatII',
  'ApaLI', 'BstEII', 'BstYI', 'EcoNI', 'MfeI', 'NruI', 'PciI', 'PmlI',
  'PshAI', 'RsrII', 'SgrAI', 'SrfI', 'SwaI', 'ZraI',
];

const TYPE_IIS_GOLDEN_GATE = [
  'BsaI', 'BsmBI', 'BbsI', 'SapI', 'PaqCI', 'AarI', 'BsmFI', 'BspQI',
  'BtgZI', 'Esp3I', 'BfuAI', 'BsmAI', 'BspMI', 'BveI', 'BsaXI', 'FokI',
  'BspCNI', 'BseRI', 'BsgI', 'BpuEI', 'BpmI', 'EciI', 'MmeI', 'NmeAIII',
  'PleI', 'SfaNI', 'BccI', 'BbvI', 'BceAI', 'BciVI', 'BcoDI', 'BmrI',
  'BtsCI', 'BtsI', 'MlyI', 'HgaI', 'HphI', 'MboII', 'MnlI', 'AlwI',
  'BaeI', 'BcgI', 'CspCI',
];

const BLUNT_CUTTERS = [
  'SmaI', 'EcoRV', 'PvuII', 'HpaI', 'DraI', 'StuI', 'SspI', 'ScaI',
  'NaeI', 'MscI', 'SrfI', 'SwaI', 'PmeI', 'SnaBI', 'BstZ17I', 'ZraI',
  'AluI', 'HaeIII', 'RsaI', 'BstUI', 'HincII', 'NlaIV', 'SfoI', 'AfeI',
  'Eco47III', 'PmlI', 'SmiI', 'BsaAI', 'BsaBI', 'EcoICRI', 'Eco53kI',
  'Eco72I', 'FspI', 'NruI', 'XmnI', 'MlyI', 'BsrBI',
];

const RARE_EIGHT_BASE = [
  'NotI', 'AscI', 'PacI', 'PmeI', 'SbfI', 'FseI', 'SwaI', 'SrfI',
  'Sse8387I', 'AsiSI', 'CciNI', 'SgrAI', 'SgrDI', 'MauBI', 'FspAI',
  'SgsI', 'SmiI',
];

const FREQUENT_FOUR_BASE = [
  'AluI', 'HaeIII', 'MspI', 'HpaII', 'TaqI', 'Sau3AI', 'MboI', 'DpnII',
  'RsaI', 'CviQI', 'BstUI', 'MseI', 'Tru1I', 'MluCI', 'HhaI', 'HinP1I',
  'HpyCH4IV', 'Bsp143I', 'CviKI-1', 'Bsh1236I',
];

const COMMON_MCS = [
  'EcoRI', 'SacI', 'KpnI', 'SmaI', 'BamHI', 'XbaI', 'SalI', 'PstI',
  'SphI', 'HindIII', 'NdeI', 'NheI', 'BglII', 'NotI', 'XhoI', 'EcoRV',
  'ClaI', 'SpeI', 'ApaI', 'XmaI', 'SbfI', 'AscI', 'PacI', 'PmeI',
  'SwaI', 'SrfI', 'FseI', 'MluI', 'NcoI', 'AflII', 'ApaLI', 'BstBI',
  'BstXI', 'EagI', 'KasI', 'NsiI', 'PvuI', 'PvuII', 'ScaI', 'SnaBI',
  'SspI', 'StuI', 'ZraI', 'BspHI', 'BspEI', 'BstZ17I', 'PspOMI',
  'Eco47III',
];

const HOMING = ['I-SceI', 'I-CeuI', 'PI-SceI', 'PI-PspI'];

export const ENZYME_SETS: EnzymeSet[] = [
  makeEnzymeSet(
    'common-six-plus',
    'Common 6+ base cutters',
    'Frequently used enzymes that recognise six or more bases.',
    COMMON_SIX_PLUS,
  ),
  makeEnzymeSet(
    'neb-hf',
    'NEB HF enzymes',
    'High-fidelity enzymes commonly supplied by New England Biolabs.',
    NEB_HF,
  ),
  makeEnzymeSet(
    'type-iis-golden-gate',
    'Type IIS / Golden Gate',
    'Enzymes that cleave outside an asymmetric recognition sequence.',
    TYPE_IIS_GOLDEN_GATE,
  ),
  makeEnzymeSet(
    'blunt-cutters',
    'Blunt-end cutters',
    'Enzymes that generate blunt-ended DNA fragments.',
    BLUNT_CUTTERS,
  ),
  makeEnzymeSet(
    'rare-eight-base',
    'Rare 8-base cutters',
    'Low-frequency enzymes with eight-base recognition sites.',
    RARE_EIGHT_BASE,
  ),
  makeEnzymeSet(
    'frequent-four-base',
    'Frequent 4-base cutters',
    'High-frequency enzymes used for dense restriction maps.',
    FREQUENT_FOUR_BASE,
  ),
  makeEnzymeSet(
    'common-mcs',
    'Common vector MCS enzymes',
    'Enzymes found in pUC19, pET, pBluescript and related polylinkers.',
    COMMON_MCS,
  ),
  makeEnzymeSet(
    'homing-endonucleases',
    'Homing endonucleases',
    'Large-site rare cutters used for genome engineering.',
    HOMING,
  ),
];

export function filterEnzymes(
  pool: RestrictionEnzyme[],
  opts: {
    minSiteLength?: number;
    maxSiteLength?: number;
    overhang?: Array<'5-prime' | '3-prime' | 'blunt'>;
    typeIIS?: boolean;
    supplier?: string;
    nameQuery?: string;
  } = {},
): RestrictionEnzyme[] {
  const nameQuery = opts.nameQuery?.trim().toLowerCase();
  const supplierQuery = opts.supplier?.trim().toLowerCase();
  return pool.filter((enzyme) => {
    const siteLength = enzyme.recognitionSeq.length;
    if (opts.minSiteLength !== undefined && siteLength < opts.minSiteLength) {
      return false;
    }
    if (opts.maxSiteLength !== undefined && siteLength > opts.maxSiteLength) {
      return false;
    }
    if (opts.typeIIS !== undefined && (enzyme.isTypeIIS === true) !== opts.typeIIS) {
      return false;
    }
    if (opts.overhang && opts.overhang.length > 0) {
      const type: '5-prime' | '3-prime' | 'blunt' =
        enzyme.cutIndexTop === enzyme.cutIndexBottom
          ? 'blunt'
          : enzyme.cutIndexTop < enzyme.cutIndexBottom
            ? '5-prime'
            : '3-prime';
      if (!opts.overhang.includes(type)) return false;
    }
    if (supplierQuery) {
      const matches = (enzyme.suppliers ?? []).some((supplier) => {
        const value = supplier.toLowerCase();
        return value === supplierQuery || value.includes(supplierQuery) || supplierQuery.includes(value);
      });
      if (!matches) return false;
    }
    if (nameQuery && !enzyme.name.toLowerCase().includes(nameQuery)) {
      return false;
    }
    return true;
  });
}
