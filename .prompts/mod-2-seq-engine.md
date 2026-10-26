## 全局唯一数据契约 `src/types/schema.ts`（已存在于磁盘，只读，导入路径 `../../types/schema`）

```typescript
// src/types/schema.ts
// OpenSnapGene Global Data Contract (Single Source of Truth - Strictly Immutable Across Modules)

export type StrandDirection = 1 | -1 | 0;

export type FeatureType =
  | 'CDS'
  | 'promoter'
  | 'terminator'
  | 'rep_origin'
  | 'primer_bind'
  | 'misc_feature'
  | 'regulatory'
  | 'enhancer'
  | 'intron'
  | 'protein_bind'
  | 'oriT'
  | 'attachment_site'; // attB, attP, attL, attR, loxP

export interface SequenceFeature {
  id: string;
  name: string;
  type: FeatureType;
  start: number; // 0-based inclusive index
  end: number;   // 0-based exclusive index (if start > end in circular DNA, wraps around 0 origin)
  strand: StrandDirection;
  color: string; // Hex color code
  codonStart?: 1 | 2 | 3;
  notes?: Record<string, string[]>;
  translation?: string;
}

export interface RestrictionEnzyme {
  name: string;
  recognitionSeq: string;       // Uppercase IUPAC sequence, e.g., "GAATTC" or "GGTCTC"
  cutIndexTop: number;          // Cut offset relative to recognitionSeq start on 5'->3' strand
  cutIndexBottom: number;       // Cut offset relative to recognitionSeq start on 3'->5' strand
  isTypeIIS?: boolean;          // True for BsaI, BsmBI, BbsI, SapI (cuts outside recognition sequence)
  methylationSensitivity?: {
    dam?: 'blocked' | 'impaired' | 'insensitive';
    dcm?: 'blocked' | 'impaired' | 'insensitive';
    cpg?: 'blocked' | 'impaired' | 'insensitive';
  };
  suppliers?: string[];         // e.g., ["NEB", "Thermo", "Takara"]
  nebBuffers?: Record<'r1.1' | 'r2.1' | 'r3.1' | 'rCutSmart', number>; // Activity % (0-100)
}

export interface CutSite {
  id: string;
  enzyme: RestrictionEnzyme;
  position: number;             // 0-based start of recognition sequence
  strand: 1 | -1;               // Important for non-palindromic Type IIS enzymes
  cutPositionTop: number;       // Actual 0-based cut coordinate on 5'->3' strand (mod length)
  cutPositionBottom: number;    // Actual 0-based cut coordinate on 3'->5' strand (mod length)
  overhangType: '5-prime' | '3-prime' | 'blunt';
  overhangSeq: string;          // Single-stranded overhang sequence (5'->3')
  isMethylationBlocked: boolean; // True if overlapping Dam (GATC) or Dcm (CCWGG) site blocks cleavage
  totalCutsInPlasmid: number;
}

export interface Primer {
  id: string;
  name: string;
  sequence: string;             // Full 5'->3' oligo sequence (tailSequence + annealingSequence)
  bindingStart: number;         // 0-based start of annealing region on template
  bindingEnd: number;           // 0-based end of annealing region on template
  strand: 1 | -1;
  tailSequence: string;         // 5' non-annealing extension (restriction site, Gibson overlap, etc.)
  tmAnnealing: number;          // SantaLucia 1998 + Owczarzy salt-corrected Tm of binding region (°C)
  tmTotal: number;              // Full length Tm (°C)
  gcPercent: number;
  has3PrimeGCClamp: boolean;
  hairpinDeltaG: number;        // kcal/mol (negative values indicate stronger secondary structure)
  selfDimerDeltaG: number;      // kcal/mol
  mismatches?: number[];        // 0-based template positions of intentional site-directed mutagenesis bases
}

export interface ORF {
  id: string;
  start: number;
  end: number;
  strand: 1 | -1;
  frame: 1 | 2 | 3 | -1 | -2 | -3;
  lengthBp: number;
  aminoAcids: string;
  mwKda: number;                // Estimated protein molecular weight in kDa
  pI: number;                   // Theoretical isoelectric point
}

export type CloningOperationType =
  | 'import'
  | 'restriction_ligation'
  | 'gibson_assembly'
  | 'golden_gate'
  | 'gateway_bp'
  | 'gateway_lr'
  | 'pcr'
  | 'soe_pcr'
  | 'site_directed_mutagenesis'
  | 'blunting'
  | 'manual_edit';

export interface CloningHistoryNode {
  id: string;
  operation: CloningOperationType;
  timestamp: string;
  description: string;
  enzymesUsed?: string[];
  primersUsed?: string[];
  parentSnapshots?: Array<{
    id: string;
    name: string;
    length: number;
    extractedRange?: [number, number];
  }>;
}

export interface OverhangEnd {
  type: '5-prime' | '3-prime' | 'blunt';
  sequence: string;             // 5'->3' single-stranded overhang bases
  phosphorylated: boolean;
  sourceEnzyme?: string;
}

export interface PlasmidDocument {
  id: string;
  name: string;
  sequence: string;             // Uppercase IUPAC DNA sequence
  topology: 'circular' | 'linear';
  length: number;
  createdAt: string;
  updatedAt: string;
  description?: string;
  methylationProfile?: {
    dam: boolean;               // Default true for standard E. coli DH5alpha/TOP10
    dcm: boolean;               // Default true
    cpg: boolean;               // Default false
  };
  linearEnds?: {                // Present when topology === 'linear' (e.g. digested fragment or PCR product)
    left: OverhangEnd;
    right: OverhangEnd;
  };
  features: SequenceFeature[];
  primers: Primer[];
  history: CloningHistoryNode[];
}

export interface SelectionRange {
  start: number;                // 0-based inclusive
  end: number;                  // 0-based exclusive (wraps around 0 if start > end in circular plasmid)
  strand?: 1 | -1 | 'both';
}

export interface SangerTraceData {
  id: string;
  fileName: string;
  calledSequence: string;
  qualityScores: number[];      // Phred scores (0-62)
  baseLocations: number[];      // Trace sample index for each called base peak
  trimRange: [number, number];  // High-quality [startBaseIdx, endBaseIdx] after Mott trimming
  traces: {
    A: number[];
    T: number[];
    G: number[];
    C: number[];
  };
  alignment?: {
    refStart: number;
    refEnd: number;
    strand: 1 | -1;
    identityPercent: number;
    alignedRef: string;
    alignedQuery: string;
    mismatches: Array<{
      refIndex: number;
      queryIndex: number;
      type: 'substitution' | 'insertion' | 'deletion' | 'heterozygous_peak';
      refBase: string;
      queryBase: string;
      aminoAcidImpact?: string; // e.g., "Silent (L124L)" or "Missense (E45K in EGFP)"
    }>;
  };
}

export interface VirtualGelLane {
  id: string;
  label: string;
  isLadder?: boolean;
  bands: Array<{
    sizeBp: number;
    conformation: 'linear' | 'supercoiled' | 'nicked';
    apparentBp: number;         // Effective migration size (supercoiled migrates ~0.7x faster)
    migrationY: number;         // Normalized 0.0 (well) to 1.0 (bottom of gel)
    relativeIntensity: number;  // 0.1 to 1.0 (proportional to fragment mass fraction)
    fragmentDoc?: PlasmidDocument;
  }>;
}

// Module 6: BYOK AI Copilot Contracts
export type AIProviderType = 'openai' | 'anthropic' | 'deepseek' | 'gemini' | 'custom_openai';

export interface AIConfig {
  provider: AIProviderType;
  apiKey: string;               // Stored strictly in browser localStorage
  baseUrl: string;              // e.g., "https://api.deepseek.com/v1" or "https://api.openai.com/v1"
  model: string;                // e.g., "deepseek-chat", "gpt-4o", "claude-3-7-sonnet-latest"
  temperature?: number;
}

export type AIToolAction =
  | { type: 'DESIGN_PRIMERS'; payload: { targetStart: number; targetEnd: number; cloningMethod: 'gibson' | 'restriction' | 'mutagenesis'; forwardTail?: string; reverseTail?: string; mutationSeq?: string } }
  | { type: 'ADD_FEATURES'; payload: { features: Omit<SequenceFeature, 'id'>[] } }
  | { type: 'RUN_DIGESTION'; payload: { enzymeNames: string[] } }
  | { type: 'HIGHLIGHT_RANGE'; payload: { start: number; end: number; reason: string } }
  | { type: 'SIMULATE_CLONING'; payload: { method: CloningOperationType; fragmentIds: string[]; enzymes?: string[] } };

export interface AIChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  proposedActions?: AIToolAction[]; // One-click executable actions rendered as interactive cards in UI
}
```

