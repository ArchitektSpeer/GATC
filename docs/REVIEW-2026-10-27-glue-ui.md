# 胶水层与 UI 代码审查（GPT-6.1-Sol）

- 日期：2026-10-27
- 审查模型：gpt-6.1-sol（Codex CLI `codex exec`，reasoning effort high，只读沙箱）
- 范围：`src/app/`、`src/main.tsx`、`src/types/schema.ts`、`src-tauri/src/`、`src-tauri/capabilities/`；不含 `src/modules/**` 与第三方依赖
- 审查提示词：见文末附录

> 核实与修复结论见下方“核实与处理”。原始报告保留原文，未作修改。

## 核实与处理

逐条对照代码核实，**23 项全部成立**，已全部修复，并为每项补了回归测试（`src/app/review-fixes.test.ts`、`src/app/autosave.test.ts`、`src/app/bio-client.test.ts`、`src-tauri/src/autosave.rs`）。

| # | 级别 | 结论 | 处理 | 回归测试 |
|---|---|---|---|---|
| 1 | P0 | 成立 | 序列编辑改为同步执行，并校验编辑所依据的版本；版本已变时拒绝并提示，不再把旧坐标套到新序列上。重设原点同样绑定来源版本（`App.tsx` `onEdit`、`transform`） | 无独立单测（`App.tsx` 组件逻辑）；所用的版本判断 `isDocCurrent` 由 `revision.test.ts` 覆盖 |
| 2 | P0 | 成立 | 新增 `addTraces` 与 `unsavedTraces`：导入 AB1/FASTQ 计入未保存，参与关闭提醒和自动保存；重新比对不算修改 | `#2` |
| 3 | P0 | 成立 | 新增 `saveFile`：有保存对话框（File System Access API）时写入成功才算“已确认”；只能下载时记为“未确认”，本次会话内继续保留恢复快照，“保存并关闭”也不再自动关闭。正常关闭时同步写入结束标记，下次启动静默清理 | `#3`；`session-check.mjs` |
| 4 | P0 | 成立 | 提取 `recoverRecord`：新快照写入成功后才删除旧恢复记录，否则保留并提示 | `#4` |
| 5 | P0 | 成立 | 桌面端改为每个会话一组文件 `autosave-<session>.json`（含各自备份），新会话不会覆盖未处理的恢复数据；会话 id 校验防路径穿越 | `autosave.rs` 3 项；`TauriSnapshotStore` 测试 |
| 6 | P0 | 成立 | 新增 `ranges.ts` 统一换算 1-based/0-based：环状序列上终点小于起点表示跨原点区间，终点=起点−1 表示空区间 | `#6 #18` |
| 7 | P0 | 成立 | 向导和引物库的结果记录来源文档版本；版本变化后隐藏“添加”并提示重新计算，写回经 `replaceIfCurrent` 再次校验 | 无独立单测（组件状态）；写回所用的 `isDocCurrent` 由 `revision.test.ts` 覆盖 |
| 8 | P0 | 成立 | 载体、插入来源、酶或这些文档本身变化时，清空已有片段与结果，必须重新酶切 | 无独立单测（组件状态），浏览器测试覆盖酶切连接流程 |
| 9 | P0 | 成立 | 演示的写回改为 `replaceIfCurrent`，文档已被修改时停止演示，不覆盖用户编辑 | 无独立单测，同 #7 |
| 10 | P0 | 成立 | 侧边栏按文档区分（`key={doc.id}`）；`applyAIAction` 要求目标文档 id，应用前校验坐标为整数、在范围内、线性不跨原点，校验特征类型与链方向 | `#10 #12` |
| 11 | P0 | 成立 | 手工引物保留 IUPAC 简并碱基，其他字符明确报错（已确认热力学计算对简并碱基返回有限值） | 手工核对 |
| 12 | P0 | 成立 | `mutationSeq: ''` 按删除进入突变设计；缺少该字段时拒绝 | `#10 #12` |
| 13 | P1 | 成立 | 切点缓存同时记录文档版本与酶集键，切换酶集后立即失效，旧请求结果不写入 | `#13` |
| 14 | P1 | 成立 | 查找只在对话框打开时运行 | 手工核对 |
| 15 | P1 | 成立 | 新增 `remapDocIds`：打开项目与恢复时，id 冲突的文档连同历史父节点引用一起重映射 | `#15` |
| 16 | P1 | 成立 | 文档列表变化后若活动文档已不存在，改为仍打开的文档 | `#16` |
| 17 | P1 | 成立 | 恢复候选必须能完整解析项目，否则继续尝试下一个备份（桌面）或忽略（Web） | `TauriSnapshotStore` 测试 |
| 18 | P1 | 成立 | 突变预览与提交使用同一换算，跨原点时拼接尾段与首段 | `#6 #18` |
| 19 | P1 | 成立 | 结果保存计算时的蛋白、宿主与策略；输入变化后提示结果已过期，打开时使用结果自身的参数 | 手工核对 |
| 20 | P1 | 成立 | 清空注释时删除 `note`，保留其他限定字段 | `#20` |
| 21 | P1 | 成立 | Worker `onerror`/`onmessageerror` 拒绝所有进行中的任务，停用线程池并改为线程内计算 | `bio-client.test.ts` |
| 22 | P2 | 成立 | FASTQ 解析移入 Worker（`fastqToTraces`），主线程只接收前 200 条 | `#22` |
| 23 | P2 | 部分修复 | Inspector 的整条序列 GC 改为按序列缓存；根组件订阅整个 store 的结构未重构，留作后续性能工作 | — |

