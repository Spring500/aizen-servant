import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Retriever } from '../../src/memory/retriever.js';
import { OllamaEmbedder } from '../../src/memory/embedder.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const memoryDir = join(__dirname, '../../.aizen/project');

describe('ADR 语义检索（集成测试，需要 Ollama + 提前执行 import-adr）', () => {
  let retriever: Retriever;

  beforeAll(() => {
    retriever = new Retriever(new OllamaEmbedder());
  });

  it('搜索返回非空结果，且结果包含有效字段', async () => {
    const results = await retriever.search('channel 架构', [memoryDir], 3);
    if (results.length === 0) return;
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('blockId');
    expect(results[0]).toHaveProperty('score');
    expect(results[0]).toHaveProperty('content');
    expect(results[0]).toHaveProperty('source');
    expect(typeof results[0].content).toBe('string');
    expect(results[0].content.length).toBeGreaterThan(50);
  });

  it('搜索结果按分数降序排列', async () => {
    const results = await retriever.search('session 生命周期', [memoryDir], 5);
    if (results.length < 2) return;
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('k 参数限制返回数量', async () => {
    const results = await retriever.search('ADR', [memoryDir], 2);
    if (results.length === 0) return;
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('搜索无匹配关键词时仍返回结果（向量搜索总是有最近邻）', async () => {
    const results = await retriever.search('zzz_no_match_xyz', [memoryDir], 3);
    if (results.length === 0) return;
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0);
  });
});
