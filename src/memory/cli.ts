#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { BlockStore } from './store.js';
import { Retriever } from './retriever.js';
import { OllamaEmbedder } from './embedder.js';

/**
 * CLI 主入口。根据子命令分发到对应的处理函数。
 *
 * 子命令：add / get / search / stats / rebuild
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

/**
 * 解析命令行参数中的 --key value 标志。
 * 同一个 key 出现多次会收集为字符串数组。
 *
 * @param args - 原始参数数组（不含命令名本身）
 * @returns 标志名到值的映射
 */
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

/**
 * 从标志 Map 中读取必填的字符串值。
 * 缺失或类型不对时输出错误并退出。
 *
 * @param flags - parseFlags 的返回值
 * @param name - 标志名（不含 -- 前缀）
 * @returns 标志的字符串值
 */
function requireFlag(flags: Map<string, string | string[]>, name: string): string {
  const v = flags.get(name);
  if (!v || typeof v !== 'string') {
    console.error(`错误: 缺少参数 --${name}`);
    process.exit(1);
  }
  return v;
}

/**
 * 从标志 Map 中读取 --memory-dir（支持多次指定），并校验目录存在性。
 *
 * @param flags - parseFlags 的返回值
 * @returns 已校验存在的目录路径数组
 */
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

/** 打印使用说明 */
function printUsage(): void {
  console.log(`用法:
  aizen-memory add --content "<text>" --type <type> --memory-dir <path>
  aizen-memory get <blockId> --memory-dir <path>
  aizen-memory search "<query>" --memory-dir <path> [--memory-dir <path> ...] [-k <N>]
  aizen-memory stats --memory-dir <path> [--memory-dir <path> ...]
  aizen-memory rebuild --memory-dir <path>`);
}

/**
 * 新增记忆块。生成嵌入向量后写入指定目录。
 *
 * 标志：
 *   --content  正文内容
 *   --type     块类型 (conversation/document/ai_insight/external)
 *   --memory-dir 存储目录
 *   --source-filename 来源文件名（可选，默认 manual）
 *   --source-section  来源章节（可选）
 */
async function cmdAdd(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const content = requireFlag(flags, 'content');
  const type = requireFlag(flags, 'type');
  const dir = requireFlag(flags, 'memory-dir');

  if (!existsSync(dir)) {
    const store = new BlockStore(dir);
    store.ensureDir();
  }

  const validTypes = ['conversation', 'document', 'ai_insight', 'external'];
  if (!validTypes.includes(type)) {
    console.error(`错误: --type 必须为 ${validTypes.join(' | ')}`);
    process.exit(1);
  }

  const embedder = new OllamaEmbedder();
  const embedding = await embedder.embed(content);

  const store = new BlockStore(dir);
  const { blockId } = await store.append({
    type,
    content,
    source: {
      filename: (flags.get('source-filename') as string) ?? 'manual',
      section: (flags.get('source-section') as string) ?? '',
    },
  }, embedding);

  console.log(`已创建: ${blockId}`);
}

/**
 * 按 blockId 查看记忆块全文。
 *
 * 位置参数：blockId
 * 标志：--memory-dir
 */
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
  console.log();
  console.log(block.content);
}

/**
 * 语义搜索记忆。支持多源合并、Top-K 截断。
 *
 * 位置参数：查询文本
 * 标志：
 *   --memory-dir 记忆目录（可多次指定）
 *   -k          返回结果数（默认 3）
 */
async function cmdSearch(args: string[]): Promise<void> {
  const flags = parseFlags(args);

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
      console.log(`[${sourceLabel}] ${r.score.toFixed(3)}  ${r.blockId}`);
    }
  } catch (err) {
    console.error(`检索失败: ${(err as Error).message}`);
    process.exit(1);
  }
}

/**
 * 查看记忆存储的统计信息（块数、已索引数、向量文件大小）。
 *
 * 标志：--memory-dir（可多次指定）
 */
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

/**
 * 重建向量索引。为目录下所有块重新生成嵌入向量并写入 .vec 文件。
 *
 * 标志：--memory-dir
 */
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
