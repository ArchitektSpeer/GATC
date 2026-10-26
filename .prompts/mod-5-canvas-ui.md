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

### 额外依赖许可
- 仅可使用 `react`、`seqviz`、`lucide-react`。组件样式使用内联 style 或组件内 CSS 字符串（项目已启用 Tailwind v4，可使用 Tailwind 类名）。
- 文件可拆分为 `__DIR__/` 下多个 `.tsx`/`.ts`，但必须从 `__DIR__/index.tsx` 统一导出。
- 组件需将重计算（布局、轨道分配）放在 `useMemo` 中；长序列仅渲染可视行。

### 必须导出的接口约定（名称与签名不可更改，可增加可选 props）
```ts
export type VizTheme = 'light' | 'dark' | 'publication';
export interface CircularPlasmidMapProps { doc: PlasmidDocument; cutSites: CutSite[]; selection: SelectionRange | null; onSelectionChange?: (sel: SelectionRange | null) => void; onFeatureClick?: (f: SequenceFeature) => void; theme?: VizTheme; size?: number; showPrimers?: boolean; svgRef?: React.Ref<SVGSVGElement>; }
export function CircularPlasmidMap(props: CircularPlasmidMapProps): JSX.Element;
export interface LinearSequenceEditorProps { doc: PlasmidDocument; cutSites: CutSite[]; selection: SelectionRange | null; onSelectionChange?: (sel: SelectionRange | null) => void; onEdit?: (edit: { type: 'insert'; position: number; bases: string } | { type: 'delete'; start: number; end: number } | { type: 'replace'; start: number; end: number; bases: string }) => void; bpPerRow?: 50 | 60 | 80 | 100; translationMode?: 'none' | 'cds' | 'frame3' | 'frame6'; theme?: VizTheme; height?: number; }
export function LinearSequenceEditor(props: LinearSequenceEditorProps): JSX.Element;
export interface SangerAlignmentViewerProps { doc: PlasmidDocument; traces: SangerTraceData[]; theme?: VizTheme; height?: number; }
export function SangerAlignmentViewer(props: SangerAlignmentViewerProps): JSX.Element;
export interface VirtualGelSimulatorProps { lanes: VirtualGelLane[]; agarosePercent: number; voltage: number; minutes: number; onParamsChange?: (p: { agarosePercent: number; voltage: number; minutes: number }) => void; mode?: 'uv' | 'publication'; onModeChange?: (m: 'uv' | 'publication') => void; }
export function VirtualGelSimulator(props: VirtualGelSimulatorProps): JSX.Element;
export interface CloningHistoryTreeProps { history: CloningHistoryNode[]; selectedId?: string | null; onSelectNode?: (id: string) => void; theme?: VizTheme; }
export function CloningHistoryTree(props: CloningHistoryTreeProps): JSX.Element;
export function exportSvgToPublicationFile(svg: SVGSVGElement, fileName: string): void;
export function exportSvgToPng(svg: SVGSVGElement, fileName: string, dpi?: number): Promise<void>;
export function SeqVizView(props: { doc: PlasmidDocument; cutSites: CutSite[]; viewer?: 'circular' | 'linear' | 'both'; selection: SelectionRange | null; onSelectionChange?: (sel: SelectionRange | null) => void }): JSX.Element; // seqviz 薄封装
```
- 本模块无需单元测试，但 `tsc` 必须零错误；可选地写 `canvas-ui.test.ts` 测试纯布局函数（轨道分配、标签防碰撞）。

---

### 工程执行规则（所有模块通用，必须遵守）
1. 当前工作目录就是项目根目录。依赖已安装在 `node_modules`（React 18、`@teselagen/*`、`seqviz`、`@biowasm/aioli`、`lucide-react`、vitest、TypeScript 严格模式）。**禁止运行 `npm install` 或修改 `package.json`、`tsconfig.json`、`vite.config.ts`、`src/types/schema.ts`**。
2. **只允许创建/修改 `src/modules/canvas-ui/` 目录下的文件**，不得触碰其他任何目录或文件。
3. 使用任何第三方库前，先阅读其在 `node_modules/<包名>/` 下的 `.d.ts` / 源码，确认真实导出名与参数，不得臆造 API。若库的类型声明缺失，在本模块内用最小的 `declare`/类型断言封装，禁止使用 `// @ts-ignore` 掩盖错误。
4. 非 UI 模块必须是纯函数/纯 TS，不得访问 `window`、`document`、`localStorage`（可在 Web Worker 与 Node 中运行）。
5. 完成后必须自检并修复直到全部通过：
   - `npx vitest run src/modules/canvas-ui` 全部通过；
   - `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "src/modules/canvas-ui"` 无任何输出（其他模块报错与你无关，忽略）。
6. 代码与注释中**不得写任何作者署名、"Generated by" 字样或 AI 工具名称**；严禁 `TODO`、伪代码、占位实现。
7. 坐标约定：所有区间 0-based 左闭右开 `[start, end)`；环状 DNA 中 `start > end` 表示跨越 0 点；取模统一使用 `((p % len) + len) % len`。
