/**
 * Fixtures and helpers shared by the integration suites.
 *
 * Each suite writes the fixture through the contents API or the filesystem,
 * which is external as far as the extension is concerned: the bytes on disk
 * move without anything telling the open document, which is exactly what an
 * agentic tool does.
 */

import { expect, galata } from '@jupyterlab/galata';
import * as fs from 'fs';
import * as path from 'path';

export const PLUGIN_ID = 'jupyterlab_advanced_markdown_viewer_extension:plugin';
export const FILE = 'live.md';

/**
 * Galata's stock readiness wait expects a Launcher tab in the main area. The
 * lab this suite runs against opens with an empty main area, so the wait
 * times out before any test body runs. Readiness here is the splash gone and
 * the shell mounted, which is all the tests need.
 */
export const labFixtures = {
  waitForApplication: async (
    { baseURL }: { baseURL?: string },
    use: (wait: (page: any) => Promise<void>) => Promise<void>
  ) => {
    await use(async (page: any) => {
      await page.locator('#jupyterlab-splash').waitFor({ state: 'detached' });
      await page.locator('#main').waitFor();
    });
  }
};

export const INITIAL = [
  '# Report',
  '',
  'The first paragraph is unchanged.',
  '',
  'The second paragraph mentions apples.',
  ''
].join('\n');

/**
 * Same document with the second paragraph rewritten and a third added.
 */
export const REWRITTEN = [
  '# Report',
  '',
  'The first paragraph is unchanged.',
  '',
  'The second paragraph mentions oranges.',
  '',
  'A third paragraph appeared.',
  ''
].join('\n');

/**
 * Settings that make the feature observable within a test: fall back to a
 * check every second, hold the highlight long enough to assert on it, and
 * show a change at once so the text read after a decoration appears is
 * complete; a describe with other needs passes its own overrides.
 */
export function settings(overrides: Record<string, unknown> = {}) {
  return {
    ...galata.DEFAULT_SETTINGS,
    [PLUGIN_ID]: {
      enabled: true,
      pollInterval: 1,
      fadeDuration: 30000,
      animation: true,
      animationSpeed: 0,
      highlight: true,
      tabCue: true,
      ...overrides
    }
  };
}

/**
 * The computed style of one tab marker: the `::before` of the label of the
 * tab carrying a marker class, beside the label's own colour.
 *
 * The marker is generated content, so nothing but the computed style of the
 * pseudo-element says which shape a tab is showing or whether it moves.
 */
export interface IMarkerStyle {
  content: string;
  color: string;
  animationName: string;
  animationDuration: string;
  timingFunction: string;
  labelColor: string;
}

/**
 * Read the marker of the one tab carrying a class.
 */
export function markerStyle(
  page: any,
  tabClass: string
): Promise<IMarkerStyle> {
  return page.evaluate((name: string) => {
    const tab = document.querySelector(`.lm-TabBar-tab.${name}`);
    const label = tab?.querySelector('.lm-TabBar-tabLabel');
    if (!label) {
      throw new Error(`no tab carries ${name}`);
    }
    const marker = getComputedStyle(label, '::before');
    return {
      content: marker.content,
      color: marker.color,
      animationName: marker.animationName,
      animationDuration: marker.animationDuration,
      timingFunction: marker.animationTimingFunction,
      labelColor: getComputedStyle(label).color
    };
  }, tabClass);
}

/**
 * Open the same file in the text editor and type into it, which leaves the
 * shared document dirty. The editor tab is current afterwards.
 */
export async function typeInEditor(
  page: any,
  path: string,
  text: string
): Promise<void> {
  await page.evaluate(async (target: string) => {
    await (window as any).jupyterapp.commands.execute('docmanager:open', {
      path: target,
      factory: 'Editor'
    });
  }, path);
  const editor = page.locator('.jp-FileEditor .cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
}

/**
 * Open the Markdown preview for a path and wait for its first render.
 */
export async function openPreview(
  page: any,
  path: string,
  firstText = 'The first paragraph is unchanged.'
): Promise<void> {
  await page.evaluate(async (target: string) => {
    await (window as any).jupyterapp.commands.execute('docmanager:open', {
      path: target,
      factory: 'Markdown Preview'
    });
  }, path);
  // Only the preview in front is visible, so a suite with two open documents
  // waits on the one it just opened rather than on both at once.
  await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
    firstText
  );
}

