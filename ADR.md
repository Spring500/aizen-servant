# Architecture Decision Records

> AizenServant — 7x24 Multi-Channel Agent
>
> Status 定义：
> - `Accepted` — 已确定，实施中
> - `Experimental` — 正在实验中，可能被推翻
> - `Proposed` — 提议阶段，尚未实施

---

## ADR-001: 核心语言与运行时

- **Status:** Accepted
- **Date:** 2026-05-20

### Context

需要选一个语言来实现 agent 引擎和多 channel 接入层。核心依赖是 Pi（`@earendil-works/pi-coding-agent`），它提供 TypeScript SDK 和 RPC 两种集成方式。

### Decision

**TypeScript + Node.js（后续通过 Bun compile 打包为可执行程序）。**

- Pi SDK 是 TypeScript 原生，同语言集成深度最大
- discord.js、grammy、fastify 等 channel 库都是 Node.js 生态
- 后续通过 `bun build --compile` 产出跨平台二进制（Pi 项目自身已使用此流程）

### Alternatives Considered

- **Python + Pi RPC**：Pi 提供的 RPC 模式可通过 stdin/stdout JSONL 由任意语言调用。放弃原因：需要自己维护 RPC 协议的类型层，且 channel 库（discord.py、aiogram）与 Pi SDK 不在同一运行时，调试和扩展成本高。
- **Go + Pi RPC**：同上，且 Go 的 AI/LLM 生态较弱。

### Consequences

- 项目为单一 TypeScript 代码库，构建目标为 ESM
- 包管理使用 pnpm
- 开发期通过 `tsx` 热重载，生产期通过 Bun 编译为二进制

---

## ADR-002: Pi 集成方式

- **Status:** Accepted
- **Date:** 2026-05-20

### Context

Pi 提供两种集成路线：

1. **SDK 模式**：`import { createAgentSession } from '@earendil-works/pi-coding-agent'`，同进程运行，可深度访问 agent state、注册 tool、监听事件。
2. **RPC 模式**：启动 `pi --mode rpc` 子进程，通过 stdin/stdout JSONL 协议通信。

### Decision

**主体使用 SDK 同进程集成。保留 RPC 作为"外包 worker"——必要时刻可 spawn `pi --mode rpc` 子进程处理进程隔离的批量子任务。**

### Rationale

| 维度 | SDK | RPC |
|------|-----|-----|
| 集成深度 | 可直接读写 agent state、注入 tool、注册事件 hook | 仅能通过协议定义的接口交互 |
| 类型安全 | 完整 TS 类型 | JSONL 字符串，需自维护 |
| 进程隔离 | Pi 崩溃 → 服务崩溃 | Pi 崩溃不影响主进程 |
| 并发 session | 同一进程管理多个 session | 每个 session 可能需要一个子进程 |
| 扩展注入 | 直接 import 扩展 ts 文件 | 需传文件路径或放在 `.pi/extensions/` |

SDK 在集成深度、类型安全、并发管理上全面占优。进程隔离的劣势可通过以下方式缓解：
- 主 agent 进程使用守护/自动重启机制（systemd / Docker restart policy）
- 需要真正隔离的批量任务通过 RPC 外包

### Alternatives Considered

- **纯 RPC 模式**：放弃原因——自定义 tool 注册、事件拦截、agent state 读写等需求在 RPC 模式下受限严重。

### Consequences

- 项目直接依赖 `@earendil-works/pi-coding-agent` 和 `@earendil-works/pi-ai`
- 自定义 tool（如 `discord_send`、`telegram_send`）通过 SDK 的 `pi.registerTool()` 注册
- 扩展逻辑（权限控制、事件拦截）通过 SDK 的 `ExtensionAPI` 实现
- RPC 外包为可选模块，不阻塞主流程开发

---

## ADR-003: 构建与分发

- **Status:** Accepted
- **Date:** 2026-05-30
- **Supersedes:** 初版（2026-05-20，Bun compile 跨平台二进制 → 已废弃）

### Context

AizenServant 是 7x24 常驻服务（ADR-002），不是本地交互式 CLI。服务的天然分发形态是容器镜像或包安装，而非单文件二进制。初版继承了 Pi 的 `bun build --compile` 路线——但那是为 CLI 工具设计的分发形态，与服务器不匹配。

### Decision

**主分发用 Docker 镜像，次分发用 npm。运行时为 Node ≥ 22（保留 ADR-001），不使用 Bun。**

- 开发：Node + pnpm + tsx（或 Node 原生 type-stripping）+ Vitest
- 分发：Docker 镜像（主，自带运行时与重启守护）+ npm 包（次，给不用 Docker 的自托管者）

### Rationale

| 维度 | Docker/npm + Node | Bun compile 二进制 |
|------|-------------------|--------------------|
| 形态匹配 | ✅ 服务器即容器/服务 | ❌ 为本地 CLI 设计 |
| 跨平台 | ✅ 容器天然跨平台 | 需各平台分别编译 |
| Pi 兼容 | ✅ Pi 原生 Node | bun 对 Node 兼容非 100%，native addon(koffi) 有坑 |
| 7x24 稳定 | ✅ Node 久经考验 | bun 常驻进程长期稳定性未验证 |
| 守护重启 | ✅ Docker restart / systemd 白拿（ADR-002） | 需自建 |

单文件二进制是给"装在本机的 CLI"用的；服务器不需要它。

### Consequences

- CI 产出 Docker 镜像并推送；npm 包为可选次通道
- 不引入 Bun 工具链
- 若将来出现"无 Docker 无 Node、单文件即跑"的真实需求，再引回 bun compile，不影响现有代码

---

## ADR-004: 持久化策略

- **Status:** Accepted
- **Date:** 2026-05-20

### Context

需要决定 agent 状态、用户数据、配置等如何持久化。Pi 的 `SessionManager` 已经用 JSONL 文件管理对话历史。

### Decision

**全部持久化采用纯文本文件。不使用数据库。**

具体形式：
- 对话历史：Pi `SessionManager` 的 JSONL 格式（已提供）
- 用户状态、定时任务配置、跨 session 记忆：自定义 JSON/JSONL 文件
- 记忆系统：纯文本文件组织（格式见 ADR-009b）

### Rationale

- 纯文本 = 零迁移成本 + git 可见 + 可直接 grep/debug
- Pi 生态原生的哲学就是 files over databases（session 是 JSONL，配置是 JSON，上下文是 Markdown）
- 便于对记忆系统进行反复、激烈的设计迭代——改结构不需要写 migration
- 当前数据量级（个人/小团队 agent）远不需要数据库的查询能力

### Alternatives Considered

- **SQLite (`better-sqlite3`)**：提供查询能力，但引入了 native addon（与 ADR-003 的 Bun compile 目标冲突），且每次迭代都需要写 migration。

### Consequences

- 所有可持久化状态以文件形式组织在用户可访问的目录中
- 记忆系统的文件格式和组织结构见 ADR-009b
- 保留将来在需要时换为嵌入式数据库的能力（通过接口抽象）

