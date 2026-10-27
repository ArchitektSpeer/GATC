# GATC 跨模块审计包（AUDIT_BUNDLE）

> 生成时间：2026-10-27T02:52:23.562Z
> 用途：连同第 1 节的审阅提示词一起发给外部审阅模型，做最终的代码与生信算法审计。

## 1. 审阅提示词

```markdown
你是一位拥有 15 年经验的计算生物学首席架构师与 Web 安全审计专家。我们刚刚通过架构编排 + 模块并行开发完成了一个开源 SnapGene 完整替代品（OpenSnapGene）的代码开发。

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

对于发现的每一个问题，请直接给出精确到函数与行号的修复补丁代码（Diff 格式），以便我直接交回开发流程一键打补丁。
```

## 2. 质量门禁结果

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 0 error ✅ |
| `vitest run` | Test Files 15 passed (15) Tests 374 passed (374) |
| 模块间交叉引用 | 无 ✅ |

## 3. 模块规模与公开接口

| 模块 | 文件 | 行数 | 测试文件 |
|---|---|---|---|
| io-adapter | 2 | 5806 | 1 |
| seq-engine | 11 | 6383 | 2 |
| cloning-primer | 11 | 9443 | 2 |
| alignment-gel | 14 | 6852 | 3 |
| canvas-ui | 35 | 13161 | 5 |
| ai-copilot | 3 | 3528 | 1 |
| app（集成层） | 17 | 4458 | 1 |

### io-adapter

```text
index.ts:108  export interface ProteinFeature {
index.ts:119  export interface ProteinDocument {
index.ts:130  export interface SequencingRead {
index.ts:2677  export function exportPlasmidToSnapGene(doc: PlasmidDocument): Uint8Array {
index.ts:2706  export function parseFastq(text: string): SequencingRead[] {
index.ts:3689  export async function parseProteinFile(
index.ts:3755  export function isProteinFile(fileName: string, data: string | ArrayBuffer): boolean {
index.ts:3814  export function exportProteinToFasta(protein: ProteinDocument): string {
index.ts:3871  export function exportProteinToGenPept(protein: ProteinDocument): string {
index.ts:3997  export function normalizeAccession(
index.ts:4023  export async function fetchFromNCBI(
index.ts:4129  export function enrichSnapGeneBinary(
index.ts:4183  export async function parseSnapGeneBuffer(
index.ts:4226  export async function parseGenBankString(gbkText: string): Promise<PlasmidDocument> {
index.ts:4242  export async function parseBioFile(
index.ts:4589  export function exportPlasmidToGenBank(doc: PlasmidDocument): string {
index.ts:4615  export function exportPlasmidToFasta(doc: PlasmidDocument): string {
index.ts:4635  export function exportPlasmidToSnapGeneJson(doc: PlasmidDocument): string {
```

### seq-engine

```text
codon-usage.ts:1  export type CodonUsageOrganism =
codon-usage.ts:181  export const CODON_USAGE: Record<CodonUsageOrganism, Record<string, number>> =
codon-usage.ts:465  export function backTranslate(
codon-usage.ts:505  export function codonAdaptationIndex(
digest-buffer.ts:6  export type NebBufferName = 'r1.1' | 'r2.1' | 'r3.1' | 'rCutSmart';
digest-buffer.ts:8  export interface EnzymeDigestCondition {
digest-buffer.ts:16  export const ENZYME_DIGEST_CONDITIONS: Record<string, EnzymeDigestCondition> = {
digest-buffer.ts:360  export function recommendDoubleDigestBuffer(
digest-buffer.ts:493  export interface DoubleDigestRecommendation {
enzyme-catalog.ts:3  export const ENZYME_SUPPLIER_CATALOG: Record<string, string[]> = {
enzymes.ts:232  export const ENZYME_DATABASE: RestrictionEnzyme[] = buildDatabase();
enzymes.ts:485  export const COMMERCIAL_ENZYMES: RestrictionEnzyme[] = buildCommercialEnzymes();
enzymes.ts:502  export function getEnzymeByName(name: string): RestrictionEnzyme | undefined {
enzymes.ts:519  export function findIsoschizomers(
enzymes.ts:552  export interface EnzymeSet {
enzymes.ts:640  export const ENZYME_SETS: EnzymeSet[] = [
enzymes.ts:691  export function filterEnzymes(
feature-library-extra.ts:8  export interface FeatureLibraryExtraEntry {
feature-library-extra.ts:15  export const FEATURE_LIBRARY_EXTRA: FeatureLibraryExtraEntry[] = [
feature-library.ts:4  export interface FeatureLibraryEntry {
feature-library.ts:85  export const FEATURE_LIBRARY: FeatureLibraryEntry[] = [
index.ts:24  export {
index.ts:32  export type { EnzymeSet } from './enzymes';
index.ts:33  export { searchMotif } from './motif-search';
index.ts:34  export type { MotifHit } from './motif-search';
index.ts:35  export {
index.ts:40  export type { CodonUsageOrganism } from './codon-usage';
index.ts:41  export { FEATURE_LIBRARY };
index.ts:42  export type { FeatureLibraryEntry };
index.ts:43  export { FEATURE_LIBRARY_EXTRA } from './feature-library-extra';
index.ts:44  export type { FeatureLibraryExtraEntry } from './feature-library-extra';
index.ts:45  export {
index.ts:49  export type {
index.ts:55  export type SequenceEdit =
index.ts:154  export function calcGcPercent(seq: string): number {
index.ts:159  export function reverseComplement(seq: string): string {
index.ts:165  export function translateDna(seq: string): string {
index.ts:426  export function findCutSites(
index.ts:704  export function findAllORFs(doc: PlasmidDocument, minAaLength = 75): ORF[] {
index.ts:1070  export function mutatePlasmidSequence(
index.ts:1247  export function reverseComplementPlasmid(doc: PlasmidDocument): PlasmidDocument {
index.ts:1324  export function rotateCircularOrigin(
index.ts:2059  export function autoAnnotateFeatures(
motif-search.ts:3  export interface MotifHit {
motif-search.ts:294  export function searchMotif(
rebase-overrides.ts:6  export interface RebaseOverride {
rebase-overrides.ts:13  export const REBASE_OVERRIDES: Record<string, RebaseOverride> = {
rebase-overrides.ts:45  export const REBASE_UNKNOWN_CUT: ReadonlySet<string> = new Set([
```

### cloning-primer

