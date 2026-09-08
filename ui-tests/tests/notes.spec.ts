import { expect, test } from '@jupyterlab/galata';

import {
  choose,
  entry,
  FILE,
  fileText,
  IPoint,
  labFixtures,
  mark,
  menu,
  onDisk,
  openMenu,
  openPreview,
  select,
  settings,
  typeInEditor
} from './helpers';

/**
 * Integration tests of marks and notes in a real browser.
 *
 * The feature has three surfaces and each is exercised where the reader meets
 * it: the context menu of the rendered preview, the panel beside it, and the
 * Markdown file on disk. A test that only read the panel would pass over a
 * marker written in the wrong place, so every write is also read back from the
 * file the server holds, which is the file an agent would read.
 *
 * Selections are built as a `Range` over the rendered text nodes rather than
 * dragged with the mouse, because a drag over wrapped text selects whatever
 * the layout happens to put under the pointer. The context menu is then opened
 * with a real right click inside the selection, which is what keeps the
 * selection alive and what the reader does.
 */

test.use(labFixtures);

/** A document of four paragraphs, each with a sentence worth marking. */
const DOC = [
  '# Report',
  '',
  'The first paragraph mentions apples and pears.',
  '',
  'The second paragraph mentions oranges and plums.',
  '',
  'The third paragraph mentions cherries and figs.',
  '',
  'The fourth paragraph mentions grapes and melons.',
  ''
].join('\n');

/**
 * The four sentences, each ending at its full stop.
 *
 * A selection snaps outward to whole words and a word is a run of non-blank
 * characters, so a selection stopping before the full stop still marks it.
 * Naming the sentence with its stop keeps what is asked for and what is
 * written the same string.
 */
const P1 = 'apples and pears.';
const P2 = 'oranges and plums.';
const P3 = 'cherries and figs.';
const P4 = 'grapes and melons.';

/** The first line of DOC, for the wait that says the preview is up. */
const FIRST = 'The first paragraph mentions apples and pears.';

/** A document long enough that its end is off screen. */
const LONG = [
  '# Long report',
  '',
  ...Array.from(
    { length: 40 },
    (_, i) => `Paragraph ${i + 1} of the long report, written to scroll.\n`
  ),
  'The final paragraph mentions cherries and figs.',
  ''
].join('\n');

/** Identifiers for hand-written markers, each a version 4 UUID. */
const ONE = '0d4b0d0a-4a4e-4f6a-9d8c-1d6b0a3c2e11';
const TWO = '7f2c9c58-3b8a-4b8f-8f7d-2e1a5b6c7d80';
const THREE = 'c1a2b3c4-d5e6-4f70-8123-456789abcdef';

/** The version 4 UUID shape a mark identifier must have. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** An opening marker, written the way this version writes it. */
const opening = (id: string, rest = 'note colour=yellow'): string =>
  `<!-- mark:${id} ${rest} -->`;

/** A closing marker. */
const closing = (id: string): string => `<!-- /mark:${id} -->`;

/**
 * DOC with three of its sentences marked by hand.
 *
 * Each marker pair encloses whole words, full stop included, which is where
 * the extension's own writer puts them: a selection snaps outward to word
 * boundaries, so a marker never lands inside a word.
 */
const MARKED = [
  '# Report',
  '',
  `The first paragraph mentions ${opening(ONE)}${P1}${closing(ONE)}`,
  '',
  `The second paragraph mentions ${opening(TWO, 'note colour=blue')}${P2}` +
    `${closing(TWO)}`,
  '',
  `The third paragraph mentions ${opening(THREE, 'note colour=pink')}${P3}` +
    `${closing(THREE)}`,
  '',
  'The fourth paragraph mentions grapes and melons.',
  ''
].join('\n');

/**
 * DOC with its first sentence marked by hand, the closing marker written
 * between the last word and its full stop.
 *
 * The extension's own writer snaps a selection outward to whole words, so
 * only a marker written by hand or by an agent splits one; the passage is
 * still painted whole.
 */
const SPLIT_WORD = DOC.replace(
  P1,
  `${opening(ONE)}apples and pears${closing(ONE)}.`
);

/**
 * DOC's shape with an indented code block between two paragraphs.
 *
 * An indented block ends where its last word ends, so a mark taken over the
 * whole block has its closing boundary exactly on the bound of the block. A
 * marker left there is printed as a line of the reader's own code, which is
 * what the widening out of a protected span prevents.
 */
const CODE_DOC = [
  '# Recipe',
  '',
  'The paragraph before the code.',
  '',
  '    total = one + two',
  '    printed',
  '',
  'The paragraph after the code.',
  ''
].join('\n');

/** How many marks the many-mark document carries. */
const MANY = 20;

/** A version 4 UUID for the nth mark of the many-mark document. */
const manyId = (n: number): string =>
  `0d4b0d0a-4a4e-4f6a-9d8c-1d6b0a3c2e${String(n).padStart(2, '0')}`;

/** How many paragraphs stand between one mark of that document and the next. */
const MANY_GAP = 60;

/**
 * A document of 1200 paragraphs carrying twenty marks, one every sixtieth.
 *
 * A paint reads the source once and the rendered text once for the whole
 * document rather than once for every mark, so a long document with many
 * marks is what says whether every passage is still found afterwards.
 */
const MANY_MARKS = [
  '# Long report',
  '',
  ...Array.from({ length: MANY * MANY_GAP }, (_, i) => {
    const passage =
      `fruit number ${i + 1} and keeps its own sentence about apples, ` +
      'pears, oranges and plums.';
    const lead = `Paragraph ${i + 1} of the long report mentions `;
    if (i % MANY_GAP !== 0) {
      return `${lead}${passage}\n`;
    }
    // The marker goes after the first words of the line, never at the start
    // of one, which CommonMark would read as an HTML block and swallow the
    // paragraph into. That is where the extension's own writer puts it too.
    const id = manyId(i / MANY_GAP);
    return `${lead}${opening(id)}${passage}${closing(id)}\n`;
  }),
  ''
].join('\n');

/**
 * Wait until the file on disk says what the test waits for, and answer with
 * it. A write is finished when the save has landed, not when the panel has
 * redrawn, so every assertion about the document reads the file itself.
 */
async function fileWhen(
  apiPath: string,
  holds: (text: string) => boolean
): Promise<string> {
  await expect
    .poll(() => holds(fileText(apiPath)), { timeout: 15000 })
    .toBe(true);
  return fileText(apiPath);
}

/** The identifiers of every opening marker, in document order. */
const openingIds = (text: string): string[] =>
  [...text.matchAll(/<!-- mark:([0-9a-f-]{36})[ \n]/g)].map(match => match[1]);

/** The identifiers of every closing marker, in document order. */
const closingIds = (text: string): string[] =>
  [...text.matchAll(/<!-- \/mark:([0-9a-f-]{36}) -->/g)].map(match => match[1]);

/** Drop the selection, for the tests that need the menu without one. */
const clearSelection = (page: any): Promise<void> =>
  page.evaluate(() => window.getSelection()?.removeAllRanges());

