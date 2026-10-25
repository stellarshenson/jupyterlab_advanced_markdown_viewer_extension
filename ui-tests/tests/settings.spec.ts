import { expect, test } from '@jupyterlab/galata';

import {
  FILE,
  INITIAL,
  PLUGIN_ID,
  REWRITTEN,
  SUITE_FADE_DURATION,
  SUITE_POLL_INTERVAL,
  closeMenus,
  entry,
  labFixtures,
  openMenu,
  openPreview,
  select,
  settings,
  typeInEditor
} from './helpers';

/**
 * Integration tests of the settings as the reader meets them.
 *
 * The settings editor lists the four settings this extension declares. A
 * user settings file written before the other seven became server options
 * still holds their keys; it loads, the four in it apply and the removed keys
 * change nothing. The seven reach the page from the server configuration,
 * where the suite sets them in jupyter_server_test_config.py.
 */

test.use(labFixtures);

/** The id prefix the settings editor gives the fields of this plugin. */
const FIELD_PREFIX = `jp-SettingsEditor-${PLUGIN_ID}_`;

/** The checkbox the settings editor draws for the live-updates switch. */
const SWITCH = `#${FIELD_PREFIX.replace(':', '\\:')}enabled`;

/** The four settings the editor lists, by key and title, in their order. */
const LISTED = [
  { key: 'enabled', title: 'Enabled' },
  { key: 'animation', title: 'Animate changes' },
  { key: 'highlight', title: 'Highlight changes' },
  { key: 'author', title: 'Note handle' }
];

/** How long the editor is given to store a value the reader entered. */
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
  await expect(page.locator(SWITCH)).toBeVisible();
}

/**
 * The fields the settings editor draws for this plugin, in their order: the
 * key each input is drawn for and the text of the group around it, which
 * holds its title.
 */
function listedFields(
  page: any
): Promise<Array<{ key: string; text: string }>> {
  return page.evaluate(
    (prefix: string) =>
      Array.from(document.querySelectorAll('input, select, textarea'))
        .filter(element => element.id.startsWith(prefix))
        .map(element => ({
          key: element.id.slice(prefix.length),
          text: element.closest('.form-group')?.textContent ?? ''
        })),
    FIELD_PREFIX
  );
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

  test('ACC-CONFIG-211-EDITOR lists four settings', async ({ page }) => {
    await openSettingsEditor(page);
    const fields = await listedFields(page);
    expect(fields.map(field => field.key)).toEqual(
      LISTED.map(listed => listed.key)
    );
    LISTED.forEach((listed, index) => {
      expect(fields[index].text).toContain(listed.title);
    });
  });
});

/**
 * A user settings file from before the seven server options left the
 * settings: every removed key at a value other than the suite's, beside a
 * handle of its own.
 */
const WITH_REMOVED_KEYS = {
  pollInterval: 1,
  fadeDuration: 500,
  animationSpeed: 80,
  animationJitter: 0.5,
  highlightVisibility: 'high',
  tabCue: false,
  notes: false,
  author: 'galata'
};

/** The command that asks for the note handle, with the one in force. */
const SET_HANDLE = 'advanced-markdown-viewer:set-note-handle';

test.describe('a user settings file holding a removed key', () => {
  test.use({ mockSettings: settings(WITH_REMOVED_KEYS) });

  test('ACC-CONFIG-214-REMOVED-KEYS still loads, the four settings in it apply and the removed keys change nothing', async ({
    page,
    tmpPath
  }) => {
    // The command is offered only once the settings have loaded, and its box
    // holds the handle the file names. A file the registry refused would
    // leave it greyed.
    await expect
      .poll(() =>
        page.evaluate(
          (id: string) => (window as any).jupyterapp.commands.isEnabled(id),
          SET_HANDLE
        )
      )
      .toBe(true);
    await page.evaluate((id: string) => {
      void (window as any).jupyterapp.commands.execute(id);
    }, SET_HANDLE);
    const dialog = page.locator('.jp-Dialog');
    await expect(dialog.locator('input')).toHaveValue('galata');
    await dialog.locator('button.jp-mod-reject').click();
    await expect(dialog).toHaveCount(0);

    // The editor draws no field for a removed key.
    await openSettingsEditor(page);
    expect((await listedFields(page)).map(field => field.key)).toEqual(
      LISTED.map(listed => listed.key)
    );

    // The settings were applied before the preview opened, so it shows what
    // the removed keys would change: the suite's medium strength, not high;
    // the marking entries, not notes off; a marked tab, not the cue off.
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(INITIAL, 'text', path);
    await openPreview(page, path);
    await expect(
      page.locator('[data-jp-advancedmd-visibility]')
    ).toHaveAttribute('data-jp-advancedmd-visibility', 'medium');
    await openMenu(page, await select(page, 'first paragraph'));
    await expect(entry(page, 'Add Comment')).toHaveCount(1);
    await expect(entry(page, 'Add Comment')).not.toHaveClass(/lm-mod-hidden/);
    await closeMenus(page);
    await page.contents.uploadContent(REWRITTEN, 'text', path);
    await expect(
      page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabUpdated')
    ).toHaveCount(1, { timeout: 20000 });
  });
});

test.describe('a server option', () => {
  test('ACC-CONFIG-212-SERVER-OPTIONS reaches the page', async ({ page }) => {
    // The server puts the options jupyter_server_test_config.py sets into the
    // page configuration under one key, which the frontend reads at start.
    const options = await page.evaluate(
      () =>
        JSON.parse(
          (document.getElementById('jupyter-config-data') as HTMLElement)
            .textContent as string
        ).advancedMarkdownViewer
    );
    expect(options).toEqual({
      pollInterval: SUITE_POLL_INTERVAL,
      fadeDuration: SUITE_FADE_DURATION,
      animationSpeed: 20,
      animationJitter: 0,
      highlightVisibility: 'medium',
      tabCue: true,
      notes: true
    });
  });
});

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
    // The reader types in the editor, the file moves on, and the preview is
    // opened over both: the text they typed over is not on disk any more, so
    // the change is held back with nothing to merge over (DEF-APPLY-90).
    await typeInEditor(page, target, 'UNSAVED WORK');
    await page.contents.uploadContent(REWRITTEN, 'text', target);
    await openPreview(page, target, 'UNSAVED WORK');

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
