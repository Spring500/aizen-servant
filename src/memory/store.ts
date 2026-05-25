import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { MemoryBlock, CreateBlockInput } from './block.js';
import { createBlock } from './block.js';

/** 每条向量在 .vec 文件中的字节数：768 维 × 4 字节(float32) */
const VEC_ROW_BYTES = 768 * 4;

/** append() 单次调用的步骤耗时记录 */
export interface AppendTiming {
  ensureDir: number;
  contentHash: number;
  dedupLookup: number;
  createBlock: number;
  writeJson: number;
  writeVec: number;
  total: number;
  isNew: boolean;
}

/**
 * 记忆块持久化存储。
 *
 * 目录结构：
 *   {memoryDir}/
 *     blocks/         — 每个块一个 {blockId}.json 文件
 *     blocks.vec      — 二进制向量文件，按 blockId 排序对齐
 *     blocks.hash     — blocks/ 目录的 mtime 哈希，用于检测是否需要重建向量索引
 */
export class BlockStore {
  /** JSON 块文件目录 */
  private blocksDir: string;
  /** 二进制向量文件路径 */
  private vecPath: string;
  /** 目录 mtime 哈希文件路径 */
  private hashPath: string;
  /** append() 调用的耗时记录，每次调用 push 一条 */
  timingLog: AppendTiming[] = [];

  /** 正文 sha256 → blockId 的内存缓存，首次访问时懒加载 */
  private contentHashCache: Map<string, string> | null = null;

  /**
   * @param memoryDir - 记忆存储根目录，如 .aizen/project/
   */
  constructor(private memoryDir: string) {
    this.blocksDir = join(memoryDir, 'blocks');
    this.vecPath = join(memoryDir, 'blocks.vec');
    this.hashPath = join(memoryDir, 'blocks.hash');
  }

  /** 确保存储目录存在（幂等） */
  ensureDir(): void {
    mkdirSync(this.blocksDir, { recursive: true });
  }

  /**
   * 写入记忆块。自动生成 ULID，按正文 SHA256 哈希去重。
   * 如果正文已有对应块则跳过写入，直接返回已有 blockId。
   *
   * @param input - 创建块的输入参数（不含 blockId）
   * @param embedding - 768 维 Float32Array 向量
   * @returns 最终落盘的 blockId 及是否为首次写入
   */
  async append(input: CreateBlockInput, embedding: Float32Array): Promise<{ blockId: string; isNew: boolean }> {
    const t: AppendTiming = {
      ensureDir: 0, contentHash: 0, dedupLookup: 0,
      createBlock: 0, writeJson: 0, writeVec: 0,
      total: 0, isNew: true,
    };
    const t0 = performance.now();

    let tSub = performance.now();
    this.ensureDir();
    t.ensureDir = +(performance.now() - tSub).toFixed(3);

    tSub = performance.now();
    const contentHash = this.computeContentHash(input.content);
    t.contentHash = +(performance.now() - tSub).toFixed(3);

    tSub = performance.now();
    const existingId = this.findBlockIdByContentHash(contentHash);
    t.dedupLookup = +(performance.now() - tSub).toFixed(3);

    if (existingId) {
      t.isNew = false;
      t.total = +(performance.now() - t0).toFixed(3);
      this.timingLog.push(t);
      return { blockId: existingId, isNew: false };
    }

    tSub = performance.now();
    const block = createBlock(input);
    t.createBlock = +(performance.now() - tSub).toFixed(3);

    const { blockId, embedding: _emb, ...rest } = block;

    // 写入新块后同步更新内存缓存
    if (this.contentHashCache) {
      this.contentHashCache.set(contentHash, blockId);
    }

    tSub = performance.now();
    const jsonPath = join(this.blocksDir, `${blockId}.json`);
    writeFileSync(jsonPath, JSON.stringify(rest, null, 2), 'utf-8');
    t.writeJson = +(performance.now() - tSub).toFixed(3);

    tSub = performance.now();
    this.writeSortedVec(blockId, embedding);
    t.writeVec = +(performance.now() - tSub).toFixed(3);

    t.total = +(performance.now() - t0).toFixed(3);
    this.timingLog.push(t);
    return { blockId, isNew: true };
  }

