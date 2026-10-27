# OpenSnapGene 系统架构与多 Agent 协同开发规范 (`design.md`)

> **文档用途**：本文档是提供给 **Claude Code**（总架构师与集成协调者）的最高执行蓝图（Master Blueprint）。
> **执行口令**：在终端启动 `claude` 后，直接输入：`请阅读根目录下的 design.md，严格按照其中的多 Agent 编排流程、开源轮子复用策略与模块契约，推进 OpenSnapGene 的完整开发与验证。`

---

## 一、 多 Agent 协同研发流水线（Multi-Agent Orchestration Protocol）

本项目采用 **“Claude Code 顶层规划与集成 + OpenCode/QoderCLI (`deepseek-v4.1`) 模块并行编码 + ChatGPT 终审质检”** 的三级流水线。

### 1. 角色职责边界（硬性约束）
1. **Claude Code（Chief Architect & Integrator）**：
   - **禁止亲自从零手写大段业务模块实现**（除非是修复最后阶段的编译胶水错误）。
   - 负责：初始化 Monorepo/Vite 工程、安装开源依赖轮子、冻结全局唯一类型契约 `src/types/schema.ts`、编写模块级提示词文件（`.prompts/mod-*.md`）、通过 Bash 并发/顺序调用 `opencode` 或 `qodercli` 驱动 `deepseek-v4.1` 生成各个解耦模块、执行 `tsc --noEmit` 与 `vitest` 自动化集成测试，以及生成最终供 ChatGPT 审阅的审计包。
2. **OpenCode / QoderCLI + `deepseek-v4.1`（Core Module Builders）**：
   - 负责：在严格隔离的单模块上下文中，仅依赖 `src/types/schema.ts` 与指定的开源 NPM/WASM 轮子，编写高内聚、零耦合、高性能的具体业务模块代码。
   - 标准非交互调用命令模板（由 Claude Code 在终端自动检测并执行）：
     ```bash
     # 优先使用 opencode 非交互模式调用 deepseek-v4.1
     opencode run --model deepseek/deepseek-v4.1 -q "$(cat .prompts/mod-X.md)"
     # 或使用 qodercli 非交互模式调用 deepseek-v4.1
     qodercli run --model deepseek-v4.1 --prompt-file .prompts/mod-X.md
     ```
3. **ChatGPT（Chief Code Auditor & Bio-Algorithm Reviewer）**：
   - 负责：在所有模块由 Claude Code 整合编译通过后，基于本文档第七节生成的《跨模块审计报告》与专项审查 Prompt，对环状 DNA 跨零点边界条件、热力学公式精度、内存泄漏及 BYOK API 密钥安全性进行终审。

---

## 二、 站在巨人肩膀上：强制复用的成熟开源轮子矩阵

**核心原则**：严禁重复造底层解析与重型可视化轮子！必须优先通过 `npm` 安装并封装以下 MIT/BSD 协议的工业级开源库，仅在开源库未覆盖的胶水层、AI Agent 编排层和定制算法上编写代码：