待确认两项：

- **断电落盘**：已在重命名后同步父目录（Windows 上无此操作）；未做故障注入验证。
- **Tauri 能力**：当前为 `core:default` 加 `core:window:allow-destroy`。是否进一步收窄需要展开权限清单逐项核对，未改动。

修复过程中发现的问题：把 FASTQ 解析移入 Worker 后，Worker 连带加载的 `@teselagen/bio-parsers` 引用了 Worker 中不存在的 `global`，导致 Worker 加载即失败。浏览器走查捕获了这一问题，#21 的修复使它表现为明确的错误而不是任务挂起。现已在 Worker 入口加 `global` 垫片（`src/app/worker-globals.ts`）。

验证（2026-10-27）：`npm run typecheck` 通过；`npm test` 434/434；`npm run build` 通过；`cargo test` 3/3；`node scripts/e2e.mjs` 26/26；`npm run check:session` 10/10（连续 3 次）。

---

## 原始报告

已完成限定范围内的只读静态审查，包含 `src/app/` 下的测试源码；未修改文件，未运行构建、测试或其他会写文件的命令。`src/modules/**` 仅查阅调用接口，不报告其内部问题。

以下共 **23 项确定问题**。

### P0：数据丢失、静默改变序列或错误科学结果

**1. 编辑队列保留旧坐标，却把操作应用到最新序列。**

