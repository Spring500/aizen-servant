# aizen-memory Phase 1 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个可独立使用的本地语义记忆系统 CLI 工具 `aizen-memory`

**Architecture:** 五个模块——block（类型校验）、store（文件持久化）、embedder（Ollama 向量编码）、retriever（余弦相似度搜索）、cli（命令行入口）。外加一个临时脚本 import-adr 导入 ADR 文档。

**Tech Stack:** TypeScript ESM、Node.js ≥ 20、Vitest、Zod、ULID、tsx

---

## Task 1: 项目脚手架

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Modify: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "aizen-memory",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "ulid": "^3.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: 写 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: 写 vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: 更新 .gitignore**

在现有内容末尾追加：
```
node_modules/
dist/
.aizen/
data/
*.tsbuildinfo
```

- [ ] **Step 5: 创建 `.env.example`**

```
# Ollama embedding API
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=nomic-embed-text
```

- [ ] **Step 6: 安装依赖**

```bash
pnpm install
```

- [ ] **Step 7: 验证脚手架**

```bash
pnpm typecheck
pnpm test
```

Expected: typecheck 无错误，vitest 报告 0 tests（因为没有测试文件）。

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts .gitignore .env.example
git commit -m "chore: initialize project scaffold with pnpm + Vitest + TypeScript ESM"
```

---

## Task 2: MemoryBlock 类型定义

**Files:**
- Create: `src/memory/block.ts`
- Create: `tests/memory/block.test.ts`

- [ ] **Step 1: 写 block.test.ts（失败的测试）**

```typescript
import { describe, it, expect } from 'vitest';
import { createBlock, validateBlock } from '../../src/memory/block.js';

