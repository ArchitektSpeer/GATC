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

你是一位计算生物学与合成生物学自动化专家。请严格基于 `src/types/schema.ts` 契约，编写 `src/modules/cloning-primer/index.ts` 及单元测试 `src/modules/cloning-primer/cloning-primer.test.ts`。

### 核心任务要求（100% 复刻 SnapGene 引物与克隆模拟能力）

1. **工业级热力学引物计算器 (`evaluateOligoThermodynamics`)**：
   - 完整内置 **SantaLucia (1998) Unified Nearest-Neighbor** 10 组二核苷酸步长参数表（$\Delta H^\circ$ 与 $\Delta S^\circ$，含起始惩罚与对称性修正）及 **Owczarzy et al. (2008) $\text{Mg}^{2+}$ / $\text{dNTP}$ / $\text{Na}^+$ 盐浓度校正公式**。
   - 实现动态规划二级结构预测算法，精确计算引物自身发夹结构（`hairpinDeltaG`）、同源二聚体（`selfDimerDeltaG`）和一对引物间的异源二聚体（`crossDimerDeltaG`）自由能及 ASCII 配对可视化图。
   - 实现 `designPrimerPair(doc: PlasmidDocument, targetRange: SelectionRange, options)`：支持自动寻找最佳退火长度（18~28 bp，使正反向引物 $\Delta T_m < 1.5^\circ\text{C}$ 且具备 3' GC Clamp），支持一键附加 5' 酶切位点 + NEB 推荐保护碱基（Leader Bases，如 `GCG` 或 `AAGGAAAAA`）或 Gibson 同源臂。

2. **定点突变引物设计器 (`designMutagenesisPrimers`)**：
   - 支持单碱基/多碱基替换、插入与缺失（QuikChange 重叠模式或背靠背反向 PCR Q5 SDM 模式）。
   - **亮点功能**：自动扫描突变位点附近密码子，推荐可通过同义突变（不改变氨基酸序列）引入或消除的限制性内切酶位点（Silent Restriction Site for Screening），方便实验人员后续用酶切鉴定阳性克隆。

3. **五大分子克隆全真模拟器（均需完整迁移子片段的 `SequenceFeature` 坐标并写入 `CloningHistoryNode`）**：
   - **酶切与连接 (`simulateDigestion` & `simulateLigation`)**：
     - 切割环状或线性 DNA，在产物 `linearEnds.left` 和 `linearEnds.right` 准确记录 5'/3'/blunt 末端单链序列。
     - 支持 `bluntEnds(fragment, method: 'klenow_fill_in' | 't4_exonuclease')` 末端补平/削平模拟。
     - `simulateLigation`：校验粘性末端是否互补（含 BamHI+BglII、NheI+SpeI+XbaI、SalI+XhoI 等同尾酶连接后疤痕位点推导），支持正向与反向插入检测。
   - **Gibson Assembly / In-Fusion (`simulateGibsonAssembly` & `designGibsonPrimers`)**：
     - 支持 2~8 个片段环形或线性组装。使用后缀-前缀精确/容错匹配自动识别相邻片段首尾 `15~45 bp` 的同源重叠臂（自动尝试片段正向与反向互补），消除重叠区冗余序列后无缝环化。
   - **Golden Gate Assembly (`simulateGoldenGateAssembly` & `designGoldenGatePrimers`)**：
     - 针对 BsaI / BsmBI / BbsI / SapI / PaqCI 等 Type IIS 酶，自动识别酶切后识别位点是否被切除在外，提取 4bp（或 3bp）粘性末端，构建有向组装图（Directed Assembly Graph）寻找唯一环化路径；检查组装产物内部是否残留该 Type IIS 酶切位点；并基于 NEB Ligase Fidelity 数据对 4bp Overhang 组合给出保真度评分与错配风险提示。
   - **Gateway Cloning (`simulateGatewayBP` & `simulateGatewayLR`)**：
     - 识别 `attB1`/`attB2` 与供体载体 `attP1`/`attP2` 重组生成入门克隆（含 `attL1`/`attL2`），以及与目的载体 `attR1`/`attR2` 重组生成表达克隆。
   - **PCR 与融合 PCR (`simulatePCR` & `simulateOverlapExtensionPCR`)**：
     - 模拟引物 3' 端与模板结合（允许内部存在定点突变错配或 5' 端悬空尾巴），处理环状模板跨 `0 bp` 扩增，生成线性双链 PCR 产物。

### 额外依赖许可
- 可使用 `@teselagen/sequence-utils`（如反向互补、翻译）。不得导入 `src/modules/` 下其他模块：需要的酶切位点以 `CutSite[]` 形式由调用方传入；Golden Gate 时 Type IIS 酶以 `RestrictionEnzyme` 对象传入，由本模块自行在双链上搜索其（非简并）识别序列。

