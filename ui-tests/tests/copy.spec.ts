import { expect, test } from '@jupyterlab/galata';

import {
  choose,
  FILE,
  labFixtures,
  mark,
  openMenu,
  openPreview
} from './helpers';

/**
 * Integration test of Copy Content: the rendered preview handed to the system
 * clipboard as basic HTML.
 *
 * The reader's target is a mail client, so what matters is what lands on the
 * clipboard, not what the panel shows: the test reads both flavours back
 * through the browser's own clipboard.
 */

test.use(labFixtures);

/** A document with one of everything the copy has to carry. */
const DOC = [
  '# Report',
  '',
  'The first paragraph mentions apples and pears.',
  '',
  '- a list item',
  '- [the source](https://example.org)',
  '',
  '| left | right |',
  '| ---- | ----- |',
  '| one | two |',
  '',
  '```ts',
  'const x = 1;',
  '```',
  ''
].join('\n');

const FIRST = 'The first paragraph mentions apples and pears.';

/** The HTML flavour of the system clipboard. */
const copiedHtml = (page: any): Promise<string> =>
  page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes('text/html')) {
        return (await item.getType('text/html')).text();
      }
    }
    return '';
  });

test('ACC-COPY-160 copies the rendered content as basic HTML, with no class, style or paint', async ({
  page,
  tmpPath
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const target = `${tmpPath}/${FILE}`;
  await page.contents.uploadContent(DOC, 'text', target);
  await openPreview(page, target, FIRST);
  // A marked passage carries a background colour in the preview, which is what
  // the browser's own copy would take into the email.
  await mark(page, 'apples and pears.');
  await expect(page.locator('.jp-AdvancedMd-mark')).toHaveCount(1);

  const box = await page.locator('.jp-RenderedMarkdown:visible').boundingBox();
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await openMenu(page, {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  });
  await choose(page, 'Copy Content');

  const html = await copiedHtml(page);
  // The structure is there.
  expect(html).toContain('<h1>Report</h1>');
  expect(html).toContain('<li>a list item</li>');
  expect(html).toContain('<a href="https://example.org/">the source</a>');
  expect(html).toContain('<table>');
  expect(html).toContain('<code>const x = 1;</code>');
  // The look is not, and neither are this extension's own markers.
  expect(html).not.toContain('class=');
  expect(html).not.toContain('style=');
  expect(html).not.toContain('jp-AdvancedMd');
  expect(html).not.toContain('<!-- mark:');
  expect(html).not.toContain('¶');
  // The marked words are in the copy, without the colour they are painted in.
  expect(html).toContain('apples and pears.');

  // A target that takes no HTML gets the same words as text.
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('Report');
  expect(text).toContain(FIRST);
  expect(text).not.toContain('<h1>');
});
