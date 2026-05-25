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
 * 主流程：解析 ADR.md → 逐 section 写入记忆存储 → 建立 prev/next 关系链 → 更新哈希。
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

  let prevBlockId: string | null = null;

  /** 记录每个 section 的步骤耗时（毫秒） */
  const loopTimings: { label: string; embed: number; updateSummary: number; updatePrev: number }[] = [];

  for (let i = 0; i < sections.length; i++) {
    const { title, content } = sections[i];

    const sectionMatch = title.match(/ADR-(\d+[a-z]?)/);
    const sectionLabel = sectionMatch ? sectionMatch[1] : title;

    const bodyText = content.replace(/^##.*$/m, '').trim();
    const firstLine = bodyText.split('\n').find(l => l.trim().length > 3) ?? '';

    const fullContent = `${title}\n${content}`;

    // ── 先去重，再决定是否需要嵌入 ──
    let blockId: string;
    let isNew = false;
    let embedMs = 0;
    let updateSummaryMs = 0;

    const existingId = store.findByContent(fullContent);

    if (existingId) {
      blockId = existingId;
      const tUpd = performance.now();
      store.updateBlock(blockId, {
        summary: {
          self: title.replace(/^#+\s*/, '').slice(0, 100).trim(),
          prev: null,
          next: null,
        },
      });
      updateSummaryMs = +(performance.now() - tUpd).toFixed(3);
    } else {
      const tEmbed = performance.now();
      const embedding = await embedder.embed(fullContent);
      embedMs = +(performance.now() - tEmbed).toFixed(3);

      const result = await store.append(
        {
          type: 'document',
          content: fullContent,
          source: { filename: inputFile, section: sectionLabel },
          relations: prevBlockId ? { prevId: prevBlockId } : undefined,
          summary: {
            self: title.replace(/^#+\s*/, '').slice(0, 100).trim(),
          },
        },
        embedding,
      );
      blockId = result.blockId;
      isNew = result.isNew;
    }

    // ── 补填前一个块的 nextId ──
    let updatePrevMs = 0;
    if (prevBlockId) {
      const prevExisting = store.getBlock(prevBlockId);
      if (prevExisting) {
        const tUpd = performance.now();
        store.updateBlock(prevBlockId, {
          relations: {
            ...prevExisting.relations,
            nextId: blockId,
          },
        });
        updatePrevMs = +(performance.now() - tUpd).toFixed(3);
      }
    }

    loopTimings.push({
      label: `ADR-${sectionLabel}`,
      embed: embedMs,
      updateSummary: updateSummaryMs,
      updatePrev: updatePrevMs,
    });

    console.log(`录入 ADR-${sectionLabel}: ${firstLine.slice(0, 60)} → ${isNew ? '已保存' : '已存在'}`);
    prevBlockId = blockId;
  }

  // ── 汇总耗时 ──
  const totalLoop = loopTimings.reduce((s, t) => s + t.embed + t.updateSummary + t.updatePrev, 0);
  const totalEmbed = loopTimings.reduce((s, t) => s + t.embed, 0);
  const totalUpdSummary = loopTimings.reduce((s, t) => s + t.updateSummary, 0);
  const totalUpdPrev = loopTimings.reduce((s, t) => s + t.updatePrev, 0);

  console.log(`\n──── 单条耗时（ms）────`);
  console.log(`  embedder.embed()        平均 ${(totalEmbed / sections.length).toFixed(1)} ms，合计 ${totalEmbed.toFixed(0)} ms`);
  console.log(`  updateBlock(summary)    平均 ${(totalUpdSummary / sections.length).toFixed(1)} ms，合计 ${totalUpdSummary.toFixed(0)} ms`);
  console.log(`  updateBlock(prev)       平均 ${(totalUpdPrev / sections.length).toFixed(1)} ms，合计 ${totalUpdPrev.toFixed(0)} ms`);
  console.log(`  以上小计                平均 ${(totalLoop / sections.length).toFixed(1)} ms，合计 ${totalLoop.toFixed(0)} ms`);
  console.log();

  console.log('──── append() 内部步骤耗时（ms，汇总 21 条）────');
  const tlog = store.timingLog;
  const fields = ['ensureDir', 'contentHash', 'dedupLookup', 'createBlock', 'writeJson', 'writeVec', 'total'] as const;
  if (tlog.length > 0) {
    for (const f of fields) {
      const vals = tlog.map(t => t[f]);
      const sum = vals.reduce((a, b) => a + b, 0);
      const avg = sum / tlog.length;
      const max = Math.max(...vals);
      console.log(`  ${f.padEnd(14)} 平均 ${avg.toFixed(1).padStart(6)} ms  最慢 ${max.toFixed(1).padStart(6)} ms  合计 ${sum.toFixed(0).padStart(6)} ms`);
    }
  }

  console.log(`\n──── 总耗时 ────`);
  const newBlocks = tlog.filter(t => t.isNew);
  const dupAppend = tlog.filter(t => !t.isNew);
  const dupPreCheck = sections.length - tlog.length; // 被 findByContent 提前拦截的
  console.log(`  提前去重（跳过嵌入）  ${dupPreCheck} 条`);
  console.log(`  append() 新建        ${newBlocks.length} 条`);
  console.log(`  append() 去重        ${dupAppend.length} 条`);
  console.log(`  append() 总计        ${tlog.reduce((s, t) => s + t.total, 0).toFixed(0)} ms`);
  console.log(`  embedder.embed() 总计 ${totalEmbed.toFixed(0)} ms`);
  console.log(`  全部耗时              ${(tlog.reduce((s, t) => s + t.total, 0) + totalEmbed + totalUpdSummary + totalUpdPrev).toFixed(0)} ms`);

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
