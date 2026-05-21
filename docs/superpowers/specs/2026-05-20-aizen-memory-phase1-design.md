# aizen-memory Phase 1 — 设计规格

> **版本:** 1.0
> **日期:** 2026-05-20
> **范围:** 独立记忆系统 CLI 工具

---

## 1. 产品目标

产出一个可通过 CLI 独立使用的本地语义记忆系统。开发者可以对任意文本内容建立向量索引，通过自然语言检索，并直接编辑和迁移存储文件。

## 2. 架构

```
src/memory/
├── block.ts       # MemoryBlock 类型 + schema 校验
├── store.ts       # BlockStore（文件读写、脏检测）
├── embedder.ts    # Embedder 接口 + OllamaEmbedder
├── retriever.ts   # Retriever（搜索、多源合并）
└── cli.ts         # CLI 入口

scripts/
└── import-adr.ts  # 一次性：把 ADR.md 切块入库
```

## 3. 数据结构

### MemoryBlock

```typescript
interface MemoryBlock {
  blockId: string;       // 26 字符 ULID，如 "01J4XK7N8P9Q2R3S4T5V6W7X8"
  type: "conversation" | "document" | "ai_insight" | "external";
  createdAt: number;     // Unix ms
  source: {
    channel?: string;
    user?: string;
    filename?: string;
    section?: string;
  };
  content: string;       // 纯文本全文
  relations: {
    prevId: string | null;
    nextId: string | null;
    related: string[];
  };
  summary: {
    self: string;
    prev: string | null;
    next: string | null;
  };
  weight: {
    boosts: Array<{ at: number; sessionForkId: string }>;
    negativeMarks: number;
  };
  embedding?: number[];  // float32[768]，可选
  deprecated: boolean;
  supersededBy: string | null;
  meta: Record<string, unknown>;
}
```

**存储格式：** 每块一个 JSON 文件，文件名 `{blockId}.json`。文件中不存 `blockId`（文件名即是 ID），不存 `embedding`（在 `.vec` 中）。

### SearchResult

```typescript
interface SearchResult {
  blockId: string;
  score: number;     // 0..1
  summary: string;
  content: string;
  source: string;    // memoryDir 路径
}
```

## 4. 模块规格

### 4.1 Block (`block.ts`)

**职责：** 类型定义 + 输入校验。

**对外接口：**

```typescript
function createBlock(input: {
  type: string;
  content: string;
  source?: Record<string, string>;
  relations?: { prevId?: string; nextId?: string; related?: string[] };
  meta?: Record<string, unknown>;
}): MemoryBlock

function validateBlock(block: unknown): MemoryBlock
```

**行为承诺：**
- `createBlock` 自动生成 ULID、`createdAt`、默认字段
- `validateBlock` 对不合法字段抛出 Zod 错误（含字段路径和原因）
- `blockId` 校验：26 字符 ULID
- `type` 校验：必须为 `conversation | document | ai_insight | external`
- `content` 校验：非空字符串

---

### 4.2 Store (`store.ts`)

**职责：** 块的持久化读写、向量文件的脏检测与管理。

**目录结构：**

```
<memoryDir>/
├── blocks/
│   ├── 01J4XK7N8P9Q.json
│   ├── 01J4XK7N8P9R.json
│   └── ...
├── blocks.vec     ← 768×N 字节，每行 3072 字节，行对齐
└── blocks.hash    ← SHA256("fileName:mtime,...")
```

**对外接口：**

```typescript
class BlockStore {
  constructor(memoryDir: string);

  // 目录存在性检查
  ensureDir(): void;

  // 写入
  append(block: MemoryBlock, embedding: Float32Array): Promise<void>;
  writeVec(embeddings: Map<string, Float32Array | null>): Promise<void>;

  // 读取
  getBlock(blockId: string): MemoryBlock | null;
  getAllBlocks(): MemoryBlock[];
  listBlockIds(): string[];
  loadVectors(): Float32Array;          // [blockCount × 768]
  getVectorIndex(blockId: string): number;  // 文件排序后该 blockId 的行号

  // 脏检测
  needsRebuild(): boolean;
  updateHash(): void;

  // 统计
  stats(): { blockCount: number; indexedCount: number; vecSizeBytes: number };
}
```

**行为承诺：**

写入：
- `append` → 写 JSON 文件到 `blocks/` → 按 ULID 排序插入 `.vec` 对应行 → 更新 `.hash`
- 目标 `memoryDir` 不存在 → 自动创建完整目录结构
- `.vec` 中未生成 embedding 的块 → 对应行全零填充

