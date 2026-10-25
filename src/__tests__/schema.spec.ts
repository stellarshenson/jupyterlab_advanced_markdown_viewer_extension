/**
 * The settings declaration JupyterLab validates user settings against.
 *
 * The settings editor lists the four settings a reader changes for
 * themselves; the other seven are server options the frontend reads from the
 * page config. Every declared setting has a type and the default the code
 * falls back to, and a key the schema does not declare is accepted, so a
 * user settings file that still holds a removed setting loads.
 *
 * The file the package ships is read here, so this test sees exactly what
 * JupyterLab loads, and the defaults are imported from src/controller.ts
 * rather than restated, so code that stopped agreeing with the declaration
 * fails here.
 */

import plugin from '../../schema/plugin.json';

import { DEFAULT_SETTINGS, HIGHLIGHT_VISIBILITIES } from '../controller';
import { COMMANDS } from '../index';
import { DEFAULT_AUTHOR } from '../notes';

// src/index.ts is the plugin declaration, so importing the commands from it
// also loads the packages the declaration names its tokens from, and one of
// those ships JavaScript jest cannot parse. The tokens are named here and
// never called, so an empty module in their place is enough.
jest.mock('@jupyterlab/application', () => ({}));
jest.mock('@jupyterlab/apputils', () => ({}));
jest.mock('@jupyterlab/markdownviewer', () => ({}));
jest.mock('@jupyterlab/settingregistry', () => ({}));

/**
 * The validator the settings registry runs over a user settings file.
 */
const { DefaultSchemaValidator } = jest.requireActual(
  '@jupyterlab/settingregistry'
) as typeof import('@jupyterlab/settingregistry');

/**
 * One declared setting, as far as this test reads it.
 */
interface IDeclaration {
  title?: string;
  type?: string;
  description?: string;
  default?: unknown;
}

const schema = plugin as {
  'jupyter.lab.shortcuts': unknown[];
  properties: Record<string, IDeclaration>;
};

const declarations = Object.entries(schema.properties);

describe('the settings schema', () => {
  it('declares the four settings the editor lists, each described in at most two sentences', () => {
    const defaults: Record<string, unknown> = {};
    const types: Record<string, string> = {};
    for (const [key, declaration] of declarations) {
      defaults[key] = declaration.default;
      types[key] = declaration.type ?? 'none';
      // A sentence ends with a full stop and a space or the end of the text.
      expect(
        declaration.description?.match(/\.(\s|$)/g)?.length
      ).toBeLessThanOrEqual(2);
    }
    const keys = ['enabled', 'animation', 'highlight', 'author'] as const;
    expect(Object.keys(defaults)).toEqual(keys);
    expect(declarations.map(([, declaration]) => declaration.title)).toEqual([
      'Enabled',
      'Animate changes',
      'Highlight changes',
      'Note handle'
    ]);
    for (const key of keys) {
      expect(defaults[key]).toEqual(DEFAULT_SETTINGS[key]);
      expect(types[key]).toBe(typeof DEFAULT_SETTINGS[key]);
    }
  });

  it('names the default handle in the author setting it describes', () => {
    // The description tells the reader what an empty setting writes, and
    // the word it names is the one the code writes, so retuning the
    // constant cannot leave the settings editor saying the old one.
    expect(schema.properties.author.description).toContain(
      `@${DEFAULT_AUTHOR}`
    );
  });

  it('accepts a settings file holding a removed key', () => {
    // The keys an older release declared, as a user settings file written
    // then still holds them. The registry refuses the whole file when the
    // validator reports an error, so none may be reported.
    const user = {
      enabled: false,
      pollInterval: 1,
      fadeDuration: 30000,
      animationSpeed: 80,
      animationJitter: 0.25,
      highlightVisibility: 'medium',
      tabCue: false,
      notes: false
    };
    const settings = {
      // The key the validator files the schema under; the plugin id would be
      // read as a URI whose scheme the validator's URI parser refuses.
      id: 'plugin',
      raw: JSON.stringify(user),
      schema: plugin,
      data: { composite: {}, user: {} },
      version: ''
    };

    expect(
      new DefaultSchemaValidator().validateData(settings as any)
    ).toBeNull();
    // The kept setting in the same file still applies.
    expect(settings.data.composite).toMatchObject({ enabled: false });
  });

  /**
   * ACC-ANIM-143. A fresh install animates: nothing has to be switched on and
   * the speed is not the crawl the first releases shipped. The schema carries
   * only the switch; the speed and the jitter are the code's own defaults.
   */
  it('animates a change out of the box, at 75 characters per second with a quarter of jitter', () => {
    expect(schema.properties.animation.default).toBe(true);
    expect(DEFAULT_SETTINGS.animation).toBe(true);
    expect(DEFAULT_SETTINGS.animationSpeed).toBe(75);
    expect(DEFAULT_SETTINGS.animationJitter).toBe(0.25);
  });

  /**
   * ACC-HILITE-21. The highlight stays five seconds once the change has
   * finished arriving.
   */
  it('keeps a highlight for five seconds out of the box', () => {
    expect(DEFAULT_SETTINGS.fadeDuration).toBe(5000);
  });

  /**
   * ACC-HILITE-140. The code knows the three strengths, faintest first, and
   * starts at the middle one.
   */
  it('knows the three highlight strengths and starts at the middle one', () => {
    expect(HIGHLIGHT_VISIBILITIES).toEqual(['low', 'medium', 'high']);
    expect(DEFAULT_SETTINGS.highlightVisibility).toBe('medium');
  });

  it('binds the mark-selection command over the preview', () => {
    // The keydown lands on the viewer node, which is focusable and is what a
    // click in the preview or a Tab focuses, so the binding is scoped to it.
    expect(schema['jupyter.lab.shortcuts']).toEqual([
      {
        command: COMMANDS.markSelection,
        keys: ['Accel Shift M'],
        selector: '.jp-MarkdownViewer'
      }
    ]);
  });
});