/** The middle of the rendered preview, which is always on screen. */
async function previewCentre(page: any): Promise<IPoint> {
  const box = await page.locator('.jp-RenderedMarkdown:visible').boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Right click in the middle of the rendered preview, without a selection. */
async function openMenuOnPreview(page: any): Promise<void> {
  await clearSelection(page);
  await openMenu(page, await previewCentre(page));
}

/** The panel of the preview in front, absent while the panel is hidden. */
const panel = (page: any) => page.locator('.jp-AdvancedMd-notes:visible');

/** The rows the panel lists. */
const rows = (page: any) =>
  page.locator('.jp-AdvancedMd-notes:visible .jp-AdvancedMd-notesRow');

/** The ticks the minimap shows. */
const ticks = (page: any) =>
  page.locator('.jp-AdvancedMd-notes:visible .jp-AdvancedMd-notesTick');

/** The painted passages of the preview in front. */
const painted = (page: any) =>
  page.locator('.jp-RenderedMarkdown:visible .jp-AdvancedMd-mark');

/** A button of the panel, by the text on it. */
const panelButton = (page: any, label: string) =>
  page.locator('.jp-AdvancedMd-notes:visible button', { hasText: label });

/** The toolbar control that brings the panel back. */
const toolbarNotes = (page: any) =>
  page.locator('.jp-Toolbar:visible .jp-ToolbarButton', { hasText: 'Notes' });

/** Open a row so its controls and its whole thread are on screen. */
async function openRow(page: any, index = 0): Promise<void> {
  await rows(page).nth(index).locator('.jp-AdvancedMd-notesHead').click();
  await expect(
    rows(page).nth(index).locator('.jp-AdvancedMd-notesControls')
  ).toBeVisible();
}

/** Write a note into the entry that is open. */
async function writeNote(page: any, text: string): Promise<void> {
  const box = page.locator('.jp-AdvancedMd-notesForm textarea');
  await expect(box).toBeVisible();
  await box.fill(text);
  await panelButton(page, 'Save').click();
}

/** Save a file the way a process outside the lab does. */
const writeExternally = (
  page: any,
  apiPath: string,
  content: string
): Promise<void> => page.contents.uploadContent(content, 'text', apiPath);

/** The scroll position of the rendered view. */
const scrollTop = (page: any): Promise<number> =>
  page.evaluate(() => {
    const roots = Array.from(
      document.querySelectorAll<HTMLElement>('.jp-RenderedMarkdown')
    );
    const root = roots.find(node => node.offsetParent !== null);
    return root ? root.scrollTop : -1;
  });

/** No dialog is open, and no tab reports unsaved work. */
async function savedCleanly(page: any): Promise<void> {
  await expect(page.locator('.jp-Dialog')).toHaveCount(0);
  await expect(page.locator('.lm-TabBar-tab.jp-mod-dirty')).toHaveCount(0);
}

test.describe('marking a passage', () => {
  // A short fade so a test that writes the file externally does not wait out
  // the highlight, and no typing animation so the change is on screen at once.
  test.use({ mockSettings: settings({ fadeDuration: 500, animation: false }) });

  test.beforeEach(async ({ page, tmpPath }) => {
    await page.contents.uploadContent(DOC, 'text', `${tmpPath}/${FILE}`);
    await openPreview(page, `${tmpPath}/${FILE}`, FIRST);
  });

  test('ACC-NOTES-44 adds a note from a selection through the context menu', async ({
    page,
    tmpPath
  }) => {
    await openMenu(page, await select(page, P1));
    await choose(page, 'Add note');

    await writeNote(page, 'This needs a source.');

    await expect(rows(page)).toHaveCount(1);
    await expect(
      rows(page).first().locator('.jp-AdvancedMd-notesPassage')
    ).toHaveText(P1);
    await expect(
      rows(page).first().locator('.jp-AdvancedMd-notesText')
    ).toHaveText('This needs a source.');
    await fileWhen(`${tmpPath}/${FILE}`, holds =>
      holds.includes('This needs a source.')
    );
  });

  test('ACC-NOTES-45 offers the marking entries only with a selection', async ({
    page
  }) => {
    await openMenuOnPreview(page);
    // A Lumino item that is not visible stays in the DOM, so what says the
    // entry is not offered is the class on it.
    await expect(entry(page, 'Mark yellow')).toHaveCount(1);
    await expect(entry(page, 'Mark yellow')).toHaveClass(/lm-mod-hidden/);
    await expect(entry(page, 'Add note')).toHaveClass(/lm-mod-hidden/);
    // The panel entries are offered without a selection, which is the control
    // saying the menu itself was built.
    await expect(entry(page, 'Show notes')).not.toHaveClass(/lm-mod-hidden/);
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);

    await openMenu(page, await select(page, P1));
    await expect(entry(page, 'Mark yellow')).not.toHaveClass(/lm-mod-hidden/);
    await expect(entry(page, 'Add note')).not.toHaveClass(/lm-mod-hidden/);
  });

  test('ACC-NOTES-46 writes the note and both markers into the file', async ({
    page,
    tmpPath
  }) => {
    await openMenu(page, await select(page, P1));
    await choose(page, 'Add note');
    await writeNote(page, 'The source is missing.');

    const text = await fileWhen(`${tmpPath}/${FILE}`, holds =>
      holds.includes('The source is missing.')
    );
    const [id] = openingIds(text);
    expect(id).toMatch(UUID);
    expect(text).toContain(`<!-- mark:${id} note colour=yellow\n`);
    expect(text).toContain(closing(id));
    expect(text).toMatch(
      /@[A-Za-z0-9_.-]+ \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z: The source is missing\./
    );
  });

  test('ACC-NOTES-47 gives each mark an identifier that occurs exactly twice', async ({
    page,
    tmpPath
  }) => {
    await mark(page, P1);
    await expect(painted(page)).toHaveCount(1);
    await mark(page, P2);
    await expect(painted(page)).toHaveCount(2);
    await mark(page, P3);
    await expect(painted(page)).toHaveCount(3);

    const text = await fileWhen(
      `${tmpPath}/${FILE}`,
      holds => openingIds(holds).length === 3
    );
    const ids = openingIds(text);
    expect(new Set(ids).size).toBe(3);
    expect(closingIds(text)).toEqual(ids);
    for (const id of ids) {
      expect(text.split(id).length - 1).toBe(2);
    }
  });

  test('ACC-NOTES-48 writes a version 4 UUID as the identifier', async ({
    page,
    tmpPath
  }) => {
    await mark(page, P1);

    const text = await fileWhen(
      `${tmpPath}/${FILE}`,
      holds => openingIds(holds).length === 1
    );
    expect(openingIds(text)[0]).toMatch(UUID);
  });

  test('ACC-NOTES-95 writes a bare mark with no note line', async ({
    page,
    tmpPath
  }) => {
    await mark(page, P1);

    const text = await fileWhen(
      `${tmpPath}/${FILE}`,
      holds => openingIds(holds).length === 1
    );
    const id = openingIds(text)[0];
    // The whole marker on one line is what says it carries no note.
    expect(text).toContain(`${opening(id)}${P1}${closing(id)}`);
    await expect(rows(page)).toHaveCount(1);
    await expect(
      rows(page).first().locator('.jp-AdvancedMd-notesPassage')
    ).toHaveText(P1);
  });

  test('ACC-NOTES-96 adds a note from the marked passage and leaves it whole', async ({
    page,
    tmpPath
  }) => {
    await mark(page, P1);
    const before = await fileWhen(
      `${tmpPath}/${FILE}`,
      holds => openingIds(holds).length === 1
    );
    const id = openingIds(before)[0];

    // Clicking the passage itself is the second way to the note entry.
    await painted(page).first().click();
    await writeNote(page, 'Say which orchard.');

    const text = await fileWhen(`${tmpPath}/${FILE}`, holds =>
      holds.includes('Say which orchard.')
    );
    // The passage between the markers is byte for byte what it was, and the
    // closing marker is untouched.
    expect(text).toContain(`-->${P1}${closing(id)}`);
    expect(text).toContain(`<!-- mark:${id} note colour=yellow\n`);
    expect(closingIds(text)).toEqual([id]);
    expect(text).toContain('The second paragraph mentions oranges and plums.');
  });

  test('ACC-NOTES-97 writes no note line when the entry is confirmed empty', async ({
    page,
    tmpPath
  }) => {
    await mark(page, P1);
    const before = await fileWhen(
      `${tmpPath}/${FILE}`,
      holds => openingIds(holds).length === 1
    );

    await openRow(page);
    await panelButton(page, 'Add note').click();
    await expect(
      page.locator('.jp-AdvancedMd-notesForm textarea')
    ).toBeVisible();
    await panelButton(page, 'Save').click();
    await expect(page.locator('.jp-AdvancedMd-notesForm')).toHaveCount(0);

    // Give a write that should not happen the time it would have taken.
    await page.waitForTimeout(1500);
    expect(fileText(`${tmpPath}/${FILE}`)).toBe(before);
  });

  test('ACC-NOTES-98 writes each colour into the marker and paints it', async ({
    page,
    tmpPath
  }) => {
    await mark(page, P1, undefined, 'yellow');
    await expect(painted(page)).toHaveCount(1);
    await mark(page, P2, undefined, 'blue');
    await expect(painted(page)).toHaveCount(2);
    await mark(page, P3, undefined, 'pink');
    await expect(painted(page)).toHaveCount(3);
    await mark(page, P4, undefined, 'orange');
    await expect(painted(page)).toHaveCount(4);

    const text = await fileWhen(
      `${tmpPath}/${FILE}`,
      holds => openingIds(holds).length === 4
    );
    for (const colour of ['yellow', 'blue', 'pink', 'orange']) {
      expect(text).toContain(`note colour=${colour} -->`);
      await expect(
        page.locator(
          `.jp-RenderedMarkdown:visible .jp-AdvancedMd-mark-${colour}`
        )
      ).toHaveCount(1);
    }
    const backgrounds = await page.evaluate(() =>
      ['yellow', 'blue', 'pink', 'orange'].map(colour => {
        const node = document.querySelector(
          `.jp-RenderedMarkdown .jp-AdvancedMd-mark-${colour}`
        );
        return node ? getComputedStyle(node).backgroundColor : '';
      })
    );
    // Four painted passages, four different backgrounds, none of them the
    // transparent one an unstyled span reports.
    expect(new Set(backgrounds).size).toBe(4);
    for (const background of backgrounds) {
      expect(background).not.toBe('rgba(0, 0, 0, 0)');
    }
  });

  test('ACC-NOTES-101 keeps a heading whole when the selection starts inside it', async ({
    page,
    tmpPath
  }) => {
    await mark(page, 'Report', P1);

    const text = await fileWhen(
      `${tmpPath}/${FILE}`,
      holds => openingIds(holds).length === 1
    );
    const id = openingIds(text)[0];
    const lines = text.split('\n');
    // The heading line is exactly what it was: no marker inside it.
    expect(lines).toContain('# Report');
    // The opening marker was widened out of the heading onto a line of its
    // own before the block; the closing marker stays inline in the paragraph.
    expect(lines).toContain(opening(id));
    expect(text).toContain(`${P1}${closing(id)}`);
    await expect(page.locator('.jp-RenderedMarkdown:visible h1')).toContainText(
      'Report'
    );
  });

  test('ACC-NOTES-60 marks a selection that crosses a block boundary', async ({
    page,
    tmpPath
  }) => {
    await mark(page, P1, 'The second paragraph');

    const text = await fileWhen(
      `${tmpPath}/${FILE}`,
      holds => openingIds(holds).length === 1
    );
    const id = openingIds(text)[0];
    // Both paragraphs carry a painted run of the one mark.
    const blocks = await page.evaluate(
      (target: string) =>
        Array.from(
          document.querySelectorAll(
            `.jp-RenderedMarkdown [data-mark="${target}"]`
          )
        ).map(node => node.closest('p')?.textContent ?? ''),
      id
    );
    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks[0]).toContain('apples and pears');
    expect(blocks[blocks.length - 1]).toContain('The second paragraph');
  });

  test('ACC-NOTES-61 keeps two overlapping marks and all four markers', async ({
    page,
    tmpPath
  }) => {
    await mark(page, P1, P2);
    await fileWhen(
      `${tmpPath}/${FILE}`,
      holds => openingIds(holds).length === 1
    );
    await mark(page, P2, P3, 'blue');

    const text = await fileWhen(
      `${tmpPath}/${FILE}`,
      holds => openingIds(holds).length === 2
    );
    const ids = openingIds(text);
    expect(new Set(ids).size).toBe(2);
    expect(new Set(closingIds(text))).toEqual(new Set(ids));
    await expect(rows(page)).toHaveCount(2);
    for (const id of ids) {
      await expect(
        page.locator(`.jp-RenderedMarkdown:visible [data-mark="${id}"]`).first()
      ).toBeVisible();
    }
  });

  test('ACC-NOTES-57 removes both markers and leaves the text', async ({
    page,
    tmpPath
  }) => {
    await mark(page, P1);
    const before = await fileWhen(
      `${tmpPath}/${FILE}`,
      holds => openingIds(holds).length === 1
    );
    const id = openingIds(before)[0];

    await openRow(page);
    await panelButton(page, 'Remove').click();

    const text = await fileWhen(
      `${tmpPath}/${FILE}`,
      holds => openingIds(holds).length === 0
    );
    // The identifier is gone from the whole file, so neither marker is left
    // behind under any spelling.
    expect(text).not.toContain(id);
    expect(closingIds(text)).toEqual([]);
    expect(text).toContain(FIRST);
    await expect(painted(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(0);
    await expect(panel(page).locator('.jp-AdvancedMd-notesCount')).toHaveText(
      'No marks'
    );
  });

  test('ACC-NOTES-50 opens the panel on the first mark', async ({ page }) => {
    // A document with no marks and no stored state opens without the panel.
    await expect(panel(page)).toHaveCount(0);

    await mark(page, P1);

    await expect(panel(page)).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
  });

  test('ACC-NOTES-100 saves the mark and a change written a moment before', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    const changed = DOC.replace('cherries and figs', 'quinces and medlars');
    // The write and the mark are not separated by a wait: whether the change
    // has reached the document by the time the marker is written or is still
    // only on disk, the save carries both and raises no dialog.
    await writeExternally(page, target, changed);
    await mark(page, P1);

    const text = await fileWhen(
      target,
      holds => openingIds(holds).length === 1
    );
    expect(text).toContain('quinces and medlars');
    expect(text).not.toContain('cherries and figs');
    expect(text).toContain(`${opening(openingIds(text)[0])}${P1}`);
    await savedCleanly(page);
  });

  test("DEF-NOTES-36 applies the route's edits once when the watcher read the file back first", async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    // Only the answer is held back: the server writes the file at once, the
    // watcher reads it back into the document, and the 200 reaches the page
    // after the document already holds the markers.
    let delivered = false;
    await page.route(/\/write(\?.*)?$/, async (route: any) => {
      const response = await route.fetch();
      await new Promise(resolve => setTimeout(resolve, 400));
      await route.fulfill({ response });
      delivered = true;
    });

    await mark(page, 'apples');

    await expect.poll(() => delivered, { timeout: 15000 }).toBe(true);
    await expect
      .poll(() => openingIds(fileText(target)).length, { timeout: 15000 })
      .toBe(1);
    // The refresh after the 200 has run by now; what the document holds is
    // what stays.
    await page.waitForTimeout(500);
    const document = await page.evaluate((path: string) => {
      const open = Array.from(
        (window as any).jupyterapp.shell.widgets('main')
      ) as any[];
      const widget = open.find(w => w.context && w.context.path === path);
      return {
        model: widget.context.model.toString() as string,
        dirty: widget.context.model.dirty as boolean
      };
    }, target);
    expect(openingIds(document.model)).toHaveLength(1);
    expect(closingIds(document.model)).toHaveLength(1);
    expect(openingIds(fileText(target))).toHaveLength(1);
    expect(document.model).toBe(fileText(target));
    expect(document.dirty).toBe(false);
    await savedCleanly(page);
  });

  test('ACC-NOTES-58 keeps a mark anchored through a change elsewhere', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await mark(page, P1);
    const text = await fileWhen(
      target,
      holds => openingIds(holds).length === 1
    );
    const id = openingIds(text)[0];

    await writeExternally(
      page,
      target,
      text.replace('cherries and figs', 'quinces and medlars')
    );
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      'quinces and medlars'
    );

    await expect(rows(page)).toHaveCount(1);
    await expect(
      rows(page).first().locator('.jp-AdvancedMd-notesState')
    ).toHaveCount(0);
    await expect(
      page.locator(`.jp-RenderedMarkdown:visible [data-mark="${id}"]`)
    ).toHaveCount(1);
  });

  test('ACC-NOTES-59 lists a mark whose markers a rewrite removed', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await mark(page, P1);
    const text = await fileWhen(
      target,
      holds => openingIds(holds).length === 1
    );
    const [only] = openingIds(text);

    // The rewrite takes both markers of the only mark away, which is what an
    // agent rewriting that paragraph does. Nothing is left to anchor, so the
    // panel is holding the last mark of the document when it is asked to keep
    // showing it.
    await writeExternally(
      page,
      target,
      text
        .replace(opening(only), '')
        .replace(closing(only), '')
        .replace('cherries and figs', 'quinces and medlars')
    );
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      'quinces and medlars'
    );

    // The mark that lost its markers is still listed, and says it is lost.
    await expect(panel(page)).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).filter({ hasText: 'unanchored' })).toHaveCount(1);
    expect(openingIds(fileText(target))).toEqual([]);
    await expect(painted(page)).toHaveCount(0);
  });
  test('ACC-NOTES-99 shows a note another author added to the file', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await openMenu(page, await select(page, P1));
    await choose(page, 'Add note');
    await writeNote(page, 'This contradicts the intro.');
    const text = await fileWhen(target, holds =>
      holds.includes('This contradicts the intro.')
    );
    const id = openingIds(text)[0];

    // The agent answers by editing the file, which is the whole protocol.
    await writeExternally(
      page,
      target,
      text.replace(
        '\n-->',
        '\n@claude 2026-09-06T16:05:12Z: Agreed, I will rewrite it.\n-->'
      )
    );

    const entries = rows(page).first().locator('.jp-AdvancedMd-notesEntry');
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0)).toContainText('This contradicts the intro.');
    await expect(entries.nth(1)).toContainText('@claude');
    await expect(entries.nth(1)).toContainText('Agreed, I will rewrite it.');
    expect(openingIds(fileText(target))).toEqual([id]);
  });

  test('ACC-NOTES-104 reads a two-line entry as one note under its author', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await openMenu(page, await select(page, P1));
    await choose(page, 'Add note');
    await writeNote(page, 'Needs a source.');
    const text = await fileWhen(target, holds =>
      holds.includes('Needs a source.')
    );
    // Every note line opens with the handle of whoever wrote it. Which handle
    // that is belongs to the two identity tests below.
    expect(text).toMatch(
      /\n@[A-Za-z0-9_.-]+ \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z: Needs a source\.\n/
    );

    // A line inside the marker that does not open an entry continues the one
    // above it, so a note runs over two lines under one author.
    await writeExternally(
      page,
      target,
      text.replace(
        '\n-->',
        '\n@claude 2026-09-06T16:05:12Z: The first line of the answer,\n' +
          'and the second line of the same answer.\n-->'
      )
    );

    const entries = rows(page).first().locator('.jp-AdvancedMd-notesEntry');
    await expect(entries).toHaveCount(2);
    await expect(
      entries.nth(1).locator('.jp-AdvancedMd-notesAuthor')
    ).toHaveText('@claude');
    await expect(entries.nth(1).locator('.jp-AdvancedMd-notesText')).toHaveText(
      'The first line of the answer, and the second line of the same answer.'
    );
  });
});

