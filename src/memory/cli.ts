#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { BlockStore } from './store.js';
import { OllamaEmbedder } from './embedder.js';
import { Retriever } from './retriever.js';
import { createBlock } from './block.js';

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

function requireFlag(flags: Map<string, string | string[]>, name: string): string {
  const v = flags.get(name);
  if (!v || typeof v !== 'string') {
    console.error(`错误: 缺少参数 --${name}`);
    process.exit(1);
  }
  return v;
}

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

function printUsage(): void {
  console.log(`用法:
  aizen-memory add --content "<text>" --type <type> --memory-dir <path>
  aizen-memory get <blockId> --memory-dir <path>
  aizen-memory search "<query>" --memory-dir <path> [--memory-dir <path> ...] [-k <N>]
  aizen-memory stats --memory-dir <path> [--memory-dir <path> ...]
  aizen-memory rebuild --memory-dir <path>`);
}

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

  const block = createBlock({
    type,
    content,
    source: {
      filename: (flags.get('source-filename') as string) ?? 'manual',
      section: (flags.get('source-section') as string) ?? '',
    },
  });

  const embedder = new OllamaEmbedder();
  const embedding = await embedder.embed(content);

  const store = new BlockStore(dir);
  await store.append(block, embedding);

  console.log(`已创建: ${block.blockId}`);
}

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
  console.log(`摘要:       ${block.summary.self || '(无)'}`);
  console.log();
  console.log(block.content);
}

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
      console.log(`[${sourceLabel}] ${r.score.toFixed(3)}  ${r.summary || '(无摘要)'}`);
    }
  } catch (err) {
    console.error(`检索失败: ${(err as Error).message}`);
    process.exit(1);
  }
}

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
