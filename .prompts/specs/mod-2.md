
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