```text
assembly.ts:30  export interface CloningProductResult {
assembly.ts:36  export const LIC_DEFAULT_TAILS = {
assembly.ts:239  export function addATailing(pcrProduct: PlasmidDocument): PlasmidDocument {
assembly.ts:260  export function simulateTACloning(
assembly.ts:279  export function simulateGCCloning(
assembly.ts:322  export function simulateTOPOCloning(
assembly.ts:441  export function simulateLIC(
assembly.ts:514  export function designLICPrimers(
cloning.ts:145  export function simulateDigestion(doc: PlasmidDocument, cutSites: CutSite[]): PlasmidDocument[] {
cloning.ts:219  export function bluntEnds(
cloning.ts:412  export function simulateLigation(
cloning.ts:658  export function simulateGibsonAssembly(
cloning.ts:829  export function designGibsonPrimers(
cloning.ts:1090  export function simulateGoldenGateAssembly(
cloning.ts:1196  export function designGoldenGatePrimers(
cloning.ts:1246  export const GATEWAY_ATT_SITES = {
cloning.ts:1434  export function simulateGatewayBP(
cloning.ts:1505  export function simulateGatewayLR(
cloning.ts:1871  export function simulateMultiSiteGatewayLR(
cloning.ts:2104  export function simulatePCR(
cloning.ts:2336  export function simulateOverlapExtensionPCR(
cloning.ts:2366  export function digestAndReligate(
cloning.ts:2376  export function pcrProductLength(
cloning.ts:2386  export function gibsonProductLength(fragments: PlasmidDocument[], options?: { minOverlap?: number; maxOverlap?: number; circular?: boolean }): number {
cloning.ts:2391  export function mutationProduct(
cloning.ts:2409  export function defaultEnzymeList(): RestrictionEnzyme[] {
cloning.ts:2413  export function restrictionEnzymePanel(): RestrictionEnzyme[] {
cloning.ts:2417  export function isGoldenGateEnzyme(enzyme: RestrictionEnzyme): boolean {
cloning.ts:2421  export function primerPairOptions(options?: PrimerDesignOptions): PrimerDesignOptions {
cloning.ts:2425  export function designPrimerPairForFeature(
cloning.ts:2433  export function gcOf(sequence: string): number {
cloning.ts:2437  export * from './assembly';
cloning.ts:2438  export * from './recombination';
enzymes.ts:11  export interface EnzymeDefinition extends RestrictionEnzyme {
enzymes.ts:15  export function makeEnzyme(
enzymes.ts:34  export const COMMON_ENZYMES: RestrictionEnzyme[] = [
enzymes.ts:97  export function enzymeByName(name: string): RestrictionEnzyme | undefined {
enzymes.ts:102  export function resolveEnzyme(nameOrSequence: string): RestrictionEnzyme | undefined {
enzymes.ts:112  export interface EnzymeCutCoordinates {
enzymes.ts:123  export function cutCoordinates(
enzymes.ts:188  export function cutEnds(
enzymes.ts:197  export interface MethylationProfile {
enzymes.ts:223  export function isMethylationBlocked(
enzymes.ts:247  export function findCutSites(
enzymes.ts:278  export function endsCompatible(right: OverhangEnd, left: OverhangEnd): boolean {
enzymes.ts:287  export function reverseEnd(end: OverhangEnd): OverhangEnd {
enzymes.ts:296  export interface OverhangFidelity {
enzymes.ts:306  export function scoreOverhang(overhang: string, allOverhangs: string[]): OverhangFidelity {
enzymes.ts:341  export function isTypeIIS(enzyme: RestrictionEnzyme): boolean {
enzymes.ts:345  export const NEB_LEADER_BASES: Record<string, string> = {
enzymes.ts:367  export function recommendedLeader(enzymeName: string): string {
enzymes.ts:371  export function enzymeRecognitionForTail(
fragment-assembly.ts:27  export type HomologyAssemblyKit = 'Gibson' | 'NEBuilder HiFi' | 'In-Fusion';
fragment-assembly.ts:109  export function designHomologyAssemblyPrimers(
fragment-assembly.ts:662  export function simulateInsertFragment(
index.ts:1  export type {
index.ts:5  export {
index.ts:17  export type {
index.ts:23  export {
index.ts:30  export type {
index.ts:36  export {
index.ts:53  export {
index.ts:69  export type {
index.ts:72  export {
index.ts:82  export type { HomologyAssemblyKit } from './fragment-assembly';
index.ts:83  export {
index.ts:88  export type { RecombinationSite } from './recombination';
index.ts:89  export {
index.ts:95  export type {
index.ts:100  export {
primer.ts:43  export interface PrimerDesignOptions {
primer.ts:55  export function buildPrimer(
primer.ts:176  export function designPrimerPair(
primer.ts:312  export interface MutationSpec {
primer.ts:319  export interface SilentSiteSuggestion {
primer.ts:592  export function designMutagenesisPrimers(
primer.ts:755  export function primerEnzymeTail(
primer.ts:766  export function silentSitePanel(): RestrictionEnzyme[] {
primer.ts:770  export function cloneFeatureList(features: SequenceFeature[]): SequenceFeature[] {
primer.ts:774  export function shiftedFeatureList(features: SequenceFeature[], offset: number): SequenceFeature[] {
primer.ts:778  export function mutationSpecLength(doc: PlasmidDocument, mutation: MutationSpec): number {
primer.ts:782  export function mutatedDocumentCopy(doc: PlasmidDocument): PlasmidDocument {
primer.ts:786  export interface PrimerBindingHit {
primer.ts:806  export function findPrimerBindingSites(
recombination.ts:25  export type RecombinationSite =
recombination.ts:35  export const RECOMBINATION_SITES: Record<RecombinationSite, string> = {
recombination.ts:98  export function findRecombinationSites(doc: PlasmidDocument): LocatedSite[] {
recombination.ts:559  export function simulateRecombinase(
thermo.ts:19  export interface ReactionConditions {
thermo.ts:26  export const DEFAULT_REACTION_CONDITIONS: Required<ReactionConditions> = {
thermo.ts:43  export const SANTA_LUCIA_1998: Record<string, NearestNeighborStep> = {
thermo.ts:62  export const SANTA_LUCIA_INITIATION = {
thermo.ts:69  export interface NearestNeighborSummary {
thermo.ts:75  export function nearestNeighborSummary(sequence: string): NearestNeighborSummary {
thermo.ts:112  export function owczarzySaltCorrection(sequence: string, conditions?: ReactionConditions): number {
thermo.ts:152  export function meltingTemperature(
thermo.ts:175  export function deltaG37(sequence: string, conditions?: ReactionConditions): number {
thermo.ts:436  export function predictHairpin(sequence: string, conditions?: ReactionConditions): HairpinPrediction {
thermo.ts:548  export function predictDuplex(
thermo.ts:660  export interface OligoThermo {
thermo.ts:673  export function evaluateOligoThermodynamics(
thermo.ts:696  export function calcCrossDimer(
thermo.ts:705  export function tmDifference(a: number, b: number): number {
thermo.ts:709  export function normalizeConditions(conditions?: ReactionConditions): Required<ReactionConditions> {
utils.ts:11  export const GAS_CONSTANT = 1.9872; // cal / (mol * K)
utils.ts:51  export const CODON_TABLE: Record<string, string> = {
utils.ts:118  export const AMINO_ACID_NAMES: Record<string, string> = {
utils.ts:142  export const SYNONYMOUS_CODONS: Record<string, string[]> = (() => {
utils.ts:153  export function uid(prefix: string): string {
utils.ts:158  export function nowIso(): string {
utils.ts:162  export function mod(value: number, length: number): number {
utils.ts:167  export function clamp(value: number, low: number, high: number): number {
utils.ts:171  export function normalizeDNA(sequence: string): string {
utils.ts:175  export function complementBase(base: string): string {
utils.ts:179  export function reverseComplement(sequence: string): string {
utils.ts:188  export function reverseSequence(sequence: string): string {
utils.ts:192  export function isSelfComplementary(sequence: string): boolean {
utils.ts:197  export function gcPercentOf(sequence: string): number {
utils.ts:207  export function has3PrimeGCClamp(sequence: string): boolean {
utils.ts:214  export function isPalindromic(sequence: string): boolean {
utils.ts:219  export function hammingDistance(a: string, b: string): number {
utils.ts:233  export function rangeLength(start: number, end: number, length: number, circular: boolean): number {
utils.ts:241  export function sequenceSlice(
utils.ts:272  export function motifToRegex(motif: string): RegExp {
utils.ts:281  export function findMotifPositions(sequence: string, motif: string, circular: boolean): number[] {
utils.ts:299  export function findMotifOnlyPositions(
utils.ts:321  export interface StrandedMotifMatch {
utils.ts:327  export function findMotifOnBothStrands(
utils.ts:347  export function translateSequence(sequence: string, frame = 0, stopAtStop = false): string {
utils.ts:359  export function codonStartFor(anchor: number, position: number): number {
utils.ts:363  export function bluntOverhang(): OverhangEnd {
utils.ts:367  export function copyOverhang(end: OverhangEnd | undefined): OverhangEnd {
utils.ts:377  export function reverseOverhang(end: OverhangEnd | undefined): OverhangEnd {
utils.ts:387  export function cloneFeature(feature: SequenceFeature): SequenceFeature {
utils.ts:396  export function clonePrimer(primer: Primer): Primer {
utils.ts:403  export function cloneHistoryNode(node: CloningHistoryNode): CloningHistoryNode {
utils.ts:419  export function cloneDocument(doc: PlasmidDocument): PlasmidDocument {
utils.ts:433  export interface MakeDocumentInput {
utils.ts:446  export function makeDocument(input: MakeDocumentInput): PlasmidDocument {
utils.ts:468  export function makeHistoryNode(
utils.ts:495  export interface DocumentSnapshot {
utils.ts:502  export function documentSnapshot(
utils.ts:514  export function appendHistory(doc: PlasmidDocument, node: CloningHistoryNode): PlasmidDocument {
utils.ts:520  export interface SlicedDocumentData {
utils.ts:591  export function sliceDocumentData(
utils.ts:664  export function shiftFeature(feature: SequenceFeature, offset: number): SequenceFeature {
utils.ts:672  export function shiftPrimer(primer: Primer, offset: number): Primer {
utils.ts:681  export function clipFeatureToLength(feature: SequenceFeature, length: number): SequenceFeature | null {
utils.ts:690  export interface MutationAdjustment {
utils.ts:696  export function applySequenceMutation(
utils.ts:725  export function adjustFeaturesForMutation(
utils.ts:778  export function findFirstDifference(a: string, b: string): number {
utils.ts:786  export function formatKcal(value: number): string {
```

### alignment-gel

