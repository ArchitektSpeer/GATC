GATC：一个开源的分子克隆工作台

GATC（Gene Assembly & Toolkit for Cloning，GPL-3.0）是一个纯前端的分子生物学
工作台：质粒图谱、序列编辑、酶切与克隆模拟、引物设计、Sanger 与多序列比对、
虚拟电泳。打开网页即可使用，无需账号；序列解析与全部计算都在浏览器内完成，
首次加载后可离线运行。

· 可直接读写 SnapGene 的 .dna 文件，并读取 GenBank、ApE、Vector NTI、
  Benchling、FASTA、EMBL、GFF、SBOL 等格式；支持按 NCBI 登录号与坐标区间获取。
· 580 余种市售酶、3000 余条酶库记录，跨原点扫描、甲基化阻断判定、双酶切
  缓冲液推荐。
· 克隆模拟覆盖酶切连接、Gibson、Golden Gate、Gateway、TA/TOPO、LIC、
  Cre-lox 与 Flp-FRT 重组、PCR 与融合 PCR、定点突变。
· 引物按 SantaLucia 1998 + Owczarzy 2008 计算；构建历史可导出 OpenCloning
  LinkML 策略与可运行的 pydna 脚本，脚本自带断言，跑一遍即是验证。
· 近期加入多步克隆方案的沙盒推演、测序异常归因，以及 WebAssembly 比对内核。

与 Biopython、REBASE、primer3、pydna 的交叉验证逐项列在 CROSSCHECK 文档中
（例如 .dna 导入导出各 15/15 一致、切点 5592/5592 一致、304 条引物 Tm 与
primer3 最大偏差 0.00 °C），未覆盖的范围同样列明。

下一步计划把更多生物信息学开源工具整合进同一平台，并通过 MCP 统一对外暴露，
供 Agent 直接调用；项目现有的 MCP 服务器已提供 15 个工具。

在线使用：https://architektspeer.github.io/GATC/
源码（GPL-3.0）：https://github.com/ArchitektSpeer/GATC
交叉验证明细：https://github.com/ArchitektSpeer/GATC/blob/main/docs/CROSSCHECK.md
MCP 服务器：https://github.com/ArchitektSpeer/GATC/blob/main/docs/MCP.md

注：SnapGene 为 Dotmatics 的商标，本项目为独立实现，与其无关联。
