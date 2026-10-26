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

你是一位 AI Agent 架构师与合成生物学专家。请严格基于 `src/types/schema.ts` 契约，编写纯前端 BYOK（Bring Your Own Key）AI 实验导师模块 `src/modules/ai-copilot/index.ts` 与侧边栏组件 `src/modules/ai-copilot/CopilotSidebar.tsx`。

### 核心安全与架构要求
1. **100% 纯前端直连（Zero-Backend BYOK）**：
   - 用户在网页设置弹窗中填入自己的 API Key、选择提供商（OpenAI / Anthropic Claude / DeepSeek / Google Gemini / 自定义 OpenAI 兼容端点如本地 Ollama 或 OpenRouter）及模型名称。
   - 配置仅保存在浏览器 `localStorage`（键名 `opensnapgene_ai_config`），提供一键清除按钮，所有 HTTP `fetch` 流式请求（SSE）均从用户浏览器直接发往对应官方 API，绝不经过第三方服务器。

2. **智能质粒上下文摘要压缩器 (`buildPlasmidContextPrompt`)**：
   - 质粒全序列可能长达数万 bp，直接塞入 Prompt 会浪费大量 Token 且导致大模型坐标幻觉。
   - 请编写 `buildPlasmidContextPrompt(doc: PlasmidDocument, cutSites: CutSite[], selection: SelectionRange | null, sangerTraces: SangerTraceData[]): string`：
     - 自动提取质粒拓扑、总长度、GC%、甲基化状态、全部 `SequenceFeature` 的精确坐标与方向、所有单酶切位点（Unique Cutters）与 Type IIS 位点列表、当前 `.ab1` 测序比对发现的所有突变位点摘要，以及用户当前鼠标选中区间（`selection`）及其上下游各 100 bp 的局部真实序列。

3. **双向结构化 Tool Calling / Action 卡片机制**：
   - 系统 Prompt 指导大模型在回答分子克隆问题时，除了给出专业清晰的实验步骤建议外，还可以在回复末尾输出 `<opensnapgene_action>` JSON 块（解析为 `AIToolAction[]`）：
     - `DESIGN_PRIMERS`：AI 自动规划克隆策略并填入目标扩增坐标、克隆方法（Gibson/酶切/定点突变）及推荐的 5' 端酶切位点/同源臂，用户在聊天框点击 **“一键应用引物设计”** 即可触发回调直接生成引物。
     - `RUN_DIGESTION`：AI 推荐最佳双酶切鉴定组合（例如：“建议使用 EcoRI + BamHI 进行菌落鉴定，可切出 3200bp 和 1500bp 两条清晰条带”），用户点击 **“在虚拟电泳中预览”** 即可直接切换至电泳视图并加载该酶切组合。
     - `ADD_FEATURES` / `HIGHLIGHT_RANGE`：AI 帮助分析未知序列区域或排查克隆失败原因并一键高亮问题区间。

4. **内置高频实验场景一键快捷指令（Quick Prompts）**：
   - 在 `<CopilotSidebar />` 顶部提供快捷胶囊按钮：
     - 🧬 **规划克隆方案**（“我想把当前选中的基因片段克隆到另一个载体中，帮我对比 Gibson 与双酶切方案并生成引物”）
     - 🔍 **排查酶切/克隆失败**（“检查当前质粒是否存在 Dam/Dcm 甲基化阻断、内部残留 Type IIS 位点或引物二聚体风险”）
     - 📊 **解读 Sanger 测序结果**（“分析已加载的 `.ab1` 测序比对结果，判断是否存在移码或错义突变”）
     - 🧪 **推荐鉴定酶切组合**（“帮我挑一组在虚拟电泳上条带区分度最明显的商业内切酶用于质粒鉴定”）