```text
abif.ts:611  export async function parseAb1Trace(buffer: ArrayBuffer, fileName: string): Promise<SangerTraceData> {
abif.ts:626  export function mottTrim(qualityScores: number[], errorThreshold = 0.05): [number, number] {
abif.ts:661  export interface SecondaryPeakCall {
abif.ts:669  export function detectSecondaryPeaks(trace: SangerTraceData, ratio = 0.35): SecondaryPeakCall[] {
alignment.ts:5  export interface GotohScoring {
alignment.ts:20  export function gotohLocalAlign(
alignment.ts:567  export async function alignTraceToPlasmid(
coverage.ts:4  export interface CoverageCall {
coverage.ts:10  export interface CoverageDiscrepancy {
coverage.ts:16  export type CoverageStatus =
coverage.ts:23  export interface CoverageSummary {
coverage.ts:31  export interface CoverageOptions {
coverage.ts:108  export function summarizeTraceCoverage(
gel.ts:3  export type LadderName =
gel.ts:41  export type GelConformation = 'linear' | 'supercoiled' | 'nicked';
gel.ts:43  export interface LadderBand {
gel.ts:49  export const DNA_LADDERS: Record<LadderName, LadderBand[]> = {
gel.ts:587  export interface GelSampleInput {
gel.ts:599  export interface GelRunParams {
gel.ts:627  export function computeMigration(apparentBp: number, params: GelRunParams): number {
gel.ts:676  export function simulateVirtualGel(samples: GelSampleInput[], params: GelRunParams): VirtualGelLane[] {
genetics.ts:26  export function translateCodon(codon: string): string {
genetics.ts:31  export function complementBase(base: string): string {
genetics.ts:35  export function reverseComplement(sequence: string): string {
genetics.ts:48  export function iupacForPair(first: string, second: string): string {
genetics.ts:58  export function isCanonicalBase(base: string): boolean {
index.ts:1  export {
index.ts:6  export type { SecondaryPeakCall } from './abif';
index.ts:8  export {
index.ts:12  export type { GotohScoring } from './alignment';
index.ts:14  export { pairwiseAlign } from './pairwise';
index.ts:15  export type { PairwiseMode, PairwiseOptions, PairwiseResult } from './pairwise';
index.ts:17  export { multipleSequenceAlignment } from './msa';
index.ts:18  export type { MsaInput, MsaOptions, MsaResult, MsaRow } from './msa';
index.ts:20  export type { SequenceType } from './scoring';
index.ts:22  export {
index.ts:27  export type {
index.ts:35  export { createSyntheticTrace } from './synthetic';
index.ts:36  export type { SyntheticTraceOptions } from './synthetic';
index.ts:38  export { summarizeTraceCoverage } from './coverage';
index.ts:39  export type {
index.ts:47  export { alignReadsToReference, readsToTraces } from './reads';
index.ts:48  export type {
msa.ts:12  export interface MsaInput {
msa.ts:18  export interface MsaRow {
msa.ts:24  export interface MsaResult {
msa.ts:33  export interface MsaOptions {
msa.ts:898  export function multipleSequenceAlignment(
pairwise.ts:9  export type PairwiseMode = 'global' | 'local' | 'semiglobal';
pairwise.ts:11  export interface PairwiseOptions {
pairwise.ts:20  export interface PairwiseResult {
pairwise.ts:623  export function pairwiseAlign(
reads.ts:4  export interface SequencingRead {
reads.ts:11  export interface ReadMismatch {
reads.ts:17  export interface ReadAlignment {
reads.ts:27  export interface ReadAlignmentOptions {
reads.ts:527  export function alignReadsToReference(
reads.ts:630  export function readsToTraces(reads: SequencingRead[]): SangerTraceData[] {
scoring.ts:1  export type SequenceType = 'dna' | 'protein';
scoring.ts:3  export const DNA_ALPHABET = 'ACGTN';
scoring.ts:4  export const PROTEIN_ALPHABET = 'ARNDCQEGHILKMFPSTWYVBZX*';
scoring.ts:72  export function alphabetSize(type: SequenceType): number {
scoring.ts:76  export function residueCode(base: string, type: SequenceType): number {
scoring.ts:81  export function encodeResidues(sequence: string, type: SequenceType): Uint8Array {
scoring.ts:89  export interface SubstitutionScoring {
scoring.ts:94  export function buildSubstitutionTable(
scoring.ts:116  export function detectSequenceType(sequences: string[], explicit?: SequenceType): SequenceType {
scoring.ts:134  export function normalizeSequence(sequence: string): string {
synthetic.ts:5  export interface SyntheticTraceOptions {
synthetic.ts:42  export function createSyntheticTrace(
```

### canvas-ui

