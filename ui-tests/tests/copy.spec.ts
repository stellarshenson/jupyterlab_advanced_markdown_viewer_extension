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

test('DEF-COPY-99 copies the selected passage alone, and the whole document when nothing is selected', async ({
  page,
  tmpPath
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const target = `${tmpPath}/${FILE}`;
  await page.contents.uploadContent(DOC, 'text', target);
  await openPreview(page, target, FIRST);

  // Select the first paragraph the way the reader does, over its own words.
  const passage = page
    .locator('.jp-RenderedMarkdown:visible p', { hasText: 'apples and pears' })
    .first();
  await passage.evaluate((element: HTMLElement) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  const box = await passage.boundingBox();
  await openMenu(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await choose(page, 'Copy Content');

  const selected = await copiedHtml(page);
  expect(selected).toContain('apples and pears');
  // Nothing the reader left out travels with it.
  expect(selected).not.toContain('<h1>Report</h1>');
  expect(selected).not.toContain('a list item');
  expect(selected).not.toContain('<table>');
  const selectedText = await page.evaluate(() =>
    navigator.clipboard.readText()
  );
  expect(selectedText).toContain('apples and pears');
  expect(selectedText).not.toContain('Report');

  // With the selection dropped the whole document is the answer again.
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  const whole = await page
    .locator('.jp-RenderedMarkdown:visible')
    .boundingBox();
  await openMenu(page, {
    x: whole.x + whole.width / 2,
    y: whole.y + whole.height / 2
  });
  await choose(page, 'Copy Content');

  const everything = await copiedHtml(page);
  expect(everything).toContain('<h1>Report</h1>');
  expect(everything).toContain('a list item');
  expect(everything).toContain('apples and pears');
});

test('ACC-COPY-160 keeps the tag that names a selected list or table', async ({
  page,
  tmpPath
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const target = `${tmpPath}/${FILE}`;
  await page.contents.uploadContent(DOC, 'text', target);
  await openPreview(page, target, FIRST);

  // The copy is serialised from the returned element's innerHTML, so the
  // outermost tag of a selection is only emitted when the selection sits
  // inside something. Without that, a list arrives as loose items and a
  // table as loose rows, which a mail client runs together.
  const selectContentsOf = async (selector: string) => {
    await page
      .locator(`.jp-RenderedMarkdown:visible ${selector}`)
      .first()
      .evaluate((element: HTMLElement) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
    const box = await page
      .locator(`.jp-RenderedMarkdown:visible ${selector}`)
      .first()
      .boundingBox();
    await openMenu(page, {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2
    });
    await choose(page, 'Copy Content');
    return copiedHtml(page);
  };

  const list = await selectContentsOf('ul');
  expect(list).toContain('<ul>');
  expect(list).toContain('a list item');
  expect(list).toContain('the source');
  // The reader selected the list, not the document around it.
  expect(list).not.toContain('apples and pears');

  const table = await selectContentsOf('table');
  expect(table).toContain('<table>');
  expect(table).toContain('left');
  expect(table).toContain('two');
  expect(table).not.toContain('apples and pears');
});
