/**
 * commit-msg hook — 校验 AizenServant 提交规范
 * 规则见 AGENTS.md § 技术约定 > Git 提交
 *
 * 用法：由 .husky/commit-msg 调用，参数 $1 为 commit message 暂存文件路径
 */

import { readFileSync } from "node:fs";

/** 允许的提交 type（与 AGENTS.md 同步） */
const ALLOWED_TYPES = ["feat", "fix", "refactor", "test", "docs", "chore"] as const;

/** 错误消息模板 */
const HELP = [
  "",
  "  要求: <type>: <中文简述>",
  "  示例: feat: 新增记忆块存储层",
  "        fix: 修复向量搜索泄漏",
  "",
  `  type: ${ALLOWED_TYPES.join(" | ")}`,
  "",
];

/**
 * 校验提交首行格式
 * 返回错误消息字符串，合法时返回 null
 */
function validate(msgPath: string): string | null {
  const raw = readFileSync(msgPath, "utf-8");
  const firstLine = raw.split("\n")[0]!.trim();

  // ── 解析 type ──
  const colonIdx = firstLine.indexOf(":");
  if (colonIdx === -1) {
    return `❌ 提交首行格式错误\n${HELP.join("\n")}  你的提交:\n  ${firstLine}`;
  }

  const type = firstLine.slice(0, colonIdx).trim();
  const desc = firstLine.slice(colonIdx + 1).trim();

  // ── 校验 type ──
  if (!(ALLOWED_TYPES as readonly string[]).includes(type)) {
    return `❌ 无效的提交 type: '${type}'\n${HELP.join("\n")}  你的提交:\n  ${firstLine}`;
  }

  // ── 校验描述 ──
  if (desc.length === 0) {
    return `❌ type 后的描述不能为空\n${HELP.join("\n")}  你的提交:\n  ${firstLine}`;
  }

  return null;
}

// ── 入口 ──
const msgPath = process.argv[2];
if (!msgPath) {
  console.error("用法: commit-msg.ts <commit-message-file>");
  process.exit(1);
}

const err = validate(msgPath);
if (err) {
  console.error(err);
  process.exit(1);
}

console.log(`✅ 提交格式：${readFileSync(msgPath, "utf-8").split("\n")[0]!.split(":")[0]!}`);
process.exit(0);
