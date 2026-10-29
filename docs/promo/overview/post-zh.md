GATC：一个开源的分子克隆工作台

GATC（Gene Assembly & Toolkit for Cloning）是一个以 GPL-3.0 发布的分子生物学
工作台，覆盖质粒图谱、序列编辑、酶切与克隆模拟、引物设计、Sanger 与多序列
比对、虚拟电泳。它是纯前端实现：打开网页即可使用，无需账号，序列解析与全部
计算都在浏览器内完成，不存在可上传数据的服务器；首次加载后可离线运行，也可
安装为桌面应用。

一、文件与数据来源

可直接读写 SnapGene 的 .dna 文件（含引物、甲基化设定、构建历史树与多段特征），
并可读取 GenBank、ApE、Vector NTI、Benchling、FASTA、EMBL、GFF、DNASTAR .seq、
Serial Cloner .xdna、Geneious、SBOL，以及蛋白文件与 FASTQ 读长。支持按登录号
从 NCBI 获取序列，也可只取指定坐标区间（例如某基因及其上下游 1 kb），不必下载
整条染色体。另内置 32 个常用载体的 GenBank 记录供离线取用，以及按登录号收录的
105 个 SEVA 标准载体。

二、酶切与克隆

酶库含 580 余种市售酶与 3000 余条酶数据库记录（含同裂酶查询），支持跨原点扫描、
Dam/Dcm/CpG 甲基化阻断判定、双酶切的 NEB 缓冲液推荐与星号活性提示。克隆模拟
覆盖单双酶切连接、插入片段、Gibson / NEBuilder HiFi / In-Fusion、Golden Gate
（含接头保真度评分与内部位点预警）、Gateway BP/LR/MultiSite LR、TA / GC / TOPO、
LIC、Cre-lox 与 Flp-FRT 重组、PCR 与融合 PCR、定点突变（QuikChange 与 Q5 背靠背，
并给出静默酶切位点建议）。

引物计算采用 SantaLucia 1998 最邻近模型与 Owczarzy 2008 的 Mg²⁺/dNTP 盐校正；
发夹与二聚体 ΔG 用 SantaLucia & Hicks 2004 的动态规划。

三、合成生物学与基因组工程

内置 Patron 等 2015 年提出的植物通用语法（12 个接头，直接取自论文图表）与酵母
工具箱 YTK 元件类型，可校验元件实际切出的接头、检查所选位置能否首尾相接并环化，
并支持 N×M 组合装配。CRISPR 部分实现 SpCas9、SaCas9、Cas12a 三种核酸酶的靶点
扫描，切点按各自原始文献计算（文献给出范围者标明为近似）；脱靶检查明确声明
仅在已打开的序列中进行，不是全基因组搜索。同源重组可自两翼取同源臂，生成带臂
的供体扩增引物、重组后的位点序列，以及落在同源臂之外的鉴定引物与两种产物大小。

四、可复现性与互通

构建历史可导出为 OpenCloning 的 LinkML 克隆策略（schema 0.4.8）并能读回，也可
导出为可运行的 pydna 脚本；脚本会从亲本重建每个产物并与软件记录的序列断言比对，
因此"跑一遍"本身就是验证。pydna 无法表达的步骤按记录序列给出并标注 TODO，不生成
看似可运行而结果错误的代码。此外可一键导出实验记录（构建体、特征、引物、按
聚合酶分列的 PCR 程序、按酶活性数据推荐缓冲液的酶切体系、电泳泳道与构建谱系），
输出 Markdown 或可直接打印的网页。

五、与独立实现的交叉验证

`npm run crosscheck` 会在 SnapGene 自己写出的真实文件上，与 Biopython、REBASE、
primer3、pydna 逐项比对。摘录：.dna 的导入与导出各 15/15 文件一致；酶定义
699/699 与 REBASE 一致；切点 5592/5592 一致；304 条寡核苷酸的 Tm 与 primer3
最大偏差 0.00 °C；酶切片段 164/164、PCR 产物 105/105、Gateway BP 12/12、
LR 14/14、Cre-lox 8/8 与 pydna 一致。文档同时列明未覆盖的范围，例如电泳迁移
模型只做自洽性检验而未与实测胶比对，Sanger 碱基识别与多序列比对仅有单元测试，
MultiSite Gateway 未作比对。验证脚本随仓库发布，可自行复跑。

六、近期加入

· 多步克隆方案的沙盒推演：把一条路线写成有向无环图（12 种操作），每步调用与
  对应向导相同的引擎逐步计算，确认后才写入工作区。
· 测序异常归因：只依据 Phred 与高质量区、引物在分子上的足迹、连接边界三类
  可核对的证据作判断；证据不足者标注为"未能归因"，不作推测。
· 比对内核改用 WebAssembly（3.6 kB，随应用打包、可离线），本机实测约为原
  JavaScript 实现的 3.5 倍；保留等价 JavaScript 实现作回退，并有测试要求两者
  逐格一致。

七、下一步

计划把更多生物信息学开源工具整合进同一平台，并通过 Model Context Protocol
(MCP) 统一对外暴露，使 Agent 与其他工具链可以直接调用。项目现有的 MCP 服务器
已提供 15 个工具（序列文件读写、酶切位点、引物设计、PCR / Gibson / Golden Gate
模拟、ORF 查找、特征注释、Sanger 比对等），以本地进程经 stdio 通信，不向外
发送数据。

界面提供简体中文与 English 两种语言。桌面端目前仅发布 Linux 的 AppImage、deb
与 rpm；Windows 与 macOS 使用同一套源码，可自行构建，但尚无预编译产物。

在线使用：https://architektspeer.github.io/GATC/
源码（GPL-3.0）：https://github.com/ArchitektSpeer/GATC
桌面端下载：https://github.com/ArchitektSpeer/GATC/releases
交叉验证明细：https://github.com/ArchitektSpeer/GATC/blob/main/docs/CROSSCHECK.md
文件兼容性：https://github.com/ArchitektSpeer/GATC/blob/main/docs/COMPATIBILITY.md
MCP 服务器：https://github.com/ArchitektSpeer/GATC/blob/main/docs/MCP.md

注：SnapGene 为 Dotmatics 的商标，本项目为独立实现，与其无关联。
