import { expect, test } from '@jupyterlab/galata';
import * as fs from 'fs';
import * as path from 'path';

import {
  FILE,
  INITIAL,
  REWRITTEN,
  labFixtures,
  markerStyle,
  openPreview,
  settings,
  typeInEditorAfter
} from './helpers';

/**
 * Integration tests of the marker itself on the document tab.
 *
 * Every marker is generated content on the tab label, so the class on the tab
 * says only that a state was set: what the reader sees is the computed style
 * of the `::before` of the label, and that is what these tests read. The three
 * states have to be told apart by shape, by colour and by movement, because a
 * reader who cannot tell two colours apart still has the other two.
 */

test.use(labFixtures);

const UPDATED = 'jp-AdvancedMd-tabUpdated';
const ACTIVE = 'jp-AdvancedMd-tabActive';
const BLOCKED = 'jp-AdvancedMd-tabBlocked';
const MISSING = 'jp-AdvancedMd-tabMissing';
const UNREAD = 'jp-AdvancedMd-tabUnread';

/**
 * The glyphs the stylesheet writes: a half-filled circle for a change that
 * arrived, a filled square for one held back, a cross for a file gone from
 * disk.
 */
const CIRCLE = '"◐"';
const SQUARE = '"◼"';
const CROSS = '"✕"';

/**
 * What Chromium reports for the content of the unread marker. The stylesheet
 * writes the content as an empty string, because the dot is a box and shows
 * no character.
 */
const NO_CHARACTER = '""';

/**
 * Either character of a marker read while it alternates: which of the two is
 * on the tab depends on the moment of the read.
 */
const EITHER_FRAME = /^"[◐◑]"$/;

/**
 * The two frames of the marker of a change that is arriving: the character
 * and the transform at a quarter and at three quarters of one run of its
 * animation. The animation is held at each of the two and then let go, so
 * the read does not depend on when it is made.
 */
const frames = (page: any): Promise<{ content: string; transform: string }[]> =>
  page.evaluate((name: string) => {
    const label = document.querySelector(
      `.lm-TabBar-tab.${name} .lm-TabBar-tabLabel`
    ) as Element;
    const animation = document.getAnimations().find(candidate => {
      const effect = candidate.effect as any;
      return effect?.target === label && effect?.pseudoElement === '::before';
    });
    if (!animation) {
      throw new Error('the marker is not animated');
    }
    const duration = Number(
      (animation.effect as any).getComputedTiming().duration
    );
    const was = animation.currentTime;
    animation.pause();
    const read = (fraction: number) => {
      animation.currentTime = duration * fraction;
      const style = getComputedStyle(label, '::before');
      return { content: style.content, transform: style.transform };
    };
    const both = [read(0.25), read(0.75)];
    animation.currentTime = was;
    animation.play();
    return both;
  }, UPDATED);

/**
 * Where the test server keeps a contents-API path on disk. A file removed
 * there is removed behind the lab's back, which is what a file gone from disk
 * means to this extension.
 */
const onDisk = (apiPath: string): string =>
  path.join(__dirname, '..', ...apiPath.split('/'));

/**
 * The blocked colour of the light theme, which the lab opens in.
 */
const BLOCKED_COLOUR = 'rgb(218, 54, 51)';

/**
 * The brand colour of the theme in use, read from the page so the assertions
 * follow the theme rather than a fixed value. The probe carries the same
 * variable the dot takes, --jp-brand-color2, and opts out of forced colours,
 * which would otherwise repaint it.
 */
const brandColour = (page: any): Promise<string> =>
  page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = 'var(--jp-brand-color2)';
    probe.style.setProperty('forced-color-adjust', 'none');
    document.body.appendChild(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  });

/**
 * Open one preview holding unsaved edits, so the change written under it is
 * held back, and a second preview that takes its change at once. The tab bar
 * then carries both markers at the same time and they can be compared.
 */
