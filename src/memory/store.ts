import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { MemoryBlock } from './block.js';

const VEC_ROW_BYTES = 768 * 4;

export class BlockStore {
  private blocksDir: string;
  private vecPath: string;
  private hashPath: string;

  constructor(private memoryDir: string) {
    this.blocksDir = join(memoryDir, 'blocks');
    this.vecPath = join(memoryDir, 'blocks.vec');
    this.hashPath = join(memoryDir, 'blocks.hash');
  }

  ensureDir(): void {
    mkdirSync(this.blocksDir, { recursive: true });
  }

  async append(block: MemoryBlock, embedding: Float32Array): Promise<void> {
    this.ensureDir();

    const { blockId, embedding: _emb, ...rest } = block;
    const jsonPath = join(this.blocksDir, `${blockId}.json`);
    writeFileSync(jsonPath, JSON.stringify(rest, null, 2), 'utf-8');

    this.writeSortedVec(blockId, embedding);
  }

  getBlock(blockId: string): MemoryBlock | null {
    const jsonPath = join(this.blocksDir, `${blockId}.json`);
    if (!existsSync(jsonPath)) return null;

    const raw = readFileSync(jsonPath, 'utf-8');
    const fields = JSON.parse(raw);
    return { blockId, ...fields } as MemoryBlock;
  }

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

  listBlockIds(): string[] {
    this.ensureDir();
    return readdirSync(this.blocksDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .map(f => f.replace('.json', ''));
  }

  loadVectors(): Float32Array {
    if (!existsSync(this.vecPath)) return new Float32Array(0);

    const buf = readFileSync(this.vecPath);
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  }

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
    }

    writeFileSync(this.vecPath, buf);
  }

  getVectorIndex(blockId: string): number {
    return this.listBlockIds().indexOf(blockId);
  }

  needsRebuild(): boolean {
    if (!existsSync(this.hashPath)) return true;

    const currentHash = this.computeMtimeHash();
    const storedHash = readFileSync(this.hashPath, 'utf-8').trim();
    return currentHash !== storedHash;
  }

  updateHash(): void {
    const hash = this.computeMtimeHash();
    writeFileSync(this.hashPath, hash, 'utf-8');
  }

  stats(): { blockCount: number; indexedCount: number; vecSizeBytes: number } {
    const ids = this.listBlockIds();
    const vecSize = existsSync(this.vecPath) ? statSync(this.vecPath).size : 0;

    let indexedCount = 0;
    if (existsSync(this.vecPath) && ids.length > 0) {
      const vec = this.loadVectors();
      const rowCount = Math.floor(vec.length / 768);
      for (let i = 0; i < Math.min(ids.length, rowCount); i++) {
        const start = i * 768;
        const slice = vec.slice(start, start + 768);
        if (slice.some(v => v !== 0)) indexedCount++;
      }
    }

    return { blockCount: ids.length, indexedCount, vecSizeBytes: vecSize };
  }

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

  private writeSortedVec(blockId: string, embedding: Float32Array): void {
    const ids = this.listBlockIds();
    const targetIdx = ids.indexOf(blockId);
    const totalRows = targetIdx >= 0 ? Math.max(ids.length, targetIdx + 1) : ids.length + 1;

    let oldVec: Float32Array;
    if (existsSync(this.vecPath)) {
      const buf = readFileSync(this.vecPath);
      oldVec = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    } else {
      oldVec = new Float32Array(0);
    }

    const newBuf = Buffer.alloc(totalRows * VEC_ROW_BYTES);
    let oldRow = 0;
    const oldRowCount = Math.floor(oldVec.length / 768);

    for (let i = 0; i < totalRows; i++) {
      if (targetIdx >= 0 && i === targetIdx) continue;

      if (oldRow < oldRowCount) {
        const srcOffset = oldRow * VEC_ROW_BYTES;
        const dstOffset = i * VEC_ROW_BYTES;
        for (let j = 0; j < 768 && srcOffset + j * 4 < oldVec.length * 4; j++) {
          newBuf.writeFloatLE(oldVec[oldRow * 768 + j], dstOffset + j * 4);
        }
        oldRow++;
      }
    }

    if (targetIdx >= 0) {
      const dstOffset = targetIdx * VEC_ROW_BYTES;
      for (let j = 0; j < embedding.length; j++) {
        newBuf.writeFloatLE(embedding[j], dstOffset + j * 4);
      }
    } else {
      const dstOffset = (totalRows - 1) * VEC_ROW_BYTES;
      for (let j = 0; j < embedding.length; j++) {
        newBuf.writeFloatLE(embedding[j], dstOffset + j * 4);
      }
    }

    writeFileSync(this.vecPath, newBuf);
  }
}