---

## ADR-005: 包结构 — Workspace 三包

- **Status:** Accepted
- **Date:** 2026-05-30
- **Supersedes:** 初版（2026-05-20，单包结构 → 已废弃）

### Context

记忆系统定为完整插件机制（ADR-015）：第三方/云端记忆插件必须能在不依赖整个应用的前提下被实现。单包结构无法提供这种边界——插件与应用混在一个 package 里，无法独立依赖、独立版本。

### Decision

**升级为 pnpm workspace 三包：**

| 包 | 职责 | 依赖 |
|----|------|------|
| `@aizen/memory-contract` | MemoryProvider 接口、ExploreFn、数据类型。零运行时依赖，极稳定 | 无 |
| `@aizen/memory-default` | 文件存储默认记忆插件（现 `src/memory/*` 演进） | 仅 contract |
| `@aizen/servant` | 主应用：core/channels/retrieval/scheduler/config | contract（运行时按配置加载插件） |

### Rationale

- **app 与所有插件只依赖 contract，彼此不依赖**——这是"可替换、可云端自管"的结构前提
- pnpm 严格 node_modules 在安装期强制此边界（无幽灵依赖），npm 扁平提升做不到
- 第三方插件 = 另一个只依赖 contract 的包

### Consequences

- 根 `package.json` 为 workspace 私有根；`pnpm-workspace.yaml` 已就位
- 原 `aizen-memory` 包归入 `@aizen/memory-default`
- `import-adr.ts`、`aizen-memory` CLI 作为 memory-default 的附属调试工具保留
- 单包不再是约束；目录边界升级为包边界

---

## ADR-006: 测试策略

- **Status:** Accepted
- **Date:** 2026-05-20

### Context

需要选择测试框架和测试策略。

### Decision

**使用 Vitest 作为测试框架。**

测试分层：
- **Unit tests**: mock Pi SDK，测试核心逻辑（agent engine、消息队列、调度器）
- **Integration tests**: 使用 Pi 的 `SessionManager.inMemory()` + 测试用 model 配置，验证完整 agent 流程
- **E2E tests**: 启动 Fastify 服务器，通过 HTTP 验证端到端行为

### Rationale

- Vitest 原生 ESM 支持，与项目一致
- 兼容 Jest API，迁移成本低
- 内置覆盖率（v8 provider）
- Pi SDK 可以通过 Vitest 的 `vi.mock()` 完整 mock

### Consequences

- `vitest.config.ts` 配置 ESM + 覆盖率
- `tests/helpers/mock-pi.ts` 提供 Pi SDK mock 工厂
- CI 中运行 `vitest run --coverage`

---

## ADR-007: Channel 架构 — Tool-as-Channel-Driver

- **Status:** Accepted
- **Date:** 2026-05-20

### Context

需要设计多个通信 channel（HTTP, Discord, Telegram, CLI）如何与 agent 引擎交互。传统做法是框架层做路由：解析消息 → 路由到 agent → 解析 agent 输出 → 路由回 channel。

### Decision

**将路由逻辑从代码层上移到 LLM 层。每个 channel 只做两件事：**

1. **入站**：将来自该 channel 的消息格式化为统一结构，放入 agent 的消息队列
2. **出站**：暴露一个 `*_send` tool 供 LLM 调用

LLM 自主决定：对哪条消息回复、通过哪个 channel 回复、回复什么内容。

### Channel 统一消息格式

```
[Channel: discord | From: Alice#1234 | MsgID: d-abc123 | Thread: #general]
帮我看看上面的代码有什么问题
```

### Channel Tool 示例

```typescript
// Discord send tool
{ name: "discord_send", parameters: {
    channel_id: string,
    reply_to_msg_id: string,
    content: string,
}}

// Telegram send tool
{ name: "telegram_send", parameters: {
    chat_id: string,
    reply_to_msg_id: string,
    content: string,
}}
```

### Rationale

- **新增 channel 成本极低**：只需写一个入站 adapter + 注册一个 send tool
- **跨 channel 上下文共享**：LLM 可以看到 Alice 在 Discord 上的问题和她在 Telegram 上的追问
- **回复归因明确**：tool call 参数里强制指定目标和 channel，不可能"不小心"回错
- **减少胶水代码**：不需要 router、dispatcher、response parser 等中间层

### Consequences

- channel 模块极薄，核心逻辑在 agent engine 和 tool 定义中
- 需要精心设计 system prompt 来指导 LLM 正确使用 channel tool
- LLM 可能选择不回复某些消息——这是 feature 不是 bug

---

## ADR-008: Agent Session 模型

- **Status:** Experimental
- **Date:** 2026-05-20

### Context

需要决定 Pi session 的生命周期——一个 session 服务所有用户还是每个用户独立 session，以及并发消息如何处理。

### Decision

**当前实验方案：单一长 session 处理所有业务，定期归档/摘要接力。**

**架构约束：Session 模型必须在代码层实现为可替换策略（strategy pattern），而非硬编码假设。** 这使得以下模型可以随时切换实验：

| 模型 | 描述 |
|------|------|
| **单 session（当前）** | 一个长 session 处理所有用户所有消息 |
| **每用户一个 session** | 每个用户独立 session + 消息队列 |
| **每次请求新 session** | 临时 session 带历史摘要 |
| **Fork 模式** | 利用 Pi tree fork 处理并发 |

### 消息队列交互模型

基于 Pi SDK 的原语定义了以下交互模式：

```
┌─────────────────────────────────────────────────────┐
│  队列有消息                                          │
│    ↓                                                │
│  agent 空闲 → pull N 条 → session.prompt(messages)   │
│    ↓                                                │
│  LLM 思考 → 决定回复谁 → 调用 channel_send tool       │
│    ↓                                                │
│  tool 执行完毕 ←── 此时 session.steer("有新消息") ────┐│
│    ↓                                                ││
│  LLM 继续 → turn_end                                ││
│    ↓                                                ││
│  agent_end 事件 → 可通知记忆系统归档                  ││
│    ↓                                                ││
│  循环回到顶部                                       ││
└─────────────────────────────────────────────────────┘
```

对应 Pi SDK 原语：
- **agent 主动取消息**：监听 `agent_end` 事件，触发下一批 `session.prompt()`
- **知道 agent "做完了"**：`agent_end` 事件 或 `session.agent.waitForIdle()`
- **多条消息同时推入**：`session.prompt()` 接受完整消息列表
- **tool 执行期间有新消息**：`session.steer()` 在 tool 完成后、下一轮 LLM 调用前注入

### Rationale

- 对大上下文 LLM 的能力有信心
- 期望记忆系统能有效管理跨用户上下文
- 单 session 简化调度逻辑，所有上下文天然共享

### Known Risks