| 功能域 | 强制复用的开源轮子 (NPM / WASM) | 开源协议 | 用途与封装策略 |
| :--- | :--- | :--- | :--- |
| **全格式文件解析/导出** | [`@teselagen/bio-parsers`](https://github.com/TeselaGen/tg-oss) | MIT | 直接调用 `anyToJson`、`snapgeneToJson`、`genbankToJson`、`ab1ToJson`、`jsonToGenbank`、`jsonToFasta`，原生支持 `.dna`、`.gbk`、`.fasta`、`.ab1`、`.gff`、Geneious 等格式转换，通过薄适配器映射为本项目的 `PlasmidDocument`。 |
| **环状/线性序列操作与环数运算** | [`@teselagen/sequence-utils`](https://github.com/TeselaGen/tg-oss) & [`@teselagen/range-utils`](https://github.com/TeselaGen/tg-oss) | MIT | 直接复用其经过工业验证的环状区间交集/平移计算（`adjustRangeToInsert`、`adjustRangeToDeletion`）、IUPAC 简并酶切搜索（`getCutsitesFromSequence`）、ORF 查找与氨基酸翻译，避免手写环形取模越界 Bug。 |
| **双视图质粒图谱与序列渲染** | [`seqviz`](https://github.com/Lattice-Automation/seqviz) (底层渲染) + 自研增强 SVG 图层 | MIT | 复用 `SeqViz` 的高性能虚拟滚动线性视图与环形 SVG 骨架，外挂自研的出版级防重叠引线（Leader Lines）导出器、虚拟电泳胶图与 Sanger 峰图叠加轨。 |
| **C/C++ 级生信算法加速 (WASM)** | [`@biowasm/aioli`](https://biowasm.com/) (`minimap2` / `kalign` / `primer3`) | MIT | 在 Web Worker 中通过 BioWASM 调用编译为 WebAssembly 的 `minimap2`（大序列比对）、`kalign`（多序列比对 MSA）与 `primer3`（热力学引物计算），并提供 TypeScript Bitap / Gotoh SIMD 级纯函数作为离线极速回退。 |
| **现代 UI 与快捷键交互** | `shadcn/ui` + `cmdk` + `lucide-react` + `zustand` + `zundo` | MIT | `cmdk` 实现毫秒级 `Cmd/Ctrl + K` 命令面板；`zustand` + `zundo` 实现零耦合状态总线与无限级 `Undo/Redo` 时间旅行。 |
| **跨平台桌面/Web 双栖外壳** | `Vite` + `PWA` + [`Tauri 2.0`](https://tauri.app/) | MIT | 一套代码同时构建纯静态离线 Web 版（GitHub Pages 直接运行）与 10MB 级 Windows/macOS/Linux 原生客户端。 |

---

## 三、 100% 复刻 SnapGene 全功能清单 + 高性能算法规范

为了真正平替商业版 SnapGene（而非仅仅做个 Viewer），系统必须完整实现以下 **8 大核心功能矩阵**，且所有计算密集型任务必须在 **Web Worker** 中异步执行（耗时严格控制在 `< 16ms` 以保障 UI 60fps）：

1. **全格式无损读写与 SnapGene 历史树还原**：
   - 支持拖拽读取 `.dna`（含 SnapGene 专有二进制 TLV 包与构建历史树 Packet）、`.gb/.gbk`、`.fasta`、`.ab1/.scf`、`.embl`，支持一键导出兼容 SnapGene/ApE 的 `.gbk` 及论文出版级无背景 `.svg` / `.pdf`。
2. **全套分子克隆全流程模拟（In-Silico Cloning Suite）**：
   - **Restriction & Ligation（酶切连接）**：支持单酶切、双酶切、部分酶切，自动校验粘性末端（5'/3' Overhang）互补性、同尾酶（如 BamHI/BglII）兼容性（连接后自动标记原酶切位点消失）、Klenow 补平/削平（Blunting）与去磷酸化防自连提示。
   - **Gibson Assembly / In-Fusion（同源重组组装）**：支持 2~10 个片段拼接，自动扫描首尾同源重叠区（15~40 bp），自动设计带重叠臂的正反向引物并重算熔解温度。
   - **Golden Gate Assembly（Type IIS 无缝组装）**：支持 BsaI、BsmBI、BbsI、SapI、PaqCI 等 Type IIS 酶切方向判定、4bp 粘性末端连接保真度矩阵（Ligation Fidelity Matrix）打分与死循环（内部残留酶切位点）预警。
   - **Gateway Cloning & TOPO Cloning**：支持 `BP` 反应（`attB` × `attP` → `attL` + `attR`）和 `LR` 反应模拟，以及 TA / Blunt TOPO 克隆模拟。
   - **PCR 与融合 PCR（Overlap Extension PCR / SOE-PCR）**：自动匹配引物 3' 退火区，合成带 5' 端酶切保护碱基或点突变的扩增产物。
3. **高精度引物设计与定点突变（Primer Design & Site-Directed Mutagenesis）**：
   - 采用 **SantaLucia (1998) 最邻近热力学算法（Nearest-Neighbor）** + **Owczarzy (2008) 二价镁离子/dNTP 盐浓度校正公式**，精确计算退火区 $T_m$ 与全长 $T_m$。
   - 利用动态规划算法计算发夹结构（Hairpin $\Delta G$）、同源二聚体（Self-Dimer $\Delta G$）与异源二聚体（Cross-Dimer $\Delta G$）。
   - 支持一键设计定点突变引物（点突变、插入、缺失）并自动引入或消除静默酶切位点（Silent Restriction Site）以便实验室做菌落酶切鉴定。
4. **Sanger 测序峰图比对与多序列比对（`.ab1` Trace Alignment & MSA）**：
   - 解析 `.ab1` 四色荧光通道（A/T/G/C）强度曲线与 Phred 质量分（Q20/Q30），使用 Mott 算法自动修剪两端低质量杂峰。
   - 采用 **环状双倍展开参考序列（Circular Doubled Reference）+ 带仿射空位罚分的 Gotoh / Smith-Waterman 局部比对（或 BioWASM `minimap2`）**，完美解决跨越质粒 `0 bp` 原点的测序读长比对，高亮标出点突变（Substitution）、移码插入/缺失（Indel）及杂合双峰。
5. **虚拟琼脂糖凝胶电泳（Virtual Agarose Gel Simulation）**：
   - 支持多泳道（Multi-lane）对比，内置商业 Marker（NEB 1kb Plus, 1kb, 100bp, Takara DL2000/DL5000），支持调节胶浓度（0.5% ~ 3.0% Agarose），采用 Ferguson 对数迁移模型计算条带位置，并模拟超螺旋（Supercoiled）、开环（Nicked）与线性（Linear）构象差异及条带质量亮度。
6. **本地极速自动特征注释（Instant Local Auto-Annotation）**：
   - 内置精选的 pLannotate / Addgene 核心特征指纹库（50+ 常见启动子、抗性基因、复制起始点、荧光蛋白、亲和标签、终止子），采用 **Aho-Corasick 多模式自动机 / FM-Index** 实现 `< 10ms` 全质粒正负双链自动扫描注释。
7. **五维联动视图工作台（5-Way Synchronized Views）**：
   - `Map`（环形/线性矢量图谱）、`Sequence`（双链碱基 + 3/6框密码子翻译 + 酶切阶梯切口线）、`Enzymes`（支持按切割次数、NEB Buffer 活性、甲基化敏感性 Dcm/Dam/CpG 过滤）、`Features/Primers`、`History`（可视化克隆谱系树，点击任意历史节点可回溯当时的载体与引物）。
8. **AI Copilot 实验导师（网页端 BYOK 自带 API 密钥驱动）**：
   - 用户可在网页设置面板填入自己的 API Key（支持 OpenAI、Anthropic Claude、DeepSeek、Google Gemini 或任意兼容 OpenAI 格式的自定义 Base URL / 本地 Ollama）。
   - **密钥安全**：API Key 仅保存在用户浏览器本地 `localStorage`（或 WebCrypto 加密存储），由浏览器直接请求大模型接口，**绝不经过任何第三方中转服务器**。
   - **结构化 Function Calling / Tool Use 能力**：AI 不仅能回答问题，还能直接读取当前质粒的 `PlasmidDocument` 上下文（智能截断摘要以节省 Token），并直接返回可一键应用到画布上的结构化 JSON 指令：
     - *“帮我把 GFP 替换成 mCherry，用 Gibson 组装，自动设计好两条引物”* → AI 自动调用内部工具输出引物对与组装预览。
     - *“为什么我用 EcoRI 和 BamHI 双酶切没有切开？”* → AI 自动检查当前质粒的 Dam/Dcm 甲基化重叠位点或 Buffer 兼容性并给出排查建议。
     - *“分析这条 `.ab1` 测序峰图，告诉我克隆成功了吗？”* → AI 自动解读错配位点是否落在 CDS 阅读框内、是否导致无义/错义突变。

---

## 四、 极致解耦的目录结构与模块边界

Claude Code 必须严格按照以下目录结构初始化工程。**铁律**：`src/modules/` 下的 6 个子模块之间**严禁互相 `import`**！它们只能单向引用 `src/types/schema.ts` 和外部 `npm` 开源库，最终仅由 `src/app/` 进行组装：

```text
opensnapgene/
├── design.md                          # 本架构蓝图文档
├── .prompts/                          # Claude Code 生成并投喂给 opencode/qodercli 的模块提示词
│   ├── mod-1-io.md
│   ├── mod-2-seq-engine.md
│   ├── mod-3-cloning-primer.md
│   ├── mod-4-alignment-gel.md
│   ├── mod-5-canvas-ui.md
│   └── mod-6-ai-copilot.md
├── src/
│   ├── types/
│   │   └── schema.ts                  # [Module 0] 全局唯一数据契约（Claude Code 亲自生成并锁定）
│   ├── modules/                       # [严格隔离区] 由 opencode/qodercli (deepseek-v4.1) 分别生成
│   │   ├── io-adapter/                # [Module 1] 封装 @teselagen/bio-parsers + SnapGene 历史树解析
│   │   │   ├── index.ts
│   │   │   └── io.test.ts
│   │   ├── seq-engine/                # [Module 2] 封装 @teselagen/sequence-utils + Aho-Corasick 自动注释 + 甲基化酶切
│   │   │   ├── index.ts
│   │   │   └── seq-engine.test.ts
│   │   ├── cloning-primer/            # [Module 3] SantaLucia 精确热力学 + 5大克隆模拟 (Gibson/GoldenGate/Restriction/PCR/Gateway)
│   │   │   ├── index.ts
│   │   │   └── cloning-primer.test.ts
│   │   ├── alignment-gel/             # [Module 4] .ab1 色谱解析 + 环形 Gotoh/WASM 比对 + Ferguson 虚拟电泳胶计算
│   │   │   ├── index.ts
│   │   │   └── alignment-gel.test.ts
│   │   ├── canvas-ui/                 # [Module 5] 封装 SeqViz + 出版级防碰撞 SVG 环形图 + 线性双链 + 虚拟胶/峰图纯受控组件
│   │   │   └── index.tsx
│   │   └── ai-copilot/                # [Module 6] 纯前端 BYOK 多模型适配器 + 质粒上下文压缩器 + 生信 Tool Calling 引擎
│   │       ├── index.ts
│   │       └── CopilotSidebar.tsx
│   └── app/                           # [Claude Code 整合区] 状态总线、Web Worker 池与主工作台组装
│       ├── store.ts                   # Zustand + Zundo (Undo/Redo) 全局状态总线
│       ├── bio.worker.ts              # 将 Module 2/3/4 封装为非阻塞 Web Worker
│       └── App.tsx                    # 多标签页、Cmd+K 命令面板、克隆向导弹窗与五维视图主界面
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 五、 核心基石：【Module 0】全局唯一数据契约 (`src/types/schema.ts`)

> **Claude Code 执行指令**：在启动任何子模块生成前，先将以下 `src/types/schema.ts` 原样写入磁盘，并在后续所有 `.prompts/mod-*.md` 中完整内联此文件内容。

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

## 六、 Claude Code 调度 OpenCode / QoderCLI (`deepseek-v4.1`) 的六大模块指令库

Claude Code 在完成工程初始化与 `src/types/schema.ts` 创建后，应将以下 6 个模块的 Prompt 分别写入 `.prompts/mod-1.md` ~ `.prompts/mod-6.md`（写入时自动将 `src/types/schema.ts` 的真实代码拼接到每个 Prompt 的头部），然后通过命令行调用 `opencode` 或 `qodercli` 使用 `deepseek-v4.1` 逐个或并行生成代码。

---

### 【Module 1】全格式解析与 SnapGene 历史树引擎 (`src/modules/io-adapter/index.ts`)

**Claude Code 执行命令**：
`opencode run --model deepseek/deepseek-v4.1 -q "$(cat .prompts/mod-1-io.md)"`

**写入 `.prompts/mod-1-io.md` 的提示词内容**：
```markdown
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
```

---

### 【Module 2】高性能生信计算、甲基化酶切与自动注释引擎 (`src/modules/seq-engine/index.ts`)

**Claude Code 执行命令**：
`opencode run --model deepseek/deepseek-v4.1 -q "$(cat .prompts/mod-2-seq-engine.md)"`

**写入 `.prompts/mod-2-seq-engine.md` 的提示词内容**：
```markdown
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
```

---

### 【Module 3】引物热力学与全模式分子克隆模拟引擎 (`src/modules/cloning-primer/index.ts`)

**Claude Code 执行命令**：
`opencode run --model deepseek/deepseek-v4.1 -q "$(cat .prompts/mod-3-cloning-primer.md)"`

**写入 `.prompts/mod-3-cloning-primer.md` 的提示词内容**：
```markdown
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
```

---

### 【Module 4】Sanger 测序 `.ab1` 比对与虚拟电泳胶引擎 (`src/modules/alignment-gel/index.ts`)

**Claude Code 执行命令**：
`opencode run --model deepseek/deepseek-v4.1 -q "$(cat .prompts/mod-4-alignment-gel.md)"`

**写入 `.prompts/mod-4-alignment-gel.md` 的提示词内容**：
```markdown
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
```

---

### 【Module 5】出版级双视图画布、Sanger 峰图与电泳可视化组件库 (`src/modules/canvas-ui/index.tsx`)

**Claude Code 执行命令**：
`opencode run --model deepseek/deepseek-v4.1 -q "$(cat .prompts/mod-5-canvas-ui.md)"`

**写入 `.prompts/mod-5-canvas-ui.md` 的提示词内容**：
```markdown
你是一位顶尖科学可视化工程师与 React 组件架构师。请严格基于 `src/types/schema.ts` 契约，编写纯受控可视化组件库 `src/modules/canvas-ui/index.tsx`。

### 架构与轮子复用要求
1. 严禁引用 `src/modules/` 下的其他逻辑模块，所有数据通过 Props 传入，所有操作通过 Callback 抛出。
2. 结合 `seqviz`（处理底层高频双链滚动与基础环形渲染）与自研出版级 SVG/Canvas 增强视图，确保既有成熟的交互，又具备超越 SnapGene 的视觉美学（支持 Light、Dark 与 Nature/Cell 论文发表白底高对比度配色模式）。

### 必须实现并导出的五大受控可视化组件

1. `<CircularPlasmidMap />`（出版级 SVG 环形质粒图谱 + 一键矢量导出）：
   - 采用贪心区间图着色算法（Interval Graph Coloring）将重叠的 `SequenceFeature` 分配到多层同心圆轨道，绘制带方向箭头的圆弧（正确处理跨 12 点钟 `0 bp` 原点的圆弧拆分）。
   - **左右分列防碰撞放射状引线布局（Force-Relaxed Leader Lines）**：对酶切位点（区分单酶切粗体与多酶切、置灰显示甲基化阻断位点）和引物箭头计算外圈标签坐标，通过垂直扫描松弛算法消除任何文字重叠，绘制折线引线。
   - 支持在圆环上顺时针/逆时针鼠标拖拽选区（实时显示扇形阴影与角度 bp 气泡）。
   - 导出函数 `exportSvgToPublicationFile(svgElement, fileName)` 和 `exportSvgToPng(svgElement, fileName, dpi = 300)`。

2. `<LinearSequenceEditor />`（60fps 虚拟滚动多轨线性序列视图）：
   - 按行虚拟化渲染（每行可配置 50/60/80/100 bp），即使打开 100kb BAC 质粒也保持 60fps。
   - 每一行精确对齐渲染 5 个垂直轨道：
     - **Track 1（酶切切口与引物轨）**：在对应碱基间画出经典的 SnapGene 风格红/蓝阶梯状切割折线（直观展示 5' 或 3' 粘性末端切口跨度），以及引物退火箭头与上扬的 5' 端酶切尾巴。
     - **Track 2（5'→3' 正链碱基）** & **Track 3（3'→5' 互补负链碱基）**：支持拖拽框选、点击插入光标、直接按键输入/删除碱基。
     - **Track 4（氨基酸翻译轨）**：支持仅翻译 CDS 特征（按特征自身的 `codonStart` 和正负链方向展示单字母/三字母氨基酸及密码子序号）或全局 3框/6框翻译，起始 `M` 标绿，终止 `*` 标红。
     - **Track 5（彩色特征胶囊条）**：带方向箭头的特征条。

3. `<SangerAlignmentViewer />`（Sanger 测序四色色谱峰对齐视图）：
   - 上方展示参考质粒双链与氨基酸，下方同步滚动展示多条 `.ab1` 测序读长。
   - 使用 Canvas / SVG 绘制平滑的 A(绿)、T(红)、G(黑/灰)、C(蓝) 四通道荧光曲线，背景叠加 Phred 质量柱状图（Q20 以上浅灰，Q20 以下浅橙预警），醒目标红所有点突变、缺失、插入及杂合双峰，点击突变列表可一键平滑滚动定位到对应色谱峰。

4. `<VirtualGelSimulator />`（交互式虚拟琼脂糖电泳室）：
   - 支持切换 UV 紫外暗室荧光模式与白底考马斯/反相出版模式，包含胶浓度滑块（0.5%~3.0%）、电压/时间模拟滑块，鼠标悬停在任意条带上显示精确片段大小（bp）、质量占比、来源起止坐标及两端粘性末端序列。

5. `<CloningHistoryTree />`（可视化克隆谱系树）：
   - 将 `doc.history` 渲染为自上而下的交互式有向无环图（DAG），清晰展示从原始载体、PCR 产物经过何种酶切/Gibson/Golden Gate 步骤生成当前质粒。
```

---

### 【Module 6】纯前端 BYOK AI 实验导师与自动化生信 Agent (`src/modules/ai-copilot/index.ts` & `CopilotSidebar.tsx`)

**Claude Code 执行命令**：
`opencode run --model deepseek/deepseek-v4.1 -q "$(cat .prompts/mod-6-ai-copilot.md)"`

**写入 `.prompts/mod-6-ai-copilot.md` 的提示词内容**：
```markdown
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
```

---

## 七、 Claude Code 终极整合与自动化验证协议（Integration & Verification）

当 `opencode` / `qodercli` (`deepseek-v4.1`) 生成完上述 6 个独立模块后，**Claude Code** 亲自接管并执行以下 4 步整合工作：

1. **构建 Web Worker 异步计算池 (`src/app/bio.worker.ts`)**：
   - 将 `seq-engine`、`cloning-primer` 和 `alignment-gel` 中的耗时函数封装到 Web Worker 中（并提供同步 Fallback 以便单元测试直接调用），确保主线程 UI 永不卡顿。
2. **构建全局状态管理与内置示例库 (`src/app/store.ts`)**：
   - 使用 `zustand` + `zundo`（支持 `Cmd/Ctrl + Z` 无限撤销/重做）连接 6 大模块。
   - **内置开箱即用实验室级真实示例数据**：内置完整的 `pUC19 (2686 bp)` 与 `pEGFP-N1 (4733 bp)` 真实序列、完整特征注释及一条模拟的 `.ab1` 测序峰图数据，让用户打开网页第一秒就能体验双视图联动、酶切、Gibson 组装、虚拟电泳与 AI 导师。
3. **构建主工作台 (`src/app/App.tsx`)**：
   - 组装顶部多质粒标签栏、五维视图切换器（`Split` / `Circular Map` / `Sequence` / `Virtual Gel` / `Sanger Alignment` / `History Tree`）、`Cmd/Ctrl + K` 全局命令面板、克隆向导模态框（PCR / 酶切连接 / Gibson / Golden Gate / 定点突变）、右侧属性检查器与右侧可唤起的 **AI Copilot 实验导师抽屉**。
4. **运行编译器与测试门禁（Quality Gate）**：
   - Claude Code 在终端依次运行：
     ```bash
     npm run typecheck   # tsc --noEmit 必须 0 Error
     npm run test        # vitest run 所有生信边界单元测试必须 100% PASS
     npm run build       # vite build 生产构建必须成功
     ```
5. **外部交叉验证门禁（Cross-check Gate）**：
   - 仅靠自测无法证明结果正确，因此还需与**独立实现**逐项对比，样本一律使用 **SnapGene 本体生成的真实 `.dna` 文件**（官网质粒库 + Biopython 测试集 + Gateway 载体）：
     ```bash
     npm run crosscheck  # 需 Python 3；首次运行会下载参考文件并建立 venv
     ```
   - 四个阶段与参考实现：
     1. `.dna` 读写互通 ↔ Biopython 的 SnapGene 解析器（双向）
     2. 酶切位点 ↔ REBASE；引物 Tm ↔ primer3；CDS 翻译 ↔ 文件内 SnapGene 自存蛋白序列
     3. 酶切片段 / PCR / 酶切连接 ↔ pydna；Gibson / Golden Gate ↔ 已知答案
     4. Gateway BP、LR ↔ pydna `gateway_assembly`；Cre/lox ↔ pydna `recombinase_assembly`
   - 每一项必须 100% 一致；发现的差异必须判定为"GATC 缺陷"或"参考工具口径差异"，前者修复并补回归测试，后者在脚本中注明理由后跳过。
   - 结果与历次发现的缺陷记录在 `docs/CROSSCHECK.md`。

---

## 八、 交由 ChatGPT 终审的标准交付包与审阅提示词（Final ChatGPT Audit）

当 Claude Code 完成编译与测试后，由 Claude Code 自动在项目根目录生成一份 `AUDIT_BUNDLE.md`（汇总模块接口、核心环状边界代码、热力学计算与 AI 密钥存储逻辑），然后你将该文件连同以下审阅提示词发给 **ChatGPT** 进行最终把关：

### 复制以下提示词发给 ChatGPT 进行终审：

```markdown
你是一位拥有 15 年经验的计算生物学首席架构师与 Web 安全审计专家。我们刚刚通过“Claude Code 架构编排 + DeepSeek-V4.1 模块开发”完成了一个开源 SnapGene 完整替代品（OpenSnapGene）的代码开发。

请对附件/下方的代码实现进行最严苛的终审（Code & Bio-Algorithm Audit），按 `[P0 致命缺陷]`、`[P1 逻辑偏差]`、`[P2 性能与体验优化]` 三个等级输出审阅报告，并重点核查以下 5 大生信与安全红线：

1. **环状 DNA 跨零点（Origin Wrap-Around）边界正确性**：
   - 检查当 `SequenceFeature`、`ORF`、酶切识别位点（特别是 Type IIS 酶如 BsaI 识别位点在零点左端、切割位点跨过 `0 bp` 落入右端）以及 `.ab1` 测序比对跨越 `0 bp` 原点时，坐标取模运算 `((pos % len) + len) % len` 是否在所有模块中 100% 严密，有无漏切或负数下标越界？
2. **正负双链与粘性末端（Overhang）生物化学方向性**：
   - 检查非回文酶（Type IIS 如 BsaI/BsmBI）在负链（`-1` strand）匹配时，`cutPositionTop` 和 `cutPositionBottom` 是否正确做了翻转对称计算？
   - 检查酶切连接（Ligation）与 Golden Gate 组装时，5' 突出端与 3' 突出端的互补配对方向（5'→3' vs 3'→5'）及反义插入（Inverted Insert）特征反转计算是否符合真实分子生物学规律？
3. **SantaLucia 最邻近热力学与盐校正精度**：
   - 核对 `cloning-primer` 模块中的 10 组二核苷酸 $\Delta H^\circ$、$\Delta S^\circ$ 常量及气体常数 $R = 1.987\text{ cal/(mol}\cdot\text{K)}$、同源/异源寡核苷酸浓度分母（$C_T/4$ vs $C_T/1$）与 Owczarzy $\text{Mg}^{2+}$ 校正公式是否与 Primer3 / SnapGene 标准一致？
4. **前端 BYOK AI 密钥安全与上下文防幻觉**：
   - 检查 `ai-copilot` 模块是否存在任何将用户 `apiKey` 打印到日志或发送到非用户指定 `baseUrl` 的风险？
   - 检查 AI 返回的 `AIToolAction` 坐标（0-based vs 1-based）在应用回主画布前是否有严格的 Schema 边界校验？
5. **模块解耦度与大质粒（100kb+）渲染性能**：
   - 检查 `src/modules/*` 之间是否存在任何违规的交叉引用？线性序列视图与 SVG 环形图谱在面对 50,000 bp 以上序列及数百个酶切位点时，是否存在主线程阻塞或 React 重复重渲染瓶颈？

对于发现的每一个问题，请直接给出精确到函数与行号的修复补丁代码（Diff 格式），以便我直接交回给 Claude Code 一键打补丁。
```
