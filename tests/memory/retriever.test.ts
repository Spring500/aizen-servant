import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Retriever, cosineSimilarity } from '../../src/memory/retriever.js';
import { BlockStore } from '../../src/memory/store.js';

/**
 * 构造模拟嵌入器，用 sin 函数生成确定性伪向量（相同文字 → 相同向量）。
 * 用于测试检索逻辑，不依赖 Ollama。
 */
function makeEmbedder() {
  return {
    dimensions: 768,
    async embed(text: string): Promise<Float32Array> {
      const vec = new Float32Array(768);
      const seed = text.charCodeAt(0) || 0;
      for (let i = 0; i < 768; i++) {
        vec[i] = Math.sin(seed + i * 0.01);
      }
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
  let retriever: Retriever;

  beforeEach(async () => {
    testDir1 = join(tmpdir(), `aizen-r1-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    testDir2 = join(tmpdir(), `aizen-r2-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const store1 = new BlockStore(testDir1);
    const store2 = new BlockStore(testDir2);

    const embedder = makeEmbedder();
    retriever = new Retriever(embedder);

    await store1.append(
      { type: 'document', content: '这是关于 Channel 架构的决策', summary: { self: 'ADR-007 Channel 架构' } },
      await embedder.embed('这是关于 Channel 架构的决策'),
    );

    await store1.append(
      { type: 'document', content: 'Python 语言的选择讨论', summary: { self: 'ADR-001 核心语言' } },
      await embedder.embed('Python 语言的选择讨论'),
    );

    await store2.append(
      { type: 'document', content: '个人笔记：部署脚本问题', summary: { self: '部署脚本个人笔记' } },
      await embedder.embed('个人笔记：部署脚本问题'),
    );
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