1. **线程安全**：Pi session 的 `prompt()` 是互斥的，同时只能一个。已通过队列解决。
2. **上下文污染**：不同用户对话在同一上下文窗口可能互相干扰。已通过"回复必须走 tool call 指定对象"和 system prompt 隔离缓解，最终依赖于记忆系统的信息归因能力。
3. **单点故障**：session 崩溃影响所有用户。与单线程问题等价，不是单 session 特有。
4. **大规模场景下的 LLM 混乱**：当同时涌入大量跨用户消息时，LLM 可能在多个对话间混淆。此风险需要在实验中观察和评估。

### Consequences

- `AgentEngine` 模块必须通过策略接口抽象 session 创建/恢复/队列逻辑
- 初始实现提供 `SingleSessionStrategy`，后续可添加 `PerUserSessionStrategy`、`EphemeralSessionStrategy`
- 记忆系统必须设计为与 session 模型解耦

### Revision 2026-05-30（session 即沙箱边界）

session 策略**同时决定沙箱拓扑**（ADR-018）：**一个 session = 一个沙箱**，沙箱生命周期绑 session 生命周期。

- 单 session → 一个共享沙箱（当前）。群聊多用户在同一沙箱内，用户间隔离靠软件授权层（actor 绑定/信任级，ADR-018），非 OS。
- per-user session → 每用户一个沙箱，用户间获 OS 级隔离。
- fork / ephemeral → 各自独立沙箱（后台调度任务、并发子任务用）。

故 `SessionStrategy` 接口需把"沙箱的创建/销毁"纳入 session 生命周期管理。

---

## ADR-009: 记忆系统 — 总览

记忆系统是 AizenServant 的差异化核心。以下 6 条子 ADR 分别定义块模型、存储、检索、fork 遍历、生命周期权重、异质数据源。

**核心理念：** 对话之外的一切信息——文档、API 返回、AI 提炼物——全部统一为记忆块。记忆块之间通过双向链表和跨类型引用形成可遍历的知识图谱。每轮对话前通过向量搜索 + fork 遍历从图谱中捞出相关知识注入。

```
ADR-009a: Block Model          ← 块结构定义，总纲
    ├── ADR-009b: Storage      ← JSONL + .vec，sharding
    ├── ADR-009c: Retrieval    ← embedding → 搜索 → 注入管道
    ├── ADR-009d: Fork Traversal ← fork 作为图遍历引擎
    ├── ADR-009e: Lifecycle & Weighting ← 创建、摘要、动态加权
    └── ADR-009f: Heterogeneous Sources ← 对话之外的异质内容
```

---

### ADR-009a: 记忆系统 — 块模型 (Block Model)

- **Status:** Accepted
- **Date:** 2026-05-20

#### Context

记忆系统需要一个最小自治单元——记忆块。所有来源最终都编码为这一结构。块之间通过显式关系连接，形成可被 LLM 遍历的知识图谱。

#### Decision

**记忆块是记忆系统的最小自治单元。不预设内容结构——`content` 字段为纯文本。**

#### Block Schema

```json
{
  "blockId": "mem_20260520_abc123",
  "type": "conversation",
  "createdAt": 1747734600000,
  "source": {
    "channel": "discord",
    "user": "Alice#1234"
  },
  "content": "User: 帮我看看这段代码有什么问题\n\nAssistant: 有 SQL 注入风险...",
  "relations": {
    "prevId": "mem_xyz789",
    "nextId": null,
    "related": ["mem_doc001"]
  },
  "summary": {
    "self": "Alice 请求代码审查，发现了 SQL 注入和 XSS 漏洞",
    "prev": "上一轮 Alice 在讨论认证模块的 OAuth 流程",
    "next": null
  },
  "weight": {
    "boosts": [],
    "negativeMarks": 0
  },
  "embedding": [0.0123, -0.0456],
  "meta": {}
}
```

#### Field Rationale

| 字段 | 说明 |
|------|------|
| `type` | `conversation`、`document`、`ai_insight`、`external`。驱动解析和注入逻辑 |
| `content` | **纯文本**。不预设 user/assistant 结构——不同 type 的内容格式不同，但都行对齐 |
| `relations.prevId/nextId` | 双向链表，构建对话时间线。fork 遍历时 LLM 沿链前进/后退 |
| `relations.related` | 跨类型引用。对话块可以关联到文档块、AI 提炼块、外部数据块 |
| `summary.self` | 当前块浓缩摘要，向量搜索返回时作为锚点信息 |
| `summary.prev/next` | 上下文锚点。分别在上/下一块创建时异步回填 |
| `weight.boosts` | 记录每次 fork 遍历中被 pick 的时间戳，用于动态增强 |
| `weight.negativeMarks` | LLM 标记此块为误导/过时信息的次数，用于指数衰减 |
| `embedding` | float32 向量。未生成时缺失 → 等效于未 indexed |
| `meta` | 扩展槽。type 特定元数据（文档名、API 来源等） |

#### Key Constraints

- **记忆块不绑定 session。** 双向链表的 prevId/nextId 已承载对话连续性。文档块和 AI 提炼块本身就没有 session。
- **content 总是全文。** 不做 chunking。一个记忆块 = 一段完整的、可被 LLM 直接理解的内容。文档过长时由外部流程切成多个块，每块仍是完整上下文。

---

### ADR-009b: 记忆系统 — 存储层 (Storage)

- **Status:** Accepted
- **Date:** 2026-05-20
- **Supersedes:** 初版（2026-05-20，JSONL + 按周 shard → 已废弃）
- **Depends on:** ADR-009a, ADR-010

#### Context

记忆块既需要人类可以直接编辑（vim 打开改一行 JSON），又需要高效检索 embedding 向量。同时需要支持跨目录迁移块而不破坏引用和向量索引。

#### Decision

**每个记忆块 = 一个独立 JSON 文件（以 ULID 命名）。每个记忆目录 = 一个共享 `.vec` 文件。文件名字典排序对齐行号。**

#### 目录结构

```
.aizen/project/
├── blocks/
│   ├── 01J4XK7N8P9Q2R3S4T5V6W7X8.json   ← 一块 = 一文件
│   ├── 01J4XK7N8P9Q2R3S4T5V6W8Y9.json
│   ├── 01J4XK7N8P9Q2R3S4T5V6W9Z0.json
│   └── ...
└── blocks.vec                            ← 整个目录共用一个 .vec
```

#### 对齐规则

```
文件名 ULID 字典排序 → 第 i 个文件 = .vec 第 i 行

排序后:                          .vec:
  01J4XK7N8P9Q2R3S4T5V6W7X8 → 行 0 (3072 bytes)
  01J4XK7N8P9Q2R3S4T5V6W8Y9 → 行 1
  01J4XK7N8P9Q2R3S4T5V6W9Z0 → 行 2
  ...

ULID 天然时间可排序 → 新块排末尾，行对齐稳定。
```

#### 脏检测（避免全量 rebuild）

```
stored_hash = SHA256("01J4XK.json:1716300000,01J4Y...json:1716303600,...")
  → 存为 blocks.hash（与 .vec 同目录）
current_hash = SHA256(sort(ls blocks/*.json) → 文件名 + ":" + mtime)

启动时比较两者：
  stored_hash === current_hash → .vec 有效，直接加载
  不同 → 需要 rebuild（重建 .vec，更新 .hash）
```

