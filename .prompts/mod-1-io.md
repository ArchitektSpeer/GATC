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

你是一位资深生物信息学工程师。请严格遵循下方提供的 `src/types/schema.ts` 契约，编写 `src/modules/io-adapter/index.ts` 及对应的单元测试 `src/modules/io-adapter/io.test.ts`。

### 架构与解耦铁律
1. 本模块严禁引用 `src/modules/` 下的任何其他模块，仅允许导入 `../../types/schema` 以及开源库 `@teselagen/bio-parsers`。
2. 充分复用现有开源轮子 + 补齐深度特性：
   - 优先调用 `@teselagen/bio-parsers` 的 `anyToJson`、`snapgeneToJson`、`genbankToJson`、`fastaToJson`、`jsonToGenbank`、`jsonToFasta` 处理标准解析，并将其返回的 TeselaGen `SequenceData` 结构无损转换为 `PlasmidDocument`。
   - **深度增强（SnapGene `.dna` 专有 TLV 二进制增强解析器）**：由于通用开源库往往会丢失 SnapGene `.dna` 文件中的引物（Packet `0x05`）、甲基化状态与构建历史树（Packet `0x07` / `0x0B` Zlib/XML History Tree），请编写一个原生 `DataView` 补充解析器 `enrichSnapGeneBinary(buffer: ArrayBuffer, baseDoc: PlasmidDocument): PlasmidDocument`，直接从二进制 TLV 包中提取完整的 `Primer[]` 和 `CloningHistoryNode[]` 谱系。

### 必须导出的函数签名
- `parseBioFile(fileName: string, content: ArrayBuffer | string): Promise<PlasmidDocument[]>`
- `parseSnapGeneBuffer(buffer: ArrayBuffer, fileName?: string): Promise<PlasmidDocument>`
- `parseGenBankString(gbkText: string): Promise<PlasmidDocument>`
- `exportPlasmidToGenBank(doc: PlasmidDocument): string`（必须保留 `/ApEinfo_fwdcolor` 与 `/ApEinfo_revcolor` 标签以完美兼容 SnapGene 与 ApE）
- `exportPlasmidToFasta(doc: PlasmidDocument): string`
- `exportPlasmidToSnapGeneJson(doc: PlasmidDocument): string`

### 质量要求
- 严禁出现任何 `TODO` 或伪代码。
- 严格校对 0-based 左闭右开区间（`[start, end)`）与 GenBank 1-based 闭区间的转换，正确处理跨 `0` 原点的环状特征（`start > end`）。

### 额外接口约定
- 所有解析出的 `PlasmidDocument` 必须字段齐全：`id`（随机唯一）、`sequence` 大写、`length === sequence.length`、`createdAt/updatedAt` ISO 字符串、`features`/`primers`/`history` 至少为空数组，`history` 至少含一个 `operation: 'import'` 节点；未指定时 `methylationProfile = { dam: true, dcm: true, cpg: false }`。
- 特征颜色缺失时按类型给出默认 Hex 颜色。
- 单元测试需在测试内构造 GenBank 文本（含跨零点 `join(...)` 特征）与 FASTA 文本进行往返（parse → export → parse）一致性校验；`.dna` 测试可在测试内用 `DataView` 构造最小合法 SnapGene 二进制（cookie 包 0x09 + DNA 包 0x00）。

---

### 工程执行规则（所有模块通用，必须遵守）
1. 当前工作目录就是项目根目录。依赖已安装在 `node_modules`（React 18、`@teselagen/*`、`seqviz`、`@biowasm/aioli`、`lucide-react`、vitest、TypeScript 严格模式）。**禁止运行 `npm install` 或修改 `package.json`、`tsconfig.json`、`vite.config.ts`、`src/types/schema.ts`**。
2. **只允许创建/修改 `src/modules/io-adapter/` 目录下的文件**，不得触碰其他任何目录或文件。
3. 使用任何第三方库前，先阅读其在 `node_modules/<包名>/` 下的 `.d.ts` / 源码，确认真实导出名与参数，不得臆造 API。若库的类型声明缺失，在本模块内用最小的 `declare`/类型断言封装，禁止使用 `// @ts-ignore` 掩盖错误。
4. 非 UI 模块必须是纯函数/纯 TS，不得访问 `window`、`document`、`localStorage`（可在 Web Worker 与 Node 中运行）。
5. 完成后必须自检并修复直到全部通过：
   - `npx vitest run src/modules/io-adapter` 全部通过；
   - `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "src/modules/io-adapter"` 无任何输出（其他模块报错与你无关，忽略）。
6. 代码与注释中**不得写任何作者署名、"Generated by" 字样或 AI 工具名称**；严禁 `TODO`、伪代码、占位实现。
7. 坐标约定：所有区间 0-based 左闭右开 `[start, end)`；环状 DNA 中 `start > end` 表示跨越 0 点；取模统一使用 `((p % len) + len) % len`。