### 必须导出的接口约定（名称与签名不可更改）
```ts
export interface ReactionConditions { naMm?: number /*50*/; mgMm?: number /*2*/; dntpMm?: number /*0.8*/; oligoNm?: number /*250*/; }
export interface OligoThermo { tm: number; deltaH: number; deltaS: number; deltaG37: number; gcPercent: number; has3PrimeGCClamp: boolean; hairpinDeltaG: number; selfDimerDeltaG: number; hairpinAscii: string; selfDimerAscii: string; }
export function evaluateOligoThermodynamics(seq: string, cond?: ReactionConditions): OligoThermo;
export function calcCrossDimer(a: string, b: string, cond?: ReactionConditions): { deltaG: number; ascii: string };
export function buildPrimer(doc: PlasmidDocument, bindingStart: number, bindingEnd: number, strand: 1 | -1, tail?: string, name?: string, cond?: ReactionConditions): Primer;
export interface PrimerDesignOptions { minLen?: number; maxLen?: number; targetTm?: number; forwardTail?: string; reverseTail?: string; enzymeSiteForward?: string; enzymeSiteReverse?: string; leaderBases?: string; cond?: ReactionConditions; }
export function designPrimerPair(doc: PlasmidDocument, target: SelectionRange, options?: PrimerDesignOptions): { forward: Primer; reverse: Primer; productLength: number; productSequence: string; warnings: string[] };
export interface MutationSpec { start: number; end: number; newBases: string; mode?: 'quikchange' | 'q5_back_to_back'; }
export function designMutagenesisPrimers(doc: PlasmidDocument, mutation: MutationSpec, enzymes?: RestrictionEnzyme[]): { forward: Primer; reverse: Primer; mutatedDoc: PlasmidDocument; silentSiteSuggestions: Array<{ enzyme: string; action: 'introduce' | 'remove'; position: number; changedBases: string; note: string }>; warnings: string[] };
export function simulateDigestion(doc: PlasmidDocument, cutSites: CutSite[]): PlasmidDocument[]; // 线性片段，含 linearEnds 与迁移后的 features
export function bluntEnds(fragment: PlasmidDocument, method: 'klenow_fill_in' | 't4_exonuclease'): PlasmidDocument;
export function simulateLigation(fragments: PlasmidDocument[], options?: { circularize?: boolean; dephosphorylatedIds?: string[] }): { product: PlasmidDocument | null; compatible: boolean; orientations: Array<'forward' | 'reverse'>; destroyedSites: string[]; warnings: string[] };
export function simulateGibsonAssembly(fragments: PlasmidDocument[], options?: { minOverlap?: number; maxOverlap?: number; circular?: boolean }): { product: PlasmidDocument | null; junctions: Array<{ leftId: string; rightId: string; overlapSeq: string; overlapTm: number; reversed: boolean }>; warnings: string[] };
export function designGibsonPrimers(parts: Array<{ doc: PlasmidDocument; range: SelectionRange }>, options?: { overlapLength?: number; circular?: boolean; cond?: ReactionConditions }): Array<{ partId: string; forward: Primer; reverse: Primer }>;
export function simulateGoldenGateAssembly(parts: PlasmidDocument[], enzyme: RestrictionEnzyme, options?: { circular?: boolean }): { product: PlasmidDocument | null; overhangs: string[]; fidelityScore: number; internalSiteWarnings: string[]; warnings: string[] };
export function designGoldenGatePrimers(parts: Array<{ doc: PlasmidDocument; range: SelectionRange }>, enzyme: RestrictionEnzyme, overhangs: string[]): Array<{ partId: string; forward: Primer; reverse: Primer }>;
export function simulateGatewayBP(attBInsert: PlasmidDocument, donor: PlasmidDocument): { entryClone: PlasmidDocument | null; byproduct: PlasmidDocument | null; warnings: string[] };
export function simulateGatewayLR(entryClone: PlasmidDocument, destination: PlasmidDocument): { expressionClone: PlasmidDocument | null; byproduct: PlasmidDocument | null; warnings: string[] };
export function simulatePCR(template: PlasmidDocument, forward: Primer | string, reverse: Primer | string, options?: { minAnneal?: number; maxMismatches?: number }): { product: PlasmidDocument | null; warnings: string[] };
export function simulateOverlapExtensionPCR(fragments: PlasmidDocument[], outerForward: Primer | string, outerReverse: Primer | string): { product: PlasmidDocument | null; warnings: string[] };
```
- 测试至少覆盖：SantaLucia Tm 与 Primer3 参考值（例如 `AGCGGATAACAATTTCACACAGGA` 在 50mM Na+/250nM 下 ~ 59–62°C）偏差 < 1.5°C、EcoRI 跨零点酶切产物 overhang `AATT`、BamHI+BglII 连接相容并报告位点消失、2 片段 Gibson 环化长度正确、BsaI 三片段 Golden Gate、环状模板跨零点 PCR。

---

### 工程执行规则（所有模块通用，必须遵守）
1. 当前工作目录就是项目根目录。依赖已安装在 `node_modules`（React 18、`@teselagen/*`、`seqviz`、`@biowasm/aioli`、`lucide-react`、vitest、TypeScript 严格模式）。**禁止运行 `npm install` 或修改 `package.json`、`tsconfig.json`、`vite.config.ts`、`src/types/schema.ts`**。
2. **只允许创建/修改 `src/modules/cloning-primer/` 目录下的文件**，不得触碰其他任何目录或文件。
3. 使用任何第三方库前，先阅读其在 `node_modules/<包名>/` 下的 `.d.ts` / 源码，确认真实导出名与参数，不得臆造 API。若库的类型声明缺失，在本模块内用最小的 `declare`/类型断言封装，禁止使用 `// @ts-ignore` 掩盖错误。
4. 非 UI 模块必须是纯函数/纯 TS，不得访问 `window`、`document`、`localStorage`（可在 Web Worker 与 Node 中运行）。
5. 完成后必须自检并修复直到全部通过：
   - `npx vitest run src/modules/cloning-primer` 全部通过；
   - `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "src/modules/cloning-primer"` 无任何输出（其他模块报错与你无关，忽略）。
6. 代码与注释中**不得写任何作者署名、"Generated by" 字样或 AI 工具名称**；严禁 `TODO`、伪代码、占位实现。
7. 坐标约定：所有区间 0-based 左闭右开 `[start, end)`；环状 DNA 中 `start > end` 表示跨越 0 点；取模统一使用 `((p % len) + len) % len`。
