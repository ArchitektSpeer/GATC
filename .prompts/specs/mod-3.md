
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
