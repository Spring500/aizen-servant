## 对话规则

1. **说中文，说清楚。** 不造名词、不造缩写、不用英文术语替代中文概念。歧义比啰嗦更坏。

2. **先说结论，再说理由。** 回复交付价值后立刻停止：
   - "是不是"类问题：1-3 句话
   - "为什么"类问题：结论一句 + 解释段
   - 展示方案：用表格/清单而非段落
   - 禁止追问"要不要我继续"，禁止在没有被要求时解释代码
   - 用户说"展开"或"详细说"时，以上限制解除

3. **不奉承。** 用户说错了必须纠正。同意必须基于客观判断——不附和，不拍马，不"你说得对但是"的假同意。沉默不表示同意。

4. **不确定的事必须存疑。** 以下事项禁止当作已确认的结论使用：
   - 我们没有讨论过的事
   - 讨论过但未写入 ADR、ROADMAP 或代码注释的事
   - 你在对话中自己推断但未向我确认的事
   有疑问时先问。不确定时写明"这是我的推断，尚未确认"。

## 技术约定

- **语言**: TypeScript strict mode，ESM (`"type": "module"`)
- **运行时**: Node.js ≥ 20，开发期 `tsx`，生产期 `bun build --compile`
- **包管理**: bun
- **测试**: Vitest，TDD 流程——先写失败的测试，再写实现
- **持久化**: 纯文本文件（JSONL + 二进制 `.vec`），零数据库
- **代码风格**: 每个函数必须有中文注释说明用途和参数含义。逻辑不可自明处补充注释。不用注释重复代码本身（"计算总价"对 `calculateTotalPrice` 是噪音）

### Git 提交

```
<type>: <中文简述>

<中文详细说明（可选，简述说不清时写）>
Via: opencode
```

**Type**（兼容 Conventional Commits）：

| type | 含义 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修 bug |
| `refactor` | 重构（不改变行为） |
| `test` | 新增或修改测试 |
| `docs` | 文档 |
| `chore` | 工程杂务 |

**规则：**

- 一次提交一个逻辑意图。该意图的附属改动（功能必需的测试、连带改动的文档）不算跨类型
- 简述用中文，不造缩写
- 提交末尾附 `Via: opencode`，标注来自 coding agent
- 人类手动提交时 `Via` 行可省略
- **禁止使用 `--no-verify`、设置 `HUSKY=0`、修改 `core.hooksPath` 或任何其他方式绕过 commit-msg hook 校验。** hook 报错时必须排查原因、修复问题后重新提交。

## 架构

AizenServant 是一个基于 Pi SDK 的 7x24 多 channel agent。本文件是稳定的人手写规则，agent 禁止修改。

## 记忆系统（aizen-memory）

项目使用 aizen-memory 管理架构决策记录（ADR）和调研结论。记忆分两层：

| 层 | 路径 | 性质 |
|----|------|------|
| 项目记忆 | `.aizen/project/` | 团队共享，从 `ADR.md` 构建索引 |
| 个人记忆 | `.aizen/personal/` | 私有，记录临时发现和未确认推断 |

### 查询

做架构相关工作前，先查记忆：

```bash
npx tsx src/memory/cli.ts search "<问题描述>" \
  --memory-dir .aizen/project/ \
  --memory-dir .aizen/personal/
```

如果记忆库尚未构建：
```bash
npx tsx scripts/import-adr.ts ADR.md --target .aizen/project/
```

### 何时写入

#### 写入 ADR（项目记忆）— 三个条件同时满足时

1. 你在 ≥2 个可行方案中做出了选择
2. 改变这个选择需要修改 ≥3 个文件或影响 ≥2 个模块的接口
3. 这个选择不能从代码本身一眼看出原因

全部满足 → 编辑根目录 `ADR.md`，追加新条目，然后重建索引：
```bash
npx tsx scripts/import-adr.ts ADR.md --target .aizen/project/
```

#### 写入个人记忆 — 满足任一条件时

- 你通过实验/调研得出了一个结论，且该结论影响后续决策
- 你发现了一个非显而易见的约束（性能瓶颈、API 限制、兼容性问题）
- 你排除了一个看似可行但实际不可行的方案（记录"为什么不行"）

```bash
npx tsx src/memory/cli.ts add \
  --content "<结论内容>" \
  --type document \
  --memory-dir .aizen/personal/
```

#### 不写 — 以下情况跳过

- 只有一个合理选项，没有真正的"选择"
- 代码本身已经是文档（命名清晰、类型完整）
- 临时 workaround 且已在代码注释中标记了 TODO

### 个人记忆提升为项目记忆

当个人记忆中的发现值得团队共享时：将内容写入 `ADR.md`，提交 PR，合并后重建项目索引。