```text
CircularPlasmidMap.tsx:86  export interface CircularPlasmidMapProps {
CircularPlasmidMap.tsx:120  export function CircularPlasmidMap({
CloningHistoryTree.tsx:13  export interface CloningHistoryTreeProps {
CloningHistoryTree.tsx:29  export function CloningHistoryTree({
LinearPlasmidMap.tsx:44  export interface LinearPlasmidMapProps {
LinearPlasmidMap.tsx:89  export function LinearPlasmidMap({
LinearSequenceEditor.tsx:32  export interface LinearSequenceEditorProps {
LinearSequenceEditor.tsx:98  export function LinearSequenceEditor({
MapDisplayOptionsPanel.tsx:9  export interface MapDisplayOptionsPanelProps {
MapDisplayOptionsPanel.tsx:60  export function MapDisplayOptionsPanel({
MultipleAlignmentViewer.tsx:23  export interface MsaViewRow {
MultipleAlignmentViewer.tsx:29  export interface MultipleAlignmentViewerProps {
MultipleAlignmentViewer.tsx:78  export function MultipleAlignmentViewer({
ProteinSequenceView.tsx:21  export type { ProteinDocument, ProteinFeature } from './layout/proteinLayout';
ProteinSequenceView.tsx:23  export interface ProteinSelection {
ProteinSequenceView.tsx:28  export interface ProteinSequenceViewProps {
ProteinSequenceView.tsx:69  export function ProteinSequenceView({
SangerAlignmentViewer.tsx:24  export interface SangerAlignmentViewerProps {
SangerAlignmentViewer.tsx:329  export function SangerAlignmentViewer({
SeqVizView.tsx:6  export interface SeqVizViewProps {
SeqVizView.tsx:14  export function SeqVizView({
VirtualGelSimulator.tsx:16  export interface VirtualGelSimulatorProps {
VirtualGelSimulator.tsx:49  export function VirtualGelSimulator({
exportPdf.ts:14  export type { PdfExportOptions, PdfPageLayout } from './pdfPage';
exportPdf.ts:15  export {
exportPdf.ts:67  export async function exportSvgToPdf(
exportSvg.ts:24  export function triggerDownload(blob: Blob, fileName: string): void {
exportSvg.ts:36  export function exportSvgToPublicationFile(
exportSvg.ts:46  export async function exportSvgToPng(
index.tsx:1  export { CircularPlasmidMap } from './CircularPlasmidMap';
index.tsx:2  export { LinearPlasmidMap } from './LinearPlasmidMap';
index.tsx:3  export { MapDisplayOptionsPanel } from './MapDisplayOptionsPanel';
index.tsx:4  export { ProteinSequenceView } from './ProteinSequenceView';
index.tsx:5  export { LinearSequenceEditor } from './LinearSequenceEditor';
index.tsx:6  export { SangerAlignmentViewer } from './SangerAlignmentViewer';
index.tsx:7  export { VirtualGelSimulator } from './VirtualGelSimulator';
index.tsx:8  export { CloningHistoryTree } from './CloningHistoryTree';
index.tsx:9  export { SeqVizView } from './SeqVizView';
index.tsx:10  export { MultipleAlignmentViewer } from './MultipleAlignmentViewer';
index.tsx:12  export { exportSvgToPublicationFile, exportSvgToPng } from './exportSvg';
index.tsx:13  export { exportSvgToPdf } from './exportPdf';
index.tsx:14  export {
index.tsx:20  export {
index.tsx:37  export {
index.tsx:47  export {
index.tsx:55  export {
index.tsx:64  export {
index.tsx:71  export {
index.tsx:85  export {
index.tsx:90  export {
index.tsx:99  export { printSequenceText, printSvg } from './print';
index.tsx:101  export type {
index.tsx:114  export type {
index.tsx:118  export type { ProteinDocument, ProteinFeature } from './ProteinSequenceView';
index.tsx:119  export type {
index.tsx:123  export type {
index.tsx:129  export type {
index.tsx:141  export type {
index.tsx:146  export type {
index.tsx:152  export type {
index.tsx:157  export type {
index.tsx:163  export type { PdfExportOptions, PdfPageLayout, PdfPageSize } from './pdfPage';
index.tsx:164  export type { IndexRange, MsaColorScheme } from './layout/msaLayout';
index.tsx:166  export type { VizTheme } from './theme';
index.tsx:167  export { THEMES, getTheme, FEATURE_PALETTE, OPERATION_LABEL } from './theme';
mapDisplayOptions.ts:10  export interface MapDisplayOptions {
mapDisplayOptions.ts:30  export interface ResolvedMapDisplayOptions {
mapDisplayOptions.ts:47  export const MIN_LABEL_FONT_SIZE = 7;
mapDisplayOptions.ts:48  export const MAX_LABEL_FONT_SIZE = 20;
mapDisplayOptions.ts:50  export const DEFAULT_MAP_DISPLAY_OPTIONS: ResolvedMapDisplayOptions = {
mapDisplayOptions.ts:78  export function resolveMapDisplayOptions(
mapDisplayOptions.ts:110  export function isFeatureVisible(
mapDisplayOptions.ts:118  export function filterVisibleFeatures(
mapDisplayOptions.ts:129  export function resolvePrimerVisibility(
pdfPage.ts:8  export type PdfPageSize = 'a4' | 'letter' | 'fit';
pdfPage.ts:10  export interface PdfExportOptions {
pdfPage.ts:16  export interface PdfPageLayout {
pdfPage.ts:31  export const PDF_PAGE_SIZES: Record<'a4' | 'letter', { width: number; height: number }> = {
pdfPage.ts:36  export const PDF_PAGE_MARGIN = 24;
pdfPage.ts:37  export const PDF_TITLE_HEIGHT = 32;
pdfPage.ts:38  export const PDF_MIN_PAGE_SIZE = 1;
pdfPage.ts:56  export function computePdfPageLayout(
print.ts:72  export function printSvg(
print.ts:86  export function printSequenceText(
printHtml.ts:11  export interface PrintHtmlOptions {
printHtml.ts:16  export interface SequencePrintOptions {
printHtml.ts:23  export interface SequencePrintLine {
printHtml.ts:36  export interface FeaturePrintRow {
printHtml.ts:48  export function escapeHtml(value: string): string {
printHtml.ts:58  export function formatGroupedBases(bases: string, groupSize = GROUP_SIZE): string {
printHtml.ts:68  export function buildSequencePrintLines(
printHtml.ts:106  export function buildFeaturePrintRows(doc: PlasmidDocument): FeaturePrintRow[] {
printHtml.ts:152  export function buildPrintDocument(
printHtml.ts:172  export function buildSvgPrintHtml(
printHtml.ts:208  export function buildSequencePrintHtml(
segments.ts:19  export function parseSegmentsNote(
segments.ts:38  export function isMultiSegmentFeature(feature: SequenceFeature): boolean {
segments.ts:43  export interface FeaturePiece extends RangeSegment {
segments.ts:52  export interface FeatureSegmentPlan {
segments.ts:84  export function buildFeatureSegmentPlan(
segments.ts:182  export interface FeatureTrackEntry {
segments.ts:187  export interface SegmentTrackAssignment {
segments.ts:197  export function assignSegmentTracks(
segments.ts:256  export function segmentGapRanges(
theme.ts:1  export type VizTheme = 'light' | 'dark' | 'publication';
theme.ts:3  export interface VizThemeTokens {
theme.ts:50  export const THEMES: Record<VizTheme, VizThemeTokens> = {
theme.ts:176  export function getTheme(theme: VizTheme = 'light'): VizThemeTokens {
theme.ts:180  export function baseColor(base: string, theme: VizThemeTokens): string {
theme.ts:196  export const OPERATION_LABEL: Record<string, string> = {
theme.ts:210  export const OPERATION_TINT: Record<string, string> = {
theme.ts:224  export const FEATURE_PALETTE = [
types.ts:16  export type { VizTheme };
types.ts:18  export interface CircularPlasmidMapProps {
types.ts:32  export interface LinearPlasmidMapProps {
types.ts:45  export interface MapDisplayOptionsPanelProps {
types.ts:51  export interface ProteinSelection {
types.ts:56  export interface ProteinSequenceViewProps {
types.ts:65  export interface LinearSequenceEditorProps {
types.ts:83  export interface SangerAlignmentViewerProps {
types.ts:92  export interface VirtualGelSimulatorProps {
types.ts:106  export interface CloningHistoryTreeProps {
types.ts:113  export interface SeqVizViewProps {
utils.ts:3  export interface Point {
utils.ts:8  export interface RangeSegment {
utils.ts:13  export function mod(value: number, length: number): number {
utils.ts:18  export function clamp(value: number, min: number, max: number): number {
utils.ts:24  export function clamp01(value: number): number {
utils.ts:28  export function round(value: number, precision = 0): number {
utils.ts:33  export function formatBp(value: number): string {
utils.ts:37  export function formatPercent(value: number, digits = 1): string {
utils.ts:41  export function trimNumber(value: number, digits = 1): string {
utils.ts:50  export function splitRange(
utils.ts:76  export function featureSegments(
utils.ts:99  export function segmentsOverlap(a: RangeSegment, b: RangeSegment): boolean {
utils.ts:103  export function segmentLength(segments: RangeSegment[]): number {
utils.ts:107  export function pointOnCircle(
utils.ts:117  export function indexToAngle(index: number, length: number, startAngle = -90): number {
utils.ts:122  export function angleToIndex(
utils.ts:131  export function pointToIndex(
utils.ts:143  export function describeArc(
utils.ts:162  export function annularSectorPath(
utils.ts:191  export interface ArrowPolygon {
utils.ts:196  export function directionalArrow(
utils.ts:230  export function rectangularArrow(
utils.ts:257  export interface FeatureTrackAssignment {
utils.ts:263  export function assignFeatureTracks(
utils.ts:315  export interface LeaderItem {
utils.ts:321  export type LeaderSide = 'left' | 'right';
utils.ts:323  export interface LeaderLabel<T extends LeaderItem = LeaderItem> {
utils.ts:335  export interface LeaderLayoutOptions {
utils.ts:347  export interface LeaderSource extends LeaderItem {
utils.ts:356  export function layoutLeaderLabels<T extends LeaderSource>(
utils.ts:464  export function niceTickStep(length: number, targetTicks = 12): number {
utils.ts:477  export function textWidthEstimate(text: string, fontSize: number): number {
utils.ts:481  export function hexToRgba(hex: string, alpha: number): string {
utils.ts:495  export function contrastText(hex: string): string {
```

### ai-copilot

```text
CopilotSidebar.tsx:46  export interface CopilotSidebarProps {
CopilotSidebar.tsx:161  export function CopilotSidebar(props: CopilotSidebarProps): JSX.Element {
index.ts:16  export const AI_CONFIG_STORAGE_KEY = 'gatc_ai_config';
index.ts:17  export const LEGACY_AI_CONFIG_STORAGE_KEY = 'opensnapgene_ai_config';
index.ts:19  export const PROVIDER_DEFAULTS: Record<AIProviderType, { baseUrl: string; model: string }> = {
index.ts:42  export const QUICK_PROMPTS: Array<{ id: string; icon: string; label: string; prompt: string }> = [
index.ts:448  export function buildPlasmidContextPrompt(
index.ts:616  export function buildSystemPrompt(): string {
index.ts:740  export function parseAssistantReply(text: string): { content: string; actions: AIToolAction[] } {
index.ts:895  export function validateAction(
index.ts:1557  export async function streamChat(
index.ts:1611  export function loadAIConfig(): AIConfig | null {
index.ts:1659  export function saveAIConfig(config: AIConfig): void {
index.ts:1696  export function clearAIConfig(): void {
```

## 4. 全局数据契约 `src/types/schema.ts`

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
  secondCut?: { top: number; bottom: number }; // Second cleavage of enzymes that cut on both sides (BaeI, BcgI); same convention as cutIndexTop/Bottom
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

## 5. 关键路径源码摘录

### 环状跨零点酶切扫描 + 甲基化阻断（seq-engine） — `findCutSites`

