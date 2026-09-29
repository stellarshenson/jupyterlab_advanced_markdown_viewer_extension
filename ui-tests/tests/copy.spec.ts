import { expect, test } from '@jupyterlab/galata';

import {
  choose,
  closeMenus,
  entry,
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

/** A document with a link of each kind whose address is copied. */
const LINKS = [
  '# Links',
  '',
  'Plain words, then [the site](https://example.com/a) and [the notes](./notes.md#setup).',
  '',
  '### Hard criteria',
  '',
  'The heading above carries the paragraph mark link.',
  ''
].join('\n');

test('ACC-COPY-163 copies the address a link opens, without the session token', async ({
  page,
  tmpPath
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const target = `${tmpPath}/${FILE}`;
  await page.contents.uploadContent(LINKS, 'text', target);
  await openPreview(page, target, 'Hard criteria');
  const root = page.locator('.jp-RenderedMarkdown:visible');
  const origin = new URL(page.url()).origin;

  /** Open the menu on a link, choose the entry and read the clipboard. */
  const copyAddressOf = async (link: any): Promise<string> => {
    const box = await link.boundingBox();
    await openMenu(page, {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2
    });
    await expect(
      entry(page, 'Copy link address').locator('.lm-Menu-itemIcon svg')
    ).toHaveCount(1);
    await choose(page, 'Copy link address');
    return page.evaluate(() => navigator.clipboard.readText());
  };

  expect(
    await copyAddressOf(root.getByRole('link', { name: 'the site' }))
  ).toBe('https://example.com/a');

  // JupyterLab writes the session token into a link to a file.
  const notes = root.getByRole('link', { name: 'the notes' });
  expect(await notes.getAttribute('href')).toContain('_xsrf=');
  expect(await copyAddressOf(notes)).toBe(
    `${origin}/files/${tmpPath}/notes.md#setup`
  );

  // The paragraph mark on a heading shows while the heading is hovered.
  const heading = root.locator('h3', { hasText: 'Hard criteria' });
  await heading.hover();
  expect(await copyAddressOf(heading.locator('a.jp-InternalAnchorLink'))).toBe(
    `${origin}/lab/tree/${tmpPath}/${FILE}#Hard-criteria`
  );

  // Off a link the entry is not offered.
  const words = await root
    .locator('p', { hasText: 'Plain words' })
    .boundingBox();
  await openMenu(page, { x: words.x + 5, y: words.y + words.height / 2 });
  await expect(entry(page, 'Copy link address')).toHaveCount(0);
  await closeMenus(page);
});

/** A plain JPEG of 40 by 30 pixels. */
const JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAeACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCGiiivUPMCiiigAooooAKKKKACiiigAooooA//2Q==';

test('ACC-COPY-198 copies a picture as PNG at the size of its file', async ({
  page,
  tmpPath
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.contents.uploadContent(JPEG, 'base64', `${tmpPath}/house.jpg`);
  const target = `${tmpPath}/${FILE}`;
  // Shown at half the width of its file.
  await page.contents.uploadContent(
    '# Pictures\n\n<img src="house.jpg" width="20">\n\nPlain words here.\n',
    'text',
    target
  );
  await openPreview(page, target, 'Plain words here.');
  const root = page.locator('.jp-RenderedMarkdown:visible');
  const picture = root.locator('img');
  await expect
    .poll(() =>
      picture.evaluate((image: HTMLImageElement) => image.naturalWidth)
    )
    .toBe(40);

  const box = await picture.boundingBox();
  await openMenu(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await expect(
    entry(page, 'Copy image').locator('.lm-Menu-itemIcon svg')
  ).toHaveCount(1);
  await choose(page, 'Copy image');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const items = await navigator.clipboard.read();
        if (!items[0]?.types.includes('image/png')) {
          return null;
        }
        const bitmap = await createImageBitmap(
          await items[0].getType('image/png')
        );
        return [items.length, bitmap.width, bitmap.height];
      })
    )
    .toEqual([1, 40, 30]);

  // Off a picture the entry is not offered.
  const words = await root
    .locator('p', { hasText: 'Plain words' })
    .boundingBox();
  await openMenu(page, { x: words.x + 5, y: words.y + words.height / 2 });
  await expect(entry(page, 'Copy image')).toHaveCount(0);
  await closeMenus(page);
});

test('DEF-COPY-126 offers no Copy image on an SVG picture or a drawn diagram', async ({
  page,
  tmpPath
}) => {
  await page.contents.uploadContent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#4682b4"/></svg>',
    'text',
    `${tmpPath}/chart.svg`
  );
  const target = `${tmpPath}/${FILE}`;
  await page.contents.uploadContent(
    '# Pictures\n\n![chart](chart.svg)\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nPlain words here.\n',
    'text',
    target
  );
  await openPreview(page, target, 'Plain words here.');
  const root = page.locator('.jp-RenderedMarkdown:visible');

  for (const picture of [
    root.locator('img[alt="chart"]'),
    root.locator('.jp-RenderedMermaid img')
  ]) {
    await expect
      .poll(() =>
        picture.evaluate((image: HTMLImageElement) => image.naturalWidth)
      )
      .toBeGreaterThan(0);
    const box = await picture.boundingBox();
    await openMenu(page, {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2
    });
    // The menu is the preview's own, and it keeps the entry as a hidden item.
    await expect(entry(page, 'Copy Content')).toBeVisible();
    await expect(entry(page, 'Copy image')).toBeHidden();
    await closeMenus(page);
  }
});
