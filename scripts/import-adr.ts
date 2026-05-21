/**
 * 一次性脚本：将 docs/ADR.md 的每个 ADR section 作为记忆块导入。
 *
 * 用法: npx tsx scripts/import-adr.ts docs/ADR.md --target .aizen/project/
 */

import { readFileSync, existsSync } from 'node:fs';
import { BlockStore } from '../src/memory/store.js';
import { OllamaEmbedder } from '../src/memory/embedder.js';
import { createBlock } from '../src/memory/block.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const inputFile = args.find(a => !a.startsWith('--'));
  if (!inputFile) {
    console.error('用法: npx tsx scripts/import-adr.ts <markdown-file> --target <memory-dir>');
    process.exit(1);
  }
  if (!existsSync(inputFile)) {
    console.error(`文件不存在: ${inputFile}`);
    process.exit(1);
  }

  const targetIdx = args.indexOf('--target');
  if (targetIdx === -1 || !args[targetIdx + 1]) {
    console.error('错误: 缺少 --target <memory-dir>');
    process.exit(1);
  }
  const target = args[targetIdx + 1];

  const md = readFileSync(inputFile, 'utf-8');

  const sections = splitByAdrHeader(md);
  console.log(`解析 ${inputFile} ... 发现 ${sections.length} 个 ADR section`);

  if (sections.length === 0) {
    console.log('未找到 ADR section');
    return;
  }

  const store = new BlockStore(target);
  const embedder = new OllamaEmbedder();

  let prevBlockId: string | null = null;

  for (let i = 0; i < sections.length; i++) {
    const { title, content } = sections[i];

    const sectionMatch = title.match(/ADR-(\d+[a-z]?)/);
    const sectionLabel = sectionMatch ? sectionMatch[1] : title;

    const bodyText = content.replace(/^##.*$/m, '').trim();
    const firstLine = bodyText.split('\n').find(l => l.trim().length > 3) ?? '';

    const block = createBlock({
      type: 'document',
      content: `${title}\n${content}`,
      source: {
        filename: inputFile,
        section: sectionLabel,
      },
      relations: prevBlockId ? { prevId: prevBlockId } : undefined,
    });

    block.summary = {
      self: firstLine.slice(0, 100).trim(),
      prev: null,
      next: null,
    };

    if (prevBlockId) {
      const prevBlock = store.getBlock(prevBlockId);
      if (prevBlock) {
        prevBlock.relations.nextId = block.blockId;
        const prevEmbedding = new Float32Array(768);
        await store.append(prevBlock, prevEmbedding);
      }
    }

    const embedding = await embedder.embed(block.content);
    await store.append(block, embedding);

    console.log(`录入 ADR-${sectionLabel}: ${firstLine.slice(0, 60)} → 已保存`);
    prevBlockId = block.blockId;
  }

  console.log(`完成。${sections.length} 个 block 已写入 ${target}`);
}

function splitByAdrHeader(md: string): { title: string; content: string }[] {
  const sections: { title: string; content: string }[] = [];
  const lines = md.split('\n');
  let currentTitle = '';
  let currentContent: string[] = [];
  let started = false;

  for (const line of lines) {
    if (/^## ADR-/.test(line)) {
      if (started) {
        sections.push({ title: currentTitle, content: currentContent.join('\n').trim() });
      }
      currentTitle = line;
      currentContent = [];
      started = true;
    } else if (started) {
      currentContent.push(line);
    }
  }

  if (started) {
    sections.push({ title: currentTitle, content: currentContent.join('\n').trim() });
  }

  return sections;
}

main().catch(err => {
  console.error(`导入失败: ${(err as Error).message}`);
  process.exit(1);
});