```typescript
// src/modules/seq-engine/index.ts:426
export function findCutSites(
  doc: PlasmidDocument,
  enzymes: RestrictionEnzyme[] = COMMERCIAL_ENZYMES,
  filter: {
    uniqueOnly?: boolean;
    commercialOnly?: boolean;
    buffer?: 'r1.1' | 'r2.1' | 'r3.1' | 'rCutSmart';
    excludeMethylationBlocked?: boolean;
  } = {},
): CutSite[] {
  const sequence = normalizeSequence(doc.sequence);
  const length = sequence.length;
  if (length === 0) return [];

  const circular = doc.topology === 'circular';
  const selected = enzymes.filter((enzyme) => {
    if (filter.commercialOnly && (enzyme.suppliers ?? []).length === 0) {
      return false;
    }
    if (filter.buffer) {
      const activity = enzyme.nebBuffers?.[filter.buffer];
      if (activity === undefined || activity <= 0) return false;
    }
    return true;
  });
  if (selected.length === 0) return [];
  // Generating sites in enzyme-name order lets a stable counting sort below
  // reproduce the historical position/name/strand ordering without comparing
  // every pair of cut sites.
  selected.sort((left, right) => left.name.localeCompare(right.name));

  let maximumRecognitionLength = 0;
  for (const enzyme of selected) {
    maximumRecognitionLength = Math.max(
      maximumRecognitionLength,
      enzyme.recognitionSeq.length,
    );
  }
  const scanSequence = circular
    ? sequence + sequence.slice(0, maximumRecognitionLength)
    : sequence;
  const encodedScan = encodeSequence(scanSequence);
  const masks = buildMethylationMasks(
    sequence,
    circular,
    doc.methylationProfile,
  );

  // Isoschizomers and commercial aliases share recognition sequences, so the
  // scan is performed once per unique motif and reused by every enzyme.
  const patternCache = new Map<string, number[]>();
  const patterns = new Set<string>();
  for (const enzyme of selected) {
    const recognition = enzyme.recognitionSeq.toUpperCase();
    patterns.add(recognition);
    if (!isPalindromic(recognition)) {
      patterns.add(reverseComplement(recognition));
    }
  }

  // Motifs with a small IUPAC expansion share one Aho-Corasick pass. Highly
  // degenerate motifs fall back to the bit-parallel matcher.
  const automaton = new AnnotationAutomaton();
  const expandedPatterns: string[] = [];
  const entryPatterns: number[] = [];
  const fallbackPatterns: string[] = [];
  for (const pattern of patterns) {
    const variants = expandIupacPattern(pattern, 64);
    if (!variants) {
      fallbackPatterns.push(pattern);
      continue;
    }
    const patternIndex = expandedPatterns.length;
    expandedPatterns.push(pattern);
    for (const variant of variants) {
      entryPatterns.push(patternIndex);
      automaton.add(variant, {
        libraryIndex: patternIndex,
        strand: 1,
        kind: 'full',
        offset: 0,
      });
    }
  }

  if (expandedPatterns.length > 0) {
    automaton.build();
    const buckets = expandedPatterns.map(() => [] as number[]);
    for (const match of automaton.search(scanSequence)) {
      buckets[entryPatterns[match.entryIndex]].push(match.start);
    }
    for (let index = 0; index < expandedPatterns.length; index += 1) {
      patternCache.set(
        expandedPatterns[index],
        buckets[index].filter((position) => position < length),
      );
    }
  }

  for (const pattern of fallbackPatterns) {
    patternCache.set(
      pattern,
      findPatternPositions(scanSequence, pattern, encodedScan).filter(
        (position) => position < length,
      ),
    );
  }

  const positionsFor = (pattern: string): number[] =>
    patternCache.get(pattern) ?? [];

  const allSites: CutSite[] = [];

  for (const enzyme of selected) {
    const recognition = enzyme.recognitionSeq.toUpperCase();
    const recognitionLength = recognition.length;
    const enzymeIsDpnI = enzyme.name.toUpperCase() === 'DPNI';
    const sensitivity = enzyme.methylationSensitivity;
    const hasBlockingMethylation =
      enzymeIsDpnI ||
      (sensitivity !== undefined &&
        ((sensitivity.dam === 'blocked' && masks.profile.dam) ||
          (sensitivity.dcm === 'blocked' && masks.profile.dcm) ||
          (sensitivity.cpg === 'blocked' && masks.profile.cpg)));
    const firstSiteIndex = allSites.length;

    const cuts = [{ top: enzyme.cutIndexTop, bottom: enzyme.cutIndexBottom, suffix: '' }];
    if (enzyme.secondCut) cuts.push({ ...enzyme.secondCut, suffix: ':2' });

    const addPosition = (position: number, strand: Strand): void => {
      for (const cut of cuts) addCut(position, strand, cut.top, cut.bottom, cut.suffix);
    };

    const addCut = (position: number, strand: Strand, cutTop: number, cutBottom: number, suffix: string): void => {
      const rawTop =
        strand === 1
          ? position + cutTop
          : position + recognitionLength - cutBottom;
      const rawBottom =
        strand === 1
          ? position + cutBottom
          : position + recognitionLength - cutTop;

      if (
        !circular &&
        (rawTop < 0 || rawTop > length || rawBottom < 0 || rawBottom > length)
      ) {
        return;
      }

      const difference = rawBottom - rawTop;
      const overhangType: CutSite['overhangType'] =
        difference === 0 ? 'blunt' : difference > 0 ? '5-prime' : '3-prime';
      const overhangSeq =
        difference === 0
          ? ''
          : extractSegment(
              sequence,
              circular,
              Math.min(rawTop, rawBottom),
              Math.abs(difference),
            );
      allSites.push({
        id: `${enzyme.name}:${position}:${strand}${suffix}`,
        enzyme,
        position,
        strand,
        cutPositionTop: circular ? mod(rawTop, length) : rawTop,
        cutPositionBottom: circular ? mod(rawBottom, length) : rawBottom,
        overhangType,
        overhangSeq,
        isMethylationBlocked: hasBlockingMethylation
          ? isMethylationBlocked(
              enzyme,
              enzymeIsDpnI,
              position,
              recognitionLength,
              rawTop,
              rawBottom,
              masks,
              length,
              circular,
            )
          : false,
        totalCutsInPlasmid: 0,
      });
    };

    for (const position of positionsFor(recognition)) {
      addPosition(position, 1);
    }

    if (!isPalindromic(recognition)) {
      const reverseRecognition = reverseComplement(recognition);
      for (const position of positionsFor(reverseRecognition)) {
        addPosition(position, -1);
      }
    }

    const enzymeCutCount = allSites.length - firstSiteIndex;
    for (let index = firstSiteIndex; index < allSites.length; index += 1) {
      allSites[index].totalCutsInPlasmid = enzymeCutCount;
    }
  }

  let result = allSites;
  if (filter.uniqueOnly) {
    result = result.filter((site) => site.totalCutsInPlasmid === 1);
  }
  if (filter.excludeMethylationBlocked) {
    result = result.filter((site) => !site.isMethylationBlocked);
  }

  return orderCutSites(result, length);
}
```

### 环状 ORF 扫描 — `findAllORFs`

```typescript
// src/modules/seq-engine/index.ts:704
export function findAllORFs(doc: PlasmidDocument, minAaLength = 75): ORF[] {
  const sequence = normalizeSequence(doc.sequence);
  const length = sequence.length;
  if (length < 3) return [];

  const circular = doc.topology === 'circular';
  const minimum = Math.max(0, Math.floor(minAaLength));
  interface Candidate {
    start: number;
    endRaw: number;
    strand: Strand;
    aminoAcids: string;
  }
  const candidates = new Map<string, Candidate>();

  for (const strand of [1, -1] as const) {
    const oriented = strand === 1 ? sequence : reverseComplement(sequence);
    const scan = circular ? oriented + oriented : oriented;
    const orientedLength = oriented.length;

    for (let start = 0; start < length; start += 1) {
      if (scan.slice(start, start + 3) !== START_CODON) continue;

      const limit = circular ? start + length : orientedLength;
      let stopStart = -1;
      for (let position = start; position + 3 <= limit; position += 3) {
        const codon = scan.slice(position, position + 3);
        if (STOP_CODONS.has(codon)) {
          stopStart = position;
          break;
        }
      }
      if (stopStart < 0) continue;

      const endRaw = stopStart + 3;
      const lengthBp = endRaw - start;
      if (lengthBp < 3 || lengthBp > length) continue;

      const aminoAcids = translateDna(scan.slice(start, stopStart));
      if (aminoAcids.length < minimum) continue;

      const key = `${strand}:${stopStart}`;
      const current = candidates.get(key);
      if (!current || start < current.start) {
        candidates.set(key, {
          start,
          endRaw,
          strand,
          aminoAcids,
        });
      }
    }
  }

  const orfs: ORF[] = [];
  for (const candidate of candidates.values()) {
    const { start, endRaw, strand, aminoAcids } = candidate;
    const lengthBp = endRaw - start;

    let topStart: number;
    let topEnd: number;
    if (lengthBp === length) {
      topStart = 0;
      topEnd = length;
    } else if (strand === 1) {
      topStart = start;
      topEnd = circular ? endRaw % length : endRaw;
    } else if (circular) {
      topStart = mod(length - (endRaw % length), length);
      topEnd = mod(length - (start % length), length);
    } else {
      topStart = length - endRaw;
      topEnd = length - start;
    }

    orfs.push({
      id: `orf-${strand === 1 ? 'f' : 'r'}-${topStart}-${topEnd}-${lengthBp}`,
      start: topStart,
      end: topEnd,
      strand,
      frame: orfFrame(strand === 1 ? topStart : start, strand),
      lengthBp,
      aminoAcids,
      mwKda: Number(proteinMolecularWeightKda(aminoAcids).toFixed(3)),
      pI: Number(proteinIsoelectricPoint(aminoAcids).toFixed(2)),
    });
  }

  return orfs.sort(
    (left, right) => left.start - right.start || left.strand - right.strand,
  );
}
```

### 序列编辑与特征坐标联动 — `mutatePlasmidSequence`

