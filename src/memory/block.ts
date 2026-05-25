import { ulid } from 'ulid';
import { z } from 'zod';

/** 允许的记忆块类型列表 */
export const BlockTypes = ['conversation', 'document', 'ai_insight', 'external'] as const;
/** 记忆块类型 */
export type BlockType = (typeof BlockTypes)[number];

/** ULID 格式校验正则 */
const ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** 记忆块数据结构 —— 持久化到 JSON 文件的完整 schema */
export const MemoryBlockSchema = z.object({
  blockId: z.string().regex(ulidRegex, '非法 blockId 格式'),
  type: z.enum(BlockTypes),
  createdAt: z.number(),
  source: z.record(z.string(), z.string()).default({}),
  content: z.string().min(1, 'content 不能为空'),
  weight: z.object({
    boosts: z.array(z.object({
      at: z.number(),
      sessionForkId: z.string(),
    })).default([]),
    negativeMarks: z.number().int().min(0).default(0),
  }).default({}),
  embedding: z.array(z.number()).optional(),
  deprecated: z.boolean().default(false),
  supersededBy: z.string().nullable().default(null),
  meta: z.record(z.string(), z.unknown()).default({}),
});

export type MemoryBlock = z.infer<typeof MemoryBlockSchema>;

/** 创建记忆块的输入参数 —— 不包含 blockId，由 store 内部生成 */
export interface CreateBlockInput {
  type: string;
  content: string;
  source?: Record<string, string>;
  meta?: Record<string, unknown>;
}

/**
 * 创建记忆块。自动生成 ULID，填充默认字段。
 *
 * @param input - 创建参数：type、content 必填，source/meta 可选
 * @returns 包含 ULID 和全量默认值的 MemoryBlock
 */
export function createBlock(input: CreateBlockInput): MemoryBlock {
  const now = Date.now();
  return {
    blockId: ulid(),
    type: input.type as BlockType,
    createdAt: now,
    source: input.source ?? {},
    content: input.content,
    weight: { boosts: [], negativeMarks: 0 },
    deprecated: false,
    supersededBy: null,
    meta: input.meta ?? {},
  };
}

/**
 * 用 Zod schema 校验一个未知对象是否为合法的 MemoryBlock。
 * 不合法时抛出 ZodError。
 *
 * @param block - 待校验的未知对象
 * @returns 通过校验的 MemoryBlock
 */
export function validateBlock(block: unknown): MemoryBlock {
  return MemoryBlockSchema.parse(block);
}
