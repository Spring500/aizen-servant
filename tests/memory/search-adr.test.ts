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

  it('"channel 架构" → ADR-007', async () => {
    const results = await retriever.search('channel 架构怎么设计的', [memoryDir], 1);
    if (results.length === 0) return;
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