```typescript
// src/modules/seq-engine/index.ts:1070
export function mutatePlasmidSequence(
  doc: PlasmidDocument,
  edit: SequenceEdit,
): PlasmidDocument {
  const sequence = normalizeSequence(doc.sequence);
  const circular = doc.topology === 'circular';

  if (edit.type === 'insert') {
    if (
      !Number.isInteger(edit.position) ||
      edit.position < 0 ||
      edit.position > sequence.length
    ) {
      throw new Error('Insertion position is outside the sequence');
    }
    const bases = normalizeInsertBases(edit.bases);
    const result = transformInsertion(
      sequence,
      doc.features,
      doc.primers,
      edit.position,
      bases,
      circular,
    );
    return withHistory(
      doc,
      result.sequence,
      result.features,
      result.primers,
      `Inserted ${bases.length} bp at position ${edit.position}`,
    );
  }

  if (edit.type === 'delete') {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end)) {
      throw new Error('Deletion coordinates must be integers');
    }
    const result = transformDeletion(
      sequence,
      doc.features,
      doc.primers,
      edit.start,
      edit.end,
      circular,
    );
    return withHistory(
      doc,
      result.sequence,
      result.features,
      result.primers,
      `Deleted ${result.deletedLength} bp from ${edit.start} to ${edit.end}`,
    );
  }

  const bases = normalizeInsertBases(edit.bases);
  if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end)) {
    throw new Error('Replacement coordinates must be integers');
  }
  if (edit.start === 0 && edit.end === sequence.length) {
    const next = withHistory(
      doc,
      bases,
      [],
      [],
      `Replaced entire ${sequence.length} bp sequence with ${bases.length} bp`,
    );
    return doc.topology === 'linear'
      ? { ...next, linearEnds: undefined }
      : next;
  }
  const deleted = transformDeletion(
    sequence,
    doc.features,
    doc.primers,
    edit.start,
    edit.end,
    circular,
  );
  const insertionPosition = edit.start <= edit.end ? edit.start : 0;
  const result = transformInsertion(
    deleted.sequence,
    deleted.features,
    deleted.primers,
    insertionPosition,
    bases,
    circular,
  );

  // A replacement removes the old bases, but a feature or primer that exactly
  // spans the replaced interval still describes the new interval. Re-attach
  // those annotations instead of dropping them with the deleted sequence.
  if (edit.start <= edit.end) {
    const delta = bases.length - deleted.deletedLength;
    const newLength = result.sequence.length;
    for (const feature of doc.features) {
      if (feature.start > edit.start || feature.end < edit.end) continue;
      if (result.features.some((candidate) => candidate.id === feature.id)) continue;
      let start = feature.start;
      let end = feature.end + delta;
      if (circular) {
        start = mod(start, newLength);
        end = mod(end, newLength);
        if (start === 0 && feature.start === 0 && feature.end === sequence.length) {
          end = newLength;
        }
      }
      result.features.push({ ...feature, start, end });
    }
    for (const primer of doc.primers) {
      if (primer.bindingStart > edit.start || primer.bindingEnd < edit.end) continue;
      if (result.primers.some((candidate) => candidate.id === primer.id)) continue;
      let bindingStart = primer.bindingStart;
      let bindingEnd = primer.bindingEnd + delta;
      if (circular) {
        bindingStart = mod(bindingStart, newLength);
        bindingEnd = mod(bindingEnd, newLength);
      }
      result.primers.push({ ...primer, bindingStart, bindingEnd });
    }
  } else {
    // A wrapped replacement can also delete an annotation exactly. The new
    // bases occupy the start of the rotated sequence, so re-anchor it there.
    for (const feature of doc.features) {
      if (feature.start !== edit.start || feature.end !== edit.end) continue;
      if (result.features.some((candidate) => candidate.id === feature.id)) continue;
      result.features.push({ ...feature, start: 0, end: bases.length });
    }
    for (const primer of doc.primers) {
      if (
        primer.bindingStart !== edit.start ||
        primer.bindingEnd !== edit.end
      ) {
        continue;
      }
      if (result.primers.some((candidate) => candidate.id === primer.id)) continue;
      result.primers.push({
        ...primer,
        bindingStart: 0,
        bindingEnd: bases.length,
      });
    }
  }

  return withHistory(
    doc,
    result.sequence,
    result.features,
    result.primers,
    `Replaced ${deleted.deletedLength} bp from ${edit.start} to ${edit.end} with ${bases.length} bp`,
  );
}
```

### 重设环状原点 — `rotateCircularOrigin`

```typescript
// src/modules/seq-engine/index.ts:1324
export function rotateCircularOrigin(
  doc: PlasmidDocument,
  newZeroIndex: number,
): PlasmidDocument {
  if (doc.topology !== 'circular') {
    throw new Error('rotateCircularOrigin requires a circular plasmid');
  }
  const sequence = normalizeSequence(doc.sequence);
  const length = sequence.length;
  if (!Number.isFinite(newZeroIndex)) {
    throw new Error('New origin must be a finite number');
  }
  if (length === 0) {
    return withHistory(doc, sequence, [], [], 'Rotated circular origin to 0');
  }
  const zeroIndex = mod(Math.floor(newZeroIndex), length);
  if (zeroIndex === 0) {
    return withHistory(
      doc,
      sequence,
      doc.features.map((feature) => ({ ...feature })),
      doc.primers.map((primer) => ({ ...primer })),
      'Rotated circular origin to 0',
    );
  }
  const nextSequence = sequence.slice(zeroIndex) + sequence.slice(0, zeroIndex);

  const nextFeatures = doc.features.map((feature) => {
    const [start, end] = rotateRange(
      feature.start,
      feature.end,
      zeroIndex,
      length,
    );
    return { ...feature, start, end };
  });

  const nextPrimers = doc.primers.map((primer) => {
    const [bindingStart, bindingEnd] = rotateRange(
      primer.bindingStart,
      primer.bindingEnd,
      zeroIndex,
      length,
    );
    const mismatches = primer.mismatches
      ?.map((mismatch) => mod(mismatch - zeroIndex, length))
      .sort((left, right) => left - right);
    return { ...primer, bindingStart, bindingEnd, mismatches };
  });

  return withHistory(
    doc,
    nextSequence,
    nextFeatures,
    nextPrimers,
    `Rotated circular origin to ${zeroIndex}`,
  );
}
```

### SantaLucia/Owczarzy 热力学 — `evaluateOligoThermodynamics`

```typescript
// src/modules/cloning-primer/thermo.ts:673
export function evaluateOligoThermodynamics(
  sequence: string,
  conditions?: ReactionConditions,
): OligoThermo {
  const seq = normalizeDNA(sequence);
  const summary = nearestNeighborSummary(seq);
  const tmResult = meltingTemperature(seq, conditions);
  const hairpin = predictHairpin(seq, conditions);
  const selfDimer = predictDuplex(seq, seq, conditions);
  return {
    tm: tmResult.tm,
    deltaH: summary.deltaH,
    deltaS: summary.deltaS,
    deltaG37: deltaG37(seq, conditions),
    gcPercent: summary.gcPercent,
    has3PrimeGCClamp: has3PrimeGCClamp(seq),
    hairpinDeltaG: hairpin.deltaG,
    selfDimerDeltaG: selfDimer.deltaG,
    hairpinAscii: hairpin.ascii,
    selfDimerAscii: selfDimer.ascii,
  };
}
```

### 酶切产物与粘性末端 — `simulateDigestion`

```typescript
// src/modules/cloning-primer/cloning.ts:145
export function simulateDigestion(doc: PlasmidDocument, cutSites: CutSite[]): PlasmidDocument[] {
  const cuts = normaliseCutList(doc, cutSites);
  if (!cuts.length) return [cloneDocument(doc)];
  const circular = doc.topology === 'circular';
  const length = doc.length;
  const fragments: PlasmidDocument[] = [];
  const enzymesUsed = Array.from(new Set(cuts.map((cut) => cut.enzyme.name)));
  if (circular) {
    if (cuts.length === 1) {
      const cut = cuts[0];
      const data = sliceDocumentData(doc, cut.top, cut.top + length, { circular: true });
      fragments.push(
        linearDocFromData(
          doc,
          data,
          `${doc.name}_linearized_${cut.enzyme.name}`,
          { left: cut.left, right: cut.right },
          'restriction_ligation',
          `Linearized ${doc.name} with ${cut.enzyme.name}; cohesive ends recorded.`,
          enzymesUsed,
        ),
      );
      return fragments;
    }
    for (let index = 0; index < cuts.length; index += 1) {
      const startCut = cuts[index];
      const endCut = cuts[(index + 1) % cuts.length];
      const span = rangeLength(startCut.top, endCut.top, length, true);
      if (span <= 0) continue;
      const data = sliceDocumentData(doc, startCut.top, startCut.top + span, { circular: true });
      fragments.push(
        linearDocFromData(
          doc,
          data,
          `${doc.name}_${startCut.enzyme.name}_${index + 1}`,
          { left: startCut.left, right: endCut.right },
          'restriction_ligation',
          `Digestion of ${doc.name} with ${enzymesUsed.join(' + ')}; fragment ${index + 1} of ${cuts.length} (${data.length} bp).`,
          enzymesUsed,
        ),
      );
    }
    return fragments;
  }
  const boundaries = [0, ...cuts.map((cut) => cut.top).filter((value) => value > 0 && value < length), length];
  const uniqueBoundaries = Array.from(new Set(boundaries)).sort((a, b) => a - b);
  for (let index = 0; index + 1 < uniqueBoundaries.length; index += 1) {
    const start = uniqueBoundaries[index];
    const end = uniqueBoundaries[index + 1];
    if (end <= start) continue;
    const data = sliceDocumentData(doc, start, end, { circular: false });
    const leftEnd =
      index === 0
        ? copyOverhang(doc.linearEnds?.left ?? bluntOverhang())
        : cuts.find((cut) => cut.top === start)?.left ?? bluntOverhang();
    const rightEnd =
      index + 2 === uniqueBoundaries.length
        ? copyOverhang(doc.linearEnds?.right ?? bluntOverhang())
        : cuts.find((cut) => cut.top === end)?.right ?? bluntOverhang();
    fragments.push(
      linearDocFromData(
        doc,
        data,
        `${doc.name}_fragment_${index + 1}`,
        { left: leftEnd, right: rightEnd },
        'restriction_ligation',
        `Digestion of ${doc.name} with ${enzymesUsed.join(' + ')}; fragment ${index + 1} (${data.length} bp).`,
        enzymesUsed,
      ),
    );
  }
  return fragments;
}
```

