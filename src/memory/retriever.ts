import { BlockStore } from './store.js';
import type { Embedder } from './embedder.js';

export interface SearchResult {
  blockId: string;
  score: number;
  content: string;
  source: string;
}

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

export class Retriever {
  constructor(private embedder: Embedder) {}

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

        if (row.every(v => v === 0)) continue;

        const score = cosineSimilarity(queryVec, row);
        const block = store.getBlock(ids[i]);
        if (!block) continue;

        allResults.push({
          blockId: block.blockId,
          score,
          content: block.content,
          source: dir,
        });
      }
    }

    allResults.sort((a, b) => b.score - a.score);
    return allResults.slice(0, k);
  }
}