- 位置：[App.tsx:220](../src/app/App.tsx#L220)、[actions.ts:89](../src/app/actions.ts#L89)、[actions.ts:102](../src/app/actions.ts#L102)
- 触发场景：在 Worker 返回前，对仍显示的 `ACGT` 先删除 `[0,1)`，再将原序列 `[2,3)` 的 G 替换为 A → 第二个操作实际作用于更新后的 T，得到 `CGA`，而非按原选择意图得到的 `CAT`。修订冲突后的重试也会重复使用旧坐标。
- 修复建议：编辑事件携带基础修订；坐标操作遇到修订变化时拒绝或显式重定位。也可先同步更新编辑模型，再异步计算派生数据。

**2. 测序数据导入不计入未保存状态，关闭时可能无提醒且无恢复快照。**

- 位置：[App.tsx:182](../src/app/App.tsx#L182)、[App.tsx:191](../src/app/App.tsx#L191)、[store.ts:344](../src/app/store.ts#L344)、[autosave.ts:243](../src/app/autosave.ts#L243)
- 触发场景：打开已保存的质粒，导入 AB1/FASTQ，但不修改序列文档 → `docs` 对象不变，`dirtyIds` 为空；自动保存走删除分支，关闭标签或窗口也不提示，导入的 reads 丢失。
- 修复建议：为原始测序数据建立独立的保存基线或工作区修订；关闭提醒和自动保存应覆盖所有需要持久化的数据。

**3. 发起下载即标记保存成功，下载取消或失败后仍可能删除恢复数据。**

- 位置：[files.ts:44](../src/app/files.ts#L44)、[App.tsx:259](../src/app/App.tsx#L259)、[session.tsx:228](../src/app/session.tsx#L228)
- 触发场景：保存项目后取消浏览器保存对话框，或下载写入失败 → `markSaved` 已执行；随后自动保存可能清除快照，关闭也不再提示。网页的“保存项目并关闭”还会立即关闭文档。
- 修复建议：使用能确认写入完成的保存接口，成功后记录实际写入版本；无法确认下载结果时，不应据此清除唯一恢复副本或自动关闭。

**4. 恢复后的快照写入失败，仍删除原恢复记录。**

- 位置：[session.tsx:167](../src/app/session.tsx#L167)、[autosave.ts:247](../src/app/autosave.ts#L247)
- 触发场景：点击恢复，当前存储配额不足，`flushAutosave()` 返回 `false` → 调用方忽略结果，继续删除旧 session 的记录；再次崩溃后，恢复源已不存在。
- 修复建议：只有新快照确认持久化成功后才删除旧记录；失败时保留恢复入口并报告未完成迁移。

**5. 桌面自动保存会覆盖尚未处理的上次恢复记录。**

- 位置：[autosave.ts:147](../src/app/autosave.ts#L147)、[autosave.rs:49](../src-tauri/src/autosave.rs#L49)、[autosave.rs:36](../src-tauri/src/autosave.rs#L36)
- 触发场景：启动后暂不处理恢复横幅，先编辑其他文档 → 新 session 覆盖同一个 `autosave.json`；若尚未到备份轮换时间，旧 session 最新内容不会进入新备份，再次退出后无法通过恢复入口找回。
- 修复建议：按 session 保存独立文件，或在开始当前 session 写入前，将未处理的旧快照归档到独立、不会被轮换覆盖的位置。

**6. 跨原点替换被强制转换为纯插入。**

- 位置：[CloningWizard.tsx:1044](../src/app/CloningWizard.tsx#L1044)
- 触发场景：1000 bp 环状载体选择界面区间 `901–100` → 应传入 `[900,100)`；`Math.max(900,100)` 却把它改成 `[900,900)`，保留本应删除的 200 bp，并额外插入片段。
- 修复建议：保留环状序列的 `start > end`；仅将“终点＝起点−1”解释为空区间，分别校验线性和环状范围。

**7. 引物计算结果没有绑定来源修订，之后可被加入已变化的模板。**

- 位置：[CloningWizard.tsx:202](../src/app/CloningWizard.tsx#L202)、[CloningWizard.tsx:208](../src/app/CloningWizard.tsx#L208)、[CloningWizard.tsx:699](../src/app/CloningWizard.tsx#L699)、[CloningWizard.tsx:889](../src/app/CloningWizard.tsx#L889)、[library.tsx:159](../src/app/library.tsx#L159)
- 触发场景：引物库搜索完成后关闭对话框，在模板前端插入碱基，再打开对话框点击旧结果“添加到序列” → 代码取得最新文档，却沿用旧结合坐标和 Tm。向导中的设计结果在撤销或模板变化后也没有失效检查。
- 修复建议：结果保存来源文档 ID、修订和计算参数；应用时重新验证，过期结果必须重算。

**8. 酶切向导更换来源或酶后，仍可连接旧片段并标注为新来源。**

- 位置：[CloningWizard.tsx:396](../src/app/CloningWizard.tsx#L396)、[CloningWizard.tsx:404](../src/app/CloningWizard.tsx#L404)、[CloningWizard.tsx:413](../src/app/CloningWizard.tsx#L413)
- 触发场景：先酶切载体 A，再把载体选择改成 B，直接点击连接 → 实际使用缓存的 A 片段，产物却命名为 `B::插入来源`；自连判断也使用新的选择。
- 修复建议：为片段记录来源修订和酶参数；这些输入改变时清空片段并禁用连接，直到重新酶切。

**9. 演示模式的异步结果可以覆盖计算期间的新编辑。**

- 位置：[demo.tsx:109](../src/app/demo.tsx#L109)、[demo.tsx:112](../src/app/demo.tsx#L112)、[demo.tsx:159](../src/app/demo.tsx#L159)
- 触发场景：演示设计引物期间，用户修改或撤销同一文档 → 返回后直接用旧 `doc` 调用 `replaceDoc`，恢复旧序列、特征及历史，覆盖新编辑；退出演示也不会取消该回写。
- 修复建议：演示修改同样走带修订检查的更新入口，并为退出演示设置取消令牌；演示素材应按专用 ID 定位。

**10. AI 动作应用入口既不绑定目标文档，也不重新校验坐标。**

- 位置：[actions.ts:185](../src/app/actions.ts#L185)、[actions.ts:191](../src/app/actions.ts#L191)、[actions.ts:198](../src/app/actions.ts#L198)、[schema.ts:229](../src/types/schema.ts#L229)
- 触发场景：针对文档 A 生成的特征动作，在活动文档变为较短的 B 后交给 `applyAIAction` → 动作直接写入 B，允许产生越界特征；入口没有目标 ID 或基础修订可供核对。
- 修复建议：动作外层携带目标 ID、基础修订；应用前针对目标当前版本验证有限整数、范围、拓扑及跨原点语义，拒绝身份或修订不符的动作。

**11. 手工添加引物会静默删除简并碱基后保存。**

- 位置：[editors.tsx:187](../src/app/editors.tsx#L187)、[editors.tsx:199](../src/app/editors.tsx#L199)
- 触发场景：输入 `NNNNACGTACGTACGTACGT`，模板含后面的 16 nt → 实际保存为 `ACGTACGTACGTACGT`，四个 N 被删除，长度、尾巴和热力学计算均针对另一条寡核苷酸。
- 修复建议：保留支持的 IUPAC 字符；不支持的字符应明确报错，不能静默删除后继续保存。

**12. AI 删除突变会退化为普通引物设计。**

- 位置：[actions.ts:215](../src/app/actions.ts#L215)、[actions.ts:222](../src/app/actions.ts#L222)
- 触发场景：应用 `cloningMethod: 'mutagenesis'`、`mutationSeq: ''` 的删除突变动作 → 空字符串条件为假，走普通 `designPrimerPair`，得到不执行预期删除的引物。
- 修复建议：按 `cloningMethod` 分支；区分“缺少 mutationSeq”和“空字符串表示删除”，允许后者进入突变设计。

### P1：逻辑偏差

**13. 切点缓存缺少酶集版本，切换酶集后仍展示旧集合结果。**

- 位置：[store.ts:285](../src/app/store.ts#L285)、[store.ts:361](../src/app/store.ts#L361)、[App.tsx:129](../src/app/App.tsx#L129)
- 触发场景：扫描 EcoRI 酶集后切换到 BamHI 酶集 → 文档修订未变，旧 EcoRI 切点仍被视为有效，直到新扫描完成；新扫描失败时会一直保留。
- 修复建议：缓存键同时包含文档修订和酶集版本；输入变化时立即使旧缓存失效。

**14. 查找对话框关闭后仍会后台搜索并覆盖当前选区。**

- 位置：[tools.tsx:24](../src/app/tools.tsx#L24)、[tools.tsx:36](../src/app/tools.tsx#L36)、[tools.tsx:43](../src/app/tools.tsx#L43)
- 触发场景：搜索某模式后关闭查找，再编辑序列或切换文档 → effect 继续运行，并把选区跳回首个命中，干扰后续编辑。
- 修复建议：effect 依赖 `open`，关闭时停止搜索及选区写入，并清理未完成任务。

**15. 项目 ID 冲突处理没有同步重映射历史中的父文档引用。**

- 位置：[files.ts:55](../src/app/files.ts#L55)、[history.tsx:55](../src/app/history.tsx#L55)
- 触发场景：同一项目打开两次 → 第二批文档获得新 ID，但 `history.parentSnapshots[].id` 保留旧 ID；重放第二批文档历史时优先匹配第一批文档，可能使用后来已修改的错误来源。
- 修复建议：先建立完整 ID 映射，再重写文档间引用，包括历史父节点，而不仅是 traces 和活动文档。

**16. 撤销打开文档后，活动 ID 可能指向不存在的文档。**

- 位置：[store.ts:336](../src/app/store.ts#L336)、[store.ts:354](../src/app/store.ts#L354)
- 触发场景：已有 A，打开并激活 B，再撤销打开 → `docs` 恢复为只有 A，`activeId` 仍为 B；主区显示加载占位，已有文档无法立即操作。
- 修复建议：每次文档集合变化后维护活动 ID 有效性；撤销移除活动文档时选择仍存在的文档。

**17. 桌面备份回退只验证外层记录，不验证其中的项目是否可恢复。**

- 位置：[autosave.ts:31](../src/app/autosave.ts#L31)、[autosave.ts:134](../src/app/autosave.ts#L134)、[autosave.ts:282](../src/app/autosave.ts#L282)
- 触发场景：当前记录的外层 JSON 正常，但 `project` 字符串损坏，备份槽中存在完整项目 → `read()` 接受当前记录并停止回退；点击恢复反复报错，完整备份不会被尝试。
- 修复建议：选取恢复候选时验证完整元数据和项目可解析性；失败后继续尝试后续备份槽。

**18. 跨原点突变的原序列预览错误显示为“插入”。**

- 位置：[CloningWizard.tsx:667](../src/app/CloningWizard.tsx#L667)、[CloningWizard.tsx:683](../src/app/CloningWizard.tsx#L683)
- 触发场景：环状序列选择 `901–100` → 预览使用线性 `slice` 并把终点抬到起点，显示空串和“插入”，无法核对真正将被替换的跨原点序列。
- 修复建议：预览与提交使用同一套范围解释函数，跨原点时拼接尾段和首段。

**19. 反向翻译结果没有绑定输入，打开时可记录错误的宿主和策略。**

- 位置：[tools.tsx:144](../src/app/tools.tsx#L144)、[tools.tsx:186](../src/app/tools.tsx#L186)
- 触发场景：按宿主 A 生成结果后，修改蛋白、宿主或策略但不重新运行，点击“作为新序列打开” → 打开旧 DNA，描述却使用新的宿主和策略。
- 修复建议：结果保存计算时的输入参数；输入变化后使结果失效，或始终使用结果自身的参数显示和保存。

**20. 编辑特征时无法清空已有注释。**

- 位置：[editors.tsx:95](../src/app/editors.tsx#L95)
- 触发场景：删除注释框中的全部文字并保存 → 空字符串分支返回原 `feature.notes`，旧注释完整保留。
- 修复建议：清空时删除 `notes.note`，同时保留其他注释键。

**21. Worker 加载或运行失败后，请求及文档编辑队列可能永久挂起。**

- 位置：[bio-client.ts:25](../src/app/bio-client.ts#L25)、[bio-client.ts:79](../src/app/bio-client.ts#L79)、[actions.ts:102](../src/app/actions.ts#L102)
- 触发场景：Worker 构造成功，但脚本加载失败或发生致命运行错误 → 没有 `onerror`/`onmessageerror` 拒绝 pending；对应编辑 Promise 不结束，后续同文档编辑一直排队。
- 修复建议：跟踪每个 Worker 的请求，错误时统一拒绝并清理、重建 Worker；设置超时并向用户报告失败。

### P2：性能与体验

**22. FASTQ 的 200 条限制发生在全文件解析之后，不能限制主线程开销。**

- 位置：[App.tsx:189](../src/app/App.tsx#L189)、[App.tsx:190](../src/app/App.tsx#L190)
- 触发场景：导入包含大量 reads 的 FASTQ → 先读取并同步解析全部内容，之后才截取 200 条；界面可能长时间卡顿，并占用远超展示需求的内存。
- 修复建议：采用流式或 Worker 解析，在解析阶段限制展示读取量；需要全量处理时提供进度和取消能力。

**23. 根组件订阅整个 store，使选区拖动反复扫描完整序列计算 GC。**

- 位置：[App.tsx:90](../src/app/App.tsx#L90)、[panels.tsx:349](../src/app/panels.tsx#L349)
- 触发场景：打开长序列并连续拖动选区 → 每次选区更新都会重渲染 App 和 Inspector，再次对完整序列计算 GC，增加拖动延迟。
- 修复建议：拆分 store 订阅；完整序列统计按 `doc.sequence` 缓存，避免随选区、toast 等无关状态重复计算。

### 待确认

- **断电后的落盘保证**：[autosave.rs:55](../src-tauri/src/autosave.rs#L55)、[autosave.rs:63](../src-tauri/src/autosave.rs#L63) 只同步临时文件，重命名后未同步父目录。进程崩溃与突然断电的保证不同，需要在目标文件系统上做故障注入验证，暂不计为确定的数据丢失问题。
- **Tauri 能力是否最小化**：[default.json:9](../src-tauri/capabilities/default.json#L9) 使用 `core:default` 聚合权限。需对照当前依赖版本展开后的权限清单，才能判断其中哪些超出实际调用；本次范围内没有该展开清单，因此不直接认定存在权限漏洞。

项目和自动保存调用处未发现把 `AIConfig`、API Key 或整个 localStorage 直接传入项目序列化的问题；序列化模块内部不在审查范围。

**数量汇总：P0 12 项，P1 9 项，P2 2 项，共 23 项；待确认 2 项，不计入总数。**
---

## 附录：审查提示词

> 你是资深代码审查员。对本仓库（GATC，GPL-3.0 分子克隆工作台，React + zustand + Vite + Tauri 2）做一次只读的全量代码审查。不要修改任何文件，不要运行会写文件的命令。
> 
> ## 审查范围（只看这些）
> - `src/app/` 下全部 .ts / .tsx（组装层：状态 store.ts、Worker 客户端 bio-client.ts / bio-api.ts / bio.worker.ts、actions.ts、revision.ts、autosave.ts、files.ts、session.tsx、App.tsx、CloningWizard.tsx、panels.tsx、tools.tsx、editors.tsx、history.tsx、library.tsx、demo.tsx、ui.tsx、samples/*.ts）
> - `src/main.tsx`、`src/types/schema.ts`
> - `src-tauri/src/*.rs`、`src-tauri/capabilities/`
> 
> ## 不在范围内
> - `src/modules/**`（其他工具生成的科学计算与可视化模块），只在需要理解调用约定时查阅其导出签名，不报告其内部问题
> - `node_modules/`、`src-tauri/target/`、`dist/`、`src/app/samples/*.gb` 等数据文件、`.prompts/`、`AUDIT_BUNDLE.md`
> 
> ## 重点
> 1. 数据丢失与静默改变序列：编辑竞态、异步结果覆盖新编辑（见 revision.ts / updateDoc / callBioForDoc）、撤销/重做后派生数据（切点、测序比对）是否一致、关闭标签与窗口的提醒。
> 2. 自动保存与崩溃恢复（autosave.ts、session.tsx、src-tauri/src/autosave.rs）：原子写入、备份轮换、恢复时是否可能覆盖用户当前修改、多标签页、写入失败是否可见、IndexedDB 事务处理。
> 3. 项目文件（files.ts 及其调用）：API Key 等密钥不得写入；打开项目时的 id 冲突。
> 4. 坐标约定：内部 0-based 左闭右开，界面 1-based 闭区间；跨原点区间（start > end）；UI 与胶水层里的换算是否一致。
> 5. AI 动作应用（actions.ts applyAIAction）：坐标范围、文档 ID 校验。
> 6. React 正确性：effect 依赖、过期闭包、内存泄漏、主线程阻塞、不必要的重复渲染。
> 7. Tauri 能力配置是否最小化。
> 
> ## 输出格式
> 用中文。按 P0（数据丢失、错误科学结果、安全）、P1（逻辑偏差）、P2（性能与体验）分级。每条必须包含：
> - 位置：`文件:行号`（必须是你实际读过的行）
> - 问题：一句话
> - 触发场景：具体输入或操作 → 错误结果
> - 修复建议
> 只报告你有把握、能在代码中定位的问题；不确定的放在末尾“待确认”小节并说明原因。不要报告纯风格问题。最后给出各级数量汇总。