### 连接与末端相容性 — `simulateLigation`

```typescript
// src/modules/cloning-primer/cloning.ts:412
export function simulateLigation(
  fragments: PlasmidDocument[],
  options?: { circularize?: boolean; dephosphorylatedIds?: string[] },
): {
  product: PlasmidDocument | null;
  compatible: boolean;
  orientations: Array<'forward' | 'reverse'>;
  destroyedSites: string[];
  warnings: string[];
}
```

### Golden Gate 组装 — `simulateGoldenGateAssembly`

```typescript
// src/modules/cloning-primer/cloning.ts:1090
export function simulateGoldenGateAssembly(
  parts: PlasmidDocument[],
  enzyme: RestrictionEnzyme,
  options?: { circular?: boolean },
): {
  product: PlasmidDocument | null;
  overhangs: string[];
  fidelityScore: number;
  internalSiteWarnings: string[];
  warnings: string[];
}
```

### cloning-primer 内部 Type IIS 搜索（与 seq-engine 并行实现） — `findCutSites`

```typescript
// src/modules/cloning-primer/enzymes.ts:247
export function findCutSites(
  sequence: string,
  enzyme: RestrictionEnzyme,
  circular = true,
  profile?: MethylationProfile,
): CutSite[] {
  const seq = normalizeDNA(sequence);
  const length = seq.length;
  if (!length) return [];
  const matches = findMotifOnBothStrands(seq, enzyme.recognitionSeq, circular);
  const cuts: CutSite[] = [];
  const passes = enzyme.secondCut ? [false, true] : [false];
  for (const match of matches) for (const second of passes) {
    const coordinates = cutCoordinates(match.position, enzyme, match.strand, length, second);
    const ends = cutEnds(seq, coordinates, circular, enzyme.name);
    cuts.push({
      id: `${enzyme.name}_${match.position}_${match.strand}${second ? '_2' : ''}`,
      enzyme,
      position: match.position,
      strand: match.strand,
      cutPositionTop: coordinates.top,
      cutPositionBottom: coordinates.bottom,
      overhangType: ends.left.type,
      overhangSeq: ends.left.sequence,
      isMethylationBlocked: profile ? isMethylationBlocked(seq, enzyme, match.position, profile) : false,
      totalCutsInPlasmid: matches.length * passes.length,
    });
  }
  return cuts.sort((a, b) => a.position - b.position);
}
```

### Sanger 跨零点比对 — `alignTraceToPlasmid`

```typescript
// src/modules/alignment-gel/alignment.ts:567
export async function alignTraceToPlasmid(
  trace: SangerTraceData,
  doc: PlasmidDocument,
  options: { useWasm?: boolean; kmer?: number } = {}
): Promise<SangerTraceData> {
  const sequence = doc.sequence.toUpperCase();
  const sequenceLength = sequence.length;
  if (sequenceLength === 0) {
    return {
      ...trace,
      alignment: {
        refStart: 0,
        refEnd: 0,
        strand: 1,
        identityPercent: 0,
        alignedRef: '',
        alignedQuery: '',
        mismatches: []
      }
    };
  }

  let trimStart = 0;
  let trimEnd = trace.calledSequence.length;
  if (Array.isArray(trace.trimRange) && trace.trimRange.length === 2) {
    const suppliedStart = Number.isFinite(trace.trimRange[0]) ? trace.trimRange[0] : 0;
    const suppliedEnd = Number.isFinite(trace.trimRange[1])
      ? trace.trimRange[1]
      : trace.calledSequence.length;
    trimStart = clamp(suppliedStart, 0, trace.calledSequence.length);
    trimEnd = clamp(suppliedEnd, trimStart, trace.calledSequence.length);
  }
  if (trimEnd - trimStart < 8) {
    trimStart = 0;
    trimEnd = trace.calledSequence.length;
  }
  const query = trace.calledSequence.slice(trimStart, trimEnd).toUpperCase();
  if (!query.length) {
    return {
      ...trace,
      alignment: {
        refStart: 0,
        refEnd: 0,
        strand: 1,
        identityPercent: 0,
        alignedRef: '',
        alignedQuery: '',
        mismatches: []
      }
    };
  }

  const circular = doc.topology === 'circular';
  const reference = circular ? sequence + sequence : sequence;
  const preferredKmer = clamp(
    Math.floor(Number.isFinite(options.kmer) ? (options.kmer as number) : 15),
    4,
    32
  );

  let windowStart = 0;
  let windowEnd = reference.length;
  let diagonal: number | null = null;
  if (options.useWasm) {
    diagonal = await tryMinimap2Diagonal(reference, query);
  }
  if (diagonal === null) {
    const attempts = Array.from(
      new Set<number>([
        preferredKmer,
        Math.max(6, Math.floor(preferredKmer * 0.7)),
        6
      ])
    ).filter(kmer => kmer >= 4 && kmer <= query.length);
    for (const kmer of attempts) {
      const candidate = findSeedDiagonal(reference, query, kmer);
      if (candidate !== null) {
        diagonal = candidate;
        break;
      }
    }
  }

  let alignment = {
    score: 0,
    refStart: 0,
    refEnd: 0,
    queryStart: 0,
    queryEnd: 0,
    alignedRef: '',
    alignedQuery: ''
  };
  if (diagonal !== null) {
    const margin = Math.max(32, Math.ceil(query.length * 0.15));
    windowStart = clamp(diagonal - margin, 0, reference.length);
    windowEnd = clamp(diagonal + query.length + margin, 0, reference.length);
    if (windowEnd <= windowStart) {
      windowStart = 0;
      windowEnd = reference.length;
    }
    alignment = gotohLocalAlign(reference.slice(windowStart, windowEnd), query);
  }

  const windowCells = (windowEnd - windowStart + 1) * (query.length + 1);
  const fullCells = (reference.length + 1) * (query.length + 1);
  const shouldTryFull =
    alignment.score <= 0
      ? fullCells <= 12_000_000
      : windowCells < 300_000 && reference.length * query.length < 4_000_000;
  if (shouldTryFull) {
    const fullAlignment = gotohLocalAlign(reference, query);
    if (fullAlignment.score > alignment.score) {
      alignment = fullAlignment;
      windowStart = 0;
    }
  }

  if (alignment.score <= 0) {
    return {
      ...trace,
      alignment: {
        refStart: 0,
        refEnd: 0,
        strand: 1,
        identityPercent: 0,
        alignedRef: '',
        alignedQuery: '',
        mismatches: []
      }
    };
  }

  let matchCount = 0;
  for (let index = 0; index < alignment.alignedRef.length; index += 1) {
    const refChar = alignment.alignedRef[index];
    const queryChar = alignment.alignedQuery[index];
    if (refChar !== '-' && queryChar !== '-' && refChar === queryChar) matchCount += 1;
  }
  const identityPercent =
    alignment.alignedRef.length > 0
      ? Math.round((matchCount / alignment.alignedRef.length) * 100000) / 1000
      : 0;

  const mismatches = alignmentMismatches(
    alignment.alignedRef,
    alignment.alignedQuery,
    windowStart + alignment.refStart,
    trimStart + alignment.queryStart,
    circular,
    sequenceLength,
    trace
  );
  addImpacts(mismatches, trace, doc);

  const referenceBasesConsumed = alignment.refEnd - alignment.refStart;
  const absoluteRefStart = windowStart + alignment.refStart;
  const absoluteRefEnd = absoluteRefStart + referenceBasesConsumed;
  const refStart = circular ? modulo(absoluteRefStart, sequenceLength) : absoluteRefStart;
  const refEnd = circular ? modulo(absoluteRefEnd, sequenceLength) : absoluteRefEnd;

  return {
    ...trace,
    alignment: {
      refStart,
      refEnd,
      strand: 1,
      identityPercent,
      alignedRef: alignment.alignedRef,
      alignedQuery: alignment.alignedQuery,
      mismatches
    }
  };
}
```

### BYOK 密钥读取 — `loadAIConfig`