async function twoStates(page: any, tmpPath: string): Promise<void> {
  const held = `${tmpPath}/${FILE}`;
  const arriving = `${tmpPath}/arriving.md`;
  await page.contents.uploadContent(INITIAL, 'text', held);
  await page.contents.uploadContent(INITIAL, 'text', arriving);
  await openPreview(page, held);
  await openPreview(page, arriving);

  // The edit sits in the passage the file rewrites, so the change is
  // dropped there: a conflict, which the marker of a change held back reports.
  await typeInEditorAfter(page, held, 'apples', ' UNSAVED WORK');
  await page.contents.uploadContent(REWRITTEN, 'text', held);
  await page.contents.uploadContent(REWRITTEN, 'text', arriving);

  await expect(page.locator(`.lm-TabBar-tab.${BLOCKED}`)).toHaveCount(1, {
    timeout: 20000
  });
  await expect(page.locator(`.lm-TabBar-tab.${UPDATED}`)).toHaveCount(1, {
    timeout: 20000
  });
}

/**
 * Open a third preview and take its file away from under it, so the tab bar
 * carries the third marker beside the two above.
 */
async function alsoGone(page: any, tmpPath: string): Promise<void> {
  const gone = `${tmpPath}/gone.md`;
  await page.contents.uploadContent(INITIAL, 'text', gone);
  // A rendered preview does not mean the document has finished opening: the
  // context resolves and renders first and writes the checkpoint JupyterLab
  // takes of a file it opens afterwards. A file taken away inside that window
  // fails that request, and JupyterLab closes the document it could not open
  // rather than marking it, so there is no tab left to carry a marker. The
  // deletion therefore waits for the checkpoint to have been answered.
  const checkpointed = page.waitForResponse(
    (response: any) =>
      response.url().includes(`${gone}/checkpoints`) &&
      response.request().method() === 'POST'
  );
  await openPreview(page, gone);
  await checkpointed;
  fs.unlinkSync(onDisk(gone));

  await expect(page.locator(`.lm-TabBar-tab.${MISSING}`)).toHaveCount(1, {
    timeout: 20000
  });
}

