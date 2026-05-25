/**
 * 一次性脚本：将 ADR.md 的每个 ADR section 作为记忆块导入到 aizen-memory。
 *
 * 自动去重（正文哈希），幂等运行。首次导入全部新建，重复导入全部标记为"已存在"。
 * 用法: npx tsx scripts/import-adr.ts ADR.md --target .aizen/project/
 */
import { readFileSync, existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { BlockStore } from '../src/memory/store.js';
import { OllamaEmbedder } from '../src/memory/embedder.js';

/**
 * 主流程：解析 ADR.md → 逐 section 写入记忆存储 → 更新哈希。
 */
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

  /** 记录每个 section 的 embed 耗时（毫秒） */
  const embedTimes: number[] = [];

  for (let i = 0; i < sections.length; i++) {
    const { title, content } = sections[i];

    const sectionMatch = title.match(/ADR-(\d+[a-z]?)/);
    const sectionLabel = sectionMatch ? sectionMatch[1] : title;

    const bodyText = content.replace(/^##.*$/m, '').trim();
    const firstLine = bodyText.split('\n').find(l => l.trim().length > 3) ?? '';

    const fullContent = `${title}\n${content}`;

    let isNew = false;
    let embedMs = 0;

    const existingId = store.findByContent(fullContent);

    if (existingId) {
      console.log(`录入 ADR-${sectionLabel}: ${firstLine.slice(0, 60)} → 已存在`);
    } else {
      const tEmbed = performance.now();
      const embedding = await embedder.embed(fullContent);
      embedMs = +(performance.now() - tEmbed).toFixed(3);

      const result = await store.append(
        {
          type: 'document',
          content: fullContent,
          source: { filename: inputFile, section: sectionLabel },
        },
        embedding,
      );
      isNew = result.isNew;

      embedTimes.push(embedMs);
      console.log(`录入 ADR-${sectionLabel}: ${firstLine.slice(0, 60)} → ${isNew ? '已保存' : '已存在'}`);
    }
  }

  // ── 汇总耗时 ──
  const totalEmbed = embedTimes.reduce((s, t) => s + t, 0);

  console.log(`\n──── 单条耗时（ms）────`);
  console.log(`  embedder.embed()        平均 ${embedTimes.length ? (totalEmbed / embedTimes.length).toFixed(1) : 0} ms，合计 ${totalEmbed.toFixed(0)} ms`);

  console.log(`\n──── 总耗时 ────`);
  console.log(`  embedder.embed() 总计 ${totalEmbed.toFixed(0)} ms`);
  console.log(`  全部耗时              ${totalEmbed.toFixed(0)} ms`);

  console.log(`完成。${sections.length} 个 block 已写入 ${target}`);
  store.updateHash();
}

/**
 * 将 Markdown 文本按 "## ADR-" 或 "### ADR-" 标题拆分为 section 数组。
 *
 * @param md - ADR.md 的完整文本
 * @returns 每个 section 的标题和正文
 */
function splitByAdrHeader(md: string): { title: string; content: string }[] {
  const sections: { title: string; content: string }[] = [];
  const lines = md.split('\n');
  let currentTitle = '';
  let currentContent: string[] = [];
  let started = false;

  for (const line of lines) {
    if (/^## ADR-/.test(line) || /^### ADR-/.test(line)) {
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
