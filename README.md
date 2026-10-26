# OpenSnapGene

开源、离线优先的分子生物学工作台：质粒图谱、序列编辑、酶切/克隆模拟、引物设计、Sanger 比对、虚拟电泳与 BYOK AI 实验导师。一套代码同时构建纯静态 Web/PWA 与 Tauri 桌面客户端。

## 快速开始

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # 生产构建 → dist/（可直接部署到 GitHub Pages）
npm run tauri:dev    # 桌面客户端（需 Rust 与系统 WebView）
npm run tauri:build
```

打开后自动加载 NCBI 真实序列 **pUC19 (L09137)** 与 **pEGFP-N1 (U55762)**，以及一条覆盖 EGFP 的模拟 Sanger 读长。可直接拖入 `.dna / .gb / .gbk / .fasta / .embl / .gff / .ab1` 文件。

快捷键：`Ctrl/Cmd+K` 命令面板（支持「酶切 EcoRI BamHI」直接跑胶）、`Ctrl/Cmd+Z` 撤销、`Ctrl/Cmd+Shift+Z` 重做、`Ctrl/Cmd+O` 打开文件。

## 功能

| 领域 | 能力 |
|---|---|
| 文件 | SnapGene `.dna`（含引物、甲基化、构建历史树）、GenBank、FASTA、EMBL、GFF、Geneious 读取；GenBank（保留 ApE 颜色）/ FASTA / JSON 导出；图谱 SVG 与 300 dpi PNG 出版级导出 |
| 视图 | 环形图谱（多轨道特征、防碰撞引线、拖拽选区）、虚拟滚动双链序列（酶切阶梯切口、引物、CDS 翻译）、酶列表、特征/引物/ORF、虚拟电泳、Sanger 峰图、克隆历史树；浅色/深色/出版白底主题 |
| 酶 | 82 种商业酶（含 7 种 Type IIS），跨零点扫描，Dam/Dcm/CpG 甲基化阻断判定，按单切点/NEB Buffer/甲基化过滤 |
| 注释 | Aho-Corasick 本地自动注释（48+ 常见元件，100 kb < 15 ms），6 框 ORF + 分子量/等电点 |
| 克隆 | 单/双酶切连接（同尾酶、补平/削平、去磷酸化）、Gibson / In-Fusion、Golden Gate（保真度评分、内部位点预警）、Gateway BP/LR、PCR、融合 PCR、定点突变（QuikChange / Q5 背靠背 + 静默酶切位点推荐） |
| 引物 | SantaLucia 1998 最邻近 + Owczarzy 2008 Mg²⁺/dNTP 盐校正（46 条参考引物 Tm 误差 < 0.01 °C），SantaLucia & Hicks 2004 动态规划发夹/二聚体 ΔG（平均误差 0.3–0.5 kcal/mol），酶切位点 + 保护碱基 / Gibson 同源臂 |
| 测序 | `.ab1` 解析、Mott 修剪、杂合双峰检测、种子 + Gotoh 跨零点比对、CDS 内突变的氨基酸影响注释 |
| 电泳 | 5 种商业 Ladder、0.5–3% 胶浓度、超螺旋/开环/线性构象、按质量计算亮度 |
| AI | BYOK：OpenAI / Anthropic / DeepSeek / Gemini / 自定义兼容端点；密钥仅存于浏览器本地；质粒上下文压缩；一键执行的结构化动作卡片（设计引物、酶切跑胶、高亮、添加特征、启动克隆向导） |

## 架构

```
src/
├── types/schema.ts          全局唯一数据契约
├── modules/                 6 个互不引用的独立模块（只依赖 schema 与开源库）
│   ├── io-adapter/          @teselagen/bio-parsers + SnapGene TLV 增强解析
│   ├── seq-engine/          酶切 / ORF / 编辑坐标联动 / 自动注释
│   ├── cloning-primer/      热力学与全部克隆模拟
│   ├── alignment-gel/       ABIF 解析、比对、虚拟电泳
│   ├── canvas-ui/           纯受控可视化组件
│   └── ai-copilot/          BYOK 适配器与侧边栏
└── app/                     集成层：zustand+zundo 状态总线、Web Worker 池、工作台
```

计算密集函数通过 `src/app/bio.worker.ts` 在 Web Worker 池中执行，主线程不被阻塞。

## 验证

```bash
npm run typecheck                     # tsc --noEmit
npm run test                          # vitest：单元 + 跨模块集成 + 真实文件
npm run build && npx vite preview &   # 然后：
node scripts/e2e.mjs e2e-report       # Playwright 浏览器功能评测，输出截图与 report.json
node scripts/make-audit-bundle.mjs    # 生成 AUDIT_BUNDLE.md 供外部审计
```

## 许可

MIT

## 致谢与第三方资料

- 解析与序列工具：[TeselaGen tg-oss](https://github.com/TeselaGen/tg-oss)（MIT）、[SeqViz](https://github.com/Lattice-Automation/seqviz)（MIT）。
- SnapGene `.dna` 二进制格式的公开描述参考了 [SnapGeneReader](https://github.com/Edinburgh-Genome-Foundry/SnapGeneReader)（MIT）、[autosnapgene](https://github.com/kalekundert/autosnapgene)（MIT）、[snapgene-deepreader](https://github.com/karlYei/snapgene-deepreader)（MIT）与 Biopython `SnapGeneIO`（Biopython License）。
- 热力学模型依据已发表文献独立实现：SantaLucia (1998)、SantaLucia & Hicks (2004)、Owczarzy et al. (2004, 2008)。`test-data/primer3-reference.json` 仅包含 Primer3 的输出数值，用于精度回归测试，不含任何 Primer3 代码。
- 示例序列来自 NCBI GenBank：L09137 (pUC19)、U55762 (pEGFP-N1)。