test.describe('a document that already carries marks', () => {
  test.use({ mockSettings: settings({ fadeDuration: 500, animation: false }) });

  test.beforeEach(async ({ page, tmpPath }) => {
    await page.contents.uploadContent(MARKED, 'text', `${tmpPath}/${FILE}`);
    await openPreview(page, `${tmpPath}/${FILE}`, FIRST);
    await expect(panel(page)).toBeVisible();
  });

  test('ACC-NOTES-51 opens the panel listing the marks it holds', async ({
    page
  }) => {
    await expect(rows(page)).toHaveCount(3);
    await expect(
      rows(page).nth(0).locator('.jp-AdvancedMd-notesPassage')
    ).toHaveText(P1);
    await expect(
      rows(page).nth(1).locator('.jp-AdvancedMd-notesPassage')
    ).toHaveText(P2);
  });

  test('ACC-NOTES-56 marks every commented passage in the rendered view', async ({
    page
  }) => {
    await expect(painted(page)).toHaveCount(3);
    const marked = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('.jp-RenderedMarkdown .jp-AdvancedMd-mark')
      ).map(node => node.textContent)
    );
    expect(marked).toEqual([P1, P2, P3]);
  });

  test('ACC-NOTES-52 closes the panel and brings it back with no mark lost', async ({
    page
  }) => {
    await page.locator('.jp-AdvancedMd-notesClose').click();
    await expect(panel(page)).toHaveCount(0);

    await expect(toolbarNotes(page)).toBeVisible();
    await toolbarNotes(page).click();

    await expect(panel(page)).toBeVisible();
    await expect(rows(page)).toHaveCount(3);
  });

  test('ACC-NOTES-53 is a narrow strip beside the preview with no overlap', async ({
    page
  }) => {
    const strip = await panel(page).boundingBox();
    const rendered = await page
      .locator('.jp-RenderedMarkdown:visible')
      .boundingBox();
    expect(strip).not.toBeNull();
    expect(rendered).not.toBeNull();
    // The panel starts where the rendered Markdown ends, and is the narrower.
    expect(strip.x).toBeGreaterThanOrEqual(rendered.x + rendered.width - 1);
    expect(strip.width).toBeLessThan(rendered.width);
  });

  test('ACC-NOTES-65 shows text, then ticks, then nothing', async ({
    page,
    tmpPath
  }) => {
    await expect(rows(page)).toHaveCount(3);
    await expect(ticks(page)).toHaveCount(0);

    await openMenuOnPreview(page);
    await choose(page, 'Show notes minimap');
    await expect(panel(page)).toHaveClass(/jp-AdvancedMd-notes-minimap/);
    await expect(ticks(page)).toHaveCount(3);
    await expect(rows(page)).toHaveCount(0);

    await openMenuOnPreview(page);
    await choose(page, 'Hide notes');
    await expect(panel(page)).toHaveCount(0);

    await openMenuOnPreview(page);
    await choose(page, 'Show notes');
    await expect(rows(page)).toHaveCount(3);

    // ACC-NOTES-68: three changes of state leave exactly one settings marker.
    const text = await fileWhen(`${tmpPath}/${FILE}`, holds =>
      holds.includes('marks:settings panel=expanded')
    );
    expect(text.match(/marks:settings/g)).toHaveLength(1);
  });

  test('ACC-NOTES-64 shows and hides the panel from the context menu', async ({
    page
  }) => {
    await openMenuOnPreview(page);
    await expect(entry(page, 'Hide notes')).not.toHaveClass(/lm-mod-hidden/);
    // The state the panel is already in is not offered.
    await expect(entry(page, 'Show notes')).toHaveClass(/lm-mod-hidden/);
    await choose(page, 'Hide notes');
    await expect(panel(page)).toHaveCount(0);

    await openMenuOnPreview(page);
    await expect(entry(page, 'Show notes')).not.toHaveClass(/lm-mod-hidden/);
    await choose(page, 'Show notes');
    await expect(panel(page)).toBeVisible();
  });

  test('ACC-NOTES-102 lists an unknown type and offers it no editing', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await writeExternally(
      page,
      target,
      MARKED.replace(
        opening(TWO, 'note colour=blue'),
        opening(TWO, 'task colour=blue owner=agent')
      )
    );
    await expect(
      rows(page).nth(1).locator('.jp-AdvancedMd-notesState')
    ).toHaveText('task');

    // The row of the unknown type opens and shows no control at all.
    await rows(page).nth(1).locator('.jp-AdvancedMd-notesHead').click();
    await expect(
      rows(page).nth(1).locator('.jp-AdvancedMd-notesControls')
    ).toHaveCount(0);

    // A change to another mark leaves the unknown marker byte for byte.
    await openRow(page, 0);
    await panelButton(page, 'Add note').click();
    await writeNote(page, 'A note on the first mark.');
    const text = await fileWhen(target, holds =>
      holds.includes('A note on the first mark.')
    );
    expect(text).toContain(opening(TWO, 'task colour=blue owner=agent'));
  });

  test('ACC-NOTES-103 keeps unknown attributes in order when it rewrites', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await writeExternally(
      page,
      target,
      MARKED.replace(
        opening(TWO, 'note colour=blue'),
        opening(TWO, 'note colour=blue owner=agent due=2026-09-30')
      )
    );
    await expect(
      page.locator('.jp-RenderedMarkdown:visible .jp-AdvancedMd-mark-blue')
    ).toHaveCount(1);

    await openRow(page, 1);
    await panelButton(page, 'Add note').click();
    await writeNote(page, 'Answering the agent.');

    const text = await fileWhen(target, holds =>
      holds.includes('Answering the agent.')
    );
    expect(text).toContain(
      `<!-- mark:${TWO} note colour=blue owner=agent due=2026-09-30\n`
    );
  });

  test('ACC-NOTES-54 shows a note collapsed and expands it whole', async ({
    page,
    tmpPath
  }) => {
    await writeExternally(
      page,
      `${tmpPath}/${FILE}`,
      MARKED.replace(
        opening(ONE),
        `<!-- mark:${ONE} note colour=yellow\n` +
          '@claude 2026-09-06T16:05:12Z: The first line of the note,\n' +
          'and the second line the row hides until it is opened.\n-->'
      )
    );
    const row = rows(page).first();
    await expect(row.locator('.jp-AdvancedMd-notesText')).toHaveText(
      'The first line of the note,'
    );

    await row.locator('.jp-AdvancedMd-notesToggle').click();

    await expect(row.locator('.jp-AdvancedMd-notesText')).toContainText(
      'and the second line the row hides until it is opened.'
    );
    // The other rows are unaffected, which is what independently means.
    await expect(
      rows(page).nth(1).locator('.jp-AdvancedMd-notesControls')
    ).toHaveCount(0);
  });
});

