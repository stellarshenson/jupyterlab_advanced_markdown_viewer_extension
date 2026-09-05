import { changeRanges, diffWords } from '../diff';

/**
 * Reassemble the earlier string from an edit script.
 */
function before(ops: ReturnType<typeof diffWords>): string {
  return ops
    .filter(op => op.kind !== 'insert')
    .map(op => op.text)
    .join('');
}

/**
 * Reassemble the later string from an edit script.
 */
function after(ops: ReturnType<typeof diffWords>): string {
  return ops
    .filter(op => op.kind !== 'delete')
    .map(op => op.text)
    .join('');
}

describe('diffWords', () => {
  it('reports no change for identical text', () => {
    const ops = diffWords('alpha beta', 'alpha beta');
    expect(ops.every(op => op.kind === 'equal')).toBe(true);
  });

  it('round-trips both sides for an insertion', () => {
    const a = 'the quick fox';
    const b = 'the quick brown fox';
    const ops = diffWords(a, b);
    expect(before(ops)).toBe(a);
    expect(after(ops)).toBe(b);
    expect(ops.some(op => op.kind === 'insert')).toBe(true);
  });

  it('round-trips both sides for a deletion', () => {
    const a = 'the quick brown fox';
    const b = 'the quick fox';
    const ops = diffWords(a, b);
    expect(before(ops)).toBe(a);
    expect(after(ops)).toBe(b);
    expect(ops.some(op => op.kind === 'delete')).toBe(true);
  });

  it('round-trips a replacement in the middle of a paragraph', () => {
    const a = 'one two three four five';
    const b = 'one two THREE four five';
    const ops = diffWords(a, b);
    expect(before(ops)).toBe(a);
    expect(after(ops)).toBe(b);
  });

  it('treats an empty earlier string as a whole insertion', () => {
    const ops = diffWords('', 'fresh text');
    expect(ops).toEqual([{ kind: 'insert', text: 'fresh text' }]);
  });

  it('treats an empty later string as a whole deletion', () => {
    const ops = diffWords('gone text', '');
    expect(ops).toEqual([{ kind: 'delete', text: 'gone text' }]);
  });

  it('preserves whitespace exactly', () => {
    const a = 'line one\n\nline two\n';
    const b = 'line one\n\nline two changed\n';
    const ops = diffWords(a, b);
    expect(before(ops)).toBe(a);
    expect(after(ops)).toBe(b);
  });

  it('falls back to one replacement past the alignment bound', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`).join(' ');
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`).join(' ');
    const ops = diffWords(a, b);
    expect(before(ops)).toBe(a);
    expect(after(ops)).toBe(b);
    expect(ops.filter(op => op.kind === 'delete')).toHaveLength(1);
    expect(ops.filter(op => op.kind === 'insert')).toHaveLength(1);
  });
});

describe('changeRanges', () => {
  it('positions an addition against the later string', () => {
    const later = 'the quick brown fox';
    const ranges = changeRanges(diffWords('the quick fox', later));
    expect(ranges.added).toHaveLength(1);
    const [range] = ranges.added;
    expect(later.slice(range.start, range.end)).toContain('brown');
  });

  it('positions a removal against the later string', () => {
    const ranges = changeRanges(
      diffWords('the quick brown fox', 'the quick fox')
    );
    expect(ranges.removed).toHaveLength(1);
    expect(ranges.removed[0].text).toContain('brown');
  });

  it('reports nothing for unchanged text', () => {
    const ranges = changeRanges(diffWords('same text', 'same text'));
    expect(ranges.added).toHaveLength(0);
    expect(ranges.removed).toHaveLength(0);
  });

  it('keeps added ranges inside the later string', () => {
    const later = 'alpha beta gamma delta';
    const ranges = changeRanges(diffWords('alpha delta', later));
    for (const range of ranges.added) {
      expect(range.start).toBeGreaterThanOrEqual(0);
      expect(range.end).toBeLessThanOrEqual(later.length);
      expect(range.end).toBeGreaterThan(range.start);
    }
  });
});