test.describe('the marker of a change that arrived', () => {
  test.use({ mockSettings: settings() });

  test.beforeEach(async ({ page, tmpPath }) => {
    await page.contents.uploadContent(INITIAL, 'text', `${tmpPath}/${FILE}`);
    await openPreview(page, `${tmpPath}/${FILE}`);
  });

  test('is a half-filled circle in the tab own text colour, with a tooltip', async ({
    page,
    tmpPath
  }) => {
    await page.contents.uploadContent(REWRITTEN, 'text', `${tmpPath}/${FILE}`);
    await expect(page.locator(`.lm-TabBar-tab.${UPDATED}`)).toHaveCount(1, {
      timeout: 20000
    });

    const marker = await markerStyle(page, UPDATED);
    expect(marker.content).toMatch(EITHER_FRAME);
    // Written in currentColor, so a colour another extension gave the tab is
    // what the marker shows too.
    expect(marker.color).toBe(marker.labelColor);

    // The commonest marker names its state in words as well, so it does not
    // read as a loading glyph to a first-time reader (DEF-CUE-30). Read past
    // the caption the document manager writes once the applied change has
    // reached the Context, so the words are shown to hold through it.
    await page.waitForTimeout(1500);
    const tooltip = await page
      .locator(`.lm-TabBar-tab.${UPDATED}`)
      .getAttribute('title');
    expect(tooltip).toContain('changed on disk');
  });

  test('DEF-CUE-128 alternates two characters at 1 s a frame for a change a second, and stands still once the writer is quiet', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;

    // A writer at work: five writes a second apart.
    for (let i = 1; i <= 5; i++) {
      await page.contents.uploadContent(
        `${REWRITTEN}\nWrite ${i}.\n`,
        'text',
        path
      );
      await expect(
        page.locator('.jp-MarkdownViewer .jp-RenderedMarkdown')
      ).toContainText(`Write ${i}.`, { timeout: 20000 });
      const turning = await markerStyle(page, UPDATED);
      expect(turning.animationName).toBe('jp-AdvancedMd-tab-turn');
      // The second frame is the second character, and neither is turned or
      // moved: a character turned about the centre of its box changes
      // height on the tab, because the font does not draw the circle at
      // that centre.
      expect(await frames(page)).toEqual([
        { content: CIRCLE, transform: 'none' },
        { content: '"◑"', transform: 'none' }
      ]);
      // ACC-CUE-200: a change a second is the slowest rate, two frames of 1 s.
      expect(turning.animationDuration).toBe('2s');
      await expect(page.locator(`.lm-TabBar-tab.${ACTIVE}`)).toHaveCount(1);
      await page.waitForTimeout(1000);
    }

    // The writer has gone quiet: the tab stops saying changes arrive within a
    // few seconds and keeps the marker, which is still the reader's to clear.
    await expect(page.locator(`.lm-TabBar-tab.${ACTIVE}`)).toHaveCount(0, {
      timeout: 10000
    });
    // ACC-CUE-71: it stands still from then on, and on a tab in front it is
    // the half circle, not the unread marker of a change nobody has looked at.
    const settled = await markerStyle(page, UPDATED);
    expect(settled.content).toBe(CIRCLE);
    expect(settled.animationName).toBe('none');
    await expect(page.locator(`.lm-TabBar-tab.${UNREAD}`)).toHaveCount(0);
  });

  test('ACC-CUE-200 turns faster the more often the file changes', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;

    // The controller times each change with Date.now when it applies it. The
    // page's clock is held at a time this case sets for each write, so the
    // gaps the controller measures are the 200 ms written here and not the
    // time the lab took to take each change, which grows with the load on
    // the machine (DEF-TEST-135).
    await page.evaluate(() => {
      const realNow = Date.now.bind(Date);
      (window as any).heldNow = null;
      Date.now = () => (window as any).heldNow ?? realNow();
    });
    const start = await page.evaluate(() => Date.now());
    for (let i = 1; i <= 5; i++) {
      await page.evaluate(
        (now: number) => {
          (window as any).heldNow = now;
        },
        start + i * 200
      );
      await page.contents.uploadContent(
        `${REWRITTEN}\nFast write ${i}.\n`,
        'text',
        path
      );
      // Each change is on screen before the next is written, so the lab never
      // takes two of them in one read.
      await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
        `Fast write ${i}.`,
        { timeout: 20000 }
      );
    }
    // Five changes 200 ms apart: the mean gap rounds to 0.25 s a frame, and
    // one run of the animation is two frames.
    await expect(page.locator(`.lm-TabBar-tab.${UPDATED}`)).toHaveClass(
      /jp-AdvancedMd-tabFrame250\b/
    );
    const fast = await markerStyle(page, UPDATED);
    expect(fast.content).toMatch(EITHER_FRAME);
    expect(fast.animationDuration).toBe('0.5s');
    await page.evaluate(() => {
      (window as any).heldNow = null;
    });

    // Quiet again: the marker is kept and stands still.
    await expect(page.locator(`.lm-TabBar-tab.${ACTIVE}`)).toHaveCount(0, {
      timeout: 10000
    });
    const settled = await markerStyle(page, UPDATED);
    expect(settled.content).toBe(CIRCLE);
    expect(settled.animationName).toBe('none');
  });
});

