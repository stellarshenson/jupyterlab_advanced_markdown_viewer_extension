import { expect, test } from '@jupyterlab/galata';

import {
  entry,
  FILE,
  labFixtures,
  menu,
  openPreview,
  settings
} from './helpers';

/**
 * ACC-COMPAT-162: an entry another extension puts on the Markdown Preview is
 * added beside this extension's own, never in place of them.
 *
 * The failure mode is removal, so removal is what these cases test, and they
 * test it without needing any sibling installed. Each registers its own
 * foreign entries through the application's own ContextMenu while the test
 * runs, on the two selectors that matter: the class the rendered root shares
 * with every rendered output, which is where a sibling such as the SVG export
 * extension registers, and a node inside the root, which this extension's
 * repaint replaces. The menu is then asked for before and after a change
 * arrives from disk, and the entry is chosen to prove it still acts.
 */

test.use(labFixtures);

const ROOT_ENTRY = 'Foreign Root Entry';
const PASSAGE_ENTRY = 'Foreign Passage Entry';

const DOC = [
  '# Report',
  '',
  'The first paragraph is unchanged.',
  '',
  'The last paragraph closes the report.',
  ''
].join('\n');

const REWRITTEN = DOC.replace(
  'The last paragraph closes the report.',
  'A rewrite.'
);

/**
 * Register two entries the way another extension does, and count what they
 * run. The root selector is the one a sibling uses for any rendered output;
 * the passage selector sits on a node the repaint replaces, which is the case
 * a DOM-replacing extension is most likely to break.
 */
async function registerForeignEntries(page: any): Promise<void> {
  await page.evaluate(
    ([root, passage]: [string, string]) => {
      const app = (window as any).jupyterapp;
      const ran = ((window as any).__foreignRan = { root: 0, passage: 0 });
      app.commands.addCommand('test:foreign-root', {
        label: root,
        execute: () => {
          ran.root += 1;
        }
      });
      app.commands.addCommand('test:foreign-passage', {
        label: passage,
        execute: () => {
          ran.passage += 1;
        }
      });
      app.contextMenu.addItem({
        command: 'test:foreign-root',
        selector: '.jp-RenderedHTMLCommon',
        rank: 11
      });
      app.contextMenu.addItem({
        command: 'test:foreign-passage',
        selector: '.jp-MarkdownViewer p',
        rank: 12
      });
    },
    [ROOT_ENTRY, PASSAGE_ENTRY]
  );
}

/** How many times each foreign entry has run. */
const foreignRuns = (page: any): Promise<{ root: number; passage: number }> =>
  page.evaluate(() => (window as any).__foreignRan);

/** Right-click a paragraph of the preview and wait for the menu. */
async function openMenuOnPassage(page: any, text: string): Promise<void> {
  await page
    .locator('.jp-RenderedMarkdown:visible p', { hasText: text })
    .first()
    .click({ button: 'right' });
  await expect(menu(page).first()).toBeVisible();
}

/** An entry is offered when it is in the menu and not hidden. */
async function expectOffered(page: any, label: string): Promise<void> {
  const item = entry(page, label).first();
  await expect(item).toHaveCount(1);
  await expect(item).not.toHaveClass(/lm-mod-hidden/);
  await expect(item).not.toHaveClass(/lm-mod-disabled/);
}

test.describe("another extension's context menu entries", () => {
  test.use({ mockSettings: settings({ fadeDuration: 2000 }) });

  test("ACC-COMPAT-162 offers them on the preview beside this extension's own", async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(DOC, 'text', path);
    await openPreview(page, path);
    await registerForeignEntries(page);

    await openMenuOnPassage(page, 'The first paragraph is unchanged.');

    // Both foreign entries, on the root's shared class and on a node inside it.
    await expectOffered(page, ROOT_ENTRY);
    await expectOffered(page, PASSAGE_ENTRY);
    // This extension's own entry is on the same menu; its presence is what
    // makes an absent foreign entry a defect rather than a menu that never
    // opened.
    await expectOffered(page, 'Copy Content');
  });

  test('ACC-COMPAT-162 keeps them after a change from disk repaints the preview', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(DOC, 'text', path);
    await openPreview(page, path);
    await registerForeignEntries(page);

    // The repaint replaces the nodes the entries were seen over, which is the
    // removal this criterion is about.
    await page.contents.uploadContent(REWRITTEN, 'text', path);
    const root = page.locator('.jp-RenderedMarkdown:visible');
    await expect(root).toContainText('A rewrite.', { timeout: 20000 });
    // Settled is a decoration count, not a wait of a chosen length.
    await expect(root.locator('.jp-AdvancedMd-added')).toHaveCount(0, {
      timeout: 20000
    });
    await expect(root.locator('.jp-AdvancedMd-removed')).toHaveCount(0);

    await openMenuOnPassage(page, 'A rewrite.');

    await expectOffered(page, ROOT_ENTRY);
    await expectOffered(page, PASSAGE_ENTRY);
    await expectOffered(page, 'Copy Content');
  });

  test('ACC-COMPAT-162 lets them run - nothing here swallows the click', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(DOC, 'text', path);
    await openPreview(page, path);
    await registerForeignEntries(page);

    // Present is not the same as working: an entry this extension left in the
    // menu but whose click it consumed would pass the two cases above.
    await openMenuOnPassage(page, 'The first paragraph is unchanged.');
    await entry(page, PASSAGE_ENTRY).first().click();
    await expect(menu(page)).toHaveCount(0);
    expect(await foreignRuns(page)).toEqual({ root: 0, passage: 1 });

    await openMenuOnPassage(page, 'The first paragraph is unchanged.');
    await entry(page, ROOT_ENTRY).first().click();
    await expect(menu(page)).toHaveCount(0);
    expect(await foreignRuns(page)).toEqual({ root: 1, passage: 1 });
  });
});