### 额外依赖许可
- `index.ts` 为纯逻辑（只有 `loadAIConfig/saveAIConfig/clearAIConfig` 可访问 `localStorage`，且需 try/catch 兼容不可用环境）；`CopilotSidebar.tsx` 可使用 `react`、`lucide-react`、Tailwind 类名。
- 绝不能 `console.log` 任何包含 apiKey 的对象；请求只能发往 `config.baseUrl`（或各提供商官方默认地址）。Anthropic 浏览器直连需加 `anthropic-dangerous-direct-browser-access: true` 头；Gemini 使用 `generativelanguage.googleapis.com` 的 `streamGenerateContent?alt=sse`。

### 必须导出的接口约定（名称与签名不可更改）
```ts
// index.ts
export const AI_CONFIG_STORAGE_KEY = 'opensnapgene_ai_config';
export const PROVIDER_DEFAULTS: Record<AIProviderType, { baseUrl: string; model: string }>;
export function loadAIConfig(): AIConfig | null;
export function saveAIConfig(config: AIConfig): void;
export function clearAIConfig(): void;
export function buildPlasmidContextPrompt(doc: PlasmidDocument, cutSites: CutSite[], selection: SelectionRange | null, sangerTraces: SangerTraceData[]): string;
export function buildSystemPrompt(): string;
export function parseAssistantReply(text: string): { content: string; actions: AIToolAction[] }; // 解析并剥离 <opensnapgene_action> 块
export function validateAction(action: unknown, doc: PlasmidDocument): { ok: true; action: AIToolAction } | { ok: false; error: string }; // 严格 schema 与坐标边界校验
export function streamChat(config: AIConfig, messages: AIChatMessage[], onToken: (delta: string) => void, signal?: AbortSignal): Promise<string>;
export const QUICK_PROMPTS: Array<{ id: string; icon: string; label: string; prompt: string }>;
// CopilotSidebar.tsx
export interface CopilotSidebarProps { doc: PlasmidDocument; cutSites: CutSite[]; selection: SelectionRange | null; traces: SangerTraceData[]; onApplyAction: (action: AIToolAction) => void; open: boolean; onClose: () => void; }
export function CopilotSidebar(props: CopilotSidebarProps): JSX.Element;
```
- 测试 `ai-copilot.test.ts`：上下文压缩器输出包含特征坐标且不含全序列（10kb 测试质粒）、`parseAssistantReply` 解析多个动作、`validateAction` 拒绝越界坐标与未知类型、`streamChat` 使用注入的 mock `fetch` 解析 OpenAI SSE 流。

---

### 工程执行规则（所有模块通用，必须遵守）
1. 当前工作目录就是项目根目录。依赖已安装在 `node_modules`（React 18、`@teselagen/*`、`seqviz`、`@biowasm/aioli`、`lucide-react`、vitest、TypeScript 严格模式）。**禁止运行 `npm install` 或修改 `package.json`、`tsconfig.json`、`vite.config.ts`、`src/types/schema.ts`**。
2. **只允许创建/修改 `src/modules/ai-copilot/` 目录下的文件**，不得触碰其他任何目录或文件。
3. 使用任何第三方库前，先阅读其在 `node_modules/<包名>/` 下的 `.d.ts` / 源码，确认真实导出名与参数，不得臆造 API。若库的类型声明缺失，在本模块内用最小的 `declare`/类型断言封装，禁止使用 `// @ts-ignore` 掩盖错误。
4. 非 UI 模块必须是纯函数/纯 TS，不得访问 `window`、`document`、`localStorage`（可在 Web Worker 与 Node 中运行）。
5. 完成后必须自检并修复直到全部通过：
   - `npx vitest run src/modules/ai-copilot` 全部通过；
   - `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "src/modules/ai-copilot"` 无任何输出（其他模块报错与你无关，忽略）。
6. 代码与注释中**不得写任何作者署名、"Generated by" 字样或 AI 工具名称**；严禁 `TODO`、伪代码、占位实现。
7. 坐标约定：所有区间 0-based 左闭右开 `[start, end)`；环状 DNA 中 `start > end` 表示跨越 0 点；取模统一使用 `((p % len) + len) % len`。