**速度：** 只读文件名和 mtime，不读文件内容。10 万文件约 10-50ms。作为 CLI 启动时自动检测。不需要文件 watcher。

#### Rationale

| 问题 | 方案 |
|------|------|
| 人类可编辑 | 每块一个 `.json` 文件 → `vim` 直接改 |
| 可迁移 | `cp 01J4X.json /other/.aizen/blocks/` → rebuild 后自动对齐 |
| embedding 高效存储 | `.vec` 纯二进制，每行 768×4=3072 字节 |
| 对齐 | 文件名字典排序 ↔ 行号 |
| 新增块 | 写入 .json + 重写 .vec（初期块少，毫秒级；后期可加分片） |
| 未 indexed 块 | `.vec` 对应行全零 → 搜索时自动跳过 |
| 脏检测 | mtime 哈希比较，避免每次启动都 rebuild |
| 不引入额外编译流程 | JSON + raw binary，零依赖 |

#### Consequences

- 新增块的 `.vec` 重写是 O(n) —— 初期 n 很小，不是问题。后续块数上万时可通过引入多层 `.vec` 分片解决，分片不影响文件级块结构
- 删除一个文件后 `.vec` 必须 rebuild
- `rebuild` 命令：读取所有 `.json` → 重新计算 embedding → 写 `.vec` 和 `.hash`
- 迁移块：`cp` 文件 + 目标目录 `rebuild`

---

### ADR-009c: 记忆系统 — 检索管道 (Retrieval Pipeline)

- **Status:** Accepted
- **Date:** 2026-05-20
- **Depends on:** ADR-009a, ADR-009b

#### Context

每轮对话前需要从记忆库中检索相关知识注入上下文。检索既要快（不影响响应延迟），又要准（不注入无关内容污染窗口）。

#### Decision

**embedding → 向量搜索 → fork 遍历 → 注入。** 两步检索：向量搜锚点，fork 做遍历。

#### Pipeline

```
① 新消息到来
② 调 embedding API 编码每条新消息 → query_vector[]
③ 向量搜索：query_vector vs 所有 indexed 记忆块 → 余弦相似度排序
④ 综合评分 = cosine_similarity × boost_factor × decay_rate²negativeMarks
   → 取 Top-K 作为"锚点块"
⑤ fork traversal（见 ADR-009d）→ LLM 沿 relations 遍历 → 捞出扩展块集
⑥ 回到主 session：注入扩展块集的完整 content
⑦ agent 回复
⑧ agent_end → 异步 worker 创建新块（见 ADR-009e）
```

#### 注入约束

- 记忆块 content **只在 prompt 参数中传递**，不写入 Pi session JSONL
- 下一轮自动消失——agent 需重新检索
- 注入了哪些块被记录（用于权重反馈，见 ADR-009e）

#### 搜索评分公式

```
score(block, query) = cosine_similarity(block.embedding, query)
                    × boost_factor(block)
                    × decay_rate ^ negativeMarks
                    × recency_decay(block)
```

其中 `boost_factor` 和 `decay_rate` 定义见 ADR-009e。

#### Consequences

- 每次检索额外产生一次 embedding API 调用 + 一次 fork LLM 调用（开销接受，见 ADR-009d）
- 可配置 embedding provider（在线/本地），与主 LLM 独立

---

### ADR-009d: 记忆系统 — Fork 图遍历 (Fork Traversal)

- **Status:** Accepted
- **Date:** 2026-05-20
- **Depends on:** ADR-009c

#### Context

向量搜索只能找到"语义相似"的记忆块。但"John 这个 bug 和三个月前那次重构有关"——重构块语义上不相似，但通过 `prevId`/`nextId` 链拓扑连接。

**Fork 的作用不是过滤向量搜索结果，而是从锚点出发，沿知识图谱的边自行探索。**

#### Decision

```
① 向量搜索返回 K 个锚点块（blockId + summary.self）
② session.fork() 创建临时分支
③ 分支 prompt：
   "以下是本轮用户消息: [原始消息]
    以下是向量搜索返回的锚点记忆块: [K 个 block 的 blockId + summary.self]
    请沿每个锚点的 relations.prevId / relations.nextId / relations.related
    遍历知识图谱，找出所有与当前消息相关的记忆块。
    可以前向搜索（nextId）、后向搜索（prevId）、跨类型跳转（related）。
    返回所有相关块的 blockId 列表。不要解释，只返回 ID。"
④ LLM 沿链探索 → 返回扩展块集（锚点 + 遍历发现的块）
⑤ 分支丢弃 → 扩展块集注入主 session
⑥ 扩展块集中的所有块记录一次 boost（见 ADR-009e）
```

#### Rationale

- **锚点 + 遍历 = 高召回 + 高精确。** 向量搜索负责"找到入口"，LLM 负责"沿路找下去"
- **双向链表 + 跨类型引用 = 可被 LLM 自行推理的图**
- fork 是临时工作区，不污染主 session
- LLM 在 fork 中的探索决策比代码规则灵活——它能判断"这条对话链跟当前问题真的有关吗"

#### Risks

- **延迟开销**：每轮对话增加一次 fork LLM 调用
- **缓解**：可配置轻量/便宜 model 做 fork 遍历，与主 model 可以是不同 provider

#### Revision 2026-05-30（记忆插件化）

原方案隐含"agent 直接调 Pi `session.fork()` 做遍历"。记忆改为完整插件后（ADR-015），**遍历移入插件内部**，插件通过注入的 `ExploreFn` 回调取得 LLM 能力，回调由 retrieval 层用 Pi `session.fork()` 兑现——插件本身不依赖 Pi。遍历沿块的 `relations` 边探索，故 `relations` 字段需保留/重引入 block schema（原 summary.self 锚点已移除，改用 content 摘录）。

---

### ADR-009e: 记忆系统 — 生命周期 & 动态权重 (Lifecycle & Weighting)

- **Status:** Accepted
- **Date:** 2026-05-20
- **Depends on:** ADR-009a, ADR-009c, ADR-009d

#### Context

记忆块从创建到可搜索需要经过多个异步步骤。同时需要两种反馈机制来调整块的检索权重：正向增强（被频繁引用）和负向衰减（被标记为误导）。

#### Lifecycle

```
creation
  ↓
summary.self 生成（异步，轻量 model）
  ↓
summary.prev 回填到上一块
summary.next 由下一块创建时回填到当前块
  ↓
embedding 生成（异步）
  ↓
indexed: true → 进入可搜索状态
```

**创建时机:** agent_end → 抽取本轮完整 Q&A → 创建 `type: "conversation"` 块 → 异步 worker 依次补 summary 和 embedding。

#### 动态增强 (Positive Boost)

fork 遍历中被 pick 的每个块获得一次 boost：

