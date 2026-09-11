import { changeRanges, diffWords, mapOffsets } from '../diff';

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

  it('keeps two small edits apart in a long document, a line pushed in at the top and a word changed at the end (DEF-HILITE-88)', () => {
    // A hundred and twenty paragraphs, well past the token bound once the
    // common prefix and suffix are gone: the first edit ends the prefix and
    // the last ends the suffix, so the whole document is the middle.
    const paragraphs = Array.from(
      { length: 120 },
      (_, i) =>
        `Paragraph ${i + 1} of the report carries a few ordinary words in it.`
    );
    const before = paragraphs.join('\n');
    const after = `A new first line.\n${before}`.replace(
      /words in it\.$/,
      'words in it now.'
    );
    const ranges = changeRanges(diffWords(before, after));
    // 'it.' and 'it' are different tokens, so the last word is replaced.
    expect(
      ranges.added.map(range => after.slice(range.start, range.end))
    ).toEqual(['A new first line.\n', 'it now.']);
    expect(ranges.removed.map(removal => removal.text)).toEqual(['it.']);
  });

  it('keeps two small edits apart past a thousand lines as well, the line pass having a bound of its own (DEF-HILITE-88)', () => {
    // Thirteen hundred short lines: past the token bound many times over,
    // and past it in lines too if the line pass shared the token bound.
    const lines = Array.from({ length: 1300 }, (_, i) => `Line ${i + 1}.`);
    const before = lines.join('\n');
    const after = `A new first line.\n${before}`.replace(
      /Line 1300\.$/,
      'Line 1300 changed.'
    );
    const ranges = changeRanges(diffWords(before, after));
    expect(
      ranges.added.map(range => after.slice(range.start, range.end))
    ).toEqual(['A new first line.\n', '1300 changed.']);
    expect(ranges.removed.map(removal => removal.text)).toEqual(['1300.']);
  });

  it('keeps two small edits apart in a document of exactly 1500 lines that gains a line (DEF-HILITE-88)', () => {
    // The promised size: the write pushes the later side to 1501 lines, which
    // the bound leaves room for.
    const lines = Array.from({ length: 1500 }, (_, i) => `Line ${i + 1}.`);
    const before = lines.join('\n');
    const after = `A new first line.\n${before}`.replace(
      /Line 1500\.$/,
      'Line 1500 changed.'
    );
    const ranges = changeRanges(diffWords(before, after));
    expect(
      ranges.added.map(range => after.slice(range.start, range.end))
    ).toEqual(['A new first line.\n', '1500 changed.']);
    expect(ranges.removed.map(removal => removal.text)).toEqual(['1500.']);
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

describe('mapOffsets', () => {
  it('carries offsets across unchanged text and collapses a changed run to a point', () => {
    const inserted = mapOffsets(diffWords('alpha delta', 'alpha beta delta'));
    // 'delta' starts at 6 before the insertion of 'beta ' and at 11 after it.
    expect(inserted.toEarlier(11)).toBe(6);
    expect(inserted.toEarlier(13)).toBe(8);
    expect(inserted.toLater(8)).toBe(13);
    // Every offset inside the inserted text maps to the point it was inserted
    // at, and that point maps to the offset before the inserted text.
    expect(inserted.toEarlier(8)).toBe(6);
    expect(inserted.toLater(6)).toBe(6);
    expect(inserted.toEarlier(16)).toBe(11);

    const deleted = mapOffsets(diffWords('alpha beta delta', 'alpha delta'));
    expect(deleted.toLater(11)).toBe(6);
    expect(deleted.toLater(8)).toBe(6);
    expect(deleted.toLater(13)).toBe(8);
    expect(deleted.toEarlier(8)).toBe(13);
    expect(deleted.toEarlier(11)).toBe(16);
  });
});
