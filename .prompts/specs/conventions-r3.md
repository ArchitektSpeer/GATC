
## 跨模块约定（模块间不能 import，靠约定对齐）
- **多段特征**（GenBank `join(...)` / SnapGene 多 Segment）：
  - `SequenceFeature.notes.segments = ["s-e", "s-e", ...]`，每段为 0-based 左闭右开的文档坐标字符串（如 `"10-200"`），按生物学顺序排列；负链特征按 5'→3' 顺序。
  - 该特征的 `start`/`end` 为第一段起点到最后一段终点的整体覆盖区间（环状跨零点同样适用）。
  - 没有 `segments` 的特征视为单段。
- **蛋白文档**（schema 中没有，由各模块用相同结构各自声明，不得 import 彼此）：
```ts
export interface ProteinFeature { id: string; name: string; type: string; start: number; end: number; color: string; notes?: Record<string, string[]> } // 氨基酸坐标，0-based 左闭右开
export interface ProteinDocument { id: string; name: string; sequence: string; description?: string; features: ProteinFeature[]; createdAt: string; updatedAt: string }
```
- **FASTQ / 测序读长**：
```ts
export interface SequencingRead { id: string; name: string; sequence: string; qualities: number[] } // Phred
```