```
boost_factor(block) = 1 + Σᵢ boostᵢ × e^(-λ₁ × (now - boostᵢ.at))

λ₁ 控制半衰期。建议初始值：半天后单次 boost 衰减至 50%。
```

效果：频繁被引用的块长期保持高分，偶发被引用则快速消散。

#### 动态衰减 (Negative Decay)

LLM 通过 `memory_mark` tool 标记误导/过时/无效的块：

```
negative_decay(block) = decay_rate ^ negativeMarks

decay_rate 建议 0.65：
  1 次 → 65%    2 次 → 42%    3 次 → 27%    5 次 → 12%    10 次 → 1.3%
```

永远不会归零——理论上极端精确的搜索仍能召回，但随着标记次数增加，块在普通搜索中几乎不可见。

##### `memory_mark` Tool

```typescript
{
  name: "memory_mark",
  parameters: {
    blockId: string,
    action: "flag_misleading" | "flag_outdated" | "flag_invalid",
    reason: string,
  }
}
```

触发场景：agent 在检索后判断某记忆块提供的信息导致了错误决策。agent_end 时自动标记。

#### 综合评分（同 ADR-009c）

```
score(block, query) = cosine_similarity(block.embedding, query)
                    × boost_factor(block)
                    × decay_rate ^ negativeMarks
                    × recency_decay(block)
```

两条加权曲线独立运作。LLM 对记忆的态度随时间演化——有用的反复被引用自然上浮，误导的反复被标记自然沉底。

---

### ADR-009f: 记忆系统 — 异质数据源 (Heterogeneous Sources)

- **Status:** Accepted
- **Date:** 2026-05-20
- **Depends on:** ADR-009a

#### Context

记忆库不应只包含对话。文档、API 返回、AI 定期提炼的洞察——不同来源、不同结构，但都能被统一检索和遍历。

#### Decision

**通过 `type` 泛化记忆块，支持四种以上的异质来源。存储、检索、遍历机制全部复用。**

| type | content | meta | 入库方式 |
|------|---------|------|----------|
| `conversation` | 一轮 Q&A 纯文本 | `{ messageId, threadId }` | agent_end 自动 |
| `document` | 文件全文 | `{ filename, path, hash }` | 文件监听 / 手动导入 |
| `ai_insight` | AI 定期提炼的结论 | `{ topic, confidence }` | 定时任务触发 LLM |
| `external` | API 返回 / 网页内容 | `{ url, sourceType, fetchedAt }` | 用户指令 / 定时抓取 |

#### Key Design Points

- **content 总是纯文本。** 不同来源在入库前被序列化。文档 → 原文。API JSON → 压缩为文本表述。
- **不同类型可以互相引用。** 对话块 `related: ["mem_doc001"]`，文档块 `related: ["mem_insight042"]`——fork 遍历可以跨类型跳转。
- **入库不嵌入，统一靠检索。** 文档和 AI 提炼物不直接注入 session，而是作为记忆块等待被向量搜索 + fork 遍历捞出。

#### 定期提炼（AI Insight 生成）

定时调度器触发 LLM：
> "回顾本周所有 conversation 类型的记忆块，提炼出关键结论和模式。生成 1-3 个 ai_insight 块。"

这批块作为知识节点进入图谱，通过 `related` 引用源对话块。后续对话可以沿这些边追溯到原始上下文。

---

---

## ADR-010: 记忆块 ID 生成方案 (Block ID Scheme)

- **Status:** Accepted
- **Date:** 2026-05-20
- **Depends on:** ADR-009a

### Context

记忆块之间通过 `prevId` / `nextId` / `related` 互相引用。如果块 ID 依赖路径或序号，迁移到另一个记忆库后引用全部断裂——不是实现缺陷，是设计级 bug。

需求：
- 跨记忆库迁移块不破坏引用
- ID 不会碰撞（即使多个进程同时生成）
- 不被文件路径、存储位置、shard 归属绑定

### Decision

**使用 ULID（Universally Unique Lexicographically Sortable Identifier）。**

```
格式: 01J4XK7N8P9Q2R3S4T5V6W7X8

├─ 前 10 字符: 毫秒精度时间戳 (Crockford Base32)
└─ 后 16 字符: 80-bit 加密级随机数
```

- 26 字符，URL-safe
- 按时间自然可排序（`01J4X...` < `01J4Y...`）
- 碰撞概率 ≈ 0（80-bit 随机空间，足够并行生成）
- 零路径依赖——块可以自由在 `~/.aizen/memory/` 和 `.aizen/memory/` 之间迁移

### Alternatives Considered

| 方案 | 路径独立 | 碰撞安全 | 可排序 | 问题 |
|------|----------|----------|--------|------|
| ULID | ✅ | ✅ | ✅ | — |
| UUID v4 | ✅ | ✅ | ❌ | 不可排序，视觉噪声 |
| UUID v7 | ✅ | ✅ | ✅ | 36 字符，比 ULID 长 |
| Content hash (SHA-256) | ✅ | ✅ | ❌ | 编辑内容 → ID 变 → 引用断裂 |
| 自增序号 | ❌ | ❌ | ✅ | 多源合并冲突；迁移后序号全部重排 |

### Consequences

- 引入 npm 包 `ulid`（零依赖，约 2KB）
- `blockId` 字段固定为 26 字符 ULID string
- 无论块存储在哪个 shard、哪个目录、哪个机器上，`relations` 中的 ID 引用始终有效
- 块迁移 = 从一行的 JSONL 靠 `blockId` 找到对应行 → copy → 在目标 JSONL append
- 检索时多个记忆库合并搜索，同 ID 去重（同一个块可能被引用了但源文件在另一个库）

---

## ADR-011: 记忆所有权与共享 (Memory Ownership & Sharing)

- **Status:** Accepted
- **Date:** 2026-05-20
- **Depends on:** ADR-004, ADR-009a

### Context

记忆系统需要服务两类场景：
1. **个人记忆**：coding agent 的私有会话记录，可能含敏感信息（本地路径、试错过程、env 片段），绝对不可共享
2. **项目记忆**：团队的架构决策、设计规范、模块演进历程，需要被所有开发者检索

自动区分这两者不可行——LLM 无法判断哪条信息是"可共享的"。指望 LLM 过滤是隐私事故的温床。

### Decision

**三层记忆目录 + 人工 promote 流程。**

#### 目录约定

```
~/.aizen/memory/              ← 全局个人记忆（永不上 git）
    blocks/*.jsonl / *.vec

$PROJECT/.aizen/memory/       ← 项目记忆索引（.gitignore，从 docs/ 重建）
    blocks/*.jsonl / *.vec

$PROJECT/docs/                ← 项目记忆源文件（上 git，人手写或 promote 来的）
    adr/
    memory/
```

| 层级 | 内容 | git | 谁写 | 谁读 |
|------|------|-----|------|------|
| 全局个人 | coding agent 所有会话 | ❌ | agent 自动 | 只有我 |
| 项目索引 | 从 docs/ 构建的检索索引 | ❌ (重建) | hook 脚本 | 团队所有人的 agent |
| 项目源文件 | ADR、设计文档、架构演进 | ✅ | 人手写 / promote | 团队所有人 + review |

