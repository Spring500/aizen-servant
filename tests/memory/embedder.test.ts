import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { OllamaEmbedder } from '../../src/memory/embedder.js';

describe('OllamaEmbedder', () => {
  let server: Server;
  let baseUrl: string;
  let embedder: OllamaEmbedder;

  beforeEach(async () => {
    server = createServer((req, res) => {
      if (req.url?.startsWith('/bad')) {
        res.writeHead(500);
        res.end('Internal Server Error');
        return;
      }

      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
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
    const badEmbedder = new OllamaEmbedder(`${baseUrl}/bad`);
    await expect(badEmbedder.embed('test')).rejects.toThrow('Embedding API 错误');
  });
});
