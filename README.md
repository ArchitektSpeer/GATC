# GATC

**G**ene **A**ssembly & **T**oolkit for **C**loning：名字既是 DNA 的四种碱基，也是这个工具要做的事。

GATC 是开源、离线优先的分子生物学工作台：质粒图谱、序列编辑、酶切/克隆模拟、引物设计、Sanger 比对、虚拟电泳与 BYOK AI 实验导师。一套代码同时构建纯静态 Web/PWA 与 Tauri 桌面客户端。

## 快速开始

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # 生产构建 → dist/（可直接部署到 GitHub Pages）
npm run tauri:dev    # 桌面客户端（需 Rust 与系统 WebView）
npm run tauri:build
```

打开后自动加载 NCBI 真实序列 **pUC19 (L09137)** 与 **pEGFP-N1 (U55762)**，以及一条覆盖 EGFP 的模拟 Sanger 读长。可直接拖入 `.dna / .prot / .gb / .ape / .fasta / .embl / .gff / .ab1 / .fastq` 等文件，或点击「NCBI」按登录号导入。

快捷键：`Ctrl/Cmd+K` 命令面板（支持「酶切 EcoRI BamHI」直接跑胶）、`Ctrl/Cmd+F` 查找、`Ctrl/Cmd+Z` 撤销、`Ctrl/Cmd+Shift+Z` 重做、`Ctrl/Cmd+O` 打开文件。

## 功能

| 领域 | 能力 |
|---|---|
| 文件 | 读写 SnapGene `.dna`（含引物、甲基化、构建历史树、多段特征）；读取 GenBank / ApE / Vector NTI / Benchling、FASTA、EMBL、GFF、DNASTAR `.seq`、Serial Cloner `.xdna`、Geneious、SBOL；蛋白文件 `.prot` / GenPept / 蛋白 FASTA；FASTQ 读长；按登录号从 NCBI 导入；导出 GenBank（join 多段特征、ApE 颜色）/ FASTA / JSON；图谱导出 SVG、300 dpi PNG、矢量 PDF，图谱与序列可直接打印 |
| 视图 | 环形与线性图谱（多轨道特征、防碰撞引线、多段特征、ORF、GC 曲线、可配置显示选项）、虚拟滚动双链序列（酶切阶梯切口、引物、CDS 翻译）、蛋白序列视图（按理化性质着色、分子量/pI）、酶列表、特征/引物/ORF、虚拟电泳、Sanger 峰图与覆盖度、多序列比对、可重放的克隆历史树；浅色/深色/出版白底主题 |
| 编辑 | 碱基级编辑、特征与引物的手动添加/编辑/删除（均可撤销）、ORF 一键转为 CDS、自动注释、反向互补、重设原点、环状/线性切换 |
| 查找 | IUPAC 简并模式、允许错配、双链与跨零点命中、6 框蛋白模式查找；引物库在所有打开序列中查找结合位点（允许错配，3′ 端需完全匹配） |
| 酶 | 580+ 种市售酶、3000+ 酶数据库（含同裂酶/异裂酶查询），预设酶集与自定义酶集，跨零点扫描，Dam/Dcm/CpG 甲基化阻断判定，双酶切 NEB 缓冲液推荐与星号活性提示 |
| 注释 | 300+ 常用元件的本地自动注释（DNA 精确/容错匹配，CDS 元件可按蛋白翻译匹配），6 框 ORF + 分子量/等电点 |
| 克隆 | 单/双酶切连接（同尾酶、补平/削平、去磷酸化）、插入片段、Gibson / NEBuilder HiFi / In-Fusion、Golden Gate（保真度评分、内部位点预警）、Gateway BP/LR/MultiSite LR、TA / GC / TOPO（TA、平端、定向）、LIC、Cre/Lox 与 Flp/FRT 重组（切除、倒位、整合）、PCR、融合 PCR、定点突变（QuikChange / Q5 背靠背 + 静默酶切位点推荐） |
| 引物 | SantaLucia 1998 最邻近 + Owczarzy 2008 Mg²⁺/dNTP 盐校正（46 条参考引物 Tm 误差 < 0.01 °C），SantaLucia & Hicks 2004 动态规划发夹/二聚体 ΔG（平均误差 0.3–0.5 kcal/mol），酶切位点 + 保护碱基 / 同源臂引物设计，跨会话保存的引物库（批量导入） |
| 比对 | Sanger `.ab1`（Mott 修剪、杂合双峰、跨零点比对、氨基酸影响注释、多读长一致性与覆盖度）、FASTQ 读长比对、多序列比对（引导树 + 渐进式 profile 比对，DNA/蛋白 BLOSUM62）、双序列全局/局部/半全局比对 |
| 蛋白 | 反向翻译与 8 种宿主密码子优化（可避开指定酶切位点）、CAI 计算 |
| 电泳 | 36 种商业 Ladder、0.5–3% 胶浓度、电压与时间、超螺旋/开环/线性构象、按质量计算亮度 |
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
npm run crosscheck                    # 与 Biopython / REBASE / primer3 / pydna 交叉验证（需 Python 3）
```

交叉验证使用 SnapGene 自身生成的真实 `.dna` 文件，结果与发现并修复的问题见 [docs/CROSSCHECK.md](docs/CROSSCHECK.md)。

## 许可

Copyright (C) 2026 Qiu Shui

本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证（GPL）第 3 版，或（按你的选择）任何更新的版本，重新发布和/或修改它。本程序的发布是希望它有用，但**不提供任何担保**。完整条款见 [LICENSE](LICENSE)。

SPDX-License-Identifier: `GPL-3.0-or-later`

## 致谢与第三方资料

- 解析与序列工具：[TeselaGen tg-oss](https://github.com/TeselaGen/tg-oss)（MIT）、[SeqViz](https://github.com/Lattice-Automation/seqviz)（MIT）。
- SnapGene `.dna` 二进制格式的公开描述参考了 [SnapGeneReader](https://github.com/Edinburgh-Genome-Foundry/SnapGeneReader)（MIT）、[autosnapgene](https://github.com/kalekundert/autosnapgene)（MIT）、[snapgene-deepreader](https://github.com/karlYei/snapgene-deepreader)（MIT）与 Biopython `SnapGeneIO`（Biopython License）。
- 热力学模型依据 SantaLucia (1998)、SantaLucia & Hicks (2004)、Owczarzy et al. (2004, 2008) 实现；`test-data/primer3-reference.json` 为 [Primer3](https://github.com/primer3-org/primer3)（GPL-2.0）的输出数值，用于精度回归。
- 示例序列来自 NCBI GenBank：L09137 (pUC19)、U55762 (pEGFP-N1)。
