
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
