# aizen-memory Phase 1 — 设计规格

> **范围:** 独立记忆系统 CLI，Phase 1 仅通过 tsx 运行

---

## 1. 前置条件

Node.js ≥ 20，pnpm，Ollama 已安装且 `nomic-embed-text` 已 pull。

---

## 2. 命令与行为

### 2.1 `add` — 创建记忆块

```bash
npx tsx src/memory/cli.ts add \
  --content "<文本>" \
  --type document \
  --memory-dir .aizen/project/
```

- 自动生成 26 字符 ULID 作为 blockId
- 写入 `<memoryDir>/blocks/{blockId}.json`
- 计算 embedding → 写入 `<memoryDir>/blocks.vec` → 更新 `<memoryDir>/blocks.hash`
- 输出：`已创建: {blockId}`

`--content` 为空或缺失 → 报错退出。
`--type` 不为 `conversation | document | ai_insight | external` → 报错退出。
`--memory-dir` 路径不存在 → 自动创建完整目录结构。

### 2.2 `get` — 按 ID 查看记忆块

```bash
npx tsx src/memory/cli.ts get <blockId> --memory-dir .aizen/project/
```

输出：
```
类型:       document
来源:       { filename: "manual" }
创建时间:   2026-05-20T15:30:00Z
摘要:       ADR-015: 使用 xxx 替代 yyy

ADR-015: 新决策 — 使用 xxx 替代 yyy
...
```

blockId 不存在 → `块不存在: {blockId}`，exit 1。
`--memory-dir` 不存在 → `目录不存在: {path}`，exit 1。

### 2.3 `search` — 语义检索

```bash
npx tsx src/memory/cli.ts search "<query>" \
  --memory-dir .aizen/project/ \
  --memory-dir .aizen/personal/
```

- 对每个 `--memory-dir`：加载 `.vec` → embedding(query) → 余弦相似度 → Top-K 合并
- 输出（纯文本）：
```
[.aizen/project/] 0.892  ADR-007 Channel 架构 — Tool-as-Channel-Driver
[.aizen/personal/] 0.845  关于 auth 模块的个人笔记
[.aizen/project/] 0.723  ADR-001 核心语言与运行时
```

不指定 `--memory-dir` → 报错退出，提示用法。
query 为空 → `搜索内容不能为空`，exit 1。
所有 memory-dir 都没有块 → `未找到相关记忆`。
memory-dir 不存在 → `目录不存在: {path}`，exit 1。

### 2.4 `stats` — 记忆库状态

```bash
npx tsx src/memory/cli.ts stats --memory-dir .aizen/project/
```

输出：
```
记忆块:   12
已索引:   12
向量文件: 36 KB
```

不指定 `--memory-dir` → 报错退出，提示用法。
memory-dir 不存在 → `目录不存在: {path}`，exit 1。

### 2.5 `rebuild` — 重建向量索引

```bash
npx tsx src/memory/cli.ts rebuild --memory-dir .aizen/project/
```

- 读取所有 `blocks/*.json` → 逐块重新 `embed(content)` → 重写 `blocks.vec`
- 更新 `blocks.hash`
- 不修改任何 JSON 文件，不改变任何 blockId

输出：
```
重建中 ... 12/12
完成
```

---

## 3. 存储约定

```
.aizen/project/
├── blocks/
│   ├── 01J4XK7N8P9Q.json    ← 每块一个文件，文件名 = blockId
│   ├── 01J4XK7N8P9R.json    ← content 在这，embedding 不在这
│   └── ...
├── blocks.vec               ← {dimensions}×N 字节，语义搜索用
└── blocks.hash              ← SHA256("文件名:mtime,...")，脏检测用
```

- **`.vec` 行对齐：** 文件名（ULID）字典排序 → 第 i 个文件 = `.vec` 第 i 行
- **脏检测：** 每次加载 `.vec` 前对比 `blocks.hash`，不一致则需 rebuild
- **embedding 维度：** 768（nomic-embed-text）

---

## 4. 临时脚本

```bash
npx tsx scripts/import-adr.ts docs/ADR.md --target .aizen/project/
```

- 按 `## ADR-` 切分 Markdown → 每个 section 作为一个 `type: "document"` 块 add 到目标目录
- 一次性脚本，以后不再使用
- 输出进度：`录入 ADR-001 → 已保存` ...

---

## 5. 不在此范围

去重、动态权重、fork 遍历、异质数据源、Bun compile 二进制发布、Pi agent 集成。
