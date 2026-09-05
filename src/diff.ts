/**
 * Word-level difference between two strings.
 *
 * The extension needs to know what an external rewrite changed in the rendered
 * text so it can highlight it. A common prefix and suffix are trimmed first,
 * which covers the usual case of an agent rewriting a few paragraphs cheaply,
 * and only the remaining middle goes through a longest-common-subsequence pass.
 * The pass is bounded: past the bound the whole middle is reported as one
 * replacement rather than allowing a quadratic blow-up on a full rewrite.
 */

export type DiffOpKind = 'equal' | 'insert' | 'delete';

/**
 * One run of text that is unchanged, added, or removed.
 */
export interface IDiffOp {
  kind: DiffOpKind;
  text: string;
}

/**
 * Largest number of tokens per side that the quadratic pass will consider.
 */
export const MAX_LCS_TOKENS = 1000;

/**
 * Split text into word and whitespace tokens.
 *
 * Whitespace runs are tokens of their own, so concatenating the tokens
 * reproduces the input exactly and offsets stay faithful.
 */
export function tokenize(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

/**
 * Compare two token sequences and emit the edit script.
 */
function lcsOps(before: string[], after: string[]): IDiffOp[] {
  const n = before.length;
  const m = after.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        before[i] === after[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const ops: IDiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      push(ops, 'equal', before[i]);
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      push(ops, 'delete', before[i]);
      i++;
    } else {
      push(ops, 'insert', after[j]);
      j++;
    }
  }
  while (i < n) {
    push(ops, 'delete', before[i++]);
  }
  while (j < m) {
    push(ops, 'insert', after[j++]);
  }
  return ops;
}

/**
 * Append text to the last operation when the kind matches, so the caller sees
 * whole runs rather than one operation per token.
 */
function push(ops: IDiffOp[], kind: DiffOpKind, text: string): void {
  const last = ops[ops.length - 1];
  if (last && last.kind === kind) {
    last.text += text;
  } else {
    ops.push({ kind, text });
  }
}

/**
 * Compute the word-level difference between two strings.
 *
 * @param before - the earlier text
 * @param after - the later text
 * @returns operations which, read in order, turn `before` into `after`
 */
export function diffWords(before: string, after: string): IDiffOp[] {
  if (before === after) {
    return before ? [{ kind: 'equal', text: before }] : [];
  }
  if (!before) {
    return after ? [{ kind: 'insert', text: after }] : [];
  }
  if (!after) {
    return [{ kind: 'delete', text: before }];
  }

  const beforeTokens = tokenize(before);
  const afterTokens = tokenize(after);

  let head = 0;
  const maxHead = Math.min(beforeTokens.length, afterTokens.length);
  while (head < maxHead && beforeTokens[head] === afterTokens[head]) {
    head++;
  }

  let tail = 0;
  const maxTail = Math.min(beforeTokens.length, afterTokens.length) - head;
  while (
    tail < maxTail &&
    beforeTokens[beforeTokens.length - 1 - tail] ===
      afterTokens[afterTokens.length - 1 - tail]
  ) {
    tail++;
  }

  const beforeMiddle = beforeTokens.slice(head, beforeTokens.length - tail);
  const afterMiddle = afterTokens.slice(head, afterTokens.length - tail);

  const ops: IDiffOp[] = [];
  if (head > 0) {
    push(ops, 'equal', beforeTokens.slice(0, head).join(''));
  }

  if (
    beforeMiddle.length > MAX_LCS_TOKENS ||
    afterMiddle.length > MAX_LCS_TOKENS
  ) {
    // Too large to align token by token. Report the middle as one replacement,
    // which is what the highlight needs anyway at this size.
    if (beforeMiddle.length) {
      push(ops, 'delete', beforeMiddle.join(''));
    }
    if (afterMiddle.length) {
      push(ops, 'insert', afterMiddle.join(''));
    }
  } else {
    for (const op of lcsOps(beforeMiddle, afterMiddle)) {
      push(ops, op.kind, op.text);
    }
  }

  if (tail > 0) {
    push(ops, 'equal', beforeTokens.slice(beforeTokens.length - tail).join(''));
  }
  return ops;
}

/**
 * Offsets carried between the two strings an edit script relates.
 */
export interface IOffsetMap {
  /** The offset in the earlier string of an offset in the later string. */
  toEarlier(later: number): number;
  /** The offset in the later string of an offset in the earlier string. */
  toLater(earlier: number): number;
}

/**
 * Build the mapping between offsets in the two strings of an edit script.
 *
 * An offset in unchanged text maps to the same character on the other side.
 * An offset inside text that exists on one side only maps to the point on the
 * other side where that text was inserted or deleted, so the two ends of such
 * a run map to the same point.
 *
 * @param ops - operations from {@link diffWords}
 */
export function mapOffsets(ops: IDiffOp[]): IOffsetMap {
  const segments: Array<{
    kind: DiffOpKind;
    earlier: number;
    later: number;
    length: number;
  }> = [];
  let earlier = 0;
  let later = 0;
  for (const op of ops) {
    segments.push({ kind: op.kind, earlier, later, length: op.text.length });
    if (op.kind !== 'insert') {
      earlier += op.text.length;
    }
    if (op.kind !== 'delete') {
      later += op.text.length;
    }
  }
  const map = (offset: number, from: 'earlier' | 'later'): number => {
    const to = from === 'earlier' ? 'later' : 'earlier';
    const absent = from === 'earlier' ? 'insert' : 'delete';
    for (const segment of segments) {
      if (segment.kind === absent) {
        continue;
      }
      const end = segment[from] + segment.length;
      if (offset < end || (offset === end && segment.kind === 'equal')) {
        return segment.kind === 'equal'
          ? segment[to] + offset - segment[from]
          : segment[to];
      }
    }
    return from === 'earlier' ? later : earlier;
  };
  return {
    toEarlier: offset => map(offset, 'later'),
    toLater: offset => map(offset, 'earlier')
  };
}

/**
 * A run of added text, as a range in the later string.
 */
export interface IAddedRange {
  start: number;
  end: number;
}

/**
 * Text that was removed, and the offset in the later string where it was.
 */
export interface IRemoval {
  at: number;
  text: string;
}

/**
 * Positions of the changes, expressed against the later string.
 */
export interface IChangeRanges {
  added: IAddedRange[];
  removed: IRemoval[];
}

/**
 * Convert an edit script into positions in the later string.
 *
 * @param ops - operations from {@link diffWords}
 */
export function changeRanges(ops: IDiffOp[]): IChangeRanges {
  const added: IAddedRange[] = [];
  const removed: IRemoval[] = [];
  let offset = 0;
  for (const op of ops) {
    if (op.kind === 'equal') {
      offset += op.text.length;
    } else if (op.kind === 'insert') {
      added.push({ start: offset, end: offset + op.text.length });
      offset += op.text.length;
    } else {
      removed.push({ at: offset, text: op.text });
    }
  }
  return { added, removed };
}
