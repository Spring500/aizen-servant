import { ulid } from 'ulid';
import { z } from 'zod';

export const BlockTypes = ['conversation', 'document', 'ai_insight', 'external'] as const;
export type BlockType = (typeof BlockTypes)[number];

const ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const MemoryBlockSchema = z.object({
  blockId: z.string().regex(ulidRegex, '非法 blockId 格式'),
  type: z.enum(BlockTypes),
  createdAt: z.number(),
  source: z.record(z.string(), z.string()).default({}),
  content: z.string().min(1, 'content 不能为空'),
  relations: z.object({
    prevId: z.string().nullable().default(null),
    nextId: z.string().nullable().default(null),
    related: z.array(z.string()).default([]),
  }).default({}),
  summary: z.object({
    self: z.string().default(''),
    prev: z.string().nullable().default(null),
    next: z.string().nullable().default(null),
  }).default({}),
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

export interface CreateBlockInput {
  type: string;
  content: string;
  source?: Record<string, string>;
  relations?: {
    prevId?: string;
    nextId?: string;
    related?: string[];
  };
  meta?: Record<string, unknown>;
}

export function createBlock(input: CreateBlockInput): MemoryBlock {
  const now = Date.now();
  return {
    blockId: ulid(),
    type: input.type as BlockType,
    createdAt: now,
    source: input.source ?? {},
    content: input.content,
    relations: {
      prevId: input.relations?.prevId ?? null,
      nextId: input.relations?.nextId ?? null,
      related: input.relations?.related ?? [],
    },
    summary: { self: '', prev: null, next: null },
    weight: { boosts: [], negativeMarks: 0 },
    deprecated: false,
    supersededBy: null,
    meta: input.meta ?? {},
  };
}

export function validateBlock(block: unknown): MemoryBlock {
  return MemoryBlockSchema.parse(block);
}