test.describe('the marker of a change on a tab behind another', () => {
  // A fade duration short enough to wait out, and long enough to tell from
  // a marker that leaves at once.
  const FADE = 3000;
  test.use({ mockSettings: settings({ fadeDuration: FADE }) });

  test('ACC-CUE-201 is a still dot in the theme brand colour once the changes stop, in the light and in the dark theme, and ACC-CUE-29 leaves a fade duration after the tab comes to the front', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    const other = `${tmpPath}/other.md`;
    await page.contents.uploadContent(INITIAL, 'text', path);
    await page.contents.uploadContent(INITIAL, 'text', other);
    await openPreview(page, path);
    await openPreview(page, other);

    await page.contents.uploadContent(REWRITTEN, 'text', path);
    const tab = page.locator(`.lm-TabBar-tab.${UPDATED}`);
    await expect(tab).toHaveCount(1, { timeout: 20000 });
    await expect(tab).toHaveClass(new RegExp(ACTIVE));
    const turning = await markerStyle(page, UPDATED);
    expect(turning.content).toMatch(EITHER_FRAME);
    expect(turning.animationName).toBe('jp-AdvancedMd-tab-turn');

    // The writer is quiet and nobody has looked: the marker is a dot in the
    // theme brand colour 7 px across, a box with no character, and it does
    // not move.
    await expect(page.locator(`.lm-TabBar-tab.${UNREAD}`)).toHaveCount(1, {
      timeout: 10000
    });
    const unread = await markerStyle(page, UPDATED);
    expect(unread.content).toBe(NO_CHARACTER);
    expect(unread.width).toBe('7px');
    expect(unread.height).toBe('7px');
    expect(unread.borderRadius).toBe('50%');
    expect(unread.backgroundColor).toBe(await brandColour(page));
    expect(unread.animationName).toBe('none');
    // The dot is shorter than the line of the tab, so the tab is as high
    // with the dot as it was with the half circle.
    expect(unread.tabHeight).toBe(turning.tabHeight);

    // The dark theme gives the dot its own brand colour. The theme is a
    // setting, and galata keeps the settings of a test in memory for that
    // test alone, so the cases after this one open in the light theme again.
    await page.theme.setDarkTheme();
    await expect
      .poll(async () => {
        const dot = (await markerStyle(page, UPDATED)).backgroundColor;
        return dot === (await brandColour(page));
      })
      .toBe(true);
    // A forced-colours mode would paint the box in the colour of the tab;
    // the dot keeps the theme brand colour there.
    await page.emulateMedia({ forcedColors: 'active' });
    expect((await markerStyle(page, UPDATED)).backgroundColor).toBe(
      await brandColour(page)
    );
    await page.emulateMedia({ forcedColors: 'none' });
    // ACC-CUE-202: the unread marker says in words what it means.
    expect(await tab.getAttribute('title')).toContain(
      'while this tab was behind another'
    );

    // Past the time a tab in front would have kept it: it waits for the
    // reader on a tab behind.
    await page.waitForTimeout(FADE + 1000);
    await expect(tab).toHaveCount(1);

    // Selecting the tab is enough. The unread marker becomes the half circle at
    // once, and the marker stays for a fade duration, then goes, with no
    // click, key or scroll in the document.
    await tab.click();
    const selected = Date.now();
    await expect(page.locator(`.lm-TabBar-tab.${UNREAD}`)).toHaveCount(0);
    await expect(tab).toHaveCount(1);
    expect((await markerStyle(page, UPDATED)).content).toBe(CIRCLE);
    await expect(tab).toHaveCount(0, { timeout: FADE + 5000 });
    expect(Date.now() - selected).toBeGreaterThan(FADE - 500);
  });

  test('DEF-CUE-130 gives no unread marker to a change the reader watched, and takes its marker away on time', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    const other = `${tmpPath}/other.md`;
    await page.contents.uploadContent(INITIAL, 'text', path);
    await page.contents.uploadContent(INITIAL, 'text', other);
    await openPreview(page, path);
    // Every class change on the page is watched, so an unread marker shown at any
    // moment is seen, not only one that is there when the test looks.
    await page.evaluate((unread: string) => {
      (window as any).__sawUnread = false;
      new MutationObserver(() => {
        if (document.querySelector(`.lm-TabBar-tab.${unread}`)) {
          (window as any).__sawUnread = true;
        }
      }).observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      });
    }, UNREAD);

    await page.contents.uploadContent(REWRITTEN, 'text', path);
    const tab = page.locator(`.lm-TabBar-tab.${UPDATED}`);
    await expect(tab).toHaveCount(1, { timeout: 20000 });
    // The tab was in front while the change arrived. The reader now selects
    // another tab, before the marker has left.
    await openPreview(page, other);
    await expect(tab).toHaveCount(1);
    await expect(tab).toHaveCount(0, { timeout: FADE + 8000 });
    expect(await page.evaluate(() => (window as any).__sawUnread)).toBe(false);
  });
});