---

你是一位高性能生物信息学算法专家。请严格基于 `src/types/schema.ts` 契约，编写 `src/modules/seq-engine/index.ts` 及单元测试 `src/modules/seq-engine/seq-engine.test.ts`。

### 架构与轮子复用要求
1. 严禁引用其他业务模块，仅引用 `../../types/schema` 以及 `@teselagen/sequence-utils` 和 `@teselagen/range-utils`。
2. 复用 `@teselagen/range-utils` 处理环状序列区间裁剪、归一化与编辑时的坐标平移（`adjustRangeToInsert` / `adjustRangeToDeletion`）。

### 核心功能与高性能算法要求
1. **完备商业限制性内切酶库 (`COMMERCIAL_ENZYMES: RestrictionEnzyme[]`)**：
   - 内置不少于 60 种常用酶（涵盖 NEB 常用回文酶如 EcoRI, BamHI, HindIII, NotI, XhoI, NheI, SpeI, XbaI, PstI, SalI, NdeI, KpnI, SacI, SmaI, EcoRV, AgeI, MluI, NcoI, BglII, AscI, PacI, PmeI, SbfI，以及 **Type IIS 金门组装酶 BsaI, BsmBI, BbsI, SapI, PaqCI, AarI** 和甲基化依赖酶 DpnI）。
   - 每个酶必须包含准确的 `cutIndexTop`、`cutIndexBottom`、`isTypeIIS`、`methylationSensitivity`（Dam/Dcm/CpG）及 NEB 四种 Buffer（`r1.1`, `r2.1`, `r3.1`, `rCutSmart`）活性百分比。
