
### 额外接口约定
- 所有解析出的 `PlasmidDocument` 必须字段齐全：`id`（随机唯一）、`sequence` 大写、`length === sequence.length`、`createdAt/updatedAt` ISO 字符串、`features`/`primers`/`history` 至少为空数组，`history` 至少含一个 `operation: 'import'` 节点；未指定时 `methylationProfile = { dam: true, dcm: true, cpg: false }`。
- 特征颜色缺失时按类型给出默认 Hex 颜色。
- 单元测试需在测试内构造 GenBank 文本（含跨零点 `join(...)` 特征）与 FASTA 文本进行往返（parse → export → parse）一致性校验；`.dna` 测试可在测试内用 `DataView` 构造最小合法 SnapGene 二进制（cookie 包 0x09 + DNA 包 0x00）。