test.describe('the marker of a change held back', () => {
  test.use({ mockSettings: settings() });

  test('is a still red square with a tooltip, telling itself apart from the arriving circle', async ({
    page,
    tmpPath
  }) => {
    await twoStates(page, tmpPath);

    const blocked = await markerStyle(page, BLOCKED);
    const arriving = await markerStyle(page, UPDATED);

    expect(blocked.content).toBe(SQUARE);
    expect(blocked.color).toBe(BLOCKED_COLOUR);
    // It stands still and nudges once every eight seconds rather than turning.
    expect(blocked.animationName).toBe('jp-AdvancedMd-tab-nudge');
    expect(blocked.animationDuration).toBe('8s');

    // The two states differ in all three: shape, colour and motion.
    expect(blocked.content).not.toBe(arriving.content);
    expect(blocked.color).not.toBe(arriving.color);
    expect(blocked.animationName).not.toBe(arriving.animationName);

    // Lumino writes the caption of the widget title onto the tab, so the
    // tooltip names the state and what it asks the reader for.
    const tooltip = await page
      .locator(`.lm-TabBar-tab.${BLOCKED}`)
      .getAttribute('title');
    expect(tooltip).toContain('unsaved edits');
    // Reload from Disk takes the held change (DEF-CUE-79, DEF-CUE-85); a save
    // drops it (DEF-CUE-74), and the File menu's Revert to Checkpoint writes
    // the checkpoint over it (DEF-CUE-75), so neither is named.
    expect(tooltip).toContain('choose Reload Markdown File from Disk');
    expect(tooltip).not.toContain('Revert');
  });
});

/**
 * The text of every rendered preview on the page, whether its tab is in front
 * or behind, so a write to a document that is not in front can be waited for.
 */
const renderedText = (page: any): Promise<string> =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('.jp-RenderedMarkdown'))
      .map(node => node.textContent ?? '')
      .join(' ')
  );

test.describe('the markers under reduced motion', () => {
  test.use({ mockSettings: settings() });

  test('DEF-CUE-68 keep turning and keep their shapes', async ({
    page,
    tmpPath
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await page.evaluate(
        () => matchMedia('(prefers-reduced-motion: reduce)').matches
      )
    ).toBe(true);

    await twoStates(page, tmpPath);

    // A writer at work on a machine reporting the preference: the marker of
    // the arriving change turns at the fast speed on every write. The browser
    // preference is not this extension's switch, because a Windows host
    // reports it to every page whenever its own animation switch is off.
    const arrivingPath = `${tmpPath}/arriving.md`;
    for (let i = 1; i <= 3; i++) {
      await page.contents.uploadContent(
        `${REWRITTEN}\nWrite ${i}.\n`,
        'text',
        arrivingPath
      );
      await expect
        .poll(() => renderedText(page), { timeout: 20000 })
        .toContain(`Write ${i}.`);
      const turning = await markerStyle(page, UPDATED);
      expect(turning.content).toMatch(EITHER_FRAME);
      expect(turning.animationName).toBe('jp-AdvancedMd-tab-turn');
      expect(turning.animationDuration).toMatch(/^(2|1\.5|1|0\.5)s$/);
    }

    await alsoGone(page, tmpPath);
    // The third preview is in front now, so once the writer is quiet the
    // marker of the arriving change is that of a change nobody looked at.
    await expect(page.locator(`.lm-TabBar-tab.${UNREAD}`)).toHaveCount(1, {
      timeout: 10000
    });

    const arriving = await markerStyle(page, UPDATED);
    const blocked = await markerStyle(page, BLOCKED);
    const gone = await markerStyle(page, MISSING);

    // Each marker keeps its own shape, and its own amount of movement: the
    // arriving circle alternated while the changes arrived and now stands
    // as the dot in the theme brand colour, the held square nudges, the
    // cross of a file gone from disk stands still because nothing is waiting
    // behind it.
    expect(arriving.content).toBe(NO_CHARACTER);
    expect(arriving.width).toBe('7px');
    expect(arriving.height).toBe('7px');
    expect(arriving.borderRadius).toBe('50%');
    expect(arriving.backgroundColor).toBe(await brandColour(page));
    expect(blocked.content).toBe(SQUARE);
    expect(gone.content).toBe(CROSS);
    expect(arriving.animationName).toBe('none');
    expect(blocked.animationName).toBe('jp-AdvancedMd-tab-nudge');
    expect(gone.animationName).toBe('none');
    expect(blocked.color).toBe(BLOCKED_COLOUR);
    expect(gone.color).toBe(BLOCKED_COLOUR);
  });
});
