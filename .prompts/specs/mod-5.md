
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
