import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
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
    const ids = blocks.map(b => b.blockId);
    // 按 ULID 字符串字典序排列
    expect(ids).toEqual([...ids].sort());
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