/** Where the test server keeps a contents-API path on disk. */
export const onDisk = (apiPath: string): string =>
  path.join(__dirname, '..', ...apiPath.split('/'));

/** What the file holds right now. */
export const fileText = (apiPath: string): string =>
  fs.existsSync(onDisk(apiPath))
    ? fs.readFileSync(onDisk(apiPath), 'utf8')
    : '';

/** Where on the screen a right click lands. */
export interface IPoint {
  x: number;
  y: number;
}

/**
 * Select rendered text and answer with a point inside the selection.
 *
 * The range runs from the first character of `from` to the last character of
 * `to`, each found in the first text node holding it, so a selection crosses
 * blocks by naming a word in each. The point is the middle of the selection's
 * first rectangle, which is inside the selected text: Chromium keeps a
 * selection when the right click falls inside it.
 */
export async function select(
  page: any,
  from: string,
  to?: string
): Promise<IPoint> {
  return page.evaluate(
    ([first, last]: [string, string | null]) => {
      const roots = Array.from(
        document.querySelectorAll<HTMLElement>('.jp-RenderedMarkdown')
      );
      const root = roots.find(node => node.offsetParent !== null) ?? roots[0];
      if (!root) {
        throw new Error('no rendered Markdown is on screen');
      }
      const find = (needle: string): { node: Node; at: number } => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          const at = (node.textContent ?? '').indexOf(needle);
          if (at >= 0) {
            return { node, at };
          }
          node = walker.nextNode();
        }
        throw new Error(`no rendered text node holds "${needle}"`);
      };
      const start = find(first);
      const end = last === null ? start : find(last);
      (start.node.parentElement as HTMLElement).scrollIntoView({
        block: 'center'
      });
      const range = document.createRange();
      range.setStart(start.node, start.at);
      range.setEnd(end.node, end.at + (last ?? first).length);
      const selection = window.getSelection();
      if (!selection) {
        throw new Error('the document has no selection');
      }
      selection.removeAllRanges();
      selection.addRange(range);
      const box = range.getClientRects()[0];
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    },
    [from, to ?? null]
  );
}

/** The open context menu. */
export const menu = (page: any) => page.locator('.lm-Menu-content');

/**
 * One entry of the open context menu, by its whole label. An entry that is
 * not offered is still in the DOM carrying `lm-mod-hidden`, so this finds it
 * either way and the class is what says whether it is offered.
 */
export const entry = (page: any, label: string) =>
  page.locator('.lm-Menu-item', {
    has: page.locator('.lm-Menu-itemLabel', {
      hasText: new RegExp(`^${label}$`)
    })
  });

/** Right click at a point and wait for the menu. */
export async function openMenu(page: any, at: IPoint): Promise<void> {
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(menu(page).first()).toBeVisible();
}

/** Choose an entry of the open menu and wait for the menu to go. */
export async function choose(page: any, label: string): Promise<void> {
  await entry(page, label).click();
  await expect(menu(page)).toHaveCount(0);
}

/** Select a passage and mark it in a colour. */
export async function mark(
  page: any,
  from: string,
  to?: string,
  colour = 'yellow'
): Promise<void> {
  // A mark's clearing lags its paint by the trailing refresh, and a selection
  // made inside that window is collapsed with it (ACC-NOTES-129 log): a mark
  // after a mark waits for the previous clearing before selecting.
  await expect(page.locator('.jp-AdvancedMd-selecting')).toHaveCount(0);
  await openMenu(page, await select(page, from, to));
  await openMarkMenu(page);
  await choose(page, colourLabel(colour));
}

/** A colour as the Mark submenu names it. */
export const colourLabel = (colour: string): string =>
  colour[0].toUpperCase() + colour.slice(1);

/** Open the Mark submenu of the open context menu and wait for it. */
export async function openMarkMenu(page: any): Promise<void> {
  await entry(page, 'Mark').click();
  await expect(menu(page)).toHaveCount(2);
}

/** Close the context menu and any submenu of it. */
export async function closeMenus(page: any): Promise<void> {
  while ((await menu(page).count()) > 0) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
  }
}
