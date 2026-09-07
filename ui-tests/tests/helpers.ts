/**
 * Fixtures and helpers shared by the integration suites.
 *
 * Each suite writes the fixture through the contents API or the filesystem,
 * which is external as far as the extension is concerned: the bytes on disk
 * move without anything telling the open document, which is exactly what an
 * agentic tool does.
 */

import { expect, galata } from '@jupyterlab/galata';

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