test.describe('a marker written by hand inside a word', () => {
  test.use({ mockSettings: settings({ fadeDuration: 500, animation: false }) });

  test('ACC-NOTES-56 paints the whole passage when a marker splits its last word', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(SPLIT_WORD, 'text', target);
    await openPreview(page, target, FIRST);

    // The word the closing marker splits is painted whole, so the span covers
    // the passage and the full stop that word ends with.
    await expect(painted(page)).toHaveCount(1);
    await expect(painted(page).first()).toHaveText(P1);
  });
});

test.describe('a document whose panel opens as a minimap', () => {
  test.use({ mockSettings: settings({ fadeDuration: 500, animation: false }) });

  test.beforeEach(async ({ page, tmpPath }) => {
    await page.contents.uploadContent(
      `${DOC}<!-- marks:settings panel=minimap -->\n`,
      'text',
      `${tmpPath}/${FILE}`
    );
    await openPreview(page, `${tmpPath}/${FILE}`, FIRST);
  });

  test('DEF-NOTES-28 opens the note entry from the marked passage', async ({
    page,
    tmpPath
  }) => {
    await mark(page, P1);
    const before = await fileWhen(
      `${tmpPath}/${FILE}`,
      holds => openingIds(holds).length === 1
    );
    const id = openingIds(before)[0];
    await expect(panel(page)).toHaveClass(/jp-AdvancedMd-notes-minimap/);

    // The minimap renders no rows, so the entry needs the expanded state.
    await painted(page).first().click();
    await expect(panel(page)).toHaveClass(/jp-AdvancedMd-notes-expanded/);
    await writeNote(page, 'Say which orchard.');

    const text = await fileWhen(`${tmpPath}/${FILE}`, holds =>
      holds.includes('Say which orchard.')
    );
    expect(text).toContain(`-->${P1}${closing(id)}`);
    expect(text).toContain('<!-- marks:settings panel=expanded -->');
  });
});

