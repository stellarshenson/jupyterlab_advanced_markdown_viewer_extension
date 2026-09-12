/**
 * The settings declaration JupyterLab validates user settings against.
 *
 * The settings editor refuses a value because the schema says what that
 * setting must be, so the validation is the declaration: every setting the
 * extension reads is declared, with a type, with the default the code falls
 * back to, and, for a number, with the lowest value the code accepts. Anything
 * the schema does not declare is refused outright.
 *
 * The file the package ships is read here, so this test sees exactly what
 * JupyterLab loads, and the minimums the code refuses a value below are
 * imported from src/index.ts rather than restated, so code that stopped
 * agreeing with the declaration fails here.
 */

import plugin from '../../schema/plugin.json';

import {
  DEFAULT_SETTINGS,
  HIGHLIGHT_VISIBILITIES,
  ILiveViewSettings
} from '../controller';
import { COMMANDS, MINIMUMS } from '../index';

// src/index.ts is the plugin declaration, so importing the minimums from it
// also loads the packages the declaration names its tokens from, and one of
// those ships JavaScript jest cannot parse. The tokens are named here and
// never called, so an empty module in their place is enough.
jest.mock('@jupyterlab/application', () => ({}));
jest.mock('@jupyterlab/apputils', () => ({}));
jest.mock('@jupyterlab/markdownviewer', () => ({}));
jest.mock('@jupyterlab/settingregistry', () => ({}));

/**
 * One declared setting, as far as this test reads it.
 */
interface IDeclaration {
  type?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  oneOf?: { const: string; title: string }[];
}

const schema = plugin as {
  'jupyter.lab.shortcuts': unknown[];
  additionalProperties?: boolean;
  properties: Record<string, IDeclaration>;
};

const declarations = Object.entries(schema.properties);

describe('the settings schema', () => {
  it('declares every setting the extension reads, with its default', () => {
    const defaults: Record<string, unknown> = {};
    for (const [key, declaration] of declarations) {
      defaults[key] = declaration.default;
    }
    expect(defaults).toEqual(DEFAULT_SETTINGS);
  });

  it('declares a type for every setting, agreeing with the code', () => {
    const declared: Record<string, string> = {};
    const expected: Record<string, string> = {};
    for (const [key, declaration] of declarations) {
      // An integer is a number the editor also refuses a fraction for.
      declared[key] =
        declaration.type === 'integer'
          ? 'number'
          : (declaration.type ?? 'none');
      expected[key] = typeof DEFAULT_SETTINGS[key as keyof ILiveViewSettings];
    }
    expect(declared).toEqual(expected);
  });

  it('gives every numeric setting the lowest value the code accepts', () => {
    const minimums: Record<string, number | undefined> = {};
    for (const [key, declaration] of declarations) {
      if (declaration.type === 'number' || declaration.type === 'integer') {
        minimums[key] = declaration.minimum;
        expect(declaration.default).toBeGreaterThanOrEqual(
          declaration.minimum as number
        );
      }
    }
    expect(minimums).toEqual(MINIMUMS);
  });

  /**
   * ACC-ANIM-143. A fresh install animates: nothing has to be switched on and
   * the speed is not the crawl the first releases shipped. The number is
   * asserted on both sides rather than only compared, so raising one of them
   * alone is reported here instead of passing quietly.
   */
  it('animates a change out of the box, at 75 characters per second with a quarter of jitter', () => {
    expect(schema.properties.animation.default).toBe(true);
    expect(DEFAULT_SETTINGS.animation).toBe(true);
    expect(schema.properties.animationSpeed.default).toBe(75);
    expect(DEFAULT_SETTINGS.animationSpeed).toBe(75);
    expect(schema.properties.animationJitter.default).toBe(0.25);
    expect(DEFAULT_SETTINGS.animationJitter).toBe(0.25);
    expect(schema.properties.animationJitter.maximum).toBe(1);
  });

  /**
   * ACC-HILITE-21. The highlight stays five seconds once the change has
   * finished arriving, on both sides for the same reason as above.
   */
  it('keeps a highlight for five seconds out of the box', () => {
    expect(schema.properties.fadeDuration.default).toBe(5000);
    expect(DEFAULT_SETTINGS.fadeDuration).toBe(5000);
  });

  /**
   * ACC-HILITE-140. The editor offers exactly the three choices the code
   * knows, in the code's own order, and opens on the middle one.
   */
  it('offers the three highlight strengths and starts at the middle one', () => {
    // Each strength is declared with the label the settings editor shows, so
    // the reader chooses Low, Medium or High rather than the code's own word.
    expect(
      schema.properties.highlightVisibility.oneOf?.map(entry => entry.const)
    ).toEqual(HIGHLIGHT_VISIBILITIES);
    expect(
      schema.properties.highlightVisibility.oneOf?.map(entry => entry.title)
    ).toEqual(['Low', 'Medium', 'High']);
    expect(schema.properties.highlightVisibility.default).toBe('medium');
    expect(DEFAULT_SETTINGS.highlightVisibility).toBe('medium');
  });

  it('refuses a setting it does not declare', () => {
    expect(schema.additionalProperties).toBe(false);
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