读取：
- `getBlock` → 读 `blocks/{blockId}.json` → 解析为 MemoryBlock → 不存在返回 null
- `getAllBlocks` → 遍历 `blocks/*.json` → 按文件名排序返回
- `loadVectors` → 读 `blocks.vec` → `Float32Array`。文件不存在则返回长度 0
- `getVectorIndex` → 按文件名排序找到 blockId 的位置 → 返回行号

脏检测：
- `needsRebuild` → 计算当前文件名+mtime 的 SHA256 → 与 `blocks.hash` 比较
- 第一次使用（无 `.hash` 文件）→ 返回 true
- `updateHash` → 重新计算 SHA256 → 写入 `blocks.hash`

统计：
- `stats` → 计数 JSON 文件、计数 embedding 不为全零的行、`.vec` 文件大小

---

### 4.3 Embedder (`embedder.ts`)

**职责：** 文本到向量的编码。接口抽象，Phase 1 硬编码 Ollama 实现。

**对外接口：**

```typescript
interface Embedder {
  readonly dimensions: number;
  embed(text: string): Promise<Float32Array>;
}

class OllamaEmbedder implements Embedder {
  constructor(baseUrl?: string, model?: string);
  dimensions: 768;
  embed(text: string): Promise<Float32Array>;
}
```

**行为承诺：**
- `embed("文本")` → `POST {baseUrl}/api/embeddings` → 返回已归一化的 `Float32Array[768]`
- 连接失败 → throw `"Ollama 服务不可用 ({baseUrl})"`
- text 为空 → throw `"embed 文本不能为空"`
- HTTP 错误（非 200）→ throw `"Embedding API 错误: {status} {body}"`

**接口留口：** 所有依赖 `Embedder` 的模块只依赖接口，不依赖 `OllamaEmbedder` 具体类。

---

### 4.4 Retriever (`retriever.ts`)

**职责：** 接收查询文本，从多个记忆目录中检索最相关的块。

**对外接口：**

```typescript
class Retriever {
  constructor(embedder: Embedder);

  async search(query: string, memoryDirs: string[], k?: number): Promise<SearchResult[]>;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number;
```

**行为承诺：**
- `search("查询文本", [".aizen/project", ".aizen/personal"], 3)`
  1. `embed(query)` → query_vec
  2. 遍历 memoryDirs：
     - 创建 BlockStore → `needsRebuild()` 检测 → 若需要则 `rebuild`
     - `loadVectors()` → 对每个非零行计算 `cosineSimilarity(query_vec, row)`
  3. 合并所有 store 的结果
  4. 按 score 降序 → 取前 k 条
  5. 每条 lookup block → 返回 SearchResult（含 source 标注来自哪个 memoryDir）
- `query` 为空 → throw
- `memoryDirs` 为空 → throw
- 所有 memoryDir 都没有块 → 返回空数组

**评分公式：**

```
score = cosine_similarity(query_vec, block_row)
```

Phase 1 不使用 boost_factor 和 negative_decay——这些依赖 agent 反馈闭环。

---

### 4.5 CLI (`cli.ts`)

**职责：** 命令解析、参数校验、调用对应模块、格式化输出。

**命令列表：**

```
aizen-memory add    ← block.ts + store.ts + embedder.ts
aizen-memory get    ← store.ts
aizen-memory search ← retriever.ts
aizen-memory stats  ← store.ts
aizen-memory rebuild ← embedder.ts + store.ts
```

#### 4.5.1 `add`

```bash
npx tsx src/memory/cli.ts add \
  --content "<文本>" \
  --type document \
  [--source-filename <name>] \
  [--source-section <name>] \
  --memory-dir <path>
```

**行为：**
1. 校验 `--content` 非空、`--type` 合法、`--memory-dir` 存在
2. `createBlock(...)` → `embedder.embed(content)` → `store.append(block, vec)`
3. 输出：`已创建: {blockId}`

#### 4.5.2 `get`

```bash
npx tsx src/memory/cli.ts get <blockId> --memory-dir <path>
```

**行为：**
1. `store.getBlock(blockId)` → 不存在则输出 `块不存在: {blockId}`（exit 1）
2. 存在 → 格式化输出：

```
blockId:    mem_01J4XK7N8P9Q2R3S4T5V6W7X8
type:       document
source:     { filename: "manual" }
createdAt:  2026-05-20T15:30:00Z
summary:    ADR-015: 使用 xxx 替代 yyy

content:
ADR-015: 新决策 — 使用 xxx 替代 yyy
...
```

#### 4.5.3 `search`

```bash
npx tsx src/memory/cli.ts search "<query>" \
  --memory-dir <path> [--memory-dir <path> ...] \
  [-k <N>]
```