  /**
   * 更新已有块的非核心字段（relations、summary、weight、meta 等）。
   * 不修改正文内容和向量文件。undefined 值的字段会被忽略。
   *
   * @param blockId - 要更新的块 ID
   * @param updates - 部分字段更新对象，仅含需要修改的字段
   */
  updateBlock(blockId: string, updates: Partial<Omit<MemoryBlock, 'blockId' | 'embedding' | 'content'>>): void {
    const existing = this.getBlock(blockId);
    if (!existing) throw new Error(`未找到 block: ${blockId}`);

    const clean = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined),
    );
    const merged = { ...existing, ...clean };
    const { blockId: _, embedding: _emb, ...rest } = merged as MemoryBlock;
    const jsonPath = join(this.blocksDir, `${blockId}.json`);
    writeFileSync(jsonPath, JSON.stringify(rest, null, 2), 'utf-8');
  }

  /**
   * 按 blockId 读取单个记忆块。
   *
   * @param blockId - 26 位 ULID
   * @returns MemoryBlock 或 null（不存在时）
   */
  getBlock(blockId: string): MemoryBlock | null {
    const jsonPath = join(this.blocksDir, `${blockId}.json`);
    if (!existsSync(jsonPath)) return null;

    const raw = readFileSync(jsonPath, 'utf-8');
    const fields = JSON.parse(raw);
    return { blockId, ...fields } as MemoryBlock;
  }

  /**
   * 读取全部块，按 ULID 字典序排列。
   *
   * @returns 排序后的 MemoryBlock 数组
   */
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

  /**
   * 列出所有块的 blockId（按 ULID 字典序排列）。
   *
   * @returns blockId 字符串数组
   */
  listBlockIds(): string[] {
    this.ensureDir();
    return readdirSync(this.blocksDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .map(f => f.replace('.json', ''));
  }

  /**
   * 加载完整向量文件为 Float32Array。
   * 行数 = 块总数，每行 768 维。
   *
   * @returns 向量 Float32Array，文件不存在时返回空数组
   */
  loadVectors(): Float32Array {
    if (!existsSync(this.vecPath)) return new Float32Array(0);

    const buf = readFileSync(this.vecPath);
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  }

  /**
   * 按 blockId → embedding 映射重写整个向量文件。
   * 顺序与 listBlockIds() 对齐。
   *
   * @param embeddings - blockId 到 Float32Array 或 null 的映射
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
    }

    writeFileSync(this.vecPath, buf);
  }

  /**
   * 查询某个 blockId 在向量文件中的行索引（对应 listBlockIds 排序）。
   *
   * @param blockId - 块 ID
   * @returns 行索引，不存在时返回 -1
   */
  getVectorIndex(blockId: string): number {
    return this.listBlockIds().indexOf(blockId);
  }

  /**
   * 检测 blocks/ 目录的 mtime 哈希是否变化，判断是否需要重建向量索引。
   *
   * @returns 需要重建时为 true
   */
  needsRebuild(): boolean {
    if (!existsSync(this.hashPath)) return true;

    const currentHash = this.computeMtimeHash();
    const storedHash = readFileSync(this.hashPath, 'utf-8').trim();
    return currentHash !== storedHash;
  }

  /**
   * 更新哈希文件为当前 blocks/ 目录的 mtime 哈希。调用后 needsRebuild() 变为 false。
   */
  updateHash(): void {
    const hash = this.computeMtimeHash();
    writeFileSync(this.hashPath, hash, 'utf-8');
  }

  /**
   * 返回当前存储的统计信息。
   *
   * @returns 块总数、有非零向量的块数、向量文件字节数
   */
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

  /**
   * 检查正文内容是否已存在于存储中（便捷方法，等价于 computeContentHash + findBlockIdByContentHash）。
   *
   * @param content - 正文内容
   * @returns 已存在的 blockId，不存在时返回 null
   */
  findByContent(content: string): string | null {
    return this.findBlockIdByContentHash(this.computeContentHash(content));
  }

  /**
   * 按正文内容哈希查找已存在的 blockId。
   * 首次调用时构建 sha256 → blockId 内存缓存，后续 O(1) 查询。
   *
   * @param hash - computeContentHash 的输出
   * @returns 匹配的 blockId，不存在时返回 null
   */
  findBlockIdByContentHash(hash: string): string | null {
    if (!this.contentHashCache) {
      this.contentHashCache = new Map();
      for (const block of this.getAllBlocks()) {
        this.contentHashCache.set(this.computeContentHash(block.content), block.blockId);
      }
    }
    return this.contentHashCache.get(hash) ?? null;
  }

  /**
   * 计算正文内容的 SHA256 十六进制哈希。
   *
   * @param content - 正文内容字符串
   * @returns 64 位 hex 哈希
   */
  computeContentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * 计算 blocks/ 目录下所有 JSON 文件 {文件名:mtime} 的组合 SHA256 哈希。
   * 用于 needsRebuild 检测。
   */
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
   * 按 blockId 字典序写入或更新向量文件中的单行向量。
   * 如果 blockId 已存在则原地替换，否则追加到末尾。
   *
   * @param blockId - 块 ID
   * @param embedding - 768 维向量
   */
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
