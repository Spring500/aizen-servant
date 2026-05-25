# 暂未完成 / 需返工

> 记录当前代码中已实现但质量差、或仅有设计文档但有桩代码、或完全未开始的功能。
> 每项标注严重程度：🔴 阻塞性 | 🟡 功能缺失 | 🟢 格式问题

---

## 🔴 知识图谱（relations）未实现

**现状：** `relations.prevId`/`nextId` 仅在 `scripts/import-adr.ts` 按 ADR 文档出现顺序机械串链，`related` 永远为空。`retriever.ts` 完全未读取 relations，只做纯向量搜索。

**ADR 对应：** ADR-009d Fork 图遍历

**缺失：**
- fork 遍历引擎（沿 relations 探索图谱）
- 跨类型引用（document ↔ conversation ↔ ai_insight）
- LLM 驱动的图探索决策

---

## 🔴 摘要系统（summary）未实现

**现状：** `summary.self` 是 ADR 标题去掉 `##` 前缀的纯字符串截取（`import-adr.ts:95`），无任何 LLM 参与。`summary.prev`/`summary.next` 从未被赋值，始终为 null。

**ADR 对应：** ADR-009e 生命周期

**缺失：**
- LLM 异步生成摘要（agent_end 后抽取 Q&A）
- 上下文锚点回填（新块创建时自动更新前驱块的 summary.next）
- 摘要的检索利用（当前仅用于 CLI 展示，未参与搜索评分）

**已在 2026-05-25 移除 summary 字段。**

---

## 🔴 动态权重未实现

**现状：** `weight.boosts` 始终为空数组，`weight.negativeMarks` 始终为 0。`retriever.ts` 只算余弦相似度，未乘任何权重系数。

**ADR 对应：** ADR-009e 动态增强 / 动态衰减

**缺失：**
- fork 遍历中 pick 块的 boost 记录
- 时间衰减计算（`boost_factor` 函数）
- `memory_mark` tool 注册与执行
- negativeMarks 的指数衰减应用
- 检索评分公式完整实现

---

## 🟡 异质数据源未实现

**现状：** 所有 21 个记忆块均为 `type: "document"`。`conversation`、`ai_insight`、`external` 三种类型有 schema 定义但从未创建。

**ADR 对应：** ADR-009f

**缺失：**
- agent_end 自动创建 conversation 块
- 定时 AI 提炼生成 ai_insight 块
- 外部数据（API/网页）提取入库
- 文件监听自动导入

---

## 🟡 去重第二阶段未实现

**现状：** 仅有 SHA-256 内容哈希去重（阶段一）。高相似度语义归并（阶段二）未做。

**ADR 对应：** ADR-013

**缺失：**
- 余弦相似度 > 0.95 触发阈值
- LLM 语义归并 prompt
- deprecated + supersededBy 标记逻辑
- 旧块 relation 转移

---

## 🟡 Agent 引擎未开始

**现状：** `src/index.ts` 为占位文件，仅导出 VERSION。以下模块全部未建：
- AgentEngine（session 管理、消息队列）
- Channel 适配器（Discord、Telegram、HTTP）
- 定时调度器
- system prompt 设计

**ADR 对应：** ADR-007、ADR-008

---

## 🟡 Session 策略模式未实现

**现状：** ADR-008 要求 session 模型为可替换策略（strategy pattern），但接口和实现均未动工。

---

## 🟢 已删除字段残留

**summary 和 relations 已在 2026-05-25 移除。** 以下文件仍有残留引用（已修复）：
- ~~`block.ts` schema~~
- ~~`retriever.ts` SearchResult~~
- ~~`cli.ts` 展示~~
- ~~`import-adr.ts` 构建逻辑~~
- ~~所有测试文件~~
