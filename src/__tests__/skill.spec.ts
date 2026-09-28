/**
 * The jupyterlab-advanced-markdown-viewer-extension agent skill shows the marker grammar by example. Each
 * example must read back through the extension's own parser, and render as
 * the same page with its markers as without them.
 */
import { marked } from 'marked';

import { parseMarks } from '../marks';

declare const __dirname: string;
const { readFileSync } = jest.requireActual('fs') as {
  readFileSync(file: string, encoding: string): string;
};

const skill = readFileSync(
  `${__dirname}/../../.agents/skills/jupyterlab-advanced-markdown-viewer-extension/SKILL.md`,
  'utf8'
);

const examples = (skill.match(/```markdown\n[\s\S]*?```/g) ?? []).map(block =>
  block.slice('```markdown\n'.length, -'```'.length)
);

/** The page a source renders, without its comments or layout whitespace. */
function page(source: string): string {
  return (marked.parse(source) as string)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ ?(<[^>]*>) ?/g, '$1')
    .trim();
}

describe('the jupyterlab-advanced-markdown-viewer-extension skill examples', () => {
  it('holds examples', () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it.each(examples)('reads back every mark of %s', example => {
    const marks = parseMarks(example);

    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) {
      expect(mark.open).not.toBeNull();
      expect(mark.close === null).toBe(mark.type === 'document');
      for (const note of mark.notes) {
        expect(note.author).not.toBe('');
        expect(note.stamp).not.toBe('');
      }
    }
  });

  it.each(examples)('renders %s as it renders without markers', example => {
    const bare = example
      .replace(/<!-- mark:[\s\S]*?-->\n?/g, '')
      .replace(/<!-- \/mark:[^>]*-->/g, '');

    expect(page(example)).toBe(page(bare));
  });
});