test.describe('a file with CRLF line endings', () => {
  test.use({ mockSettings: settings({ fadeDuration: 500, animation: false }) });

  test('DEF-APPLY-27 keeps one carriage return per line through two marks', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    const crlf = DOC.replace(/\n/g, '\r\n');
    await page.contents.uploadContent(crlf, 'text', target);
    expect(fileText(target)).toBe(crlf);
    await openPreview(page, target, FIRST);

    await mark(page, P1);
    await fileWhen(target, holds => openingIds(holds).length === 1);
    await mark(page, P3);
    const text = await fileWhen(
      target,
      holds => openingIds(holds).length === 2
    );

    // The Context loads a CRLF file as LF and puts the CR back on each save;
    // the watcher compares and applies in LF as well, so the open applies
    // nothing and no save adds a CR on top of the one put back.
    const [first, third] = openingIds(text);
    expect(text).toContain(`-->${P1}${closing(first)}`);
    expect(text).toContain(`-->${P3}${closing(third)}`);
    expect(text).not.toContain('\r\r');
    expect(text.split('\r\n').length).toBe(text.split('\n').length);
  });
});

test.describe('the panel state stored in the document', () => {
  test.use({ mockSettings: settings({ fadeDuration: 500, animation: false }) });

  test('ACC-NOTES-66 reopens the document in the state it was left', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(MARKED, 'text', target);
    await openPreview(page, target, FIRST);

    await openMenuOnPreview(page);
    await choose(page, 'Show notes minimap');
    await expect(panel(page)).toHaveClass(/jp-AdvancedMd-notes-minimap/);
    await fileWhen(target, holds =>
      holds.includes('<!-- marks:settings panel=minimap -->')
    );

    await page.evaluate(() => {
      const open = Array.from(
        (window as any).jupyterapp.shell.widgets('main')
      ) as any[];
      for (const widget of open) {
        widget.close();
      }
    });
    await expect(page.locator('.jp-RenderedMarkdown')).toHaveCount(0);
    await openPreview(page, target, FIRST);

    await expect(panel(page)).toHaveClass(/jp-AdvancedMd-notes-minimap/);
    await expect(ticks(page)).toHaveCount(3);
  });

  test('ACC-NOTES-67 replaces the whole settings marker, obsolete keys and all', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(
      `${MARKED}\n<!-- marks:settings panel=minimap density=compact -->\n`,
      'text',
      target
    );
    await openPreview(page, target, FIRST);
    await expect(panel(page)).toHaveClass(/jp-AdvancedMd-notes-minimap/);

    await openMenuOnPreview(page);
    await choose(page, 'Show notes');

    const text = await fileWhen(target, holds =>
      holds.includes('panel=expanded')
    );
    expect(text).toContain('<!-- marks:settings panel=expanded -->');
    expect(text).not.toContain('density');
    expect(text.match(/marks:settings/g)).toHaveLength(1);
  });

  test('ACC-NOTES-69 ignores a settings marker it cannot read', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(
      `${DOC}\n<!-- marks:settings panel -->\n`,
      'text',
      target
    );
    await openPreview(page, target, FIRST);

    // The document holds no mark, so the default state is the hidden one.
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('.jp-Dialog')).toHaveCount(0);

    await openMenuOnPreview(page);
    await choose(page, 'Show notes');

    const text = await fileWhen(target, holds =>
      holds.includes('panel=expanded')
    );
    expect(text.match(/marks:settings/g)).toHaveLength(1);
    expect(text).toContain('<!-- marks:settings panel=expanded -->');
  });

  test('ACC-NOTES-70 leaves the text and the scroll where they were', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(LONG, 'text', target);
    await openPreview(page, target, 'Long report');

    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('.jp-RenderedMarkdown');
      if (root) {
        root.scrollTop = Math.round(root.scrollHeight / 2);
      }
    });
    const parked = await scrollTop(page);
    expect(parked).toBeGreaterThan(0);
    const before = await page
      .locator('.jp-RenderedMarkdown:visible')
      .innerText();

    await openMenuOnPreview(page);
    await choose(page, 'Show notes');
    await fileWhen(target, holds => holds.includes('panel=expanded'));
    await page.waitForTimeout(1000);

    expect(await scrollTop(page)).toBe(parked);
    expect(await page.locator('.jp-RenderedMarkdown:visible').innerText()).toBe(
      before
    );
  });
});

test.describe('revealing a mark from the panel', () => {
  test.use({ mockSettings: settings({ fadeDuration: 500, animation: false }) });

  test('ACC-NOTES-55 scrolls the preview to the passage of the chosen mark', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(
      LONG.replace(
        'cherries and figs',
        `${opening(ONE)}cherries and figs${closing(ONE)}`
      ),
      'text',
      target
    );
    await openPreview(page, target, 'Long report');
    await expect(rows(page)).toHaveCount(1);

    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('.jp-RenderedMarkdown');
      if (root) {
        root.scrollTop = 0;
      }
    });
    const passage = page.locator(
      `.jp-RenderedMarkdown:visible [data-mark="${ONE}"]`
    );
    await expect(passage).not.toBeInViewport();

    await rows(page).first().locator('.jp-AdvancedMd-notesHead').click();

    await expect(passage).toBeInViewport();
  });
});

test.describe('a change waiting on disk while the reader marks', () => {
  // The fallback check is a minute away and the event socket carries nothing,
  // so the change on disk reaches the document only because the marker write
  // asks for it. This is the case ACC-NOTES-100 names: a change that arrived
  // between the reader's selection and the write.
  test.use({
    mockSettings: settings({
      pollInterval: 60,
      fadeDuration: 500,
      animation: false
    })
  });

  test('ACC-NOTES-100 applies the change, marks, and saves without a dialog', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    // The socket is answered by the route and never connected to the server,
    // so it opens and stays silent.
    await page.routeWebSocket(
      /jupyterlab-advanced-markdown-viewer-extension\/events/,
      () => undefined
    );
    // Socket routing is installed into a document as it loads.
    await page.reload();
    await page.contents.uploadContent(DOC, 'text', target);
    await openPreview(page, target, FIRST);

    await writeExternally(
      page,
      target,
      DOC.replace('cherries and figs', 'quinces and medlars')
    );
    // Nothing carries the change to the document: no event, and the fallback
    // check is a minute away.
    await page.waitForTimeout(2000);
    await expect(
      page.locator('.jp-RenderedMarkdown:visible')
    ).not.toContainText('quinces and medlars');

    await mark(page, P1);

    const text = await fileWhen(
      target,
      holds => openingIds(holds).length === 1
    );
    expect(text).toContain('quinces and medlars');
    expect(text).toContain(`${opening(openingIds(text)[0])}${P1}`);
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      'quinces and medlars'
    );
    await savedCleanly(page);
  });
});

