# aizen-memory — Agent 使用说明

> 本文档面向在此项目中工作的 coding agent。描述如何通过 aizen-memory 读取和写入架构记忆。

---

## 记忆的两层

项目使用两层记忆：

| 层 | 路径 | 性质 |
|----|------|------|
| 项目记忆 | `.aizen/project/` | 团队共享，从 `ADR.md` 等源文件构建 |
| 个人记忆 | `.aizen/personal/` | 私有，记录你的临时发现和推断 |

**两条都是 gitignored。** 项目记忆可通过 `scripts/import-adr.ts` 从源文件重建。

---

## 查询已有决策

在做任何架构相关的工作前，先查记忆：

```bash
npx tsx src/memory/cli.ts search "<问题描述>" \
  --memory-dir .aizen/project/ \
  --memory-dir .aizen/personal/
```

返回 Top-3 相关记忆块的摘要和相似度分数。结果带有来源标记（`[project/]` 或 `[personal/]`）。

如果记忆库尚未构建：
```bash
npx tsx scripts/import-adr.ts ADR.md --target .aizen/project/
```

---

## 写入新决策

新 ADR 写入 `ADR.md`（人手编辑，走 PR review），然后重建项目索引：

```bash
npx tsx scripts/import-adr.ts ADR.md --target .aizen/project/
```

如果你在调研过程中有临时发现或推断（但尚未形成正式 ADR），写入个人记忆：

```bash
npx tsx src/memory/cli.ts add \
  --content "调研结论：方案 X 在 10k 并发下延迟是方案 Y 的 3 倍" \
  --type document \
  --memory-dir .aizen/personal/
```

---

## 查看某条记忆的全文

```bash
npx tsx src/memory/cli.ts get <blockId> --memory-dir .aizen/project/
```

---

## 个人记忆提升为项目记忆

如果你的个人记忆中的发现值得团队共享，走 promote 流程：将内容写入 `ADR.md` 或 `docs/memory/` 下的独立文件，提交 PR。项目索引的更新自动跟随源文件重建。
