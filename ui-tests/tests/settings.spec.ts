import { expect, test } from '@jupyterlab/galata';

import {
  FILE,
  INITIAL,
  PLUGIN_ID,
  REWRITTEN,
  labFixtures,
  openPreview,
  settings,
  typeInEditor
} from './helpers';

/**
 * Integration tests of the settings declaration as the reader meets it.
 *
 * The schema is what makes the settings editor refuse a value, so the proof
 * that the fallback interval carries a minimum is the editor itself: a value
 * below the minimum is reported as an error under the field and never reaches
 * the settings JupyterLab stores. The second test is the control for the
 * first - it enters an accepted value through the same field and reads it
 * back from the stored settings, so a refused value staying out means the
 * declaration refused it and not that this page saves nothing.
 */

test.use(labFixtures);

/**
 * The number input the settings editor draws for the fallback interval. The
 * editor builds the id out of the plugin id, whose colon has to be escaped to
 * read as part of the id in a selector.
 */
const FIELD = `#jp-SettingsEditor-${PLUGIN_ID.replace(':', '\\:')}_pollInterval`;

/**
 * The list of errors the editor shows under that input. It is empty while the
 * value is accepted.
 */
const FIELD_ERROR = `${FIELD}__error`;

/**
 * How long the editor is given to store a value the reader entered. The
 * control test stores one inside this window, so a stored value still holding
 * its old number after the window means nothing was sent.
 */
const SAVE_WINDOW = 2000;

/**
 * Open the settings editor on this extension's page.
 */
async function openSettingsEditor(page: any): Promise<void> {
  await page.evaluate(async () => {
    await (window as any).jupyterapp.commands.execute('settingeditor:open', {
      query: 'Advanced Markdown Viewer'
    });
  });
  await expect(page.locator(FIELD)).toBeVisible();
}

/**
 * The settings JupyterLab holds for this plugin now, as the editor last wrote
 * them.
 */
function storedSettings(page: any): Promise<Record<string, unknown>> {
  return page.evaluate(async (id: string) => {
    const server = (window as any).jupyterapp.serviceManager.serverSettings;
    const reply = await fetch(`${server.baseUrl}lab/api/settings/${id}`);
    return JSON.parse((await reply.json()).raw);
  }, PLUGIN_ID);
}

test.describe('the settings editor', () => {
  test.use({ mockSettings: settings() });

  test('refuses a fallback interval below the declared minimum', async ({
    page
  }) => {
    await openSettingsEditor(page);
    const field = page.locator(FIELD);
    await expect(field).toHaveValue('1');

    await field.fill('0');
    await field.blur();

    await expect(page.locator(FIELD_ERROR)).toContainText('>= 1');
    await page.waitForTimeout(SAVE_WINDOW);
    expect((await storedSettings(page)).pollInterval).toBe(1);
  });

  test('stores a fallback interval the declaration accepts', async ({
    page
  }) => {
    await openSettingsEditor(page);
    const field = page.locator(FIELD);
    await expect(field).toHaveValue('1');

    await field.fill('5');
    await field.blur();

    await expect(page.locator(FIELD_ERROR)).toHaveCount(0);
    await page.waitForTimeout(SAVE_WINDOW);
    expect((await storedSettings(page)).pollInterval).toBe(5);
  });
});

/** The checkbox the settings editor draws for the live-updates switch. */
const SWITCH = `#jp-SettingsEditor-${PLUGIN_ID.replace(':', '\\:')}_enabled`;

/**
 * Turn live updates on or off the way the reader does, and wait until the
 * settings JupyterLab holds say so.
 */
async function setLiveUpdates(page: any, on: boolean): Promise<void> {
  await openSettingsEditor(page);
  await page.locator(SWITCH).setChecked(on);
  await expect
    .poll(async () => (await storedSettings(page)).enabled, {
      timeout: SAVE_WINDOW * 5
    })
    .toBe(on);
}

test.describe('the live-updates switch while a change is held back', () => {
  test.use({ mockSettings: settings() });

  test('DEF-CONFIG-23 lets the held change go, and reports it again once the switch is back on', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(INITIAL, 'text', target);
    await openPreview(page, target);
    await typeInEditor(page, target, 'UNSAVED WORK');
    await page.contents.uploadContent(REWRITTEN, 'text', target);

    const blocked = page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabBlocked');
    await expect(blocked).toHaveCount(1, { timeout: 20000 });

    // Nothing waits behind the switch: the change held back is let go rather
    // than kept for a moment the reader did not ask for.
    await setLiveUpdates(page, false);
    await expect(blocked).toHaveCount(0);

    // The change is still on disk, so turning the switch back on finds it and
    // reports it again. A change still held would be reported by nothing,
    // which is what this half of the marker proves.
    await setLiveUpdates(page, true);
    await expect(blocked).toHaveCount(1, { timeout: 20000 });
  });
});