#### Promote 流程

```
开发者 A 的 personal memory
    │
    │  agent session 结束后，A 手动 review：
    │  "这条记忆值得团队知道吗？"
    │
    ├─ 否 → 留在 personal memory
    │
    └─ 是 → aizen-memory promote <blockId> --target docs/memory/
            ↓
          生成 Markdown 文件 → commit → PR → review → merge
            ↓
          其他开发者 pull → hook 重建项目记忆索引
```

**核心原则：只 merge 源文件，不 merge 索引。** 记忆索引是 build artifact，像 `node_modules/` 一样可从源重建。源文件的 review 流程复用 git 的一切协作机制。

#### 检索时合并

`aizen-memory` 支持通过 `--memory-dir` 指定多个记忆库目录：

```bash
aizen-memory search "auth 模块职责边界" \
  --memory-dir ~/.aizen/memory \        # 全局个人
  --memory-dir ./.aizen/memory           # 当前项目
```

搜索结果标注来源：`source: "personal"` vs `source: "project"`。LLM 知悉哪些是私有推断，哪些是团队共识。

### Consequences

- `.gitignore` 添加 `.aizen/` 和 `data/`
- `package.json` 的 `postinstall` / CI 中执行 `aizen-memory index docs/ --target .aizen/memory/`
- `aizen-memory` CLI 必须支持 `--memory-dir` 多源合并
- `relations` 中的 `blockId` 引用不受迁移影响（见 ADR-010）

### Revision 2026-05-30（收窄为开发期记忆）

本 ADR 描述的 project/personal/promote 三层与目录约定，**仅适用于"开发期 ADR 记忆"**——即 coding agent 查本仓库架构决策用的工具（`.aizen/project/`、`.aizen/personal/`，归 AGENTS.md 管）。

**产品的"运行期 agent 记忆"不受本 ADR 约束**：它由配置的记忆插件完全自管（本地、云端、任意），引擎层零目录假设（见 ADR-015）。两者是不同的东西，不要混淆。

---

## ADR-012: CLI 工具命名

- **Status:** Accepted
- **Date:** 2026-05-20

### Decision

**CLI 工具命名为 `aizen-memory`。** 二进制文件名 `aizen-memory`（或 Windows 下 `aizen-memory.exe`）。

### Rationale

- 语义精确：它管理的是记忆系统，不是整个 AizenServant
- 遵循 Unix 命名惯例（小写 + 连字符）
- 为将来 `aizen` 主命令预留空间（`aizen start`、`aizen serve` 等）

### Planned CLI Commands

```
aizen-memory index <source-dir> [--target <memory-dir>]    # 从源目录构建记忆索引
aizen-memory search "<query>" [--memory-dir ...] [-k <N>]  # 检索记忆
aizen-memory promote <blockId> [--target <output-dir>]     # 将个人记忆 promote 为项目源文件
aizen-memory stats [--memory-dir ...]                       # 记忆库统计
```

---

## ADR-013: 记忆块去重 (Deduplication)

- **Status:** Accepted
- **Date:** 2026-05-20
- **Depends on:** ADR-009a, ADR-010
- **Implementation:** Phase 2（当前阶段不做，仅做设计决策）

### Context

同一源文件被重复执行"构建记忆索引"、或不同开发者各自从同一文档构建项目索引后合并，都可能产生内容雷同但 ULID 不同的块。检索时返回两条几乎一样的结果，降低检索质量。

### Decision

**两阶段去重：内容哈希 → LLM 语义归并。**

#### 阶段一：内容哈希（确定性去重）

```
SHA-256(content) → 查哈希表
  ├─ 命中 → 相同内容已入库 → 跳过
  └─ 未命中 → 继续阶段二
```

O(1)，零误判，消除完全相同的重复入库。

#### 阶段二：LLM 语义归并（模糊去重）

当两块哈希不同但向量余弦相似度 > 0.95 时触发：

```
① 两个高相似度块 → 提交给 LLM
② LLM prompt：
   "以下是两个高度相似但非完全相同的记忆块：
    块 A: [content A]
    块 B: [content B]
    请判断它们是否描述同一个知识点。如果是，将它们合并为一块更精炼的记忆。
    保留两块中独有的信息，消除重复。返回合并后的 content 全文。"
③ LLM 返回合并后的 content → 创建新块（新 ULID）
④ 两个旧块的 relations 转移到合并块
⑤ 两个旧块标记 deprecated: true（不删除，保留追溯能力）
⑥ 合并后的新块计算 embedding → 入库
```

#### Rationale

- **阶段一（哈希）** 成本趋零，消除最常发生的完全重复
- **阶段二（LLM 归并）** 不损失信息——两块虽然相似但可能各有互补内容，LLM 能识别并保留
- **不删除旧块** 保留完整追溯链（谁引用了这个旧块仍能看到历史）——旧块只被标记为 deprecated，不参与检索
- 异步后台执行，不阻塞"构建记忆索引"主流程

### Consequences

- 需要维护一个内存/文件级的内容哈希表（可每次启动从 JSONL 重建）
- LLM 归并只在相似度阈值触发，调用频率低
- `deprecated` 字段加入 block schema（见 ADR-009a）

---

### ADR-009a 补充：`deprecated` 字段

由于 ADR-013 的去重策略需要标记废弃块，block schema 追加一个字段：

```json
{
  "deprecated": false,          // 新增。true 时该块不参与检索
  "supersededBy": null          // 新增。指向合并后新块的 blockId
}
```

---

## ADR-014: CLI 记忆源显式指定 (Explicit Memory Sources)

- **Status:** Accepted
- **Date:** 2026-05-20

### Context

`aizen-memory search` 需要知道从哪个记忆库检索。如果提供默认行为（如"默认搜 `.aizen/personal/` + `.aizen/project/`"），会造成两个问题：
1. 用户不知道当前在工作目录还是家目录，默认行为是隐式假设
2. 为上层封装如 coding agent 提供了不确定性——agent 不知道该显式传参还是依赖默认

### Decision

**`aizen-memory search` 不指定 `--memory-dir` 时直接报错，提示用户指定至少一个 `--memory-dir`。** 不存在任何默认搜索路径。

上层封装工具可以自行包装默认路径（如 coding agent 知道自己的 personal/project 目录在哪），但 `aizen-memory` 本身不做任何隐式假设。

### Rationale

- CLI 工具的行为必须是确定且透明可预测的
- 默认路径属于"policy"而非"mechanism"，应由上层应用层定义
- Unix 哲学：mechanism over policy

---

## ADR-015: 记忆插件契约 (Memory Provider Contract)

- **Status:** Accepted
- **Date:** 2026-05-30
- **Depends on:** ADR-005, ADR-009a, ADR-009d

### Context

