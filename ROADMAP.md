# Phase 1: aizen-memory

> 第一期目标：交付一个可独立运行的记忆系统 CLI 工具，以项目自身的 ADR 作为首个数据集进行自举验证。

---

## 交付物

| 模块 | 说明 |
|------|------|
| 块模型 | ADR-009a — ULID、type、content、relations、summary、weight、embedding、meta |
| 存储层 | ADR-009b — JSONL + .vec 读写，按周 shard |
| Embedding | ADR-009c — 可配置的 embedding API abstraction（OpenAI / 本地 Ollama） |
| 检索 | ADR-009c — 余弦相似度 + 综合评分，返回 Top-K |
| 多源合并 | ADR-011 — `--memory-dir` 支持多个记忆库目录同时搜索 |
| 个人/项目分离 | ADR-011 — 全局 `~/.aizen/memory/` + 项目 `.aizen/memory/`，后者 gitignored |
| ID | ADR-010 — ULID，路径无关，迁移不损引用 |
| CLI | ADR-012 — `aizen-memory index` / `search` |
| ADR 索引 | 解析 `docs/ADR.md`，每个 ADR section 索引入库 |
| 测试 | ADR-006 — Vitest，覆盖 store、embedder、retriever |

## 一期不做

- fork 遍历（ADR-009d）— 依赖 Pi SDK
- 动态权重（ADR-009e）— 需要 agent 反馈闭环
- 异质数据源（ADR-009f）— 先验证核心管道
- Channel、scheduler、agent engine

## 验证目标

```bash
aizen-memory index docs/ --target .aizen/memory/

aizen-memory search "channel 架构是怎么设计的"
# 期望 Top-1: ADR-007

aizen-memory search "怎么构建跨平台二进制"
# 期望 Top-1: ADR-003
```