2. **支持环状边界与甲基化阻断判定的极速酶切扫描 (`findCutSites`)**：
   - `findCutSites(doc: PlasmidDocument, enzymes?: RestrictionEnzyme[], filter?: { uniqueOnly?: boolean; commercialOnly?: boolean; buffer?: 'r1.1'|'r2.1'|'r3.1'|'rCutSmart'; excludeMethylationBlocked?: boolean }): CutSite[]`
   - 若 `doc.topology === 'circular'`，对 `sequence + sequence.slice(0, maxRecognitionLen)` 进行扫描以捕获跨越 `0 bp` 原点的切点。
   - **Dam / Dcm / CpG 甲基化精准判定**：扫描全质粒的 Dam 位点（`GATC`）与 Dcm 位点（`CCWGG`）。若 `doc.methylationProfile.dam === true` 且某个酶（如 XbaI `TCTAGA` 紧邻 `GA` 形成 `TCTAGATC`、或 BclI、ClaI、MboI）的识别/切割位点与甲基化碱基重叠，自动将该 `CutSite.isMethylationBlocked` 设为 `true`（而对 DpnI 则仅在 `dam === true` 时才允许切割）。
3. **6框 ORF 扫描与蛋白质理化性质计算 (`findAllORFs`)**：
   - 支持环状跨原点 ORF 检索（处理跨过 0 点后改变阅读框 `length % 3 !== 0` 的相位偏移），并计算每个 ORF 编码多肽的分子量（`mwKda`）与理论等电点（`pI`）。
4. **序列突变/插入/删除与特征无损联动 (`mutatePlasmidSequence`)**：
   - 当执行插入、删除、替换、反向互补（`reverseComplementPlasmid`）或重设环状质粒零点（`rotateCircularOrigin(doc, newZeroIndex)`）时，精准重算所有 `features` 和 `primers` 的新坐标并记录 `CloningHistoryNode`。