记忆系统要做成完整插件机制：默认实现随项目交付，但可被第三方替换，甚至把数据存在云端。前提是一条稳定、不依赖具体 agent 框架（Pi）的契约。

张力：fork 图遍历（ADR-009d）需要 LLM 能力，而 LLM 能力来自 Pi session。若插件直接依赖 Pi，契约就被框架绑死。

### Decision

**定义 `MemoryProvider` 契约（独立包 `@aizen/memory-contract`）。遍历与权重评分在插件内部完成，但插件通过注入的抽象「探索回调」`ExploreFn` 取得 LLM 能力，不依赖 Pi。**

```typescript
type ExploreFn = (prompt: string) => Promise<string[]>;   // agent 用 Pi session.fork() 兑现
interface RetrievalContext { explore: ExploreFn; }

interface MemoryProvider {
  store(input): Promise<{ blockId: string; isNew: boolean }>;
  retrieve(query: string, ctx: RetrievalContext, opts?): Promise<RetrievedBlock[]>;  // 锚点+遍历+评分
  search(query: string, opts?): Promise<RetrievedBlock[]>;                            // 仅锚点
  mark(blockId, action, reason): Promise<void>;
  stats(): Promise<Stats>;
}
```

### Rationale

- 契约零 Pi 依赖 → 换 LLM 框架只动 retrieval 的 `ExploreFn` 实现；换记忆后端只换插件
- 遍历放插件内（而非 agent 侧）→ 不同插件可有不同遍历策略，云端插件甚至可服务端遍历
- `ExploreFn` 是插件向外"借"的唯一能力，边界清晰

### Consequences

- 运行期记忆完全由插件自管（存储位置、结构、是否云端），引擎层零目录假设（呼应 ADR-011 修订）
- app 与所有插件只依赖 contract（ADR-005）
- 加载：config 指定插件 → 启动时动态 import + 接口校验
- 遍历依赖块的图的边 → `relations` 字段需保留/重引入 block schema

---

## ADR-016: 定时任务调度与接入主循环

- **Status:** Accepted
- **Date:** 2026-05-30
- **Depends on:** ADR-007, ADR-008, ADR-009f

### Context

定时任务（AI insight 提炼、external 抓取、定时提醒）触发后，必须决定如何与正在运行的对话主循环协作：既不污染用户上下文，又能在需要时触达用户。

### Decision

**按"是否要对用户说话"把任务分两类，两条接入路径：**

| 类型 | 例子 | 接入 |
|------|------|------|
| 后台维护型 | AI insight 提炼、external 抓取、语义去重 | 在独立 ephemeral session/worker 跑，结果直接写记忆，**不进主队列** |
| 用户触达型 | 定时提醒、定时播报 | 生成合成系统消息塞进**主入站队列**，agent 在主循环里用 send tool 决定如何触达 |

判据唯一：要不要经渠道"说话"。要说话就必须走主 session（send tool 只在主 agent 上下文）。

### Rationale

- 后台批处理不该挤占用户对话的上下文窗口和处理时机
- 触达型走合成消息 → 零特例，复用整条消息+记忆+归因通路
- 后台型正是 ADR-002 "RPC 外包 worker" / ephemeral 策略的用武之地

### Consequences

- 任务配置持久化为文件（如 `tasks.json`）；一期固定周期，cron 后置
- 合成消息带 `[Scheduler | Task | Time]` 信封，user 角色（见 ADR-017）

---

## ADR-017: 工具装配与消息平面

- **Status:** Accepted
- **Date:** 2026-05-30
- **Depends on:** ADR-002, ADR-007

### Context

需明确：怎么给 agent 工具、默认有哪些、以及工具响应与用户消息/定时消息/系统通知/注入记忆之间是什么关系、怎么组织。

### Decision

**工具装配：** 启动时经 Pi `registerTool()` 装配，来源三处——启用渠道各自的 send tool + 记忆工具 + 白名单内的 Pi 内置工具。

**默认工具：** `<channel>_send`、`memory_mark`、`memory_search`。Pi 高权限内置（shell/写文件）默认关，按信任级开（见 ADR-018）。

**两平面一旁路：** agent 的信息分三处组织：

| 种类 | 来源 | 进入方式 | 角色 | 平面 |
|------|------|----------|------|------|
| 用户消息 | 渠道 | 入站队列 | user，带渠道信封 | 事件平面 |
| 定时消息 | scheduler 触达型 | 入站队列（合成） | user，带 Scheduler 信封 | 事件平面 |
| 系统通知 | 引擎 | steer/system 注入 | system | 事件平面 |
| 工具响应 | agent 自身调用 | Pi 工具协议（turn 内闭环） | tool，绑 tool_call_id | 动作平面 |
| 注入记忆 | retrieval | prompt 参数 | 标注的参考块 | 旁路 |

### Rationale

- 工具响应是 agent 自身动作的回执，turn 内闭环，与外部事件（队列）分属两平面，不可混淆
- 用户/定时消息同走队列同为 user，仅靠信封区分来源与信任级 → 触达零特例
- 注入记忆是参考非指令，明确分隔（如 `<retrieved-memory>`），防 LLM 当命令执行

### Consequences

- 每个工具调用可带 `on_behalf_of`（见 ADR-018）
- 系统通知用 system 角色，不被当作"有人说话"

---

## ADR-018: 权限与工具授权 (Tool Authorization)

- **Status:** Experimental
- **Date:** 2026-05-30
- **Depends on:** ADR-008, ADR-017
- **Resolves:** 未决事项 #4（框架层面；细节待迭代）
- **Research:** `docs/research-tool-permissions.html`（活文档，持续调研）

> **本 ADR 为 Experimental——权限是难题，框架已定但实现细节需反复迭代。** 业界调研、分层框架全貌、分阶段实现、开放问题见上述 research 文档。本条只记已定的决策骨架。

### Context

需要在多用户（含群聊）下控制工具权限：永不让陌生人诱导 agent 用其底层权限。**prompt 不是安全边界**（提示注入可绕过），授权必须代码层强制。

调研业界（Codex / Claude Code / opencode / OpenClaw / Hermes，见末尾对照）得出共识：**主边界是沙箱，不是逐条确认**——没有一个工具会让所有 bash 都确认；沙箱内自动放行，只有逃逸动作（联网、出沙箱、破坏性）才确认。但这些都是**单用户本地 coding agent**，未解决"群聊里陌生人"的归因问题——那部分是我们场景特有的，需自建。

### Decision

**主边界 = 每 session 一个沙箱；沙箱内自动放行，逃逸动作走规则/确认；多用户共享 session 再叠一层软件授权（actor 绑定 + 信任级 + 高危带外确认）。**

#### 1. 每 session 沙箱（主边界，OS 强制）

- 一个 session 的工具执行（bash/文件）被 OS 隔离在它自己的沙箱里，框住对**主机**和**其它 session** 的爆炸半径。
- **沙箱拓扑由 session 策略决定（ADR-008）**：单 session→一个沙箱；per-user session→每用户一个沙箱（用户间获 OS 级隔离）；fork/ephemeral→各自沙箱。沙箱生命周期绑 session 生命周期。
- 沙箱不解析命令、只约束能力 → 混淆/组合命令也逃不掉。**沙箱内的命令不逐条确认。**