**行为：**
1. `--memory-dir` 未指定 → 输出错误并退出：

```
错误: 请至少指定一个 --memory-dir
用法: aizen-memory search <query> --memory-dir <path> [--memory-dir <path> ...]
```

2. query 为空 → 报错退出
3. `--memory-dir` 路径不存在 → 报错退出
4. 正常 → 输出（纯文本，不输出 JSON）：

```
[.aizen/project/] 0.892  ADR-007 Channel 架构 — Tool-as-Channel-Driver
[.aizen/project/] 0.723  ADR-001 核心语言与运行时
```

5. 无结果 → `未找到相关记忆`

#### 4.5.4 `stats`

```bash
npx tsx src/memory/cli.ts stats --memory-dir <path> [--memory-dir <path> ...]
```

**行为：**
1. `--memory-dir` 未指定 → 报错退出（同 search）
2. 正常 → 输出：

```
.aizen/project/
  记忆块:   12
  已索引:   12
  向量文件: 36 KB
```

#### 4.5.5 `rebuild`

```bash
npx tsx src/memory/cli.ts rebuild --memory-dir <path>
```

**行为：**
1. 遍历 `blocks/*.json` → 每块重新 `embed(content)` → 重写 `blocks.vec`
2. 更新 `blocks.hash`
3. 输出：

```
重建中 ... 12/12
完成。.aizen/project/blocks.vec 已更新
```

---

## 5. 临时脚本 (`scripts/import-adr.ts`)

```bash
npx tsx scripts/import-adr.ts <markdown-file> --target <memory-dir>
```

**行为：**
1. 按 `^## ADR-` 切分 Markdown 文件为多个 section
2. 每个 section：
   - type: `"document"`
   - content: section 的原始 Markdown
   - source: `{ filename, section }`
   - summary.self: section 第一段非标点内容
   - relations.prevId / nextId: 按文档出现顺序链接
3. 逐块调 `embedder.embed()` → `store.append()`
4. 输出进度：`录入 ADR-001: 核心语言与运行时 → 已保存`

---

## 6. 测试规格

### 6.1 Store 测试 (`store.test.ts`)

| 测试 | 验证点 |
|------|--------|
| `append` 写 JSON + vec | 文件存在，行号对齐 |
| `getBlock` 存在/不存在 | 返回 block / null |
| `getAllBlocks` | 按文件名排序，数量正确 |
| `loadVectors` | 维度正确，行数 = 块数 |
| `needsRebuild` 初次 | 无 `.hash` → true |
| `needsRebuild` 未改动 | 写入 + updateHash → false |
| `needsRebuild` 新增文件 | 原有 hash 不过新文件 → true |
| `stats` | blockCount / indexedCount 正确 |

### 6.2 Embedder 测试 (`embedder.test.ts`)

| 测试 | 验证点 |
|------|--------|
| mock HTTP 正常返回 | Float32Array[768] 归一化 |
| 空文本 | throw |
| 连接失败 | throw "Ollama 服务不可用" |
| HTTP 非 200 | throw "Embedding API 错误" |

### 6.3 Retriever 测试 (`retriever.test.ts`)

基础测试：
- 构造 3 个 block，手工设 embedding，验证余弦相似度排序正确

多源合并测试：
- 两个 memoryDir 各有 block，验证结果合并且来源标注正确

**复杂真实检索测试（用真实 ADR 索引）：**

前提：`scripts/import-adr.ts docs/ADR.md --target <testDir>` 跑通后。

| # | 查询 | 断言 |
|---|------|------|
| ① | `"channel 架构"` | Top-1 = ADR-007，score > 0.7 |
| ② | `"用什么语言写的 为什么不用 Python"` | Top-1 = ADR-001 |
| ③ | `"多平台可执行文件 构建 发布"` | Top-1 = ADR-003，ADR-005 也在 Top-3 |
| ④ | `"session 生命周期 并发 消息队列"` | Top-1 = ADR-008 |
| ⑤ | `"fork 遍历 知识图谱"` | Top-1 = ADR-009d |
| ⑥ | `"记忆怎么存 向量 文件格式"` | Top-1 = ADR-009b |

---

## 7. 不在此范围

- 去重（ADR-013 — Phase 2）
- 动态权重 boost/decay（ADR-009e — Phase 2）
- fork 遍历（ADR-009d — 依赖 Pi SDK）
- 异质数据源入库（ADR-009f — Phase 2）
- `aizen-memory promote` 命令（需要 agent 交互闭环）
- Bun compile 二进制发布（开发期 tsx）