```typescript
// src/modules/ai-copilot/index.ts:1611
export function loadAIConfig(): AIConfig | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;

    let raw = storage.getItem(AI_CONFIG_STORAGE_KEY);
    if (!raw) {
      const legacyRaw = storage.getItem(LEGACY_AI_CONFIG_STORAGE_KEY);
      if (legacyRaw) {
        raw = legacyRaw;
        try {
          storage.setItem(AI_CONFIG_STORAGE_KEY, legacyRaw);
        } catch {
          // Reading the legacy entry still succeeds even if migration fails.
        }
        try {
          storage.removeItem(LEGACY_AI_CONFIG_STORAGE_KEY);
        } catch {
          // Leaving the legacy entry behind is harmless; it is ignored once the new key exists.
        }
      }
    }
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (!isProviderType(parsed.provider)) return null;
    if (typeof parsed.apiKey !== 'string' || parsed.apiKey.trim().length === 0) return null;
    if (typeof parsed.baseUrl !== 'string' || !isHttpUrl(parsed.baseUrl.trim())) return null;
    if (typeof parsed.model !== 'string' || parsed.model.trim().length === 0) return null;

    const config: AIConfig = {
      provider: parsed.provider,
      apiKey: parsed.apiKey.trim(),
      baseUrl: parsed.baseUrl.trim(),
      model: parsed.model.trim(),
    };

    if (typeof parsed.temperature === 'number' && Number.isFinite(parsed.temperature)) {
      config.temperature = parsed.temperature;
    }

    return config;
  } catch {
    return null;
  }
}
```

### BYOK 密钥保存 — `saveAIConfig`

```typescript
// src/modules/ai-copilot/index.ts:1659
export function saveAIConfig(config: AIConfig): void {
  if (!config || !isProviderType(config.provider)) {
    throw new Error('Invalid AI provider.');
  }
  if (typeof config.apiKey !== 'string' || config.apiKey.trim().length === 0) {
    throw new Error('API key is required.');
  }
  if (typeof config.baseUrl !== 'string' || !isHttpUrl(config.baseUrl.trim())) {
    throw new Error('Base URL must be a valid HTTP(S) URL.');
  }
  if (typeof config.model !== 'string' || config.model.trim().length === 0) {
    throw new Error('Model name is required.');
  }
  if (
    config.temperature !== undefined &&
    (!Number.isFinite(config.temperature) || config.temperature < 0 || config.temperature > 2)
  ) {
    throw new Error('Temperature must be between 0 and 2.');
  }

  const normalized: AIConfig = {
    provider: config.provider,
    apiKey: config.apiKey.trim(),
    baseUrl: config.baseUrl.trim(),
    model: config.model.trim(),
  };
  if (config.temperature !== undefined) normalized.temperature = config.temperature;

  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    storage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Storage can be unavailable in private browsing or non-browser runtimes.
  }
}
```

### AI 动作 Schema 与坐标边界校验 — `validateAction`

```typescript
// src/modules/ai-copilot/index.ts:895
export function validateAction(
  action: unknown,
  doc: PlasmidDocument,
): { ok: true; action: AIToolAction }
```

### 浏览器直连流式请求 — `streamChat`

```typescript
// src/modules/ai-copilot/index.ts:1557
export async function streamChat(
  config: AIConfig,
  messages: AIChatMessage[],
  onToken: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (!config || !isProviderType(config.provider)) {
    throw new Error('A valid AI provider configuration is required.');
  }
  if (typeof config.apiKey !== 'string' || config.apiKey.trim().length === 0) {
    throw new Error('An API key is required.');
  }
  if (signal?.aborted) throw createAbortError();

  const prepared = prepareRequest(config, messages, signal);
  let content = '';

  const emit = (delta: string): void => {
    if (!delta) return;
    content += delta;
    onToken(delta);
  };

  let response: Response;
  try {
    response = await globalThis.fetch(prepared.url, prepared.init);
  } catch (error) {
    if (signal?.aborted) throw createAbortError();
    throw new Error(redactSecrets(`Failed to reach the AI provider: ${errorMessage(error)}`, config.apiKey));
  }

  if (response.ok === false || (typeof response.status === 'number' && response.status >= 400)) {
    let detail = '';
    try {
      detail = truncateText(await response.text(), 800);
    } catch {
      detail = '';
    }
    const suffix = detail ? ` - ${detail}` : '';
    throw new Error(
      redactSecrets(`AI request failed with HTTP ${response.status}${suffix}`, config.apiKey),
    );
  }

  try {
    await consumeStream(response, prepared.mode, emit, signal);
  } catch (error) {
    if (signal?.aborted) throw createAbortError();
    throw new Error(redactSecrets(errorMessage(error), config.apiKey));
  }

  return content;
}
```

## 6. 集成层：Worker 池与 AI 动作执行

```typescript
// Promise-based client for the bio Web Worker pool, with an in-thread
// fallback for environments without Worker support (Node/vitest, old browsers).
import { bioApi, type BioApi, type BioFn, type BioRequest, type BioResponse } from './bio-api';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

const POOL_SIZE =
  typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? Math.min(4, Math.max(1, navigator.hardwareConcurrency - 1))
    : 2;

let workers: Worker[] | null = null;
let nextWorker = 0;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorkers(): Worker[] | null {
  if (typeof Worker === 'undefined') return null;
  if (workers) return workers;
  try {
    workers = Array.from({ length: POOL_SIZE }, () => {
      const w = new Worker(new URL('./bio.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<BioResponse>) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.ok) p.resolve(e.data.result);
        else p.reject(new Error(e.data.error));
      };
      return w;
    });
  } catch {
    workers = null;
  }
  return workers;
}

export function callBioSync<K extends BioFn>(fn: K, ...args: Parameters<BioApi[K]>): ReturnType<BioApi[K]> {
  return (bioApi[fn] as (...a: unknown[]) => ReturnType<BioApi[K]>)(...args);
}

export function callBio<K extends BioFn>(
  fn: K,
  ...args: Parameters<BioApi[K]>
): Promise<Awaited<ReturnType<BioApi[K]>>> {
  const pool = getWorkers();
  if (!pool) {
    return Promise.resolve().then(() => callBioSync(fn, ...args) as unknown) as Promise<Awaited<ReturnType<BioApi[K]>>>;
  }
  const id = nextId++;
  const worker = pool[nextWorker++ % pool.length];
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    const msg: BioRequest = { id, fn, args };
    worker.postMessage(msg);
  });
}

```

```typescript
// src/app/actions.ts:139
export async function applyAIAction(action: AIToolAction): Promise<void> {
  const st = useWorkbench.getState();
  const doc = selectActiveDoc(st);
  if (!doc) return;
  switch (action.type) {
    case 'HIGHLIGHT_RANGE': {
      const { start, end, reason } = action.payload;
      st.setSelection({ start, end });
      st.setHighlight({ start, end, reason });
      st.notify(`高亮 ${start + 1}–${end}：${reason}`);
      return;
    }
    case 'ADD_FEATURES': {
      const features: SequenceFeature[] = action.payload.features.map((f) => ({ ...f, id: uid('f') }));
      st.replaceDoc({
        ...doc,
        features: [...doc.features, ...features],
        updatedAt: new Date().toISOString(),
        history: [...doc.history, historyNode('manual_edit', `AI 添加 ${features.length} 个特征`)],
      });
      st.notify(`已添加特征：${features.map((f) => f.name).join(', ')}`);
      return;
    }
    case 'RUN_DIGESTION': {
      await digestToGel(doc, action.payload.enzymeNames);
      st.setView('gel');
      return;
    }
    case 'DESIGN_PRIMERS': {
      const p = action.payload;
      if (p.cloningMethod === 'mutagenesis' && p.mutationSeq) {
        const r = await callBio('designMutagenesisPrimers', doc, { start: p.targetStart, end: p.targetEnd, newBases: p.mutationSeq }, COMMERCIAL_ENZYMES);
        st.replaceDoc(addPrimersToDoc(doc, [r.forward, r.reverse], 'AI 定点突变引物'));
        st.notify(`已设计突变引物 ${r.forward.name} / ${r.reverse.name}${r.warnings.length ? '；' + r.warnings.join('；') : ''}`);
        return;
      }
      const r = await callBio('designPrimerPair', doc, { start: p.targetStart, end: p.targetEnd }, { forwardTail: p.forwardTail, reverseTail: p.reverseTail });
      st.replaceDoc(addPrimersToDoc(doc, [r.forward, r.reverse], `AI ${p.cloningMethod} 引物`));
      st.setSelection({ start: p.targetStart, end: p.targetEnd });
      st.notify(`引物 Tm ${r.forward.tmAnnealing.toFixed(1)} / ${r.reverse.tmAnnealing.toFixed(1)} °C，产物 ${r.productLength} bp`);
      return;
    }
    case 'SIMULATE_CLONING': {
      st.setWizard(methodToWizard[action.payload.method] ?? 'restriction');
      return;
    }
  }
}
```