#### 2. 规则系统（逃逸动作才管）：deny > ask > allow

- 三种判决：**allow**（直接跑）/ **ask**（每次确认）/ **deny**（拦死）。多规则匹配同一命令时按 `deny > ask > allow` 优先级，先匹配先定，deny 最先查。
- 含**内置只读白名单**（`ls/cat/grep/git 读类`…）默认 allow。
- 规则按"动作是否逃出沙箱"分类：沙箱内读写→allow；联网/出沙箱/破坏性模式→ask 或 deny。

#### 3. 工具策略在模型调用前移除 schema

被禁工具的定义**不下发给模型**（看不见就调不了）——能力隔离靠"工具不存在"，非靠 prompt 劝阻。

#### 4. 多用户软件授权层（共享 session 内）

OS 沙箱不区分同一 session 的参与者，故群聊场景叠加：

- **信任分级**：`(channel, senderId) → 信任级`，默认拒绝。身份由渠道适配器在代码层从平台认证 ID 盖章，LLM 不可伪造。（对标 Hermes/OpenClaw 的 user authorization / 配对码）
- **actor 绑定**：工具调用带 `on_behalf_of: userId`，网关校验其为本轮**认证在场参与者** + 信任级足够。
- **高危带外确认**：高危动作阻塞，向 owner 认证渠道发**代码捕获的原始载荷** + actor + 来源，等真人批准。

#### 5. 兜底与防篡改

- **失败关闭**：无人批准 / 超时 → deny（对标 OpenClaw askFallback、Hermes timeout）。
- **批准防篡改**：存下批准的计划；命令 / cwd / 引用文件在批准后变化 → 拒（对标 OpenClaw approval mismatch + file drift）。
- **审计日志**：每次调用记 actor + 放行/拒绝。

### 风险分级（综合沙箱 + 规则 + 多用户）

| 级 | 判定 | 例 |
|----|------|----|
| 低 | 沙箱内 + 只读白名单 / allow 规则 | `ls/cat/grep`、`*_send`、`memory_search` |
| 中 | 沙箱内写 / actor 绑定 + 信任级 | workspace 写、`memory_mark` |
| 高 | 逃逸动作（联网/出沙箱/破坏性/付费发布）→ ask + owner 带外确认 | 完整 bash 联网、写主机、对外发布 |

### bash 怎么办：靠沙箱分级，不靠解析命令串

`bash` 从 `ls` 到 `rm -rf` 跨度极大，**一律确认会让确认失去意义，逐条解析判风险又不可靠**（管道/重定向/`$()`/混淆都能让"看着安全"的命令变危险）。所以按**执行能力**分，不按字符串：

1. **优先窄口径专用工具**（`read_file`/`list_dir`/`grep_repo`/`git_status`）：风险静态有界，免确认。
2. **沙箱内 bash**：在每 session 沙箱里跑，安全由沙箱保证 → 沙箱内操作免逐条确认。
3. **逃逸 bash**（要联网 / 出沙箱 / 触及主机）：ask + 高危带外确认。
4. **可选严格 allowlist**（锦上添花，非主边界）：只放行锚定且不含 shell 元字符（`; | & > < $` 反引号）的命令；否则落到确认。naive 命令名白名单不安全（`cat x > /etc/passwd`），白名单必须拒绝 shell 组合。

### LLM 在权限里的角色（含修正）

> 修正：早先写"安全判定不用 LLM"过于绝对。调研发现 Codex(Guardian/auto-review，专用模型 `codex-auto-review`) 与 Hermes(smart 模式) **确实用 LLM 判安全**——但都作为**可选的灰色地带裁决层**，不作硬边界。

- **硬边界永远是沙箱（OS/确定性），不是 LLM。**
- **LLM 可选做"灰色地带审查员"**（仿 Codex Guardian）：只对"已需批准"的越界动作裁决，**只能 gate 不能 grant**（不放大权限/网络/可写域）、**失败关闭**（构建/解析/超时→拒）。判错被沙箱兜住。
- **身份与批准载荷不经 LLM**：发件人身份由渠道代码层盖章；批准载荷==执行载荷由代码逐字节校验。
- **LLM 另可用于可读性**：对原始命令生成解读，仅供 owner 参考、非授权依据；为抗注入在隔离 session 生成。
- 是否启用 LLM 审查员属 P2 迭代项（见 research 文档 §4）。

### 业界对照（调研依据）

| 工具 | 主边界 | 自动放行 | 才确认 | 所有 bash 都确认 |
|------|--------|----------|--------|:---:|
| Codex | OS 沙箱（Seatbelt/Landlock）+ 默认禁网 | 沙箱内 workspace 命令 | 出沙箱 / 联网 | ❌ |
| Claude Code | deny>ask>allow 规则 + 只读内置白名单 | 只读命令 + allow 规则 | ask / 未匹配 | ❌ |
| opencode | per-pattern allow/ask/deny（可 per-agent） | 配为 allow 的模式 | `*: ask` 兜底 | ❌ |
| OpenClaw | 工具策略→沙箱→elevated→exec approvals→allowlist；可远程批准 | allowlist / safe bins | 清单 miss（TG/Slack 批准） | ❌ |
| Hermes | 选隔离后端（容器即边界）+ manual/smart 批准 + 用户 allowlist/配对 | 容器内 / smart 学到的安全命令 | 危险模式扫描命中 | ❌ |

我们 = 业界共识（沙箱主边界 + deny>ask>allow + schema 移除 + 防篡改 + 带外 + 失败关闭）∪ 自有扩展（**每 session 沙箱随策略伸缩** + 群聊内 actor 绑定/信任级）。

### Consequences

- config 定义信任表、各工具风险级、沙箱规则
- 沙箱实现按部署落地（容器内可用 bubblewrap/Landlock/独立用户等做 session 级隔离），架构上"沙箱边界=session 边界"
- ADR-008 的 session 策略同时决定沙箱拓扑（见 ADR-008 修订）

---

## 未决事项 (Open Issues)

以下问题尚未充分讨论：

1. **System Prompt 设计**：如何指导 LLM 在共享 session 多用户环境中正确使用 channel tool、归因记忆、填写 `on_behalf_of`？
2. **HTTP/WS Channel 具体协议**：REST vs WebSocket vs SSE？消息格式？（初步立场：先 HTTP）
3. **日志与可观测性**：结构化日志格式？与 Pi 日志的关系？
4. **错误恢复与自愈**：agent session 崩溃后的自动恢复策略（初步立场：进程级守护）
5. **记忆块过期/淘汰**：是否引入 TTL？还是全凭动态权重自然排序？

> 已解决并归档为正式 ADR：定时调度（ADR-016）、权限与工具授权（ADR-018，原 #4）、fork 遍历 model 可配置（ADR-015）。