/**
 * One identity for the lab to hand out, in the shape `/api/me` answers with.
 */
const identity = (username: string, name: string) => ({
  identity: {
    username,
    name,
    display_name: name,
    initials: name.slice(0, 1).toUpperCase(),
    color: 'var(--jp-collaborator-color1)'
  },
  permissions: {}
});

/**
 * Write a note on the first sentence of a fresh document and answer with the
 * file the save left on disk.
 */
async function noteOnFreshDocument(
  page: any,
  target: string,
  text: string
): Promise<string> {
  await page.contents.uploadContent(DOC, 'text', target);
  await openPreview(page, target, FIRST);
  await openMenu(page, await select(page, P1));
  await choose(page, 'Add note');
  await writeNote(page, text);
  return fileWhen(target, holds => holds.includes(text));
}

test.describe('a lab that names its user', () => {
  test.use({
    mockSettings: settings({ fadeDuration: 500, animation: false }),
    mockUser: identity('kj', 'Konrad Jelen')
  });

  test('ACC-NOTES-104 signs a note line with the identity username', async ({
    page,
    tmpPath
  }) => {
    const text = await noteOnFreshDocument(
      page,
      `${tmpPath}/${FILE}`,
      'The identity names me.'
    );

    expect(text).toMatch(
      /\n@kj \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z: The identity names me\.\n/
    );
    await expect(
      rows(page).first().locator('.jp-AdvancedMd-notesAuthor')
    ).toHaveText('@kj');
  });
});

test.describe('a lab that logs its user in by identifier', () => {
  test.use({
    mockSettings: settings({ fadeDuration: 500, animation: false }),
    // A hub that logs users in by identifier reports a username that names
    // the reader to the software alone, beside the name a person reads.
    mockUser: identity('4fcdf4bd-4331-4e06-bdfe-66b0eddbccac', 'Konrad Jelen')
  });

  test('ACC-NOTES-104 signs with the name when the username is a generated identifier', async ({
    page,
    tmpPath
  }) => {
    const text = await noteOnFreshDocument(
      page,
      `${tmpPath}/${FILE}`,
      'The identifier names me to the hub.'
    );

    expect(text).toMatch(
      /\n@Konrad-Jelen \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z: The identifier names me to the hub\.\n/
    );
    expect(text).not.toContain('4fcdf4bd');
    await expect(
      rows(page).first().locator('.jp-AdvancedMd-notesAuthor')
    ).toHaveText('@Konrad-Jelen');
  });
});

test.describe('a lab that hands out an anonymous identity', () => {
  test.use({
    mockSettings: settings({ fadeDuration: 500, animation: false }),
    // What jupyter_server calls a user it does not know: a name that opens
    // with Anonymous and an opaque identifier for a username.
    mockUser: identity('4fcdf4bd-4331-4e06-bdfe-66b0eddbccac', 'Anonymous Kore')
  });

  test('ACC-NOTES-106 signs with the default handle when nothing names the reader', async ({
    page,
    tmpPath
  }) => {
    const text = await noteOnFreshDocument(
      page,
      `${tmpPath}/${FILE}`,
      'Nothing names me.'
    );

    expect(text).toMatch(
      /\n@reader \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z: Nothing names me\.\n/
    );
    await expect(
      rows(page).first().locator('.jp-AdvancedMd-notesAuthor')
    ).toHaveText('@reader');
  });
});

test.describe('the author setting', () => {
  test.use({
    mockSettings: settings({
      fadeDuration: 500,
      animation: false,
      author: 'kj'
    }),
    // The identity says one thing and the setting another, so the answer says
    // which of the two wins.
    mockUser: identity('someone-else', 'Someone Else')
  });

  test('ACC-NOTES-106 signs note lines with the handle the setting names', async ({
    page,
    tmpPath
  }) => {
    const text = await noteOnFreshDocument(
      page,
      `${tmpPath}/${FILE}`,
      'The setting names me.'
    );

    expect(text).toMatch(
      /\n@kj \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z: The setting names me\.\n/
    );
    expect(text).not.toContain('@someone-else');
    await expect(
      rows(page).first().locator('.jp-AdvancedMd-notesAuthor')
    ).toHaveText('@kj');
  });
});

test.describe('notes turned off', () => {
  test.use({
    mockSettings: settings({
      fadeDuration: 500,
      animation: false,
      notes: false
    })
  });

  test('ACC-NOTES-49 renders a marked document as the plain one', async ({
    page,
    tmpPath
  }) => {
    const marked = `${tmpPath}/marked.md`;
    const plain = `${tmpPath}/plain.md`;
    await page.contents.uploadContent(MARKED, 'text', marked);
    await page.contents.uploadContent(DOC, 'text', plain);

    await openPreview(page, marked, FIRST);
    const withMarkers = await page
      .locator('.jp-RenderedMarkdown:visible')
      .innerText();
    await openPreview(page, plain, FIRST);
    const without = await page
      .locator('.jp-RenderedMarkdown:visible')
      .innerText();

    expect(withMarkers).toBe(without);
    expect(withMarkers).not.toContain('mark:');
  });

  test('ACC-NOTES-63 hides the panel, the marks and the menu entries', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(MARKED, 'text', target);
    await openPreview(page, target, FIRST);

    await expect(panel(page)).toHaveCount(0);
    await expect(painted(page)).toHaveCount(0);

    // The menu may hold nothing at all with every entry of this extension
    // gone, so the right click is made without waiting for one.
    await clearSelection(page);
    const at = await previewCentre(page);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await page.waitForTimeout(500);
    await expect(
      page.locator('.lm-Menu-item:not(.lm-mod-hidden)', {
        has: page.locator('.lm-Menu-itemLabel', {
          hasText:
            /^(Mark \w+|Add note|Show notes|Show notes minimap|Hide notes)$/
        })
      })
    ).toHaveCount(0);
    await page.keyboard.press('Escape');

    // The markers the document carries are left exactly as they were.
    expect(fileText(target)).toBe(MARKED);
  });
});

test.describe('a mark taken over an indented code block', () => {
  test.use({ mockSettings: settings({ fadeDuration: 500, animation: false }) });

  test('ACC-NOTES-101 closes the mark on a line of its own, leaving the code as it was', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(CODE_DOC, 'text', target);
    await openPreview(page, target, 'The paragraph before the code.');

    await mark(page, 'total', 'printed');

    const text = await fileWhen(
      target,
      holds => openingIds(holds).length === 1
    );
    const id = openingIds(text)[0];
    const lines = text.split('\n');
    // Both lines of the code are exactly what they were.
    expect(lines).toContain('    total = one + two');
    expect(lines).toContain('    printed');
    // Both markers are lines of their own, so neither is read as code.
    expect(lines).toContain(opening(id));
    expect(lines).toContain(closing(id));
    // The block the reader sees still holds the code and nothing else.
    const code = page.locator('.jp-RenderedMarkdown:visible pre code');
    await expect(code).toContainText('printed');
    await expect(code).not.toContainText('mark:');
  });
});

test.describe('a mark written while the editor holds unsaved edits', () => {
  test.use({ mockSettings: settings({ fadeDuration: 500, animation: false }) });

  test('DEF-APPLY-22 writes the mark into the document and puts nothing on disk', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(DOC, 'text', target);
    await openPreview(page, target, FIRST);
    // The preview and the editor share one document, so what is typed in the
    // editor is the reader's own unsaved work.
    await typeInEditor(page, target, '\n\nTyped and not saved.\n');
    await openPreview(page, target, FIRST);

    await mark(page, P1);
    await expect(rows(page)).toHaveCount(1);

    // No save was asked for, so after a wait long enough for one to land the
    // file still holds exactly what was there before.
    await page.waitForTimeout(3000);
    expect(fileText(target)).toBe(DOC);
    await expect(page.locator('.jp-Dialog')).toHaveCount(0);
    await expect(page.locator('.lm-TabBar-tab.jp-mod-dirty')).not.toHaveCount(
      0
    );

    // The mark reaches disk with the reader's own next save, together with
    // the text they typed.
    await page.evaluate(() =>
      (window as any).jupyterapp.commands.execute('docmanager:save')
    );
    const text = await fileWhen(
      target,
      holds => openingIds(holds).length === 1
    );
    expect(text).toContain('Typed and not saved.');
    expect(text).toContain(`${opening(openingIds(text)[0])}${P1}`);
    await savedCleanly(page);
  });
});

