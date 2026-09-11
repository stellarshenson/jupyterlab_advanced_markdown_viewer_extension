import { expect, test } from '@jupyterlab/galata';

import {
  choose,
  closeMenus,
  colourLabel,
  entry,
  FILE,
  fileText,
  IPoint,
  labFixtures,
  mark,
  menu,
  onDisk,
  openMarkMenu,
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

/** A second document, so a tab can be switched away from and back. */
const OTHER = ['# Other', '', 'The first paragraph is unchanged.', ''].join(
  '\n'
);

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

/** A note line an agent wrote into a marker of the file before the reader. */
const AGENT_NOTE = '@claude 2026-09-06T16:05:12Z: The intro contradicts this.';

/**
 * DOC with its first sentence marked by hand and that note line already in
 * the marker, which is what a file an agent has answered in looks like.
 */
const AGENT_NOTED = DOC.replace(
  P1,
  `<!-- mark:${ONE} note colour=yellow\n${AGENT_NOTE}\n-->${P1}${closing(ONE)}`
);

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
/** The plus control in the panel header, the one route to a document note. */
const addControl = (page: any) =>
  panel(page).locator('.jp-AdvancedMd-notesAdd');

const panelButton = (page: any, label: string) =>
  page.locator('.jp-AdvancedMd-notes:visible button', { hasText: label });

/** The removal control of the open row, an icon button named by its title. */
const removeButton = (page: any) =>
  page.locator('.jp-AdvancedMd-notes:visible button[title="Remove this mark"]');

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

/**
 * Select a passage in the editor of the same document and delete it with the
 * key the reader presses.
 *
 * The selection is set through the editor rather than dragged, for the reason
 * a selection in the preview is built as a range: a drag over wrapped text
 * selects whatever the layout happens to put under the pointer.
 */
async function deleteInEditor(
  page: any,
  apiPath: string,
  passage: string
): Promise<void> {
  await page.evaluate(
    async ({ target, wanted }: { target: string; wanted: string }) => {
      const app = (window as any).jupyterapp;
      await app.commands.execute('docmanager:open', {
        path: target,
        factory: 'Editor'
      });
      const editor = (app.shell.currentWidget as any).content.editor;
      const at = editor.model.sharedModel.getSource().indexOf(wanted);
      editor.setSelection({
        start: editor.getPositionAt(at),
        end: editor.getPositionAt(at + wanted.length)
      });
      editor.focus();
    },
    { target: apiPath, wanted: passage }
  );
  await page.keyboard.press('Backspace');
}

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

  test('DEF-NOTES-84 marks the words before a hard line break', async ({
    page,
    tmpPath
  }) => {
    // Two spaces end the first line of the item: the renderer writes the
    // break as a br element with no newline after it.
    const path = `${tmpPath}/${FILE}`;
    await writeExternally(
      page,
      path,
      [
        '# Wezwanie',
        '',
        '3. **Ostateczny rygor:**  ',
        '   W przypadku niewydania dokumentu w terminie:',
        '   * pierwszy punkt;',
        ''
      ].join('\n')
    );
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      'Ostateczny rygor:'
    );

    await openMenu(page, await select(page, 'Ostateczny', 'rygor:'));
    await choose(page, 'Add note');
    await writeNote(page, 'Nie motywuje.');

    const text = await fileWhen(path, holds => holds.includes('Nie motywuje.'));
    expect(text).toMatch(
      /-->\n3\. \*\*Ostateczny rygor:\*\*<!-- \/mark:[0-9a-f-]{36} -->  \n   W przypadku/
    );
    await expect(rows(page)).toHaveCount(1);
    await expect(
      rows(page).first().locator('.jp-AdvancedMd-notesPassage')
    ).toHaveText('Ostateczny rygor:');
    await expect(painted(page)).toHaveCount(1);
    await expect(painted(page).first()).toHaveText('Ostateczny rygor:');
  });

  test('DEF-NOTES-86 marks the word before a br element written in the source', async ({
    page,
    tmpPath
  }) => {
    // The br is in the source itself; the render shows it as a line break,
    // so Alpha and Beta are two words there and must be two in the source.
    const path = `${tmpPath}/${FILE}`;
    await writeExternally(
      page,
      path,
      ['# Lines', '', 'One Alpha<br>Beta and more words here.', ''].join('\n')
    );
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      'Beta and more'
    );

    await openMenu(page, await select(page, 'Alpha'));
    await choose(page, 'Add note');
    await writeNote(page, 'Before the break.');

    const text = await fileWhen(path, holds =>
      holds.includes('Before the break.')
    );
    expect(text).toMatch(
      /One <!-- mark:[0-9a-f-]{36} note colour=\w+\n@[^\n]*: Before the break\.\n-->Alpha<!-- \/mark:[0-9a-f-]{36} --><br>Beta and more words here\./
    );
    await expect(rows(page)).toHaveCount(1);
    await expect(
      rows(page).first().locator('.jp-AdvancedMd-notesPassage')
    ).toHaveText('Alpha');
    await expect(painted(page)).toHaveCount(1);
    await expect(painted(page).first()).toHaveText('Alpha');
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

  test('ACC-NOTES-120 puts an icon on every entry it offers, one colour per Mark', async ({
    page
  }) => {
    await openMenu(page, await select(page, P1));
    // Every entry this extension offers: the Mark entry opening the submenu,
    // Add note, the two panel states the panel is not in, and the six
    // colours inside the submenu; the document note has no entry
    // (ACC-NOTES-139).
    await expect(
      entry(page, 'Mark').locator('.lm-Menu-itemIcon svg')
    ).toHaveCount(1);
    await openMarkMenu(page);
    const ours = page.locator(
      '.lm-Menu-item[data-command^="advanced-markdown-viewer:"]:not(.lm-mod-hidden)'
    );
    await expect(ours).toHaveCount(9);
    const count = await ours.count();
    for (let i = 0; i < count; i++) {
      await expect(ours.nth(i).locator('.lm-Menu-itemIcon svg')).toHaveCount(1);
    }
    // The six colour entries show six different colours.
    const hues = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll(
          '.lm-Menu-item[data-command="advanced-markdown-viewer:mark"] .lm-Menu-itemIcon rect'
        )
      ).map(rect => rect.getAttribute('fill'))
    );
    expect(hues).toHaveLength(6);
    expect(new Set(hues).size).toBe(6);
    await closeMenus(page);
  });

  test('ACC-NOTES-121 draws each Mark entry in the colour it paints, in both themes', async ({
    page
  }) => {
    // The hues the marks paint, as the browser reports a computed fill.
    const HUES = [
      'rgb(240, 212, 15)',
      'rgb(15, 112, 240)',
      'rgb(246, 49, 177)',
      'rgb(241, 148, 34)',
      'rgb(230, 30, 70)',
      'rgb(30, 210, 50)'
    ];
    const swatchFills = () =>
      page.evaluate(() =>
        Array.from(
          document.querySelectorAll(
            '.lm-Menu-item[data-command="advanced-markdown-viewer:mark"] .lm-Menu-itemIcon rect'
          )
        ).map(rect => getComputedStyle(rect).fill)
      );
    await openMenu(page, await select(page, P1));
    await openMarkMenu(page);
    expect(await swatchFills()).toEqual(HUES);
    await closeMenus(page);

    // The dark theme recolours JupyterLab's own icons; the swatches keep
    // the colour the mark paints.
    await page.theme.setDarkTheme();
    await openMenu(page, await select(page, P1));
    await openMarkMenu(page);
    expect(await swatchFills()).toEqual(HUES);
    await closeMenus(page);
  });

  test('ACC-NOTES-124 draws the swatches muted, at the tint the painted mark uses', async ({
    page
  }) => {
    await openMenu(page, await select(page, P1));
    await openMarkMenu(page);
    const tints = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll(
          '.lm-Menu-item[data-command="advanced-markdown-viewer:mark"] .lm-Menu-itemIcon rect'
        )
      ).map(rect => Number(getComputedStyle(rect).fillOpacity))
    );
    // The light-theme alpha of each painted mark, from style/base.css.
    expect(tints).toEqual([0.2, 0.11, 0.14, 0.17, 0.18, 0.17]);
    for (const tint of tints) {
      expect(tint).toBeLessThanOrEqual(0.5);
    }
    await closeMenus(page);
  });

  test('ACC-NOTES-134 keeps every highlight faint in both themes', async ({
    page
  }) => {
    // The alpha of each mark colour as the stylesheet paints it, read from a
    // probe span inside the rendered view so the theme rules apply.
    const alphas = () =>
      page.evaluate(() => {
        const root = document.querySelector('.jp-RenderedMarkdown')!;
        return ['yellow', 'blue', 'pink', 'orange', 'red', 'green'].map(
          colour => {
            const probe = document.createElement('span');
            probe.className = `jp-AdvancedMd-mark jp-AdvancedMd-mark-${colour}`;
            root.appendChild(probe);
            const found = /rgba\(\d+, \d+, \d+, ([\d.]+)\)/.exec(
              getComputedStyle(probe).backgroundColor
            );
            probe.remove();
            return found ? Number(found[1]) : 1;
          }
        );
      });
    for (const alpha of await alphas()) {
      expect(alpha).toBeLessThanOrEqual(0.2);
    }
    await page.theme.setDarkTheme();
    for (const alpha of await alphas()) {
      expect(alpha).toBeLessThanOrEqual(0.18);
    }
  });

  test('ACC-NOTES-136 writes a note on the document as a whole from the panel', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    const documentMarker = /^<!-- mark:[0-9a-f-]{36} document\n/;
    // No marks: the panel is hidden and the badge is the way to it.
    await page.locator('.jp-AdvancedMd-notesBadge:visible').click();
    await addControl(page).click();
    await writeNote(page, 'On the whole document');
    const text = await fileWhen(path, holds =>
      holds.includes('On the whole document')
    );
    expect(text).toMatch(documentMarker);
    expect(text).toMatch(/: On the whole document\n-->\n/);
    await expect(
      rows(page).first().locator('.jp-AdvancedMd-notesPassage')
    ).toHaveText('Document');

    await panelButton(page, 'Add note').click();
    await writeNote(page, 'A second thought');
    const twice = await fileWhen(path, holds =>
      holds.includes('A second thought')
    );
    expect(
      twice.match(/^<!-- mark:[0-9a-f-]{36} document\n(?:@[^\n]*\n)+-->\n/)
    ).not.toBeNull();

    // The control pressed again opens the same thread: no second marker.
    await addControl(page).click();
    await expect(
      page.locator('.jp-AdvancedMd-notesForm textarea')
    ).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
    expect(openingIds(fileText(path))).toHaveLength(1);
    await panelButton(page, 'Cancel').click();

    await removeButton(page).click();
    const after = await fileWhen(path, holds => !documentMarker.test(holds));
    expect(openingIds(after)).toHaveLength(0);
  });

  test('ACC-NOTES-137 lists the document note first, with no swatch, no tick and no highlight', async ({
    page
  }) => {
    await mark(page, P1);
    await expect(painted(page)).toHaveCount(1);
    await addControl(page).click();
    await writeNote(page, 'On the whole');

    await expect(rows(page)).toHaveCount(2);
    const first = rows(page).first();
    await expect(first.locator('.jp-AdvancedMd-notesPassage')).toHaveText(
      'Document'
    );
    await expect(first.locator('.jp-AdvancedMd-notesSwatch')).toHaveCount(0);
    await expect(
      rows(page).nth(1).locator('.jp-AdvancedMd-notesSwatch')
    ).toHaveCount(1);
    await expect(panel(page).locator('.jp-AdvancedMd-notesCount')).toHaveText(
      '2 marks'
    );
    // The entry left the row open: a note and a removal, no colour dots.
    await expect(first.locator('.jp-AdvancedMd-notesDot')).toHaveCount(0);
    await expect(first.locator('button', { hasText: 'Add note' })).toHaveCount(
      1
    );

    await openMenuOnPreview(page);
    await choose(page, 'Show notes minimap');
    await expect(ticks(page)).toHaveCount(1);
    await expect(painted(page)).toHaveCount(1);
  });

  test('DEF-NOTES-66 puts the one tick of the minimap on the passage mark, not on the document note', async ({
    page
  }) => {
    // The reporter's own sequence, and the count alone cannot settle it: the
    // document marker sits at the top of the file, where a passage mark of
    // the first paragraph draws its tick as well. So the tick is asked whose
    // it is - a tick carries the identifier of the mark it stands for.
    await mark(page, P1);
    await addControl(page).click();
    await writeNote(page, 'On the whole');
    // The document note leads the list, so the first row's identifier is its
    // own.
    const documentId = await rows(page).first().getAttribute('data-mark');
    const passageId = await rows(page).nth(1).getAttribute('data-mark');

    await openMenuOnPreview(page);
    await choose(page, 'Show notes minimap');

    await expect(ticks(page)).toHaveCount(1);
    await expect(
      panel(page).locator(`.jp-AdvancedMd-notesTick[data-mark="${passageId}"]`)
    ).toHaveCount(1);
    await expect(
      panel(page).locator(`.jp-AdvancedMd-notesTick[data-mark="${documentId}"]`)
    ).toHaveCount(0);
  });

  test('ACC-NOTES-139 adds the document note from the plus control alone, shown in the expanded panel and not on the strip', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await mark(page, P1);
    await expect(panel(page)).toHaveClass(/jp-AdvancedMd-notes-expanded/);
    // After the count, before the expand and hide controls, 24 px.
    const order = await panel(page)
      .locator('.jp-AdvancedMd-notesHeader > *')
      .evaluateAll((nodes: Element[]) =>
        nodes.map(node => node.className.replace('jp-AdvancedMd-notes', ''))
      );
    expect(order).toEqual(['Collapse', 'Count', 'Add', 'Expand', 'Close']);
    const box = (await addControl(page).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);

    // The marker is written and the list opens its row, the field focused.
    await addControl(page).click();
    const field = page.locator('.jp-AdvancedMd-notesForm textarea');
    await expect(field).toBeFocused();
    await expect(
      rows(page).first().locator('.jp-AdvancedMd-notesPassage')
    ).toHaveText('Document');
    expect(openingIds(fileText(path))).toHaveLength(2);

    // Cancelled before a note was written: the marker leaves the file and the
    // Document row leaves the panel (DEF-NOTES-72).
    await panelButton(page, 'Cancel').click();
    await fileWhen(path, holds => openingIds(holds).length === 1);
    await expect(rows(page)).toHaveCount(1);

    // Pressed again, and the note written.
    await addControl(page).click();
    await expect(field).toBeFocused();
    await writeNote(page, 'Whole');
    await fileWhen(path, holds => holds.includes(': Whole'));

    // Pressed again: the same thread, no second marker.
    await addControl(page).click();
    await expect(field).toBeFocused();
    await expect(rows(page)).toHaveCount(2);
    expect(openingIds(fileText(path))).toHaveLength(2);
    await panelButton(page, 'Cancel').click();

    // The strip shows the hide control above the expand caret, and no plus.
    await openMenuOnPreview(page);
    await choose(page, 'Show notes minimap');
    await expect(panel(page)).toHaveClass(/jp-AdvancedMd-notes-minimap/);
    await expect(addControl(page)).toBeHidden();
    const hideBox = (await panel(page)
      .locator('.jp-AdvancedMd-notesClose')
      .boundingBox())!;
    const expandBox = (await panel(page)
      .locator('.jp-AdvancedMd-notesExpand')
      .boundingBox())!;
    expect(hideBox.y + hideBox.height).toBeLessThanOrEqual(expandBox.y + 1);

    // No other surface offers it.
    await openMenuOnPreview(page);
    await expect(entry(page, 'Add document note')).toHaveCount(0);
    await closeMenus(page);
    await openMenu(page, await select(page, P2));
    await expect(entry(page, 'Add document note')).toHaveCount(0);
    await closeMenus(page);
  });

  test('ACC-NOTES-138 shows the notes badge over the preview while the panel is hidden', async ({
    page
  }) => {
    const badge = page.locator('.jp-AdvancedMd-notesBadge:visible');
    // No marks: the panel is hidden and the badge is muted.
    await expect(panel(page)).toHaveCount(0);
    await expect(badge).toHaveCount(1);
    await expect(badge).toHaveClass(/jp-AdvancedMd-notesBadge-empty/);
    await expect(badge).toHaveAttribute('title', 'No marks: Show notes');
    await expect(
      page.locator('.jp-RenderedMarkdown .jp-AdvancedMd-notesBadge')
    ).toHaveCount(0);
    // Over the top right corner of the preview.
    const box = (await badge.boundingBox())!;
    const view = (await page
      .locator('.jp-RenderedMarkdown:visible')
      .boundingBox())!;
    expect(box.x).toBeGreaterThan(view.x + view.width / 2);
    expect(box.x + box.width).toBeLessThanOrEqual(view.x + view.width + 1);
    expect(box.y).toBeLessThan(view.y + 40);

    // The first mark opens the panel, which takes the badge with it.
    await mark(page, P1);
    await expect(panel(page)).toBeVisible();
    await expect(badge).toHaveCount(0);

    await panel(page).locator('.jp-AdvancedMd-notesClose').click();
    await expect(badge).toHaveCount(1);
    await expect(badge).not.toHaveClass(/jp-AdvancedMd-notesBadge-empty/);
    await expect(badge).toHaveAttribute('title', '1 mark: Show notes');

    // Opened from the keyboard: the focus goes to the Hide control, not to
    // the page body (DEF-NOTES-64).
    await badge.focus();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveClass(/jp-AdvancedMd-notes-expanded/);
    await expect(badge).toHaveCount(0);
    await expect(
      panel(page).locator('.jp-AdvancedMd-notesClose')
    ).toBeFocused();
  });

  test('DEF-NOTES-82 presses no header control with the second click of a double click on the notes badge', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    const badge = page.locator('.jp-AdvancedMd-notesBadge:visible');
    await expect(badge).toHaveCount(1);
    const box = (await badge.boundingBox())!;

    // The badge centre lies over the plus of the header the first click
    // opens; the second click of the double click lands there.
    await badge.dblclick();
    await expect(panel(page)).toHaveClass(/jp-AdvancedMd-notes-expanded/);
    await fileWhen(path, holds => holds.includes('panel=expanded'));
    // A marker the second click wrote lands with the state or just after it.
    await page.waitForTimeout(1500);
    expect(openingIds(fileText(path))).toHaveLength(0);
    await expect(rows(page)).toHaveCount(0);

    // The right edge of the badge lies over the Hide control: the panel stays.
    await panel(page).locator('.jp-AdvancedMd-notesClose').click();
    await expect(badge).toHaveCount(1);
    await fileWhen(path, holds => holds.includes('panel=hidden'));
    await page.mouse.dblclick(box.x + box.width - 3, box.y + box.height / 2);
    await expect(panel(page)).toHaveClass(/jp-AdvancedMd-notes-expanded/);
    await expect(badge).toHaveCount(0);

    // A key press on the plus reports no click count and still acts.
    await panel(page).locator('.jp-AdvancedMd-notesAdd').focus();
    await page.keyboard.press('Enter');
    await expect(
      page.locator('.jp-AdvancedMd-notesForm textarea')
    ).toBeFocused();
    await fileWhen(path, holds => openingIds(holds).length === 1);
  });

  test('DEF-NOTES-83 writes a note once when Save is double-clicked', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await page.locator('.jp-AdvancedMd-notesBadge:visible').click();
    await expect(panel(page)).toHaveClass(/jp-AdvancedMd-notes-expanded/);
    await panel(page).locator('.jp-AdvancedMd-notesAdd').click();
    const field = page.locator('.jp-AdvancedMd-notesForm textarea');
    await expect(field).toBeFocused();
    await fileWhen(path, holds => openingIds(holds).length === 1);
    await field.fill('Once.');

    // The field is rebuilt only after the write returns, so the second click
    // of the double click lands on the same Save.
    await page
      .locator('.jp-AdvancedMd-notesForm button', { hasText: 'Save' })
      .dblclick();
    await fileWhen(path, holds => holds.includes('Once.'));
    // A second note the second click wrote lands just after the first.
    await page.waitForTimeout(1500);
    expect(fileText(path).match(/Once\./g)).toHaveLength(1);
    await expect(
      rows(page).first().locator('.jp-AdvancedMd-notesText', {
        hasText: 'Once.'
      })
    ).toHaveCount(1);
  });

  test('DEF-NOTES-50 draws no focus ring around the preview when its tab comes back to the front', async ({
    page,
    tmpPath
  }) => {
    // JupyterLab focuses the viewer node on every tab activation, and the
    // browser takes that for keyboard focus after a switch, so without the
    // rule its own ring frames the rendered Markdown in the theme's foreground.
    await page.theme.setDarkTheme();
    await page.contents.uploadContent(OTHER, 'text', `${tmpPath}/other.md`);
    await openPreview(page, `${tmpPath}/other.md`);
    await page
      .locator('.lm-DockPanel-tabBar .lm-TabBar-tab', { hasText: FILE })
      .click();
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      FIRST
    );

    const focus = await page.evaluate(() => {
      const viewer = document.querySelector<HTMLElement>('.jp-MarkdownViewer')!;
      return {
        focused: document.activeElement === viewer,
        outline: getComputedStyle(viewer).outlineStyle
      };
    });
    expect(focus.focused).toBe(true);
    expect(focus.outline).toBe('none');
  });

  test('ACC-NOTES-127 writes red and green into the marker and paints them in colours of their own', async ({
    page,
    tmpPath
  }) => {
    await mark(page, P1, undefined, 'red');
    await expect(painted(page)).toHaveCount(1);
    await mark(page, P2, undefined, 'green');
    await expect(painted(page)).toHaveCount(2);

    const text = await fileWhen(
      `${tmpPath}/${FILE}`,
      holds => openingIds(holds).length === 2
    );
    expect(text).toContain('note colour=red -->');
    expect(text).toContain('note colour=green -->');
    const backgrounds = await page.evaluate(() =>
      ['red', 'green'].map(colour => {
        const node = document.querySelector(
          `.jp-RenderedMarkdown .jp-AdvancedMd-mark-${colour}`
        );
        return node ? getComputedStyle(node).backgroundColor : '';
      })
    );
    // Two painted passages in two backgrounds, neither the transparent one an
    // unstyled span reports and neither the colour a change is painted in.
    expect(new Set(backgrounds).size).toBe(2);
    // The change colours as the browser computes them, through probe spans
    // painted from the same custom properties, so the two are compared in one
    // syntax.
    const changes = await page.evaluate(() =>
      ['removed', 'added'].map(kind => {
        const probe = document.createElement('span');
        probe.style.backgroundColor = `var(--jp-AdvancedMd-${kind}-bg)`;
        document.body.appendChild(probe);
        const colour = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return colour;
      })
    );
    expect(changes).not.toContain('rgba(0, 0, 0, 0)');
    for (const background of backgrounds) {
      expect(background).not.toBe('rgba(0, 0, 0, 0)');
      expect(changes).not.toContain(background);
    }
  });

  test('ACC-NOTES-129 clears the selection once the passage is marked', async ({
    page,
    tmpPath
  }) => {
    await mark(page, P1);
    await expect(painted(page)).toHaveCount(1);
    // Painting the passage in place collapses the live selection by itself;
    // what kept the selection was the controller's record of it, which the
    // next render put back over the marked words (logs/probe-selection-0651).
    expect(await selectedText(page)).toBe('');

    await writeExternally(
      page,
      `${tmpPath}/${FILE}`,
      DOC.replace('grapes and melons', 'quinces and medlars')
    );
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      'quinces and medlars'
    );
    await page.waitForTimeout(600);
    expect(await selectedText(page)).toBe('');
    expect(
      await page.evaluate(() => window.getSelection()?.isCollapsed ?? true)
    ).toBe(true);
  });

  test('ACC-NOTES-45 offers the marking entries only with a selection', async ({
    page
  }) => {
    await openMenuOnPreview(page);
    // The Mark entry is offered through a selector that needs a selection, so
    // without one it is not in the menu at all. A Lumino command item that is
    // not visible stays in the DOM, so what says Add note is not offered is
    // the class on it.
    await expect(entry(page, 'Mark')).toHaveCount(0);
    await expect(entry(page, 'Add note')).toHaveClass(/lm-mod-hidden/);
    // The panel entries are offered without a selection, which is the control
    // saying the menu itself was built.
    await expect(entry(page, 'Show notes')).not.toHaveClass(/lm-mod-hidden/);
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);

    await openMenu(page, await select(page, P1));
    await expect(entry(page, 'Mark')).toHaveCount(1);
    await expect(entry(page, 'Mark')).not.toHaveClass(/lm-mod-hidden/);
    await expect(entry(page, 'Add note')).not.toHaveClass(/lm-mod-hidden/);
  });

  test('ACC-NOTES-123 keeps the colours in a Mark submenu', async ({
    page,
    tmpPath
  }) => {
    await openMenu(page, await select(page, P1));
    // One Mark entry in the menu itself, and no colour beside it.
    await expect(entry(page, 'Mark')).toHaveCount(1);
    for (const colour of ['Yellow', 'Blue', 'Pink', 'Orange', 'Red', 'Green']) {
      await expect(entry(page, colour)).toHaveCount(0);
    }
    await openMarkMenu(page);
    const colours = menu(page)
      .nth(1)
      .locator('.lm-Menu-item:not(.lm-mod-hidden)');
    await expect(colours.locator('.lm-Menu-itemLabel')).toHaveText([
      'Yellow',
      'Blue',
      'Pink',
      'Orange',
      'Red',
      'Green'
    ]);
    await expect(colours.locator('.lm-Menu-itemIcon svg rect')).toHaveCount(6);

    await choose(page, 'Pink');
    await expect(painted(page)).toHaveCount(1);
    await expect(painted(page)).toHaveClass(/jp-AdvancedMd-mark-pink/);
    const text = await fileWhen(
      `${tmpPath}/${FILE}`,
      holds => openingIds(holds).length === 1
    );
    expect(text).toContain('colour=pink');
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

  test('ACC-NOTES-117 paints a mark in place and drops the render it would have caused', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    // Hold the first paragraph's node: a render rebuilds every node of the
    // preview, so the held one stays connected only while no render ran.
    await page.evaluate(() => {
      const roots = Array.from(
        document.querySelectorAll<HTMLElement>('.jp-RenderedMarkdown')
      );
      const root = roots.find(node => node.offsetParent !== null);
      (window as any).__held = root?.querySelector('p') ?? null;
    });
    const held = (): Promise<boolean> =>
      page.evaluate(() => (window as any).__held?.isConnected === true);
    expect(await held()).toBe(true);

    await mark(page, P1);
    await expect(painted(page)).toHaveCount(1);
    expect(await held()).toBe(true);
    // The viewer renders a change once its render timeout, a second, has
    // run; that render is given its time, and it must not come.
    await page.waitForTimeout(2500);
    expect(await held()).toBe(true);
    await expect(painted(page)).toHaveCount(1);

    // A change to the text itself still renders as ever.
    const marked = await fileWhen(
      target,
      holds => openingIds(holds).length === 1
    );
    await writeExternally(
      page,
      target,
      marked.replace('grapes and melons', 'grapes and lemons')
    );
    await expect.poll(held, { timeout: 10000 }).toBe(false);
  });

  test('ACC-NOTES-118 gives the note entry a wide box with its buttons below', async ({
    page
  }) => {
    await mark(page, P1);
    await openRow(page);
    await panelButton(page, 'Add note').click();
    const form = page.locator('.jp-AdvancedMd-notesForm');
    const box = form.locator('textarea');
    await expect(box).toBeVisible();

    const formAt = await form.boundingBox();
    const boxAt = await box.boundingBox();
    const saveAt = await panelButton(page, 'Save').boundingBox();
    const cancelAt = await panelButton(page, 'Cancel').boundingBox();
    // The box spans the form and shows four lines of its own font without
    // scrolling; both buttons start below its bottom edge, so neither narrows
    // it.
    expect(boxAt.width).toBeGreaterThanOrEqual(formAt.width - 2);
    await box.fill('one\ntwo\nthree\nfour');
    const overflow = await box.evaluate(
      (node: HTMLTextAreaElement) => node.scrollHeight - node.clientHeight
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect(saveAt.y).toBeGreaterThanOrEqual(boxAt.y + boxAt.height);
    expect(cancelAt.y).toBeGreaterThanOrEqual(boxAt.y + boxAt.height);
  });

  test('ACC-NOTES-146 writes the note field in the font and at the size of the notes in the rows', async ({
    page
  }) => {
    await mark(page, P1);
    await openRow(page);
    await panelButton(page, 'Add note').click();
    await writeNote(page, 'The note the field is measured against.');
    const shown = rows(page).first().locator('.jp-AdvancedMd-notesText');
    await expect(shown).toHaveText('The note the field is measured against.');
    await panelButton(page, 'Add note').click();
    const field = page.locator('.jp-AdvancedMd-notesForm textarea');
    await expect(field).toBeVisible();
    const fonts = await field.evaluate((node: Element) => {
      const own = getComputedStyle(node);
      const note = getComputedStyle(
        node
          .closest('.jp-AdvancedMd-notesRow')!
          .querySelector('.jp-AdvancedMd-notesText')!
      );
      return {
        family: own.fontFamily,
        noteFamily: note.fontFamily,
        size: parseFloat(own.fontSize),
        noteSize: parseFloat(note.fontSize)
      };
    });
    expect(fonts.family).toBe(fonts.noteFamily);
    expect(fonts.family).not.toMatch(/monospace/);
    expect(fonts.size).toBeCloseTo(fonts.noteSize, 2);
  });

  test('ACC-NOTES-151 draws the note field as a rounded box with a brand-coloured border while focused, no ring, and Cancel then Save at the right edge in the look of Add note', async ({
    page
  }) => {
    await mark(page, P1);
    await openRow(page);
    await panelButton(page, 'Add note').click();
    const field = page.locator('.jp-AdvancedMd-notesForm textarea');
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute('placeholder', 'Write a note');

    // A theme colour as the browser resolves it, read from a probe element
    // so the case holds in any theme.
    const resolve = (variable: string) =>
      page.evaluate((name: string) => {
        const probe = document.createElement('div');
        probe.style.color = `var(${name})`;
        document.body.appendChild(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      }, variable);
    const brand = await resolve('--jp-brand-color1');
    // The placeholder is in the colour JupyterLab's own inputs give theirs.
    expect(
      await field.evaluate(
        (node: Element) => getComputedStyle(node, '::placeholder').color
      )
    ).toBe(await resolve('--jp-ui-font-color2'));
    const border = () =>
      field.evaluate((node: Element) => getComputedStyle(node).borderTopColor);
    // The border colour is in transition for 120 ms after the focus arrives.
    await expect.poll(border).toBe(brand);
    const focused = await field.evaluate((node: Element) => {
      const style = getComputedStyle(node);
      return {
        radius: style.borderTopLeftRadius,
        resize: style.resize,
        ring: style.boxShadow,
        outline: style.outlineStyle
      };
    });
    expect(focused.radius).toBe('8px');
    expect(focused.resize).toBe('none');
    // The focus shows in the border alone: no ring, no browser outline.
    expect(focused.ring).toBe('none');
    expect(focused.outline).toBe('none');

    // The two buttons are drawn as Add note is: the same class and nothing
    // more, so the same computed background, colour, border and radius.
    const buttons = page.locator('.jp-AdvancedMd-notesFormButtons button');
    await expect(buttons).toHaveText(['Cancel', 'Save']);
    const look = (node: Element) => {
      const style = getComputedStyle(node);
      return [
        style.backgroundColor,
        style.color,
        style.borderTopColor,
        style.borderTopLeftRadius,
        style.paddingLeft,
        node.className
      ].join(' ');
    };
    // Add note is offered only while no field is open (ACC-NOTES-147), so
    // its look is read between a Cancel and a second Add note.
    await panelButton(page, 'Cancel').click();
    const addNote = await panelButton(page, 'Add note').evaluate(look);
    await panelButton(page, 'Add note').click();
    await expect(field).toBeFocused();
    const save = buttons.last();
    expect(await save.evaluate(look)).toBe(addNote);
    expect(await buttons.first().evaluate(look)).toBe(addNote);

    // Save sits at the right edge of the row, Cancel to its left.
    const row = (await page
      .locator('.jp-AdvancedMd-notesFormButtons')
      .boundingBox())!;
    const saveBox = (await save.boundingBox())!;
    const cancelBox = (await buttons.first().boundingBox())!;
    expect(saveBox.x + saveBox.width).toBeCloseTo(row.x + row.width, 0);
    expect(cancelBox.x + cancelBox.width).toBeLessThanOrEqual(saveBox.x);

    // A blurred field keeps the rounded box and gives up the brand border.
    await panelButton(page, 'Cancel').focus();
    await expect.poll(border).not.toBe(brand);
  });

  test('ACC-NOTES-152 grows the note field with its content as a note is typed, and shrinks it back', async ({
    page
  }) => {
    await mark(page, P1);
    await openRow(page);
    await panelButton(page, 'Add note').click();
    const field = page.locator('.jp-AdvancedMd-notesForm textarea');
    await expect(field).toBeFocused();
    const size = () =>
      field.evaluate((node: Element) => {
        const box = node as HTMLTextAreaElement;
        return {
          height: box.getBoundingClientRect().height,
          client: box.clientHeight,
          scroll: box.scrollHeight
        };
      });
    const opened = await size();

    // Seven short lines need more than the four rows the box opens with:
    // the box is taller and holds every line without a scrollbar of its own.
    await field.pressSequentially('one\ntwo\nthree\nfour\nfive\nsix\nseven');
    await expect
      .poll(async () => (await size()).height)
      .toBeGreaterThan(opened.height);
    const grown = await size();
    expect(grown.client).toBeGreaterThanOrEqual(grown.scroll);

    // The lines deleted, the box is back at the height it opened with.
    await field.press('ControlOrMeta+a');
    await field.press('Backspace');
    await expect.poll(async () => (await size()).height).toBe(opened.height);

    // A draft restored after a rebuild opens at the height its lines need.
    await field.pressSequentially('one\ntwo\nthree\nfour\nfive\nsix\nseven');
    await expect.poll(async () => (await size()).height).toBe(grown.height);
    await panel(page).locator('.jp-AdvancedMd-notesCollapse').click();
    await expect(page.locator('.jp-AdvancedMd-notesForm textarea')).toHaveCount(
      0
    );
    await panel(page).locator('.jp-AdvancedMd-notesExpand').click();
    await expect(field).toHaveValue('one\ntwo\nthree\nfour\nfive\nsix\nseven');
    await expect.poll(async () => (await size()).height).toBe(grown.height);
  });

  test('ACC-NOTES-153 opens the row and no note entry from a click on a passage whose mark holds a note, and still marks inside it', async ({
    page,
    tmpPath
  }) => {
    await mark(page, P1);
    await openRow(page);
    await panelButton(page, 'Add note').click();
    await writeNote(page, 'Say which orchard.');
    await fileWhen(`${tmpPath}/${FILE}`, holds =>
      holds.includes('Say which orchard.')
    );
    await expect(page.locator('.jp-AdvancedMd-notesForm textarea')).toHaveCount(
      0
    );

    // The mark holds a note: the click opens the row, shows the note and
    // starts no entry; Add note stays on offer.
    await painted(page).first().click();
    await expect(
      rows(page).first().locator('.jp-AdvancedMd-notesControls')
    ).toBeVisible();
    await expect(rows(page).first()).toContainText('Say which orchard.');
    await page.waitForTimeout(500);
    await expect(page.locator('.jp-AdvancedMd-notesForm textarea')).toHaveCount(
      0
    );
    await expect(panelButton(page, 'Add note')).toBeVisible();

    // A second mark inside the first is still written.
    await mark(page, 'and pears', undefined, 'blue');
    const text = await fileWhen(
      `${tmpPath}/${FILE}`,
      holds => openingIds(holds).length === 2
    );
    expect(new Set(closingIds(text))).toEqual(new Set(openingIds(text)));
    await expect(rows(page)).toHaveCount(2);
  });

  test('DEF-NOTES-91 lets the mouse select text inside a marked passage', async ({
    page
  }) => {
    await mark(page, P1);
    await expect(painted(page).first()).toBeVisible();
    await expect(page.locator('.jp-AdvancedMd-selecting')).toHaveCount(0);
    await expect(page.locator('.jp-AdvancedMd-notesForm textarea')).toHaveCount(
      0
    );

    // The two ends of "and pears" inside the painted passage, on screen.
    const ends = await page.evaluate(() => {
      const span = document.querySelector<HTMLElement>(
        '.jp-RenderedMarkdown [data-mark]'
      );
      if (!span) {
        throw new Error('no painted passage');
      }
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !(node.textContent ?? '').includes('and pears')) {
        node = walker.nextNode();
      }
      if (!node) {
        throw new Error('the painted passage does not read "and pears"');
      }
      const at = (node.textContent ?? '').indexOf('and pears');
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 'and pears'.length);
      const box = range.getBoundingClientRect();
      return {
        x1: box.left + 1,
        x2: box.right - 1,
        y: box.top + box.height / 2
      };
    });

    // A drag with the mouse, as the reader selects: the mouse comes up on the
    // mark, which is also a click on it.
    await page.mouse.move(ends.x1, ends.y);
    await page.mouse.down();
    await page.mouse.move(ends.x2, ends.y, { steps: 8 });
    await page.mouse.up();

    // The selection stands, and no note field was opened over it.
    await page.waitForTimeout(500);
    expect(await selectedText(page)).toContain('and pears');
    await expect(page.locator('.jp-AdvancedMd-notesForm textarea')).toHaveCount(
      0
    );
  });

  test('ACC-NOTES-154 keeps a table whole when a cell is marked and a two-line note with a pipe is written on it', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/table.md`;
    const table = [
      '# Fruit',
      '',
      'A table follows.',
      '',
      '| Fruit | Count |',
      '| --- | --- |',
      '| apples and pears | 3 |',
      '| plums and figs | 4 |',
      ''
    ].join('\n');
    await page.contents.uploadContent(table, 'text', path);
    await openPreview(page, path, 'A table follows.');
    const cells = page.locator('.jp-RenderedMarkdown:visible table td');
    await expect(cells).toHaveCount(4);

    // A mark on words of a cell, and a note of two lines with a pipe in it.
    await mark(page, 'and pears');
    await openRow(page);
    await panelButton(page, 'Add note').click();
    await writeNote(page, 'first line\nwith a | pipe');
    const text = await fileWhen(path, holds => holds.includes('first line'));

    // The marker stays on the row, one line, the note escaped inside it, so
    // the table keeps its four lines and its cells.
    const lines = text.split('\n').filter(line => line.startsWith('|'));
    expect(lines).toHaveLength(4);
    expect(lines[2]).toContain('first line\\nwith a \\| pipe');
    expect(lines[2]).toContain('<!-- /mark:');
    expect(lines[2].endsWith('| 3 |')).toBe(true);
    expect(text).not.toContain('\n-->');

    // The preview still renders a table of four cells, and the panel lists
    // the note with its two lines and its pipe.
    await expect(cells).toHaveCount(4);
    await expect(cells.nth(0)).toContainText('apples and pears');
    await expect(painted(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('first line');
    await expect(rows(page).first()).toContainText('with a | pipe');
  });

  test('ACC-NOTES-147 leaves Add note out of the row whose note is being written, and keeps its colours', async ({
    page
  }) => {
    await mark(page, P1);
    await expect(painted(page)).toHaveCount(1);
    await mark(page, P2);
    await expect(painted(page)).toHaveCount(2);
    await openRow(page, 0);
    await openRow(page, 1);
    const first = rows(page).nth(0);
    const addNote = (row: any) =>
      row.locator('button', { hasText: 'Add note' });

    await addNote(first).click();
    await expect(first.locator('textarea')).toBeVisible();
    await expect(addNote(first)).toHaveCount(0);
    // The colours and the removal stay, and the other row keeps its Add note.
    await expect(first.locator('.jp-AdvancedMd-notesDot')).toHaveCount(6);
    await expect(first.locator('button[title="Remove this mark"]')).toHaveCount(
      1
    );
    await expect(addNote(rows(page).nth(1))).toHaveCount(1);

    await panelButton(page, 'Cancel').click();
    await expect(first.locator('textarea')).toHaveCount(0);
    await expect(addNote(first)).toHaveCount(1);

    await addNote(first).click();
    await writeNote(page, 'Written in full.');
    await expect(first).toContainText('Written in full.');
    await expect(addNote(first)).toHaveCount(1);
  });

  test('ACC-NOTES-148 opens a row from a click on it and closes it from its triangle', async ({
    page
  }) => {
    await mark(page, P1);
    await expect(rows(page)).toHaveCount(1);
    const row = rows(page).first();
    const triangle = row.locator('.jp-AdvancedMd-notesToggle');
    const controls = row.locator('.jp-AdvancedMd-notesControls');
    // A closed row opens from a click on it, so it carries no triangle.
    await expect(controls).toHaveCount(0);
    await expect(triangle).toHaveCount(0);

    await row.locator('.jp-AdvancedMd-notesHead').click();
    await expect(controls).toBeVisible();
    await expect(triangle).toHaveAttribute('title', 'Collapse');

    await triangle.click();
    await expect(controls).toHaveCount(0);
    await expect(triangle).toHaveCount(0);

    // Enter on the focused row opens it as the click does.
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(controls).toBeVisible();
  });

  test('DEF-NOTES-76 selects a row from a click on its note', async ({
    page
  }) => {
    await mark(page, P1);
    await openRow(page, 0);
    await panelButton(page, 'Add note').click();
    await writeNote(page, 'Selects the row from here.');
    await expect(rows(page).first()).toContainText(
      'Selects the row from here.'
    );
    await mark(page, P2);
    await expect(rows(page)).toHaveCount(2);
    // Only an open row shows its notes (ACC-NOTES-150), so the first row
    // stays open while the second is selected; the click on the first row's
    // note is what moves the selection back.
    await openRow(page, 1);
    const first = rows(page).first();
    await expect(first.locator('.jp-AdvancedMd-notesControls')).toBeVisible();
    await expect(first).not.toHaveClass(/jp-AdvancedMd-notesRow-selected/);

    await first.locator('.jp-AdvancedMd-notesText').click();
    await expect(first).toHaveClass(/jp-AdvancedMd-notesRow-selected/);
    await expect(rows(page).nth(1)).not.toHaveClass(
      /jp-AdvancedMd-notesRow-selected/
    );
  });

  test('DEF-NOTES-77 keeps the colour of a mark when Add note is double-clicked', async ({
    page,
    tmpPath
  }) => {
    await mark(page, P1);
    await openRow(page);
    // The second click lands where Add note was; a colour dot there would
    // take it and write a new colour.
    await rows(page)
      .first()
      .locator('button', { hasText: 'Add note' })
      .dblclick();
    await expect(
      page.locator('.jp-AdvancedMd-notesForm textarea')
    ).toBeVisible();
    await writeNote(page, 'Still yellow.');
    const row = rows(page).first();
    await expect(row).toContainText('Still yellow.');
    await expect(row.locator('.jp-AdvancedMd-notesSwatch')).toHaveAttribute(
      'aria-label',
      'yellow'
    );
    const text = await fileWhen(`${tmpPath}/${FILE}`, holds =>
      holds.includes('Still yellow.')
    );
    expect(text).toContain('colour=yellow');
  });

  test('ACC-NOTES-119 shows the notes of a mark as its tooltip', async ({
    page,
    tmpPath
  }) => {
    await mark(page, P1);
    await expect(painted(page)).toHaveCount(1);
    // A bare mark says nothing on hover.
    expect(await painted(page).first().getAttribute('title')).toBeNull();

    await painted(page).first().click();
    await writeNote(page, 'Say which orchard.');
    await fileWhen(`${tmpPath}/${FILE}`, holds =>
      holds.includes('Say which orchard.')
    );
    await painted(page).first().hover();
    await expect(painted(page).first()).toHaveAttribute(
      'title',
      /^[^:\n]+: Say which orchard\.$/
    );
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
    await removeButton(page).click();

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

  test('ACC-NOTES-144 removes a mark a rewrite took both markers from', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    // Marked and noted, which is the shape the defect was reported in: the
    // panel held the passage and the note the rewrite is about to take away.
    await openMenu(page, await select(page, P1));
    await choose(page, 'Add note');
    await writeNote(page, 'Worth checking.');
    const text = await fileWhen(target, holds =>
      holds.includes('Worth checking.')
    );
    const [only] = openingIds(text);

    // The agent rewrites the document without the two markers, notes and all,
    // which is what a rewrite of a marked paragraph leaves.
    await writeExternally(
      page,
      target,
      DOC.replace('cherries and figs', 'quinces and medlars')
    );
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      'quinces and medlars'
    );

    // The mark is gone from the file, so it is gone from the panel, from the
    // strip of ticks and from the rendered text, notes and all.
    await expect(panel(page)).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
    await expect(painted(page)).toHaveCount(0);
    await openMenuOnPreview(page);
    await choose(page, 'Show notes minimap');
    await expect(ticks(page)).toHaveCount(0);
    // A break is deleted only once it has stood for the settle, so the file
    // is waited on rather than read the moment the panel has caught up.
    await fileWhen(target, holds => !holds.includes(only));
  });

  test('ACC-NOTES-144 deletes the closing marker a rewrite left behind', async ({
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

    // Only the opening marker goes, which is what a rewrite of the first half
    // of a marked paragraph leaves.
    await writeExternally(page, target, text.replace(opening(only), ''));

    // The leftover marker is deleted from the file itself, so an agent
    // reading the file next finds nothing of the mark either. The deletion
    // waits out the settle first, which is what this poll waits through.
    await fileWhen(target, holds => !holds.includes(only));
    await expect(rows(page)).toHaveCount(0);
    await expect(painted(page)).toHaveCount(0);
    expect(fileText(target)).toContain(P1);
    await savedCleanly(page);
  });

  test('ACC-NOTES-144 deletes both markers of a passage a rewrite emptied', async ({
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

    // The passage between the two markers is taken out and nothing but a
    // space is left in its place: the mark encloses nothing any more.
    await writeExternally(page, target, text.replace(P1, ' '));

    // Both markers go once the break has stood for the settle.
    await fileWhen(target, holds => !holds.includes(only));
    await expect(rows(page)).toHaveCount(0);
    await expect(painted(page)).toHaveCount(0);
    await savedCleanly(page);
  });

  test('ACC-NOTES-144 keeps a mark whose passage a rewrite rewrote between its markers', async ({
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

    // Both markers survive, so the mark does: it is the new passage that is
    // listed, and nothing is deleted from the file.
    await writeExternally(
      page,
      target,
      text.replace(P1, 'quinces and medlars')
    );
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      'quinces and medlars'
    );

    await expect(rows(page)).toHaveCount(1);
    await expect(
      rows(page).first().locator('.jp-AdvancedMd-notesPassage')
    ).toHaveText('quinces and medlars');
    // Nothing was deleted, and nothing is deleted later either: the wait is
    // well past the settle a break would have to stand for.
    await page.waitForTimeout(2000);
    expect(openingIds(fileText(target))).toEqual([only]);
  });

  test('ACC-NOTES-144 keeps the markers and the notes of a passage the reader emptied while the document is unsaved', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await openMenu(page, await select(page, P1));
    await choose(page, 'Add note');
    await writeNote(page, 'Worth checking.');
    const text = await fileWhen(target, holds =>
      holds.includes('Worth checking.')
    );
    const [only] = openingIds(text);

    // The preview and the editor share one document, so the reader selecting
    // the marked passage there and pressing Backspace, meaning to retype it,
    // leaves the mark enclosing nothing for as long as they take over it.
    await deleteInEditor(page, target, P1);
    const editor = page.locator('.jp-FileEditor .cm-content');
    await expect(editor).not.toContainText(P1);

    // Their undo has to bring the passage back into a mark that is still
    // there, so neither marker and no note line is touched while the
    // document is unsaved, and the file itself is not written at all.
    await page.waitForTimeout(2000);
    await expect(editor).toContainText(`<!-- mark:${only}`);
    await expect(editor).toContainText(closing(only));
    await expect(editor).toContainText('Worth checking.');
    expect(fileText(target)).toBe(text);
    await expect(page.locator('.jp-Dialog')).toHaveCount(0);
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

  test('ACC-NOTES-125 shows the removal of a row as a trash icon', async ({
    page
  }) => {
    await openRow(page);
    await expect(removeButton(page)).toHaveCount(1);
    await expect(removeButton(page).locator('svg')).toHaveCount(1);
    await expect(removeButton(page)).toHaveText('');
    await expect(removeButton(page)).toHaveAttribute(
      'aria-label',
      'Remove this mark'
    );
  });

  test('DEF-NOTES-54 draws the theme focus ring on a row the keyboard reaches', async ({
    page
  }) => {
    // Shift+Tab leaves the row for the Hide button and Tab returns to it, so
    // the row holds keyboard focus and the browser shows a focus ring.
    await rows(page).first().focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const ring = await rows(page)
      .first()
      .evaluate((row: HTMLElement) => ({
        focused: document.activeElement === row,
        visible: row.matches(':focus-visible'),
        style: getComputedStyle(row).outlineStyle,
        colour: getComputedStyle(row).outlineColor
      }));
    expect(ring.focused).toBe(true);
    expect(ring.visible).toBe(true);
    expect(ring.style).toBe('solid');
    // The ring is the theme's, the one JupyterLab's own buttons draw.
    const theme = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--jp-focus-outline-color)';
      document.body.appendChild(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    });
    expect(ring.colour).toBe(theme);
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

  test('ACC-NOTES-135 collapses to the minimap from the header control', async ({
    page
  }) => {
    const control = panel(page).locator('.jp-AdvancedMd-notesCollapse');
    await expect(control).toBeVisible();
    await expect(control).toHaveAttribute('title', 'Show notes minimap');
    await expect(control.locator('svg')).toHaveCount(1);
    // The control leads the header at its left edge, before the count; the
    // hide control keeps the right.
    const count = await panel(page)
      .locator('.jp-AdvancedMd-notesCount')
      .boundingBox();
    const box = await control.boundingBox();
    expect(box!.x + box!.width).toBeLessThan(count!.x + 1);
    const close = await panel(page)
      .locator('.jp-AdvancedMd-notesClose')
      .boundingBox();
    expect(close!.x).toBeGreaterThan(count!.x + count!.width - 1);

    await control.focus();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveClass(/jp-AdvancedMd-notes-minimap/);
    await expect(ticks(page)).toHaveCount(3);
    // The minimap is what the control opens, so it has no place there; the
    // keyboard focus moves to the Hide control and not to the page body
    // (DEF-NOTES-58).
    await expect(control).toBeHidden();
    await expect(
      panel(page).locator('.jp-AdvancedMd-notesClose')
    ).toBeFocused();
  });

  test('ACC-NOTES-132 puts the trash icon at the right, apart from the colour dots', async ({
    page
  }) => {
    await openRow(page);
    const dots = rows(page).first().locator('.jp-AdvancedMd-notesDot');
    await expect(dots).toHaveCount(6);
    const lastDot = await dots.last().boundingBox();
    const remove = await removeButton(page).boundingBox();
    expect(lastDot).not.toBeNull();
    expect(remove).not.toBeNull();
    // More than a dot's width of free row between the last dot and the icon.
    expect(remove!.x).toBeGreaterThan(lastDot!.x + 2 * lastDot!.width);
    const controls = await rows(page)
      .first()
      .locator('.jp-AdvancedMd-notesControls')
      .boundingBox();
    expect(remove!.x + remove!.width).toBeGreaterThan(
      controls!.x + controls!.width - 8
    );
  });

  test('ACC-NOTES-133 draws the menu swatch as the row swatch', async ({
    page
  }) => {
    const swatch = await page.evaluate(() => {
      const node = document.querySelector(
        '.jp-AdvancedMd-notesSwatch.jp-AdvancedMd-mark-yellow'
      )!;
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        width: box.width,
        height: box.height,
        radius: style.borderRadius,
        background: style.backgroundColor
      };
    });
    await openMenu(page, await select(page, P1));
    await openMarkMenu(page);
    const icon = await page.evaluate(() => {
      const rect = document.querySelector(
        '.lm-Menu-item[data-command="advanced-markdown-viewer:mark"] .lm-Menu-itemIcon rect'
      )!;
      const box = rect.getBoundingClientRect();
      const style = getComputedStyle(rect);
      return {
        width: box.width,
        height: box.height,
        radius: `${rect.getAttribute('rx')}px`,
        fill: style.fill,
        alpha: Number(style.fillOpacity)
      };
    });
    await closeMenus(page);
    expect(icon.width).toBeCloseTo(swatch.width, 0);
    expect(icon.height).toBeCloseTo(swatch.height, 0);
    expect(icon.radius).toBe(swatch.radius);
    // rgba(r, g, b, a) of the swatch is rgb(r, g, b) at fill-opacity a.
    const parts = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(
      swatch.background
    )!;
    expect(icon.fill).toBe(`rgb(${parts[1]}, ${parts[2]}, ${parts[3]})`);
    expect(icon.alpha).toBeCloseTo(Number(parts[4]), 2);
  });

  test('ACC-NOTES-52 closes the panel and brings it back with no mark lost', async ({
    page
  }) => {
    await page.locator('.jp-AdvancedMd-notesClose').click();
    await expect(panel(page)).toHaveCount(0);

    // The context menu is the control outside the panel that brings it back.
    await openMenuOnPreview(page);
    await choose(page, 'Show notes');

    await expect(panel(page)).toBeVisible();
    await expect(rows(page)).toHaveCount(3);
  });

  test('ACC-NOTES-126 leaves the preview toolbar a micro strip', async ({
    page
  }) => {
    // JupyterLab collapses a toolbar to its two-pixel strip only while every
    // item is hidden, so one visible button of this extension would cost every
    // preview a toolbar row.
    const toolbar = page
      .locator('.jp-MainAreaWidget:visible', {
        has: page.locator('.jp-MarkdownViewer')
      })
      .locator(':scope > .jp-Toolbar');
    await expect(toolbar).toHaveClass(/jp-Toolbar-micro/);
    // JupyterLab's own popup opener sits hidden in every toolbar, so only a
    // visible button would be one of ours.
    await expect(toolbar.locator('.jp-ToolbarButton:visible')).toHaveCount(0);
    // The strip JupyterLab leaves is a few pixels; the open toolbar is the
    // full --jp-private-toolbar-height, near thirty.
    const box = await toolbar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThan(16);
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
    // ACC-NOTES-131: the entry names the minimap while the panel is one.
    await choose(page, 'Hide minimap');
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

  test('ACC-NOTES-54 and ACC-NOTES-150 show no note on a closed row and the whole note once it is open', async ({
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
    await expect(rows(page)).toHaveCount(3);
    const row = rows(page).first();
    const entries = row.locator('.jp-AdvancedMd-notesEntry');
    await expect(row.locator('.jp-AdvancedMd-notesPassage')).toHaveText(P1);
    await expect(entries).toHaveCount(0);

    // A click on a closed row opens it (ACC-NOTES-148).
    await row.locator('.jp-AdvancedMd-notesHead').click();

    await expect(entries).toHaveCount(1);
    await expect(row.locator('.jp-AdvancedMd-notesText')).toContainText(
      'The first line of the note,'
    );
    await expect(row.locator('.jp-AdvancedMd-notesText')).toContainText(
      'and the second line the row hides until it is opened.'
    );
    // The other rows are unaffected, which is what independently means.
    await expect(
      rows(page).nth(1).locator('.jp-AdvancedMd-notesControls')
    ).toHaveCount(0);

    // Collapse takes the note off the row again.
    await row.locator('.jp-AdvancedMd-notesToggle').click();
    await expect(entries).toHaveCount(0);
  });

  test('DEF-NOTES-80 opens a row from a click on its padding or the gap above its note', async ({
    page,
    tmpPath
  }) => {
    await writeExternally(
      page,
      `${tmpPath}/${FILE}`,
      MARKED.replace(
        opening(ONE),
        `<!-- mark:${ONE} note colour=yellow\n${AGENT_NOTE}\n-->`
      )
    );
    const first = rows(page).first();
    const controls = first.locator('.jp-AdvancedMd-notesControls');
    const note = first.locator('.jp-AdvancedMd-notesText');
    // The row is opened once so the wait for the note is a wait for the
    // written file, then closed: a closed row shows no note (ACC-NOTES-150)
    // and no controls.
    await openRow(page);
    await expect(note).toContainText('The intro contradicts this.');
    await first.locator('.jp-AdvancedMd-notesToggle').click();
    await expect(note).toHaveCount(0);
    await expect(controls).toHaveCount(0);

    // A point inside the row's box and outside the box of every part of the
    // row: halfway down the padding above the head, or, on an open row,
    // halfway down the gap above the note line.
    const blank = (where: 'gap' | 'padding') =>
      first.evaluate((row: HTMLElement, band: string) => {
        const box = row.getBoundingClientRect();
        const head = row
          .querySelector('.jp-AdvancedMd-notesHead')!
          .getBoundingClientRect();
        const entry = row
          .querySelector('.jp-AdvancedMd-notesEntry')
          ?.getBoundingClientRect();
        const [top, bottom] =
          band === 'gap' && entry
            ? [head.bottom, entry.top]
            : [box.top, head.top];
        const x = (box.left + box.right) / 2;
        const y = (top + bottom) / 2;
        return {
          x,
          y,
          room: bottom - top,
          outside: Array.from(row.children).every(child => {
            const part = child.getBoundingClientRect();
            return y < part.top || y > part.bottom;
          }),
          hit: document.elementFromPoint(x, y) === row
        };
      }, where);

    // With another row selected, the closed row opens from its padding.
    await openRow(page, 1);
    await expect(first).not.toHaveClass(/jp-AdvancedMd-notesRow-selected/);
    const padding = await blank('padding');
    expect(padding.room).toBeGreaterThanOrEqual(2);
    expect(padding.outside).toBe(true);
    expect(padding.hit).toBe(true);
    await page.mouse.click(padding.x, padding.y);
    await expect(controls).toBeVisible();
    await expect(first).toHaveClass(/jp-AdvancedMd-notesRow-selected/);
    await expect(note).toContainText('The intro contradicts this.');

    // On the open row a click on the gap above its note keeps it open and
    // selected.
    const gap = await blank('gap');
    expect(gap.room).toBeGreaterThanOrEqual(2);
    expect(gap.outside).toBe(true);
    expect(gap.hit).toBe(true);
    await page.mouse.click(gap.x, gap.y);
    await expect(controls).toBeVisible();
    await expect(first).toHaveClass(/jp-AdvancedMd-notesRow-selected/);
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

  test('ACC-NOTES-130 expands from the control on the strip', async ({
    page
  }) => {
    await expect(panel(page)).toHaveClass(/jp-AdvancedMd-notes-minimap/);
    const control = panel(page).locator('.jp-AdvancedMd-notesExpand');
    await expect(control).toBeVisible();
    await expect(control).toHaveAttribute('title', 'Show notes');
    await expect(control.locator('svg')).toHaveCount(1);
    await expect(panel(page).locator('.jp-AdvancedMd-notesAdd')).toBeHidden();

    await control.focus();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveClass(/jp-AdvancedMd-notes-expanded/);
    // The expanded panel is what the control opens, so it has no place there;
    // the keyboard focus moves to the Hide control (DEF-NOTES-58).
    await expect(control).toBeHidden();
    await expect(
      panel(page).locator('.jp-AdvancedMd-notesClose')
    ).toBeFocused();
  });

  test('ACC-NOTES-131 names the minimap in the hide control and the menu entry', async ({
    page
  }) => {
    await expect(panel(page)).toHaveClass(/jp-AdvancedMd-notes-minimap/);
    await expect(
      panel(page).locator('.jp-AdvancedMd-notesClose')
    ).toHaveAttribute('title', 'Hide minimap');
    await openMenuOnPreview(page);
    await expect(entry(page, 'Hide minimap')).not.toHaveClass(/lm-mod-hidden/);
    await expect(entry(page, 'Hide notes')).toHaveCount(0);
    await choose(page, 'Show notes');

    await expect(panel(page)).toHaveClass(/jp-AdvancedMd-notes-expanded/);
    await expect(
      panel(page).locator('.jp-AdvancedMd-notesClose')
    ).toHaveAttribute('title', 'Hide notes');
    await openMenuOnPreview(page);
    await expect(entry(page, 'Hide notes')).not.toHaveClass(/lm-mod-hidden/);
    await expect(entry(page, 'Hide minimap')).toHaveCount(0);
    await page.keyboard.press('Escape');
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

test.describe('adding a note from a passage far down the document', () => {
  test('ACC-NOTES-122 neither renders nor scrolls the preview from Add note through Save', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(LONG, 'text', target);
    await openPreview(page, target, 'Long report');

    // Selecting brings the passage to the middle of the view; from here on
    // the view must not move, and no node of it may be rebuilt.
    const at = await select(page, P3);
    const parked = await scrollTop(page);
    expect(parked).toBeGreaterThan(0);
    await page.evaluate(() => {
      const roots = Array.from(
        document.querySelectorAll<HTMLElement>('.jp-RenderedMarkdown')
      );
      const root = roots.find(node => node.offsetParent !== null);
      (window as any).__held =
        Array.from(root?.querySelectorAll('p') ?? []).find(node =>
          node.textContent?.includes('cherries')
        ) ?? null;
    });
    const held = (): Promise<boolean> =>
      page.evaluate(() => (window as any).__held?.isConnected === true);
    expect(await held()).toBe(true);

    await openMenu(page, at);
    await choose(page, 'Add note');
    await expect(
      page.locator('.jp-AdvancedMd-notesForm textarea')
    ).toBeVisible();
    expect(await scrollTop(page)).toBe(parked);
    expect(await held()).toBe(true);

    await writeNote(page, 'Say which orchard.');
    await fileWhen(target, holds => holds.includes('Say which orchard.'));
    // The viewer's render timeout is a second; the render it would schedule
    // is given its time, and the view must still be where it was.
    await page.waitForTimeout(2500);
    expect(await scrollTop(page)).toBe(parked);
    expect(await held()).toBe(true);
    await expect(painted(page)).toHaveCount(1);
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
    // The lab knows exactly who the reader is, and it makes no difference:
    // the setting alone names a note line.
    mockUser: identity('kj', 'Konrad Jelen')
  });

  test('ACC-NOTES-142 signs a note line with the default handle while the setting is empty', async ({
    page,
    tmpPath
  }) => {
    const text = await noteOnFreshDocument(
      page,
      `${tmpPath}/${FILE}`,
      'The setting is empty.'
    );

    expect(text).toMatch(
      /\n@author \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z: The setting is empty\.\n/
    );
    expect(text).not.toContain('@kj');
    await expect(
      rows(page).first().locator('.jp-AdvancedMd-notesAuthor')
    ).toHaveText('@author');
  });

  test('ACC-NOTES-142 leaves a note line an agent wrote as it stands', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(AGENT_NOTED, 'text', target);
    await openPreview(page, target, FIRST);

    await openRow(page);
    await panelButton(page, 'Add note').click();
    await writeNote(page, 'Agreed.');
    const text = await fileWhen(target, holds => holds.includes('Agreed.'));

    // The agent's line is carried through the rewrite of the marker byte for
    // byte, and only the line written here is signed with the handle.
    expect(text).toContain(AGENT_NOTE);
    expect(text).toMatch(
      /\n@author \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z: Agreed\.\n/
    );
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

  test('ACC-NOTES-142 signs note lines with the handle the setting names', async ({
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
            /^(Mark \w+|Add note|Show notes|Show notes minimap|Hide notes|Hide minimap)$/
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

    // A click on a row opens and selects it (ACC-NOTES-148). The first row
    // is opened and then the second is selected, so the first is open without
    // being selected, and a selection the Enter made would show on it.
    await openRow(page, 0);
    await openRow(page, 1);
    await expect(rows(page).first()).not.toHaveClass(
      /jp-AdvancedMd-notesRow-selected/
    );
    await rows(page).first().locator('button', { hasText: 'Add note' }).click();
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

    await openRow(page);
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

    await openRow(page);
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

    await openMarkMenu(page);
    await choose(page, colourLabel('yellow'));

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

test.describe('a note being written when the mark vanished', () => {
  test.use({ mockSettings: settings({ fadeDuration: 500, animation: false }) });

  test('ACC-NOTES-144 takes the row and its open entry with a mark the file lost', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(MARKED, 'text', target);
    await openPreview(page, target, FIRST);
    await openRow(page);
    await panelButton(page, 'Add note').click();
    const box = page.locator('.jp-AdvancedMd-notesForm textarea');
    await expect(box).toBeVisible();
    await box.fill('Written into a mark that is gone.');

    // Every marker goes from the file while the entry is open. The marks are
    // gone rather than unanchored, so their rows go and the entry goes with
    // them: what DEF-NOTES-35 kept beside an unanchored row has no row to
    // stand beside any more.
    await writeExternally(page, target, DOC);

    await expect(rows(page)).toHaveCount(0);
    await expect(box).toHaveCount(0);
    await expect(painted(page)).toHaveCount(0);
    expect(fileText(target)).not.toContain('Written into a mark');
    expect(openingIds(fileText(target))).toEqual([]);
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

  test('ACC-CUE-149 describes whether a row is open and how to change it', async ({
    page,
    tmpPath
  }) => {
    await page.contents.uploadContent(DOC, 'text', `${tmpPath}/${FILE}`);
    await openPreview(page, `${tmpPath}/${FILE}`, FIRST);
    await mark(page, P1);
    const row = rows(page).first();

    // A closed row carries no control to say that it opens (ACC-NOTES-148),
    // so its description says how; the text is not shown on the page.
    await expect(row).toHaveAccessibleDescription(
      'Closed. Press Enter to open.'
    );
    await expect(
      panel(page).getByText('Closed. Press Enter to open.')
    ).toBeHidden();

    // The keys the description names, as a screen reader user presses them.
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(row).toHaveAccessibleDescription(
      'Open. The Collapse button closes it.'
    );

    await row.locator('.jp-AdvancedMd-notesToggle').press('Enter');
    await expect(row).toHaveAccessibleDescription(
      'Closed. Press Enter to open.'
    );
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

test.describe('the first note of a long document', () => {
  test.use({ mockSettings: settings({ fadeDuration: 500, animation: false }) });

  test('DEF-NOTES-51 keeps the passage in view when the panel opens beside it', async ({
    page,
    tmpPath
  }) => {
    // Paragraphs long enough to wrap onto more lines once the panel has taken
    // its width from the preview.
    const sentence =
      'This paragraph carries words enough to wrap at the width of the preview and again at the narrower width the panel leaves it. ';
    const filler = Array.from(
      { length: 12 },
      (_, index) => `Paragraph ${index + 1}. ${sentence.repeat(3)}`
    ).join('\n\n');
    await page.contents.uploadContent(
      `# Report\n\n${filler}\n\nThe last paragraph mentions apples and pears.\n`,
      'text',
      `${tmpPath}/${FILE}`
    );
    await openPreview(page, `${tmpPath}/${FILE}`, 'Paragraph 1.');
    // The passage sits at the bottom edge of the view, with the panel hidden.
    await page.evaluate(() => {
      const paragraphs = document.querySelectorAll('.jp-RenderedMarkdown p');
      paragraphs[paragraphs.length - 1].scrollIntoView({ block: 'end' });
    });

    await openMenu(page, await select(page, P1));
    await choose(page, 'Add note');
    await expect(panel(page).locator('textarea')).toBeVisible();

    const placed = await page.evaluate(() => {
      const view = document
        .querySelector('.jp-RenderedMarkdown')!
        .getBoundingClientRect();
      const passage = document
        .querySelector('[data-mark]')!
        .getBoundingClientRect();
      return {
        view: [view.top, view.bottom],
        passage: [passage.top, passage.bottom]
      };
    });
    // The passage came back the least distance, so its edge meets the view's
    // edge; the two rectangles round to sub-pixels a fraction apart.
    expect(placed.passage[0]).toBeGreaterThanOrEqual(placed.view[0] - 1);
    expect(placed.passage[1]).toBeLessThanOrEqual(placed.view[1] + 1);
  });
});