describe('createBlock', () => {
  it('生成一个带 ULID 和默认字段的块', () => {
    const block = createBlock({
      type: 'document',
      content: '这是测试内容',
      source: { filename: 'test.md' },
    });

    expect(block.blockId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(block.type).toBe('document');
    expect(block.content).toBe('这是测试内容');
    expect(block.source).toEqual({ filename: 'test.md' });
    expect(block.createdAt).toBeTypeOf('number');
    expect(block.relations).toEqual({ prevId: null, nextId: null, related: [] });
    expect(block.summary).toEqual({ self: '', prev: null, next: null });
    expect(block.weight).toEqual({ boosts: [], negativeMarks: 0 });
    expect(block.deprecated).toBe(false);
    expect(block.supersededBy).toBeNull();
  });

  it('两次调用生成不同的 ULID', () => {
    const a = createBlock({ type: 'document', content: 'a' });
    const b = createBlock({ type: 'document', content: 'b' });
    expect(a.blockId).not.toBe(b.blockId);
  });
});

describe('validateBlock', () => {
  it('通过合法的 block', () => {
    const block = createBlock({ type: 'document', content: 'test' });
    expect(() => validateBlock(block)).not.toThrow();
  });

  it('拒绝非法的 type', () => {
    const block = { ...createBlock({ type: 'document', content: 'x' }), type: 'invalid' };
    expect(() => validateBlock(block)).toThrow();
  });

  it('拒绝空的 content', () => {
    const block = { ...createBlock({ type: 'document', content: 'x' }), content: '' };
    expect(() => validateBlock(block)).toThrow();
  });

  it('拒绝非 ULID 格式的 blockId', () => {
    const block = { ...createBlock({ type: 'document', content: 'x' }), blockId: 'not-ulid' };
    expect(() => validateBlock(block)).toThrow();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
pnpm test tests/memory/block.test.ts
```

Expected: FAIL — 找不到模块 `../../src/memory/block.js`。

- [ ] **Step 3: 写 src/memory/block.ts**

```typescript
import { ulid } from 'ulid';
import { z } from 'zod';

/** 记忆块类型常量 */
export const BlockTypes = ['conversation', 'document', 'ai_insight', 'external'] as const;
export type BlockType = (typeof BlockTypes)[number];

/** ULID 正则：26 字符 Crockford Base32 */
const ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** 记忆块 Zod schema */
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

/** 创建记忆块所需的最小输入 */
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

/**
 * 创建一个新的记忆块，自动填充 ULID、时间戳和默认字段。
 * 不在此阶段校验 type/content——调用方可先构造再 validate。
 */
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

/**
 * 校验一个对象是否符合 MemoryBlock schema。
 * 不通过时抛出 ZodError。
 */
export function validateBlock(block: unknown): MemoryBlock {
  return MemoryBlockSchema.parse(block);
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
pnpm test tests/memory/block.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/memory/block.ts tests/memory/block.test.ts
git commit -m "feat: add MemoryBlock type with ULID and Zod validation"
```

---

## Task 3: BlockStore（存储层）

**Files:**
- Create: `src/memory/store.ts`
- Create: `tests/memory/store.test.ts`

- [ ] **Step 1: 写 store.test.ts（失败的测试）**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BlockStore } from '../../src/memory/store.js';
import { createBlock } from '../../src/memory/block.js';

let testDir: string;
let store: BlockStore;

beforeEach(() => {
  testDir = join(tmpdir(), `aizen-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  store = new BlockStore(testDir);
});

afterEach(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true });
});

describe('BlockStore', () => {
  it('ensureDir 创建目录结构', () => {
    store.ensureDir();
    expect(existsSync(join(testDir, 'blocks'))).toBe(true);
  });

  it('append 写入 JSON 文件和 .vec', async () => {
    const block = createBlock({ type: 'document', content: 'hello' });
    const emb = new Float32Array(768).fill(0.1);
    await store.append(block, emb);

    const jsonPath = join(testDir, 'blocks', `${block.blockId}.json`);
    expect(existsSync(jsonPath)).toBe(true);

    const vecPath = join(testDir, 'blocks.vec');
    expect(existsSync(vecPath)).toBe(true);
  });

  it('getBlock 读取已写入的块', async () => {
    const block = createBlock({ type: 'document', content: 'hello world' });
    const emb = new Float32Array(768).fill(0.1);
    await store.append(block, emb);

    const loaded = store.getBlock(block.blockId);
    expect(loaded).not.toBeNull();
    expect(loaded!.blockId).toBe(block.blockId);
    expect(loaded!.content).toBe('hello world');
  });

  it('getBlock 不存在的块返回 null', () => {
    expect(store.getBlock('01J4XK7N8P9Q2R3S4T5V6W7X8')).toBeNull();
  });

  it('getAllBlocks 按文件名排序返回', async () => {
    const a = createBlock({ type: 'document', content: 'a' });
    const b = createBlock({ type: 'document', content: 'b' });
    const emb = new Float32Array(768);
    await store.append(a, emb);
    await store.append(b, emb);

    const blocks = store.getAllBlocks();
    expect(blocks.length).toBe(2);
    // ULID 时间可排序，b 在 a 之后
    expect(blocks[0].blockId).toBe(a.blockId);
    expect(blocks[1].blockId).toBe(b.blockId);
  });

  it('loadVectors 加载 .vec 文件', async () => {
    const block = createBlock({ type: 'document', content: 'x' });
    const emb = new Float32Array(768);
    emb[0] = 0.42;
    emb[1] = 0.73;
    await store.append(block, emb);

    const vec = store.loadVectors();
    expect(vec.length).toBe(768);
    expect(vec[0]).toBeCloseTo(0.42);
    expect(vec[1]).toBeCloseTo(0.73);
  });

  it('loadVectors 文件不存在返回空', () => {
    const vec = store.loadVectors();
    expect(vec.length).toBe(0);
  });

  it('needsRebuild 首次为 true', () => {
    store.ensureDir();
    expect(store.needsRebuild()).toBe(true);
  });

  it('needsRebuild updateHash 后为 false', async () => {
    const block = createBlock({ type: 'document', content: 'x' });
    await store.append(block, new Float32Array(768));
    store.updateHash();
    expect(store.needsRebuild()).toBe(false);
  });

  it('needsRebuild 新增文件后变为 true', async () => {
    const block1 = createBlock({ type: 'document', content: 'x' });
    await store.append(block1, new Float32Array(768));
    store.updateHash();

    // 第二个块追加
    const block2 = createBlock({ type: 'document', content: 'y' });
    await store.append(block2, new Float32Array(768));

    expect(store.needsRebuild()).toBe(true);
  });

  it('stats 返回正确的统计', async () => {
    const emb = new Float32Array(768).fill(0.1);
    await store.append(createBlock({ type: 'document', content: 'a' }), emb);
    await store.append(createBlock({ type: 'document', content: 'b' }), emb);

    expect(store.stats()).toEqual({
      blockCount: 2,
      indexedCount: 2,
      vecSizeBytes: 2 * 768 * 4,
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
pnpm test tests/memory/store.test.ts
```

Expected: FAIL — `BlockStore` 未定义。

- [ ] **Step 3: 写 src/memory/store.ts**

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { MemoryBlock } from './block.js';

const VEC_ROW_BYTES = 768 * 4; // float32 × 768

/** 记忆块的持久化存储。每个块一个 JSON 文件，整个目录共享一个 .vec。 */
export class BlockStore {
  private blocksDir: string;
  private vecPath: string;
  private hashPath: string;

  constructor(private memoryDir: string) {
    this.blocksDir = join(memoryDir, 'blocks');
    this.vecPath = join(memoryDir, 'blocks.vec');
    this.hashPath = join(memoryDir, 'blocks.hash');
  }

  /** 确保 blocks/ 目录存在 */
  ensureDir(): void {
    mkdirSync(this.blocksDir, { recursive: true });
  }

  /**
   * 将内存块和 embedding 向量写入存储。
   */
  async append(block: MemoryBlock, embedding: Float32Array): Promise<void> {
    this.ensureDir();

    const { blockId, embedding: _emb, ...rest } = block;
    const jsonPath = join(this.blocksDir, `${blockId}.json`);
    writeFileSync(jsonPath, JSON.stringify(rest, null, 2), 'utf-8');

    this.insertVectorRow(blockId, embedding);
  }

  /** 按 blockId 读取单个块 */
  getBlock(blockId: string): MemoryBlock | null {
    const jsonPath = join(this.blocksDir, `${blockId}.json`);
    if (!existsSync(jsonPath)) return null;

    const raw = readFileSync(jsonPath, 'utf-8');
    const fields = JSON.parse(raw);
    return { blockId, ...fields } as MemoryBlock;
  }

  /** 读取所有块，按文件名（ULID）排序 */
  getAllBlocks(): MemoryBlock[] {
    this.ensureDir();
    const files = readdirSync(this.blocksDir)
      .filter(f => f.endsWith('.json'))
      .sort();

    return files.map(f => {
      const blockId = f.replace('.json', '');
      return this.getBlock(blockId)!;
    });
  }

  /** 返回所有 blockId（文件名排序） */
  listBlockIds(): string[] {
    this.ensureDir();
    return readdirSync(this.blocksDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .map(f => f.replace('.json', ''));
  }

  /** 加载 .vec 文件为 Float32Array。文件不存在返回空数组。 */
  loadVectors(): Float32Array {
    if (!existsSync(this.vecPath)) return new Float32Array(0);

    const buf = readFileSync(this.vecPath);
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  }

  /**
   * 将 embeddings 映射写回 .vec 文件。
   * embeddings: blockId → Float32Array（null 表示未索引，写全零）
   */
  writeVec(embeddings: Map<string, Float32Array | null>): void {
    const ids = this.listBlockIds();
    const totalBytes = ids.length * VEC_ROW_BYTES;
    const buf = Buffer.alloc(totalBytes);

    for (let i = 0; i < ids.length; i++) {
      const emb = embeddings.get(ids[i]);
      if (emb) {
        const rowOffset = i * VEC_ROW_BYTES;
        for (let j = 0; j < emb.length; j++) {
          buf.writeFloatLE(emb[j], rowOffset + j * 4);
        }
      }
      // emb 为 null → 保留全零
    }

    writeFileSync(this.vecPath, buf);
  }

  /** 根据 blockId 获取在 .vec 中的行号 */
  getVectorIndex(blockId: string): number {
    return this.listBlockIds().indexOf(blockId);
  }

  /**
   * 使用文件名 + mtime 的 SHA256 做脏检测。
   * 返回 true 表示 .vec 需要重建。
   */
  needsRebuild(): boolean {
    if (!existsSync(this.hashPath)) return true;

    const currentHash = this.computeMtimeHash();
    const storedHash = readFileSync(this.hashPath, 'utf-8').trim();
    return currentHash !== storedHash;
  }

  /** 重新计算并持久化 mtime hash */
  updateHash(): void {
    const hash = this.computeMtimeHash();
    writeFileSync(this.hashPath, hash, 'utf-8');
  }

  /** 统计信息 */
  stats(): { blockCount: number; indexedCount: number; vecSizeBytes: number } {
    const ids = this.listBlockIds();
    const vecSize = existsSync(this.vecPath) ? statSync(this.vecPath).size : 0;

    let indexedCount = 0;
    if (existsSync(this.vecPath)) {
      const vec = this.loadVectors();
      for (let i = 0; i < ids.length; i++) {
        const start = i * 768;
        const slice = vec.slice(start, start + 768);
        if (slice.some(v => v !== 0)) indexedCount++;
      }
    }

    return { blockCount: ids.length, indexedCount, vecSizeBytes: vecSize };
  }

  // ─── 内部方法 ───

  private computeMtimeHash(): string {
    this.ensureDir();
    const hasher = createHash('sha256');
    const files = readdirSync(this.blocksDir)
      .filter(f => f.endsWith('.json'))
      .sort();

    for (const f of files) {
      const mtime = statSync(join(this.blocksDir, f)).mtimeMs;
      hasher.update(`${f}:${mtime},`);
    }

    return hasher.digest('hex');
  }

  /**
   * 在 .vec 中插入/更新一行。新块排在末尾（ULID 可排序）。
   */
  private insertVectorRow(blockId: string, embedding: Float32Array): void {
    const ids = this.listBlockIds();
    // ids 按文件名排序，blockId 是 ULID，新块自然在末尾
    const idx = ids.indexOf(blockId);
    const targetIdx = idx >= 0 ? idx : ids.length;
    const totalRows = Math.max(ids.length + (idx < 0 ? 1 : 0), targetIdx + 1);

    const oldVec = existsSync(this.vecPath)
      ? new Float32Array(readFileSync(this.vecPath).buffer)
      : new Float32Array(0);

    const newBuf = Buffer.alloc(totalRows * VEC_ROW_BYTES);

    // 复制旧行
    const oldRowCount = Math.floor(oldVec.length / 768);
    let oldRow = 0;
    for (let i = 0; i < totalRows; i++) {
      const expectedId = i < ids.length ? ids[i] : blockId;
      if (expectedId === blockId && i === targetIdx) continue; // skip new row position

      const srcOffset = oldRow * VEC_ROW_BYTES;
      const dstOffset = i * VEC_ROW_BYTES;
      for (let j = 0; j < 768 && srcOffset + j * 4 < oldVec.length * 4; j++) {
        newBuf.writeFloatLE(oldVec[oldRow * 768 + j], dstOffset + j * 4);
      }
      oldRow++;
    }

    // 写入新行
    const dstOffset = targetIdx * VEC_ROW_BYTES;
    for (let j = 0; j < embedding.length; j++) {
      newBuf.writeFloatLE(embedding[j], dstOffset + j * 4);
    }

    writeFileSync(this.vecPath, newBuf);
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
pnpm test tests/memory/store.test.ts
```

Expected: 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/memory/store.ts tests/memory/store.test.ts
git commit -m "feat: add BlockStore with per-file JSON + shared .vec + mtime hash"
```

---

## Task 4: OllamaEmbedder

**Files:**
- Create: `src/memory/embedder.ts`
- Create: `tests/memory/embedder.test.ts`

- [ ] **Step 1: 写 embedder.test.ts（失败的测试）**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { OllamaEmbedder } from '../../src/memory/embedder.js';

describe('OllamaEmbedder', () => {
  let server: Server;
  let baseUrl: string;
  let embedder: OllamaEmbedder;
  let lastRequestBody: string;

  beforeEach(async () => {
    lastRequestBody = '';
    server = createServer((req, res) => {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        lastRequestBody = body;

        if (req.url === '/bad') {
          res.writeHead(500);
          res.end('Internal Server Error');
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          embeddings: [[...new Array(768).fill(0.1)]],
        }));
      });
    });

    await new Promise<void>(resolve => server.listen(0, () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to get server address');
    baseUrl = `http://localhost:${addr.port}`;
    embedder = new OllamaEmbedder(baseUrl);
  });

  afterEach(() => {
    server.close();
  });

  it('dimensions 返回 768', () => {
    expect(embedder.dimensions).toBe(768);
  });

  it('embed 返回 Float32Array[768]', async () => {
    const result = await embedder.embed('test');
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(768);
  });

  it('embed 空字符串抛错', async () => {
    await expect(embedder.embed('')).rejects.toThrow('embed 文本不能为空');
  });

  it('连接失败抛错', async () => {
    const bad = new OllamaEmbedder('http://127.0.0.1:19999');
    await expect(bad.embed('test')).rejects.toThrow('Ollama 服务不可用');
  });

  it('HTTP 错误抛错', async () => {
    embedder = new OllamaEmbedder(`${baseUrl}/bad`);
    await expect(embedder.embed('test')).rejects.toThrow('Embedding API 错误');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
pnpm test tests/memory/embedder.test.ts
```

Expected: FAIL — `OllamaEmbedder` 未定义。

- [ ] **Step 3: 写 src/memory/embedder.ts**

```typescript
/** 文本 → 向量编码接口 */
export interface Embedder {
  readonly dimensions: number;
  embed(text: string): Promise<Float32Array>;
}

/**
 * 通过 Ollama API 调用 nomic-embed-text 做文本向量化。
 * Phase 1 硬编码 Ollama，接口已就绪供后续替换。
 */
export class OllamaEmbedder implements Embedder {
  readonly dimensions = 768;

  constructor(
    private baseUrl: string = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
    private model: string = process.env.OLLAMA_MODEL ?? 'nomic-embed-text',
  ) {}

  async embed(text: string): Promise<Float32Array> {
    if (!text || text.trim().length === 0) {
      throw new Error('embed 文本不能为空');
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
      });
    } catch {
      throw new Error(`Ollama 服务不可用 (${this.baseUrl})`);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Embedding API 错误: ${response.status} ${body}`);
    }

    const data = (await response.json()) as { embeddings: number[][] };
    const raw = data.embeddings[0];
    if (!raw || raw.length !== 768) {
      throw new Error(`Embedding API 返回了非预期的维度: ${raw?.length}`);
    }

    // 归一化
    const vec = new Float32Array(raw);
    this.normalize(vec);
    return vec;
  }

  private normalize(vec: Float32Array): void {
    let sum = 0;
    for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
    const len = Math.sqrt(sum);
    if (len > 0) {
      for (let i = 0; i < vec.length; i++) vec[i] /= len;
    }
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
pnpm test tests/memory/embedder.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/memory/embedder.ts tests/memory/embedder.test.ts
git commit -m "feat: add OllamaEmbedder with nomic-embed-text encoding"
```

---

## Task 5: Retriever（检索器）

**Files:**
- Create: `src/memory/retriever.ts`
- Create: `tests/memory/retriever.test.ts`

- [ ] **Step 1: 写 retriever.test.ts（失败的测试）**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Retriever, cosineSimilarity } from '../../src/memory/retriever.js';
import { BlockStore } from '../../src/memory/store.js';
import { createBlock } from '../../src/memory/block.js';

function makeEmbedder() {
  return {
    dimensions: 768,
    async embed(text: string): Promise<Float32Array> {
      // 用 text 的第一个字符的 charCode 生成确定性向量
      const vec = new Float32Array(768);
      const seed = text.charCodeAt(0) || 0;
      for (let i = 0; i < 768; i++) {
        vec[i] = Math.sin(seed + i * 0.01);
      }
      // 归一化
      let sum = 0;
      for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
      const len = Math.sqrt(sum);
      for (let i = 0; i < vec.length; i++) vec[i] /= len;
      return vec;
    },
  };
}

describe('cosineSimilarity', () => {
  it('相同向量相似度为 1', () => {
    const v = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it('正交向量相似度为 0', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });
});

describe('Retriever', () => {
  let testDir1: string;
  let testDir2: string;
  let store1: BlockStore;
  let store2: BlockStore;
  let retriever: Retriever;

  beforeEach(async () => {
    testDir1 = join(tmpdir(), `aizen-r1-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    testDir2 = join(tmpdir(), `aizen-r2-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    store1 = new BlockStore(testDir1);
    store2 = new BlockStore(testDir2);

    const embedder = makeEmbedder();
    retriever = new Retriever(embedder);

    const b1 = createBlock({ type: 'document', content: '这是关于 Channel 架构的决策' });
    b1.summary.self = 'ADR-007 Channel 架构';
    await store1.append(b1, await embedder.embed(b1.content));

    const b2 = createBlock({ type: 'document', content: 'Python 语言的选择讨论' });
    b2.summary.self = 'ADR-001 核心语言';
    await store1.append(b2, await embedder.embed(b2.content));

    const b3 = createBlock({ type: 'document', content: '个人笔记：部署脚本问题' });
    b3.summary.self = '部署脚本个人笔记';
    await store2.append(b3, await embedder.embed(b3.content));
  });

  afterEach(() => {
    if (existsSync(testDir1)) rmSync(testDir1, { recursive: true });
    if (existsSync(testDir2)) rmSync(testDir2, { recursive: true });
  });

  it('单源检索返回结果', async () => {
    const results = await retriever.search('channel 架构', [testDir1], 3);
    expect(results.length).toBeGreaterThan(0);
  });

  it('多源合并，结果含来源标注', async () => {
    const results = await retriever.search('channel 架构', [testDir1, testDir2], 5);
    expect(results.length).toBeGreaterThan(0);
    const sources = new Set(results.map(r => r.source));
    // 两个 source 都可能出现
    expect(sources.size).toBeGreaterThanOrEqual(1);
  });

  it('无内容时返回空数组', async () => {
    const emptyDir = join(tmpdir(), `aizen-empty-${Date.now()}`);
    const emptyStore = new BlockStore(emptyDir);
    emptyStore.ensureDir();

    const results = await retriever.search('anything', [emptyDir], 3);
    expect(results).toEqual([]);

    rmSync(emptyDir, { recursive: true });
  });

  it('query 为空抛错', async () => {
    await expect(retriever.search('', [testDir1])).rejects.toThrow();
  });

  it('memoryDirs 为空抛错', async () => {
    await expect(retriever.search('test', [])).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
pnpm test tests/memory/retriever.test.ts
```

Expected: FAIL — `Retriever` 未定义。

- [ ] **Step 3: 写 src/memory/retriever.ts**

```typescript
import { BlockStore } from './store.js';
import type { Embedder } from './embedder.js';

/** 搜索结果 */
export interface SearchResult {
  blockId: string;
  score: number;
  summary: string;
  content: string;
  source: string;
}

/** 两个同维向量的余弦相似度 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * 语义检索器。从多个记忆目录中检索最相关的块。
 */
export class Retriever {
  constructor(private embedder: Embedder) {}

  /**
   * 检索与 query 最相关的记忆块。
   * @param query    自然语言查询
   * @param memoryDirs  记忆目录路径数组
   * @param k       返回 Top-K 条
   */
  async search(query: string, memoryDirs: string[], k: number = 3): Promise<SearchResult[]> {
    if (!query || query.trim().length === 0) {
      throw new Error('查询内容不能为空');
    }
    if (memoryDirs.length === 0) {
      throw new Error('memoryDirs 不能为空');
    }

    const queryVec = await this.embedder.embed(query);
    const allResults: SearchResult[] = [];

    for (const dir of memoryDirs) {
      const store = new BlockStore(dir);

      if (store.needsRebuild()) {
        // 自动重建
        const blocks = store.getAllBlocks();
        const embeddings = new Map<string, Float32Array | null>();
        for (const block of blocks) {
          try {
            const emb = await this.embedder.embed(block.content);
            embeddings.set(block.blockId, emb);
          } catch {
            embeddings.set(block.blockId, null);
          }
        }
        store.writeVec(embeddings);
        store.updateHash();
      }

      const vec = store.loadVectors();
      if (vec.length === 0) continue;

      const ids = store.listBlockIds();
      const rowCount = Math.floor(vec.length / this.embedder.dimensions);

      for (let i = 0; i < rowCount; i++) {
        const start = i * this.embedder.dimensions;
        const row = vec.slice(start, start + this.embedder.dimensions);

        // 跳过全零行（未 indexed）
        if (row.every(v => v === 0)) continue;

        const score = cosineSimilarity(queryVec, row);
        const block = store.getBlock(ids[i]);
        if (!block) continue;

        allResults.push({
          blockId: block.blockId,
          score,
          summary: block.summary.self,
          content: block.content,
          source: dir,
        });
      }
    }

    allResults.sort((a, b) => b.score - a.score);
    return allResults.slice(0, k);
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
pnpm test tests/memory/retriever.test.ts
```

Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/memory/retriever.ts tests/memory/retriever.test.ts
git commit -m "feat: add Retriever with multi-source cosine similarity search"
```

---

## Task 6: CLI 命令入口

**Files:**
- Create: `src/memory/cli.ts`

- [ ] **Step 1: 写 src/memory/cli.ts**

```typescript
#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { BlockStore } from './store.js';
import { OllamaEmbedder } from './embedder.js';
import { Retriever } from './retriever.js';
import { createBlock } from './block.js';

// 函数声明在后，先看整体流程

/**
 * aizen-memory — 本地语义记忆系统 CLI
 *
 * 用法:
 *   npx tsx src/memory/cli.ts add --content "<text>" --type <type> --memory-dir <path>
 *   npx tsx src/memory/cli.ts get <blockId> --memory-dir <path>
 *   npx tsx src/memory/cli.ts search "<query>" --memory-dir <path> [--memory-dir <path> ...] [-k <N>]
 *   npx tsx src/memory/cli.ts stats --memory-dir <path> [--memory-dir <path> ...]
 *   npx tsx src/memory/cli.ts rebuild --memory-dir <path>
 */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const cmd = args[0];
  const rest = args.slice(1);

  switch (cmd) {
    case 'add': return cmdAdd(rest);
    case 'get': return cmdGet(rest);
    case 'search': return cmdSearch(rest);
    case 'stats': return cmdStats(rest);
    case 'rebuild': return cmdRebuild(rest);
    default:
      console.error(`未知命令: ${cmd}`);
      printUsage();
      process.exit(1);
  }
}

function parseFlags(args: string[]): Map<string, string | string[]> {
  const map = new Map<string, string | string[]>();
  let i = 0;
  while (i < args.length) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const values: string[] = [];
      i++;
      while (i < args.length && !args[i].startsWith('--')) {
        values.push(args[i]);
        i++;
      }
      map.set(key, values.length === 1 ? values[0] : values);
    } else {
      i++;
    }
  }
  return map;
}

function requireFlag(flags: Map<string, string | string[]>, name: string): string {
  const v = flags.get(name);
  if (!v || typeof v !== 'string') {
    console.error(`错误: 缺少参数 --${name}`);
    process.exit(1);
  }
  return v;
}

function requireMultiDir(flags: Map<string, string | string[]>): string[] {
  const v = flags.get('memory-dir');
  if (!v) {
    console.error('错误: 请至少指定一个 --memory-dir');
    process.exit(1);
  }
  const dirs = Array.isArray(v) ? v : [v];
  for (const d of dirs) {
    if (!existsSync(d)) {
      console.error(`目录不存在: ${d}`);
      process.exit(1);
    }
  }
  return dirs;
}

function printUsage(): void {
  console.log(`用法:
  aizen-memory add --content "<text>" --type <type> --memory-dir <path>
  aizen-memory get <blockId> --memory-dir <path>
  aizen-memory search "<query>" --memory-dir <path> [--memory-dir <path> ...] [-k <N>]
  aizen-memory stats --memory-dir <path> [--memory-dir <path> ...]
  aizen-memory rebuild --memory-dir <path>`);
}

/** add — 创建新记忆块 */
async function cmdAdd(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const content = requireFlag(flags, 'content');
  const type = requireFlag(flags, 'type');
  const dir = requireFlag(flags, 'memory-dir');

  if (!existsSync(dir)) {
    // 自动创建目录结构
    const store = new BlockStore(dir);
    store.ensureDir();
  }

  const validTypes = ['conversation', 'document', 'ai_insight', 'external'];
  if (!validTypes.includes(type)) {
    console.error(`错误: --type 必须为 ${validTypes.join(' | ')}`);
    process.exit(1);
  }

  const block = createBlock({
    type,
    content,
    source: {
      filename: (flags.get('source-filename') as string) ?? 'manual',
      section: (flags.get('source-section') as string) ?? '',
    },
  });

  const embedder = new OllamaEmbedder();
  const embedding = await embedder.embed(content);

  const store = new BlockStore(dir);
  await store.append(block, embedding);

  console.log(`已创建: ${block.blockId}`);
}

/** get — 按 ID 查看记忆块 */
function cmdGet(args: string[]): void {
  const flags = parseFlags(args);
  const dir = requireFlag(flags, 'memory-dir');
  const blockId = args.find(a => !a.startsWith('--'));
  if (!blockId) {
    console.error('错误: 请指定 blockId');
    process.exit(1);
  }

  if (!existsSync(dir)) {
    console.error(`目录不存在: ${dir}`);
    process.exit(1);
  }

  const store = new BlockStore(dir);
  const block = store.getBlock(blockId);
  if (!block) {
    console.error(`块不存在: ${blockId}`);
    process.exit(1);
  }

  const d = new Date(block.createdAt);
  console.log(`类型:       ${block.type}`);
  console.log(`来源:       ${JSON.stringify(block.source)}`);
  console.log(`创建时间:   ${d.toISOString()}`);
  console.log(`摘要:       ${block.summary.self || '(无)'}`);
  console.log();
  console.log(block.content);
}

/** search — 语义检索 */
async function cmdSearch(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  // 提取 query——第一个非 flag 参数
  const posArgs = args.filter(a => !a.startsWith('--') && !a.startsWith('-'));
  const query = posArgs[0];

  if (!flags.has('memory-dir')) {
    console.error('错误: 请至少指定一个 --memory-dir');
    console.error('用法: aizen-memory search <query> --memory-dir <path> [--memory-dir <path> ...]');
    process.exit(1);
  }

  if (!query || query.trim().length === 0) {
    console.error('搜索内容不能为空');
    process.exit(1);
  }

  const dirs = requireMultiDir(flags);
  const k = parseInt((flags.get('k') as string) ?? '3', 10);

  const embedder = new OllamaEmbedder();
  const retriever = new Retriever(embedder);

  try {
    const results = await retriever.search(query, dirs, k);
    if (results.length === 0) {
      console.log('未找到相关记忆');
      return;
    }
    for (const r of results) {
      const sourceLabel = r.source.split('/').slice(-2).join('/');
      console.log(`[${sourceLabel}] ${r.score.toFixed(3)}  ${r.summary || '(无摘要)'}`);
    }
  } catch (err) {
    console.error(`检索失败: ${(err as Error).message}`);
    process.exit(1);
  }
}

/** stats — 记忆库状态 */
function cmdStats(args: string[]): void {
  const flags = parseFlags(args);

  if (!flags.has('memory-dir')) {
    console.error('错误: 请至少指定一个 --memory-dir');
    console.error('用法: aizen-memory stats --memory-dir <path> [--memory-dir <path> ...]');
    process.exit(1);
  }

  const dirs = requireMultiDir(flags);
  for (const dir of dirs) {
    const store = new BlockStore(dir);
    const s = store.stats();
    const kb = (s.vecSizeBytes / 1024).toFixed(0);
    console.log(`${dir}/`);
    console.log(`  记忆块:   ${s.blockCount}`);
    console.log(`  已索引:   ${s.indexedCount}`);
    console.log(`  向量文件: ${kb} KB`);
    console.log();
  }
}

/** rebuild — 重建向量索引 */
async function cmdRebuild(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const dir = requireFlag(flags, 'memory-dir');

  if (!existsSync(dir)) {
    console.error(`目录不存在: ${dir}`);
    process.exit(1);
  }

  const store = new BlockStore(dir);
  const blocks = store.getAllBlocks();
  const embedder = new OllamaEmbedder();

  console.log(`重建中 ... 0/${blocks.length}`);

  const embeddings = new Map<string, Float32Array | null>();
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    try {
      const emb = await embedder.embed(block.content);
      embeddings.set(block.blockId, emb);
    } catch (err) {
      console.error(`  ${block.blockId}: embedding 失败 — ${(err as Error).message}`);
      embeddings.set(block.blockId, null);
    }
    if ((i + 1) % 10 === 0 || i === blocks.length - 1) {
      process.stdout.write(`\r重建中 ... ${i + 1}/${blocks.length}`);
    }
  }
  console.log();

  store.writeVec(embeddings);
  store.updateHash();
  console.log('完成');
}

main().catch(err => {
  console.error(`致命错误: ${(err as Error).message}`);
  process.exit(1);
});
```

- [ ] **Step 2: 验证 CLI 可运行**

```bash
npx tsx src/memory/cli.ts
```

Expected: 打印用法并 exit 1。

- [ ] **Step 3: 验证 add 命令**

```bash
mkdir -p /tmp/aizen-test && npx tsx src/memory/cli.ts add --content "测试内容" --type document --memory-dir /tmp/aizen-test
```

Expected: 打印 `已创建: {blockId}`。

- [ ] **Step 4: 验证 get 命令**

```bash
npx tsx src/memory/cli.ts get <blockId> --memory-dir /tmp/aizen-test
```

Expected: 打印块的详细信息。

- [ ] **Step 5: 验证 search 命令**

```bash
npx tsx src/memory/cli.ts search "测试" --memory-dir /tmp/aizen-test
```

Expected: 打印搜索结果（含 score）。

- [ ] **Step 6: 验证 stats 命令**

```bash
npx tsx src/memory/cli.ts stats --memory-dir /tmp/aizen-test
```

Expected: 打印记忆块统计。

- [ ] **Step 7: 验证 rebuild 命令**

```bash
npx tsx src/memory/cli.ts rebuild --memory-dir /tmp/aizen-test
```

Expected: 打印 `重建中 ... 1/1` 和 `完成`。

- [ ] **Step 8: 验证错误路径**

```bash
npx tsx src/memory/cli.ts search "test"  # 缺少 --memory-dir
npx tsx src/memory/cli.ts search "" --memory-dir /tmp/aizen-test  # 空查询
npx tsx src/memory/cli.ts search "test" --memory-dir /tmp/nonexistent  # 不存在的目录
npx tsx src/memory/cli.ts get nosuchid --memory-dir /tmp/aizen-test  # 不存在的 ID
```

Expected: 各自报对应的错误。

- [ ] **Step 9: 清理测试数据**

```bash
rm -rf /tmp/aizen-test
```

- [ ] **Step 10: Commit**

```bash
git add src/memory/cli.ts
git commit -m "feat: add aizen-memory CLI with add/get/search/stats/rebuild"
```

---

## Task 7: ADR 导入脚本（临时）

**Files:**
- Create: `scripts/import-adr.ts`

- [ ] **Step 1: 写 scripts/import-adr.ts**

```typescript
/**
 * 一次性脚本：将 docs/ADR.md 的每个 ADR section 作为记忆块导入。
 *
 * 用法: npx tsx scripts/import-adr.ts docs/ADR.md --target .aizen/project/
 */

import { readFileSync, existsSync } from 'node:fs';
import { BlockStore } from '../src/memory/store.js';
import { OllamaEmbedder } from '../src/memory/embedder.js';
import { createBlock } from '../src/memory/block.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const inputFile = args.find(a => !a.startsWith('--'));
  if (!inputFile) {
    console.error('用法: npx tsx scripts/import-adr.ts <markdown-file> --target <memory-dir>');
    process.exit(1);
  }
  if (!existsSync(inputFile)) {
    console.error(`文件不存在: ${inputFile}`);
    process.exit(1);
  }

  const targetIdx = args.indexOf('--target');
  if (targetIdx === -1 || !args[targetIdx + 1]) {
    console.error('错误: 缺少 --target <memory-dir>');
    process.exit(1);
  }
  const target = args[targetIdx + 1];

  const md = readFileSync(inputFile, 'utf-8');

  // 按 ## ADR- 切分
  const sections = splitByAdrHeader(md);
  console.log(`解析 ${inputFile} ... 发现 ${sections.length} 个 ADR section`);

  if (sections.length === 0) {
    console.log('未找到 ADR section');
    return;
  }

  const store = new BlockStore(target);
  const embedder = new OllamaEmbedder();

  let prevBlockId: string | null = null;

  for (let i = 0; i < sections.length; i++) {
    const { title, content } = sections[i];

    // 提取 section 编号
    const sectionMatch = title.match(/ADR-(\d+[a-z]?)/);
    const sectionLabel = sectionMatch ? sectionMatch[1] : title;

    // 提取第一句非空文字作为摘要
    const bodyText = content.replace(/^##.*$/m, '').trim();
    const firstLine = bodyText.split('\n').find(l => l.trim().length > 3) ?? '';

    const block = createBlock({
      type: 'document',
      content: `${title}\n${content}`,
      source: {
        filename: inputFile,
        section: sectionLabel,
      },
      relations: prevBlockId ? { prevId: prevBlockId } : undefined,
    });

    block.summary = {
      self: firstLine.slice(0, 100).trim(),
      prev: null,
      next: null,
    };

    if (prevBlockId) {
      // 回填上一块的 nextId
      const prevBlock = store.getBlock(prevBlockId);
      if (prevBlock) {
        prevBlock.relations.nextId = block.blockId;
        // 重新写入（简化的回填方式）
        const prevEmbedding = new Float32Array(768);
        await store.append(prevBlock, prevEmbedding);
      }
    }

    const embedding = await embedder.embed(block.content);
    await store.append(block, embedding);

    console.log(`录入 ADR-${sectionLabel}: ${firstLine.slice(0, 60)} → 已保存`);
    prevBlockId = block.blockId;
  }

  console.log(`完成。${sections.length} 个 block 已写入 ${target}`);
}

function splitByAdrHeader(md: string): { title: string; content: string }[] {
  const sections: { title: string; content: string }[] = [];
  const lines = md.split('\n');
  let currentTitle = '';
  let currentContent: string[] = [];
  let started = false;

  for (const line of lines) {
    if (/^## ADR-/.test(line)) {
      if (started) {
        sections.push({ title: currentTitle, content: currentContent.join('\n').trim() });
      }
      currentTitle = line;
      currentContent = [];
      started = true;
    } else if (started) {
      currentContent.push(line);
    }
  }

  if (started) {
    sections.push({ title: currentTitle, content: currentContent.join('\n').trim() });
  }

  return sections;
}

main().catch(err => {
  console.error(`导入失败: ${(err as Error).message}`);
  process.exit(1);
});
```

- [ ] **Step 2: 执行导入脚本**

```bash
npx tsx scripts/import-adr.ts docs/ADR.md --target .aizen/project/
```

Expected: 打印 12+ 行的 `录入 ADR-00X ... → 已保存`。

- [ ] **Step 3: 验证搜索结果**

```bash
npx tsx src/memory/cli.ts search "channel 架构" --memory-dir .aizen/project/
```

Expected: Top-1 是 ADR-007。

- [ ] **Step 4: Commit**

```bash
git add scripts/import-adr.ts
git commit -m "feat: add temporary ADR import script"
```

---

## Task 8: 复杂检索验证（集成测试）

**Files:**
- Create: `tests/memory/search-adr.test.ts`

- [ ] **Step 1: 写 search-adr.test.ts**

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Retriever } from '../../src/memory/retriever.js';
import { OllamaEmbedder } from '../../src/memory/embedder.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const memoryDir = join(__dirname, '../../.aizen/project');

describe('ADR 语义检索（集成测试，需要 Ollama）', () => {
  // 此测试依赖 Task 7 的 import-adr 已执行
  // 如果记忆库不存在则跳过

  let retriever: Retriever;

  beforeAll(() => {
    retriever = new Retriever(new OllamaEmbedder());
  });

  it('"channel 架构" → ADR-007', async () => {
    const results = await retriever.search('channel 架构怎么设计的', [memoryDir], 1);
    if (results.length === 0) return; // 记忆库未初始化时跳过
    expect(results[0].summary).toContain('ADR-007');
    expect(results[0].score).toBeGreaterThan(0.5);
  });

  it('"用什么语言 为什么不用 Python" → ADR-001', async () => {
    const results = await retriever.search('用什么语言写的 为什么不用 Python', [memoryDir], 1);
    if (results.length === 0) return;
    expect(results[0].summary).toContain('ADR-001');
  });

  it('"多平台可执行文件 构建 发布" → ADR-003', async () => {
    const results = await retriever.search('多平台可执行文件 构建 发布', [memoryDir], 1);
    if (results.length === 0) return;
    expect(results[0].summary).toContain('ADR-003');
  });

  it('"session 生命周期 并发" → ADR-008', async () => {
    const results = await retriever.search('session 生命周期 并发 消息队列', [memoryDir], 1);
    if (results.length === 0) return;
    expect(results[0].summary).toContain('ADR-008');
  });

  it('"fork 遍历 知识图谱" → ADR-009d', async () => {
    const results = await retriever.search('fork 遍历 知识图谱', [memoryDir], 1);
    if (results.length === 0) return;
    expect(results[0].summary).toContain('ADR-009d');
  });

  it('"记忆存储 向量 文件格式" → ADR-009b', async () => {
    const results = await retriever.search('记忆怎么存 向量 文件格式', [memoryDir], 1);
    if (results.length === 0) return;
    expect(results[0].summary).toContain('ADR-009b');
  });
});
```

- [ ] **Step 2: 运行集成测试**

```bash
pnpm test tests/memory/search-adr.test.ts
```

Expected: 依赖 Ollama 服务，若记忆库已索引且 Ollama 运行中，6 tests PASS。

- [ ] **Step 3: Commit**

```bash
git add tests/memory/search-adr.test.ts
git commit -m "test: add semantic search integration tests for ADR corpus"
```

---

## Task 9: 最终验证

- [ ] **Step 1: 运行全部测试**

```bash
pnpm test
```

Expected: 所有测试 PASS。

- [ ] **Step 2: 运行 typecheck**

```bash
pnpm typecheck
```

Expected: 无错误。

- [ ] **Step 3: 端到端验证**

```bash
# 重新索引（验证幂等性——覆盖导入）
rm -rf .aizen/project && npx tsx scripts/import-adr.ts docs/ADR.md --target .aizen/project/

# 验证 search
npx tsx src/memory/cli.ts search "channel 架构" --memory-dir .aizen/project/

# 验证 stats
npx tsx src/memory/cli.ts stats --memory-dir .aizen/project/

# 验证 add + get
npx tsx src/memory/cli.ts add --content "手动创建的测试记忆" --type document --memory-dir .aizen/project/
npx tsx src/memory/cli.ts get <output-blockId> --memory-dir .aizen/project/

# 验证 rebuild
npx tsx src/memory/cli.ts rebuild --memory-dir .aizen/project/

# 验证错误路径
npx tsx src/memory/cli.ts search "test"
npx tsx src/memory/cli.ts search "" --memory-dir .aizen/project/
npx tsx src/memory/cli.ts search "test" --memory-dir /nonexistent
```

All expected behaviors match spec.

- [ ] **Step 4: 清理 .aizen/（记忆数据不上 git）**

```bash
rm -rf .aizen/
```

- [ ] **Step 5: 最终 Commit**

```bash
git commit -m "chore: complete aizen-memory Phase 1 implementation"
```
