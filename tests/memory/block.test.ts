import { describe, it, expect } from 'vitest';
import { createBlock, validateBlock } from '../../src/memory/block.js';

describe('createBlock', () => {
  it('生成一个带 ULID 和默认字段的块', () => {
    const block = createBlock({
      type: 'document',
      content: '这是测试内容',
      source: { filename: 'test.md' },
    });

    expect(block.blockId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(block.type).toBe('document');
    expect(block.content).toBe('这是测试内容');
    expect(block.source).toEqual({ filename: 'test.md' });
    expect(block.createdAt).toBeTypeOf('number');
    expect(block.weight).toEqual({ boosts: [], negativeMarks: 0 });
    expect(block.deprecated).toBe(false);
    expect(block.supersededBy).toBeNull();
  });

  it('两次调用生成不同的 ULID', () => {
    const a = createBlock({ type: 'document', content: 'a' });
    const b = createBlock({ type: 'document', content: 'b' });
    expect(a.blockId).not.toBe(b.blockId);
  });
});

describe('validateBlock', () => {
  it('通过合法的 block', () => {
    const block = createBlock({ type: 'document', content: 'test' });
    expect(() => validateBlock(block)).not.toThrow();
  });

  it('拒绝非法的 type', () => {
    const block = { ...createBlock({ type: 'document', content: 'x' }), type: 'invalid' };
    expect(() => validateBlock(block)).toThrow();
  });

  it('拒绝空的 content', () => {
    const block = { ...createBlock({ type: 'document', content: 'x' }), content: '' };
    expect(() => validateBlock(block)).toThrow();
  });

  it('拒绝非 ULID 格式的 blockId', () => {
    const block = { ...createBlock({ type: 'document', content: 'x' }), blockId: 'not-ulid' };
    expect(() => validateBlock(block)).toThrow();
  });
});
