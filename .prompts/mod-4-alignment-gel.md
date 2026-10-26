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

你是一位生物仪器信号处理与序列比对算法专家。请严格基于 `src/types/schema.ts` 契约，编写 `src/modules/alignment-gel/index.ts` 及单元测试 `src/modules/alignment-gel/alignment-gel.test.ts`。

### 核心任务要求

1. **ABIF (`.ab1`) 测序峰图解析与双峰杂合检测 (`parseAb1Trace`)**：
   - 可结合 `@teselagen/bio-parsers` 的 `ab1ToJson` 或原生 `DataView` 解析 Applied Biosystems `.ab1` 二进制结构（提取 `FWO_1` 通道顺序、`DATA9~12` 四色色谱曲线、`PBAS` 序列、`PLOC` 峰位坐标与 `PCON` Phred 质量分）。
   - 实现 **Mott 质量修剪算法 (`mottTrim`)**：根据错配概率阈值（默认 $P = 0.05$，即 Phred Q13）自动计算有效高质量区间 `trimRange: [start, end]`。
   - 实现 **次峰/杂合双峰检测 (`detectSecondaryPeaks`)**：在每个 `baseLocations[i]` 处检查次高通道峰强度是否超过主峰的 35%，若是则标记为杂合位点（IUPAC 简并码及 `heterozygous_peak`）。

2. **高性能环状局部比对与编码框突变注释 (`alignTraceToPlasmid`)**：
   - 采用 **Seed-and-Extend (k-mer 种子索引定位) + 带仿射空位罚分的 Gotoh 局部比对算法**（支持在可用时调用 `@biowasm/aioli` 的 `minimap2`），同时支持测序读长跨越环状质粒 `0 bp` 原点（通过将参考序列首尾拼接 `doc.sequence + doc.sequence` 后映射回 `[0, doc.length)` 模空间）。
   - **自动翻译影响分析 (`aminoAcidImpact`)**：对于比对发现的每一个 `substitution` / `insertion` / `deletion`，自动检查该位点是否落在 `doc.features` 的某个 `CDS` 特征内。如果落在 CDS 内，自动计算其所在的密码子位置，输出如 `"Silent (G42G in EGFP)"`、`"Missense (S65T in EGFP)"`、`"Nonsense (Q112* Premature Stop)"` 或 `"Frameshift (-1 bp in AmpR)"` 的精准科研诊断。

3. **物理级虚拟琼脂糖凝胶电泳模拟 (`simulateVirtualGel`)**：
   - 内置 5 种标准商业 DNA Ladder 精确条带库：`NEB 1kb Plus`、`NEB 1kb`、`NEB 100bp`、`Takara DL2000`、`Takara DL5000`（含加亮参考带标记，如 1000bp 和 3000bp 双倍亮度）。
   - 实现基于 **Ferguson 方程与小片段对数模型** 的迁移距离计算函数：支持用户输入琼脂糖浓度（`agarosePercent`: 0.5% ~ 3.0%）和电泳时间，计算每个片段的 `migrationY`（0~1）与 `relativeIntensity`（按片段长度占总质量比例乘以染色效率）。
   - 支持未酶切天然质粒的三种拓扑构象模拟：`supercoiled`（超螺旋表观分子量约为真实长度的 $0.68\times$）、`linear`（$1.0\times$）和 `nicked/open-circular`（开环约为 $1.35\times$）。

### 额外依赖许可
- 可使用 `@teselagen/bio-parsers`（`ab1ToJson`）与 `@biowasm/aioli`（仅在运行时可用时动态 `import()`，Node 测试环境下必须走纯 TS Gotoh 回退路径）。

### 必须导出的接口约定（名称与签名不可更改）
```ts
export function parseAb1Trace(buffer: ArrayBuffer, fileName: string): Promise<SangerTraceData>;
export function mottTrim(qualityScores: number[], errorThreshold?: number /*0.05*/): [number, number];
export function detectSecondaryPeaks(trace: SangerTraceData, ratio?: number /*0.35*/): Array<{ baseIndex: number; primary: string; secondary: string; iupac: string; ratio: number }>;
export function alignTraceToPlasmid(trace: SangerTraceData, doc: PlasmidDocument, options?: { useWasm?: boolean; kmer?: number }): Promise<SangerTraceData>; // 返回带 alignment 的新对象
export function gotohLocalAlign(ref: string, query: string, scoring?: { match?: number; mismatch?: number; gapOpen?: number; gapExtend?: number }): { score: number; refStart: number; refEnd: number; queryStart: number; queryEnd: number; alignedRef: string; alignedQuery: string };
export type LadderName = 'NEB 1kb Plus' | 'NEB 1kb' | 'NEB 100bp' | 'Takara DL2000' | 'Takara DL5000';
export const DNA_LADDERS: Record<LadderName, Array<{ sizeBp: number; massNg: number; highlighted?: boolean }>>;
export interface GelSampleInput { id?: string; label: string; ladder?: LadderName; fragments?: Array<{ sizeBp: number; conformation?: 'linear' | 'supercoiled' | 'nicked'; massNg?: number; doc?: PlasmidDocument }>; }
export interface GelRunParams { agarosePercent: number; voltage?: number /*V/cm 5*/; minutes?: number /*45*/; }
export function computeMigration(apparentBp: number, params: GelRunParams): number; // 0..1
export function simulateVirtualGel(samples: GelSampleInput[], params: GelRunParams): VirtualGelLane[];
export function createSyntheticTrace(referenceSeq: string, options?: { fileName?: string; start?: number; length?: number; mutations?: Array<{ index: number; base: string }>; heterozygous?: Array<{ index: number; base: string }>; seed?: number }): SangerTraceData; // 生成逼真的高斯峰四色曲线 + Phred，用于演示与测试
```
- 测试至少覆盖：Mott 修剪、跨零点读长比对（参考为环状，读长取自 末端 200bp + 开头 200bp）后 refStart > refEnd 的模空间结果、CDS 内错义/无义/移码注释、超螺旋迁移快于线性、胶浓度越高大片段迁移越慢。

---

### 工程执行规则（所有模块通用，必须遵守）
1. 当前工作目录就是项目根目录。依赖已安装在 `node_modules`（React 18、`@teselagen/*`、`seqviz`、`@biowasm/aioli`、`lucide-react`、vitest、TypeScript 严格模式）。**禁止运行 `npm install` 或修改 `package.json`、`tsconfig.json`、`vite.config.ts`、`src/types/schema.ts`**。
2. **只允许创建/修改 `src/modules/alignment-gel/` 目录下的文件**，不得触碰其他任何目录或文件。
3. 使用任何第三方库前，先阅读其在 `node_modules/<包名>/` 下的 `.d.ts` / 源码，确认真实导出名与参数，不得臆造 API。若库的类型声明缺失，在本模块内用最小的 `declare`/类型断言封装，禁止使用 `// @ts-ignore` 掩盖错误。
4. 非 UI 模块必须是纯函数/纯 TS，不得访问 `window`、`document`、`localStorage`（可在 Web Worker 与 Node 中运行）。
5. 完成后必须自检并修复直到全部通过：
   - `npx vitest run src/modules/alignment-gel` 全部通过；
   - `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "src/modules/alignment-gel"` 无任何输出（其他模块报错与你无关，忽略）。
6. 代码与注释中**不得写任何作者署名、"Generated by" 字样或 AI 工具名称**；严禁 `TODO`、伪代码、占位实现。
7. 坐标约定：所有区间 0-based 左闭右开 `[start, end)`；环状 DNA 中 `start > end` 表示跨越 0 点；取模统一使用 `((p % len) + len) % len`。