test.describe('a long document carrying many marks', () => {
  test.use({ mockSettings: settings({ fadeDuration: 500, animation: false }) });

  test('DEF-HILITE-21 paints every passage from the one scan of the source and the render', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(MANY_MARKS, 'text', target);
    await openPreview(page, target, 'Paragraph 1 of the long report');

    await expect(rows(page)).toHaveCount(MANY);
    await expect(painted(page)).toHaveCount(MANY);

    // Each mark is painted on the paragraph it encloses, in document order,
    // so the shared scan located every passage and not just the first.
    const texts = await painted(page).allInnerTexts();
    for (let i = 0; i < MANY; i++) {
      expect(texts[i]).toContain(`fruit number ${i * MANY_GAP + 1} and keeps`);
    }
    // No mark is listed as unanchored.
    await expect(
      page.locator('.jp-AdvancedMd-notes:visible .jp-AdvancedMd-notesPassage', {
        hasText: 'unanchored'
      })
    ).toHaveCount(0);
  });
});

test.describe('typing a note into a row', () => {
  test.use({ mockSettings: settings({ fadeDuration: 500, animation: false }) });

  test('ACC-NOTES-104 leaves Enter to the note box rather than selecting the row', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(MARKED, 'text', target);
    await openPreview(page, target, FIRST);

    // The toggle opens the row without selecting it, which a click on the
    // head would do and would hide what the Enter did.
    await rows(page).first().locator('.jp-AdvancedMd-notesToggle').click();
    await panelButton(page, 'Add note').click();
    const box = page.locator('.jp-AdvancedMd-notesForm textarea');
    await expect(box).toBeVisible();
    await box.click();
    await page.keyboard.type('First line of the note.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second line of the note.');

    // The Enter belongs to the box it was typed in: it made a second line,
    // and it did not select the row the box sits in.
    await expect(box).toHaveValue(
      'First line of the note.\nSecond line of the note.'
    );
    await expect(rows(page).first()).not.toHaveClass(
      /jp-AdvancedMd-notesRow-selected/
    );
  });

  test('DEF-NOTES-29 keeps the caret where it was through an external write', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(MARKED, 'text', target);
    await openPreview(page, target, FIRST);

    await rows(page).first().locator('.jp-AdvancedMd-notesToggle').click();
    await panelButton(page, 'Add note').click();
    const box = page.locator('.jp-AdvancedMd-notesForm textarea');
    await expect(box).toBeVisible();
    await box.click();
    await page.keyboard.type('hello world');
    for (let step = 0; step < 6; step++) {
      await page.keyboard.press('ArrowLeft');
    }

    // The write rebuilds the panel; the entry is a new textarea carrying the
    // draft, the focus and the caret, so the next keystroke lands where the
    // reader left off.
    await writeExternally(
      page,
      target,
      MARKED.replace('grapes and melons', 'quinces and medlars')
    );
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      'quinces and medlars'
    );
    await page.keyboard.type('X');
    await expect(box).toHaveValue('helloX world');
  });

  test('DEF-NOTES-34 leaves the caret alone while the preview holds a selection', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(MARKED, 'text', target);
    await openPreview(page, target, FIRST);

    await rows(page).first().locator('.jp-AdvancedMd-notesToggle').click();
    await panelButton(page, 'Add note').click();
    const box = page.locator('.jp-AdvancedMd-notesForm textarea');
    await expect(box).toBeVisible();
    // The reader selected a passage before turning to the note, so the
    // controller holds a selection it would put back after the write.
    await select(page, P2);
    await box.click();
    await page.keyboard.type('hello world');
    for (let step = 0; step < 6; step++) {
      await page.keyboard.press('ArrowLeft');
    }

    // Putting the selection back over the preview while the textarea holds
    // the focus would move the caret, so it is left where it is until the
    // reader leaves the entry.
    await writeExternally(
      page,
      target,
      MARKED.replace('grapes and melons', 'quinces and medlars')
    );
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      'quinces and medlars'
    );
    await page.waitForTimeout(700);
    await page.keyboard.type('X');
    await expect(box).toHaveValue('helloX world');
  });
});

test.describe('live updates turned off while a change waits on disk', () => {
  // The socket is answered and silent and the fallback check is a minute
  // away, so the refresh the marker write asks for is the only thing that
  // could read the file.
  test.use({
    mockSettings: settings({
      enabled: false,
      pollInterval: 60,
      fadeDuration: 500,
      animation: false
    })
  });

  test('DEF-CONFIG-23 reads nothing on the refresh a marker write asks for', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.routeWebSocket(
      /jupyterlab-advanced-markdown-viewer-extension\/events/,
      () => undefined
    );
    // Socket routing is installed into a document as it loads.
    await page.reload();
    await page.contents.uploadContent(DOC, 'text', target);
    await openPreview(page, target, FIRST);
    await writeExternally(
      page,
      target,
      DOC.replace('cherries and figs', 'quinces and medlars')
    );

    await mark(page, P1);
    await expect(rows(page)).toHaveCount(1);

    await page.waitForTimeout(2000);
    await expect(
      page.locator('.jp-RenderedMarkdown:visible')
    ).not.toContainText('quinces and medlars');

    // Nothing tracks the file while the switch is off, so the save the marker
    // write asks for meets JupyterLab's own conflict instead: the file is
    // newer than the revision the document loaded. The other process's work
    // stays on disk, and the mark is not written over it.
    const dialog = page.locator('.jp-Dialog');
    await expect(dialog).toContainText('File Changed');
    expect(fileText(target)).toContain('quinces and medlars');
    expect(openingIds(fileText(target))).toHaveLength(0);

    // Reverting is the reader's way out of that dialog: the document takes
    // the file, and the mark they made goes with the text it replaced.
    await dialog.locator('button', { hasText: 'Revert' }).click();
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      'quinces and medlars',
      { timeout: 10000 }
    );
    expect(openingIds(fileText(target))).toHaveLength(0);
  });
});

/**
 * Start a writer inside the page that rewrites the fourth paragraph once a
 * second, each write numbered, the way an agent streaming into the file does.
 */
async function startWriter(page: any, apiPath: string): Promise<void> {
  await page.evaluate(
    ([target, doc]: [string, string]) => {
      const contents = (window as any).jupyterapp.serviceManager.contents;
      const writer = { count: 0, timer: 0 };
      writer.timer = window.setInterval(() => {
        writer.count += 1;
        void contents.save(target, {
          type: 'file',
          format: 'text',
          content: doc.replace(
            'grapes and melons.',
            `grapes and melons ${writer.count}.`
          )
        });
      }, 1000);
      (window as any).__streamWriter = writer;
    },
    [apiPath, DOC]
  );
}

/**
 * Stop that writer and answer with the number of the last write, once the
 * preview shows it.
 */
async function stopWriter(page: any): Promise<number> {
  const count: number = await page.evaluate(() => {
    const writer = (window as any).__streamWriter;
    window.clearInterval(writer.timer);
    return writer.count;
  });
  await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
    `grapes and melons ${count}.`
  );
  return count;
}

/** The selected text of the page, as the reader sees it highlighted. */
const selectedText = (page: any): Promise<string> =>
  page.evaluate(() => window.getSelection()?.toString() ?? '');

