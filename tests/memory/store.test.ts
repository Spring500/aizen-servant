import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BlockStore } from '../../src/memory/store.js';

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
    const emb = new Float32Array(768).fill(0.1);
    const { blockId } = await store.append({ type: 'document', content: 'hello' }, emb);

    const jsonPath = join(testDir, 'blocks', `${blockId}.json`);
    expect(existsSync(jsonPath)).toBe(true);

    const vecPath = join(testDir, 'blocks.vec');
    expect(existsSync(vecPath)).toBe(true);
  });

  it('getBlock 读取已写入的块', async () => {
    const emb = new Float32Array(768).fill(0.1);
    const { blockId } = await store.append({ type: 'document', content: 'hello world' }, emb);

    const loaded = store.getBlock(blockId);
    expect(loaded).not.toBeNull();
    expect(loaded!.blockId).toBe(blockId);
    expect(loaded!.content).toBe('hello world');
  });

  it('getBlock 不存在的块返回 null', () => {
    expect(store.getBlock('01J4XK7N8P9Q2R3S4T5V6W7X8')).toBeNull();
  });

  it('getAllBlocks 按文件名排序返回', async () => {
    const emb = new Float32Array(768);
    await store.append({ type: 'document', content: 'a' }, emb);
    await store.append({ type: 'document', content: 'b' }, emb);

    const blocks = store.getAllBlocks();
    expect(blocks.length).toBe(2);
    const ids = blocks.map(b => b.blockId);
    // 按 ULID 字符串字典序排列
    expect(ids).toEqual([...ids].sort());
  });

  it('loadVectors 加载 .vec 文件', async () => {
    const emb = new Float32Array(768);
    emb[0] = 0.42;
    emb[1] = 0.73;
    await store.append({ type: 'document', content: 'x' }, emb);

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
    await store.append({ type: 'document', content: 'x' }, new Float32Array(768));
    store.updateHash();
    expect(store.needsRebuild()).toBe(false);
  });

  it('needsRebuild 新增文件后变为 true', async () => {
    await store.append({ type: 'document', content: 'x' }, new Float32Array(768));
    store.updateHash();

    await store.append({ type: 'document', content: 'y' }, new Float32Array(768));

    expect(store.needsRebuild()).toBe(true);
  });

  it('stats 返回正确的统计', async () => {
    const emb = new Float32Array(768).fill(0.1);
    await store.append({ type: 'document', content: 'a' }, emb);
    await store.append({ type: 'document', content: 'b' }, emb);

    expect(store.stats()).toEqual({
      blockCount: 2,
      indexedCount: 2,
      vecSizeBytes: 2 * 768 * 4,
    });
  });

  it('updateBlock 更新已有块的元数据', async () => {
    const emb = new Float32Array(768).fill(0.1);
    const { blockId } = await store.append({ type: 'document', content: '更新测试' }, emb);

    store.updateBlock(blockId, {
      weight: { boosts: [{ at: Date.now(), sessionForkId: 'test-fork' }], negativeMarks: 0 },
      meta: { updated: true },
    });

    const loaded = store.getBlock(blockId);
    expect(loaded!.weight.boosts.length).toBe(1);
    expect(loaded!.meta).toEqual({ updated: true });
    expect(loaded!.content).toBe('更新测试');
  });

  it('updateBlock 对不存在的 blockId 抛错', () => {
    expect(() => store.updateBlock('nonexistent', {})).toThrow('未找到 block');
  });
});

describe('BlockStore 去重', () => {
  it('相同正文内容 append 两次只写入一个 JSON 文件', async () => {
    const emb = new Float32Array(768).fill(0.1);

    await store.append({ type: 'document', content: '完全相同的正文' }, emb);
    await store.append({ type: 'document', content: '完全相同的正文' }, emb);

    const jsonFiles = readdirSync(join(testDir, 'blocks')).filter(f => f.endsWith('.json'));
    expect(jsonFiles.length).toBe(1);
  });

  it('相同正文 append 返回已存在的 blockId', async () => {
    const emb = new Float32Array(768).fill(0.1);

    const result1 = await store.append({ type: 'document', content: '去重测试正文' }, emb);
    const result2 = await store.append({ type: 'document', content: '去重测试正文' }, emb);

    expect(result1.isNew).toBe(true);
    expect(result2.isNew).toBe(false);
    expect(result2.blockId).toBe(result1.blockId);
  });

  it('不同正文内容 append 写入两个 JSON 文件', async () => {
    const emb = new Float32Array(768).fill(0.1);

    await store.append({ type: 'document', content: '正文 A' }, emb);
    await store.append({ type: 'document', content: '正文 B' }, emb);

    const jsonFiles = readdirSync(join(testDir, 'blocks')).filter(f => f.endsWith('.json'));
    expect(jsonFiles.length).toBe(2);
  });
});