5. **Aho-Corasick 极速本地自动特征注释器 (`autoAnnotateFeatures`)**：
   - 内置至少 35 个实验室高频标准元件特征序列字典（CMV enhancer/promoter, EF1a, T7, U6, lacUV5, TetO, AmpR/bla, KanR/NeoR, CmR, HygR, PuroR, Blasticidin, ColE1/pUC ori, p15A ori, f1 ori, SV40 ori, 2u ori, EGFP, mCherry, tdTomato, mNeonGreen, Firefly Luciferase, Cas9, Cre, WPRE, SV40 polyA, bGH polyA, rrnB T1, 6xHis, FLAG, HA, Myc, GST, TEV site, T2A/P2A, attB1/attB2, loxP）。
   - 使用高性能多模式字符串匹配或种子哈希匹配正负双链（耗时 `< 10ms`），自动跳过已存在相同注释的区间。

### 必须导出的接口约定（供 src/app 集成，名称与签名不可更改）
```ts
export const COMMERCIAL_ENZYMES: RestrictionEnzyme[];
export function getEnzymeByName(name: string): RestrictionEnzyme | undefined;
export function findCutSites(doc: PlasmidDocument, enzymes?: RestrictionEnzyme[], filter?: { uniqueOnly?: boolean; commercialOnly?: boolean; buffer?: 'r1.1'|'r2.1'|'r3.1'|'rCutSmart'; excludeMethylationBlocked?: boolean }): CutSite[];
export function findAllORFs(doc: PlasmidDocument, minAaLength?: number /* 默认 75 */): ORF[];
export type SequenceEdit =
  | { type: 'insert'; position: number; bases: string }
  | { type: 'delete'; start: number; end: number }
  | { type: 'replace'; start: number; end: number; bases: string };
export function mutatePlasmidSequence(doc: PlasmidDocument, edit: SequenceEdit): PlasmidDocument; // 返回新对象，追加 manual_edit 历史节点
export function reverseComplementPlasmid(doc: PlasmidDocument): PlasmidDocument;
export function rotateCircularOrigin(doc: PlasmidDocument, newZeroIndex: number): PlasmidDocument;
export const FEATURE_LIBRARY: Array<{ name: string; type: FeatureType; sequence: string; color: string }>;
export function autoAnnotateFeatures(doc: PlasmidDocument, library?: typeof FEATURE_LIBRARY): SequenceFeature[]; // 仅返回新发现的特征
export function calcGcPercent(seq: string): number;
export function reverseComplement(seq: string): string;
export function translateDna(seq: string): string; // 标准密码子表，终止为 '*'
```
- 特征库中的序列必须是真实元件序列（可来自 pUC19 / pEGFP-N1 / Addgene 公开序列）；自动注释允许精确匹配，对 >30bp 的元件可使用种子 + 容错（≥95% 同一性）。
- 单元测试至少覆盖：EcoRI 跨零点切割、BsaI 负链切点、Dam 阻断 XbaI(TCTAGATC)、跨零点 ORF、插入/删除后特征坐标平移、rotateCircularOrigin。

---

### 工程执行规则（所有模块通用，必须遵守）
1. 当前工作目录就是项目根目录。依赖已安装在 `node_modules`（React 18、`@teselagen/*`、`seqviz`、`@biowasm/aioli`、`lucide-react`、vitest、TypeScript 严格模式）。**禁止运行 `npm install` 或修改 `package.json`、`tsconfig.json`、`vite.config.ts`、`src/types/schema.ts`**。
2. **只允许创建/修改 `src/modules/seq-engine/` 目录下的文件**，不得触碰其他任何目录或文件。
3. 使用任何第三方库前，先阅读其在 `node_modules/<包名>/` 下的 `.d.ts` / 源码，确认真实导出名与参数，不得臆造 API。若库的类型声明缺失，在本模块内用最小的 `declare`/类型断言封装，禁止使用 `// @ts-ignore` 掩盖错误。
4. 非 UI 模块必须是纯函数/纯 TS，不得访问 `window`、`document`、`localStorage`（可在 Web Worker 与 Node 中运行）。
5. 完成后必须自检并修复直到全部通过：
   - `npx vitest run src/modules/seq-engine` 全部通过；
   - `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "src/modules/seq-engine"` 无任何输出（其他模块报错与你无关，忽略）。
6. 代码与注释中**不得写任何作者署名、"Generated by" 字样或 AI 工具名称**；严禁 `TODO`、伪代码、占位实现。
7. 坐标约定：所有区间 0-based 左闭右开 `[start, end)`；环状 DNA 中 `start > end` 表示跨越 0 点；取模统一使用 `((p % len) + len) % len`。