test.describe('a stream of writes while the reader marks', () => {
  test.use({ mockSettings: settings({ fadeDuration: 500, animation: false }) });

  test.beforeEach(async ({ page, tmpPath }) => {
    await page.contents.uploadContent(DOC, 'text', `${tmpPath}/${FILE}`);
    await openPreview(page, `${tmpPath}/${FILE}`, FIRST);
  });

  test('DEF-NOTES-34 marks after a write landed between the menu and the choice', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await startWriter(page, target);
    await openMenu(page, await select(page, P1));
    // At least one write lands while the menu is open: its render replaces
    // the nodes the selection and the menu's hit test pointed at.
    await page.waitForTimeout(1200);
    const count = await stopWriter(page);
    await expect(menu(page).first()).toBeVisible();

    await choose(page, 'Mark yellow');

    const text = await fileWhen(
      target,
      holds => openingIds(holds).length === 1
    );
    expect(text).toContain(`${opening(openingIds(text)[0])}${P1}`);
    expect(text).toContain(`grapes and melons ${count}.`);
    await savedCleanly(page);
  });

  test('DEF-NOTES-34 keeps the selection through a write', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    // A click in the preview focuses the viewer node; the selection is made
    // by script, so the focus is given the same way.
    await page.locator('.jp-MarkdownViewer:visible').focus();
    await select(page, P1);
    expect(await selectedText(page)).toBe(P1);

    await writeExternally(
      page,
      target,
      DOC.replace('grapes and melons', 'quinces and medlars')
    );
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      'quinces and medlars'
    );
    await page.waitForTimeout(600);

    expect(await selectedText(page)).toBe(P1);
  });

  test('DEF-NOTES-34 keeps the selection through a write before it', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.locator('.jp-MarkdownViewer:visible').focus();
    await select(page, P3);
    expect(await selectedText(page)).toBe(P3);

    // The change lands in the first paragraph and is longer than the words
    // it replaces, so the selection's offsets into the rendered text move.
    await writeExternally(
      page,
      target,
      DOC.replace('apples and pears', 'apples, pears and a great many quinces')
    );
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      'a great many quinces'
    );
    await page.waitForTimeout(600);
    expect(await selectedText(page)).toBe(P3);

    await page.keyboard.press('Control+Shift+M');
    const text = await fileWhen(
      target,
      holds => openingIds(holds).length === 1
    );
    const id = openingIds(text)[0];
    expect(text).toContain(`${opening(id)}${P3}${closing(id)}`);
  });
});

test.describe('marking from the keyboard', () => {
  test.use({ mockSettings: settings({ fadeDuration: 500, animation: false }) });

  test.beforeEach(async ({ page, tmpPath }) => {
    await page.contents.uploadContent(DOC, 'text', `${tmpPath}/${FILE}`);
    await openPreview(page, `${tmpPath}/${FILE}`, FIRST);
  });

  test('ACC-NOTES-114 marks the selection from the keyboard', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    // A selection made with the keyboard needs caret browsing, which cannot
    // be driven here, so the selection is made by script and the keystroke is
    // real.
    await select(page, P1);
    await page.locator('.jp-MarkdownViewer:visible').focus();
    await page.keyboard.press('Control+Shift+M');

    const text = await fileWhen(
      target,
      holds => openingIds(holds).length === 1
    );
    const id = openingIds(text)[0];
    expect(id).toMatch(UUID);
    expect(text).toContain(`${opening(id)}${P1}${closing(id)}`);
    await savedCleanly(page);
  });

  test('ACC-NOTES-114 offers the command in the palette', async ({
    page,
    tmpPath
  }) => {
    await select(page, P1);
    await page.evaluate(async () => {
      await (window as any).jupyterapp.commands.execute(
        'apputils:activate-command-palette'
      );
    });

    const item = page.locator('.lm-CommandPalette-item', {
      has: page.locator('.lm-CommandPalette-itemLabel', {
        hasText: /^Mark the selected passage$/
      })
    });
    await expect(item).toHaveCount(1);
    // The palette's input took the focus, which collapses the document's
    // selection; the command still knows the passage the reader selected.
    await expect(item).not.toHaveClass(/lm-mod-disabled/);

    // The item is read again when it is chosen, after the focus moved and the
    // document's selection collapsed, and that read must still mark.
    await item.click();
    const text = await fileWhen(
      `${tmpPath}/${FILE}`,
      holds => openingIds(holds).length === 1
    );
    const id = openingIds(text)[0];
    expect(text).toContain(`${opening(id)}${P1}${closing(id)}`);
  });
});

test.describe('a note saved after the mark vanished', () => {
  test.use({ mockSettings: settings({ fadeDuration: 500, animation: false }) });

  test('DEF-NOTES-35 keeps a note whose mark vanished before Save', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(MARKED, 'text', target);
    await openPreview(page, target, FIRST);
    await rows(page).first().locator('.jp-AdvancedMd-notesToggle').click();
    await panelButton(page, 'Add note').click();
    const box = page.locator('.jp-AdvancedMd-notesForm textarea');
    await expect(box).toBeVisible();

    // The markers go from the file while the entry is open: the row stays,
    // unanchored, and so does the entry.
    await writeExternally(page, target, DOC);
    await expect(
      rows(page).first().locator('.jp-AdvancedMd-notesState')
    ).toHaveText('unanchored');
    await box.fill('Written into a mark that is gone.');
    await panelButton(page, 'Save').click();

    // Nothing to write the note into: the text stays in front of the reader
    // instead of vanishing without a word. The draft is read only after the
    // save round trip has answered, because until then it is there whatever
    // the answer will be.
    await page.waitForTimeout(1500);
    await expect(box).toHaveValue('Written into a mark that is gone.');
    await expect(
      rows(page).first().locator('.jp-AdvancedMd-notesState')
    ).toHaveText('unanchored');
    expect(fileText(target)).not.toContain('Written into a mark');
  });
});

test.describe('the list a screen reader moves through', () => {
  test.use({ mockSettings: settings({ fadeDuration: 500, animation: false }) });

  test('ACC-CUE-115 lists the marks as list items', async ({
    page,
    tmpPath
  }) => {
    await page.contents.uploadContent(DOC, 'text', `${tmpPath}/${FILE}`);
    await openPreview(page, `${tmpPath}/${FILE}`, FIRST);
    await mark(page, P1);

    await expect(
      panel(page).locator('.jp-AdvancedMd-notesList')
    ).toHaveAttribute('role', 'list');
    await expect(rows(page).first()).toHaveAttribute('role', 'listitem');
    await expect(rows(page).first()).not.toHaveAttribute('aria-current');

    await rows(page).first().locator('.jp-AdvancedMd-notesHead').click();
    await expect(rows(page).first()).toHaveAttribute('aria-current', 'true');
  });

  test('ACC-CUE-115 names the colour of each swatch', async ({
    page,
    tmpPath
  }) => {
    await page.contents.uploadContent(MARKED, 'text', `${tmpPath}/${FILE}`);
    await openPreview(page, `${tmpPath}/${FILE}`, FIRST);
    await expect(rows(page)).toHaveCount(3);

    // The swatch is the only place a row shows its colour, so a screen
    // reader is told the colour by name.
    const swatches = rows(page).locator('.jp-AdvancedMd-notesSwatch');
    for (let i = 0; i < 3; i++) {
      await expect(swatches.nth(i)).toHaveAttribute('role', 'img');
    }
    await expect(swatches.nth(0)).toHaveAttribute('aria-label', 'yellow');
    await expect(swatches.nth(1)).toHaveAttribute('aria-label', 'blue');
    await expect(swatches.nth(2)).toHaveAttribute('aria-label', 'pink');
  });

  test('ACC-CUE-115 names each worded control by the words on it', async ({
    page,
    tmpPath
  }) => {
    await page.contents.uploadContent(DOC, 'text', `${tmpPath}/${FILE}`);
    await openPreview(page, `${tmpPath}/${FILE}`, FIRST);
    await mark(page, P1);
    await openRow(page);

    // The accessible name starts with the visible label (WCAG 2.5.3), so a
    // reader who says "Add note" or "Cancel" reaches the button.
    await expect(panelButton(page, 'Add note')).toHaveAttribute(
      'title',
      'Add note to this mark'
    );
    await panelButton(page, 'Add note').click();
    await expect(panelButton(page, 'Cancel')).toHaveAttribute(
      'title',
      'Cancel this note'
    );
  });
});

test.describe('marking with live updates off', () => {
  test.use({
    mockSettings: settings({
      enabled: false,
      fadeDuration: 500,
      animation: false
    })
  });

  test('ACC-NOTES-112 saves through the Context and not through the route', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(DOC, 'text', target);
    await openPreview(page, target, FIRST);

    // Every write the page sends from here on: the route's POST, or the PUT
    // a Context save sends to the contents API.
    const writes: string[] = [];
    page.on('response', (response: any) => {
      const method = response.request().method();
      if (method === 'POST' || method === 'PUT') {
        const pathname = decodeURIComponent(new URL(response.url()).pathname);
        writes.push(`${method} ${pathname} ${response.status()}`);
      }
    });

    await mark(page, P1);
    await fileWhen(target, holds => openingIds(holds).length === 1);

    // With the switch off nothing moves the document's record of the file,
    // so the route is not taken: the mark goes the way it went before the
    // route, through one save.
    expect(writes.filter(entry => entry.includes('/write '))).toEqual([]);
    expect(writes.filter(entry => entry.startsWith('PUT '))).toHaveLength(1);
    await savedCleanly(page);
  });
});
