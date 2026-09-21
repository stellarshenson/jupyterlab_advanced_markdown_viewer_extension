/**
 * The two colours a mark's swatch is drawn in: the rim, and the fill it
 * holds.
 *
 * A swatch is not the wash a mark lays on the page. That wash is a tenth or
 * a fifth of an alpha, close to the page by design (ACC-NOTES-134), and on a
 * ten pixel square it is not a colour anybody can name. A swatch carries
 * information, so its rim is held to the three to one a graphical object is
 * asked for (ACC-NOTES-177), worked out against the background the page
 * actually carries so a theme this extension has never seen is covered.
 *
 * The bar belongs on the rim alone. Held to it the fill stops being the hue:
 * on the light theme yellow arrives as the olive #9c890a and green as
 * #179f26, and six of those in a column pull the eye off the text
 * (DEF-NOTES-112).
 *
 * So the fill is the mark's own colour at an alpha, and the rim is the one
 * held to the bar. The alpha dims a dark page's square - every step of it is
 * a step toward the page's own colour, so brightness and colour come down
 * together and the hue survives - and the browser composites it against
 * whatever is actually behind it, which is the panel, the selected row or
 * the Mark submenu, three surfaces a single worked-out colour cannot serve
 * at once (DEF-NOTES-113). On a light page an alpha dilutes rather than
 * dims, so there the fill is the hue walked in lightness, as it was.
 *
 * Nothing is written per theme: which of the two the page takes, the alpha
 * itself and every bar are read from the backgrounds the page carries.
 */

import { MARK_COLOURS, MarkColour } from './marks';

/** What a swatch's rim stands at against the background behind it. */
export const MIN_CONTRAST = 3;

/**
 * What a swatch's fill stands at against that same background. It is not an
 * accessibility bar - the rim answers WCAG 1.4.11 for the whole object - but
 * the floor that keeps the fill from washing into the page.
 */
export const MIN_FILL = 1.5;

/**
 * How far a swatch's edge stands from the fill it encloses. The edge is
 * darker than the fill on a dark page at the Star Colonel's instruction, and
 * nothing darker than the panel can reach the three to one a boundary is
 * otherwise asked for - the panel's own luminance puts that colour at
 * -0.0285, which no colour has - so the edge is measured against the fill it
 * borders instead (DEF-NOTES-113).
 */
export const RIM_EDGE = 1.25;

/**
 * How finely the alpha of a fill is looked for: in whole percent, which is
 * the unit the stylesheet carries it in. Looking finer and rounding to the
 * percent afterwards can round the answer back below the floor it was
 * chosen to clear.
 */
const ALPHAS = 100;

/**
 * The background luminance at which black and white give the same ratio.
 * Above it the page is light and the swatch is walked darker, below it
 * lighter.
 */
const CROSSOVER = 0.179;

/**
 * How finely the lightness is walked, in steps of a thousandth. A hundredth
 * stepped over feasible colours where the band that clears both backgrounds
 * was narrower than the step: measured over 22446 background pairs, a
 * hundredth missed 26 and a thousandth missed none.
 */
const STEPS = 1000;

/**
 * The three backgrounds a swatch is drawn on: a panel row, a selected one,
 * and the Mark submenu, which is painted on --jp-layout-color0.
 *
 * The menu was left out while the fill had a floor and nothing else, on the
 * grounds that it lies further out on the same ramp and so can only stand
 * further from a swatch that already cleared the floor. That holds for a
 * floor and fails for a ceiling: standing further is the thing a ceiling
 * forbids, and a fill worked out against the panel alone was measured at 6.6
 * to 1 in the menu against a ceiling of 5 (DEF-NOTES-113).
 */
const BACKGROUNDS = [
  '--jp-layout-color0',
  '--jp-layout-color1',
  '--jp-layout-color2'
];

/**
 * The hue of each mark colour, the light-theme rgb of style/base.css before
 * its alpha is applied. A stylesheet test holds the two together.
 */
export const HUE: Record<MarkColour, string> = {
  yellow: '#f0d40f',
  blue: '#0f70f0',
  pink: '#f631b1',
  orange: '#f19422',
  red: '#e61e46',
  green: '#1ed232'
};

/** The custom property a swatch's rim of one colour is painted from. */
export function swatchProperty(colour: MarkColour): string {
  return `--jp-AdvancedMd-swatch-${colour}`;
}

/** The custom property a swatch's fill of one colour is painted from. */
export function swatchFillProperty(colour: MarkColour): string {
  return `--jp-AdvancedMd-swatch-fill-${colour}`;
}

/**
 * The custom property a swatch's edge of one colour is painted from. It is
 * not the same as the rim colour above: that one stands at the bar and is
 * what the bar of an unanchored mark takes (ACC-NOTES-180), where this one
 * may be a transparency of the hue that only has to be told from the fill.
 */
export function swatchEdgeProperty(colour: MarkColour): string {
  return `--jp-AdvancedMd-swatch-edge-${colour}`;
}

/** A colour as its three channels, 0 to 255. */
type Rgb = [number, number, number];

/**
 * The channels of a colour written as a hex triple or as rgb(), which is
 * what a computed style reads back. Null for anything else - a property that
 * is not set, and a colour carrying an alpha, which is not the colour a
 * swatch is seen against.
 */
export function parse(colour: string): Rgb | null {
  const text = colour.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map(digit => digit + digit)
            .join('')
        : hex[1];
    return [0, 2, 4].map(at => parseInt(digits.slice(at, at + 2), 16)) as Rgb;
  }
  const channels = /^rgba?\(([^)]*)\)$/i.exec(text);
  if (!channels) {
    return null;
  }
  const parts = channels[1].split(/[\s,/]+/).filter(part => part !== '');
  const channel = parts.slice(0, 3).map(Number);
  if (channel.length < 3 || channel.some(part => isNaN(part))) {
    return null;
  }
  // A translucent background is not the colour a swatch is seen against, so
  // it is no answer at all: better the stylesheet's fallback than a walk
  // against a colour nobody is looking at. Transparent reads as rgba(0,0,0,0)
  // and would otherwise be taken for black.
  const alpha = parts[3];
  if (alpha !== undefined && alpha !== '1' && alpha !== '100%') {
    return null;
  }
  return channel as Rgb;
}

/** A colour as the hex triple a stylesheet takes. */
function hex(colour: Rgb): string {
  return `#${colour
    .map(channel => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** The relative luminance of a colour, as the contrast formula defines it. */
function luminance(colour: Rgb): number {
  const [red, green, blue] = colour.map(channel => {
    const part = channel / 255;
    return part <= 0.03928
      ? part / 12.92
      : Math.pow((part + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** How far two colours stand apart, as a ratio of 1 to 21. */
export function contrast(one: Rgb, other: Rgb): number {
  const [high, low] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

/** A colour as hue, saturation and lightness, each 0 to 1. */
function toHsl(colour: Rgb): [number, number, number] {
  const [red, green, blue] = colour.map(channel => channel / 255);
  const high = Math.max(red, green, blue);
  const low = Math.min(red, green, blue);
  const lightness = (high + low) / 2;
  const span = high - low;
  if (span === 0) {
    return [0, 0, lightness];
  }
  const saturation = span / (1 - Math.abs(2 * lightness - 1));
  const hue =
    high === red
      ? ((green - blue) / span + (green < blue ? 6 : 0)) / 6
      : high === green
        ? ((blue - red) / span + 2) / 6
        : ((red - green) / span + 4) / 6;
  return [hue, saturation, lightness];
}

/** The channels of a hue, saturation and lightness. */
function fromHsl(hue: number, saturation: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = hue * 6;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const base = lightness - chroma / 2;
  const table: Rgb[] = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second]
  ];
  const parts = table[Math.min(5, Math.floor(sector))];
  return parts.map(part => (part + base) * 255) as Rgb;
}

/** Whether the page behind a swatch is a light one. */
function pageIsLight(backgrounds: Rgb[]): boolean {
  return backgrounds.some(background => luminance(background) > CROSSOVER);
}

/** A colour laid over a background at an alpha, as the browser composites it. */
export function composite(colour: Rgb, alpha: number, background: Rgb): Rgb {
  return colour.map((part, at) =>
    Math.round(alpha * part + (1 - alpha) * background[at])
  ) as Rgb;
}

/**
 * The smallest alpha, in whole percent, at which the hue laid over every one
 * of the backgrounds still stands at the bar - or null where none does.
 *
 * An alpha is a dimmer on a dark page: every step of it is a step toward the
 * page's own colour, so the square loses brightness and colour together and
 * keeps the hue it is named after. On a light page the same step dilutes
 * instead, and the answer is refused there rather than washed out.
 */
function alphaAt(hue: Rgb, backgrounds: Rgb[], bar: number): number | null {
  if (pageIsLight(backgrounds)) {
    return null;
  }
  for (let percent = 1; percent <= ALPHAS; percent++) {
    const stands = backgrounds.every(
      background =>
        contrast(composite(hue, percent / ALPHAS, background), background) >=
        bar
    );
    if (stands) {
      return percent;
    }
  }
  return null;
}

/** How far a colour stands from the nearest of the backgrounds behind it. */
function worst(colour: Rgb, backgrounds: Rgb[]): number {
  return Math.min(
    ...backgrounds.map(background => contrast(colour, background))
  );
}

/**
 * The hue walked in lightness until it stands at the given bar against
 * every background. The walk sets off away from the background and turns
 * round where that direction does not reach the bar, which takes backgrounds
 * on both sides of the crossover. It stops at the first colour that clears
 * the bar, so a hue already clear of it is handed back untouched: that is
 * every hue on a dark page, and five of the six fills on a light one.
 *
 * Where the walk finds nothing the mark's own colour is handed back
 * unwalked. That takes one background below a tenth of the luminance scale
 * and another above three tenths; the best available colour is then the same
 * one for every hue, and six swatches of one colour carry nothing at all,
 * where six dim ones still name their mark. The walk stepping over a band
 * thinner than its own step is the other way to reach it, which is why the
 * step is a thousandth.
 */
export function contrasting(
  hue: string,
  backgrounds: Rgb[],
  bar: number = MIN_CONTRAST
): string {
  const start = parse(hue)!;
  if (backgrounds.length === 0) {
    return hex(start);
  }
  const [angle, saturation, lightness] = toHsl(start);
  const darker = backgrounds.every(
    background => luminance(background) > CROSSOVER
  );
  for (const direction of darker ? [-1, 1] : [1, -1]) {
    for (let step = 0; step <= STEPS; step++) {
      const walked = lightness + (direction * step) / STEPS;
      // Rounded here, not at the end: the bar has to be met by the colour
      // the page is painted with, and a channel rounded afterwards can drop
      // the ratio by a hundredth, which is enough to miss three to one.
      const candidate = fromHsl(
        angle,
        saturation,
        Math.min(1, Math.max(0, walked))
      ).map(Math.round) as Rgb;
      if (worst(candidate, backgrounds) >= bar) {
        return hex(candidate);
      }
    }
  }
  return hex(start);
}

/**
 * The colour a CSS token names. A hex triple and an rgb() are read straight
 * off; anything else - a keyword such as the white the stock light theme
 * gives --jp-layout-color1, an hsl(), a colour function this code has never
 * heard of - is painted on a hidden probe inside the host and read back,
 * which a browser hands over as rgb() for every colour it can express that
 * way. Null for the rest: an unset property, a token the browser will not
 * take, and one it hands back in its own notation.
 */
function resolve(host: HTMLElement, token: string): Rgb | null {
  const text = token.trim();
  const direct = parse(text);
  if (direct || text === '') {
    return direct;
  }
  const probe = document.createElement('span');
  probe.style.display = 'none';
  probe.style.color = text;
  if (probe.style.color === '') {
    return null;
  }
  host.appendChild(probe);
  const painted = getComputedStyle(probe).color;
  probe.remove();
  const resolved = parse(painted);
  if (!resolved) {
    // A colour the browser keeps in its own notation on readback, oklch()
    // among them. The swatches fall back to the stylesheet, which is the
    // light theme's answer and stands below the bar on a dark page, so the
    // degrade is said out loud rather than left to be measured.
    console.warn(
      `Could not read the background ${text} the theme carries; ` +
        'mark swatch contrast is worked out without it.'
    );
  }
  return resolved;
}

/** The two backgrounds the stock light theme carries, which the stylesheet
 * fallbacks and the menu icon are worked out against. */
const LIGHT_BACKGROUNDS: Rgb[] = [
  [255, 255, 255],
  [238, 238, 238]
];

/**
 * The fill of a swatch.
 *
 * On a dark page it is the mark's own colour at full saturation, given an
 * alpha, so the browser composites it against whatever is actually behind
 * it: the panel, the selected row, or the Mark submenu, which is painted on
 * --jp-layout-color0 and is darker than either. One value holds its distance
 * on all three, where a colour worked out against the panel alone stood at
 * 6.6 to 1 in the menu (DEF-NOTES-113). The alpha is the smallest that keeps
 * the square off every one of them.
 *
 * On a light page there is no alpha to be had: laying a hue over white at
 * anything under full strength dilutes it rather than dimming it, and the
 * square washes out. The hue is walked in lightness there, as it was before.
 */
export function swatchFilling(hue: string, backgrounds: Rgb[]): string {
  if (backgrounds.length === 0) {
    return hue;
  }
  const percent = alphaAt(parse(hue)!, backgrounds, MIN_FILL);
  if (percent === null) {
    return contrasting(hue, backgrounds, MIN_FILL);
  }
  const [red, green, blue] = parse(hue)!;
  return `rgb(${red} ${green} ${blue} / ${percent}%)`;
}

/**
 * The colour of a swatch that stands at the bar: the hue walked in lightness
 * until it clears MIN_CONTRAST against every background behind it.
 *
 * It is the swatch's edge on a light page, and it is what the bar of an
 * unanchored mark is painted in wherever the theme (ACC-NOTES-180), that bar
 * being three pixels wide with no inside to fill and nothing but its colour
 * to show. It cannot be the hue at an alpha: on the dark theme's selected
 * row blue, pink and red do not reach three to one at full strength -
 * 2.20, 2.87 and 2.22 - so an alpha has no answer there and the walk, which
 * may leave the hue's own lightness, is the only thing that carries it.
 */
export function swatchBarring(hue: string, backgrounds: Rgb[]): string {
  return contrasting(hue, backgrounds, MIN_CONTRAST);
}

/**
 * The edge of a swatch: the 1 px rim drawn inside the square.
 *
 * On a light page it is the colour above, which stands at the bar and is
 * darker than the fill there in any case. On a dark page it is the same hue
 * at a lower alpha than the fill, so it sits between the fill and the panel
 * and reads as a darker edge rather than a brighter one. Being the same hue
 * over the same panel, it stays darker than the fill on every backdrop the
 * square is drawn on, and it is held to RIM_EDGE against that fill.
 *
 * Where no lower alpha is far enough from the fill - which takes a fill so
 * faint there is no room under it - the fill is handed back and the square
 * carries no edge at all, rather than an edge nobody can see.
 */
export function swatchRimming(hue: string, backgrounds: Rgb[]): string {
  const colour = parse(hue);
  const fill =
    colour && backgrounds.length > 0
      ? alphaAt(colour, backgrounds, MIN_FILL)
      : null;
  if (fill === null || !colour) {
    return swatchBarring(hue, backgrounds);
  }
  for (let percent = fill - 1; percent >= 0; percent--) {
    const apart = backgrounds.every(
      background =>
        contrast(
          composite(colour, percent / ALPHAS, background),
          composite(colour, fill / ALPHAS, background)
        ) >= RIM_EDGE
    );
    if (apart) {
      const [red, green, blue] = colour;
      return `rgb(${red} ${green} ${blue} / ${percent}%)`;
    }
  }
  return swatchFilling(hue, backgrounds);
}

/**
 * The colour a swatch's rim falls back to where the properties are not on
 * the page: the light theme's own answer, which is what the stylesheet
 * names.
 */
export function swatchFallback(colour: MarkColour): string {
  return swatchBarring(HUE[colour], LIGHT_BACKGROUNDS);
}

/** The colour a swatch's edge falls back to, the light theme's answer again. */
export function swatchEdgeFallback(colour: MarkColour): string {
  return swatchRimming(HUE[colour], LIGHT_BACKGROUNDS);
}

/** The colour a swatch's fill falls back to, the light theme's answer again. */
export function swatchFillFallback(colour: MarkColour): string {
  return swatchFilling(HUE[colour], LIGHT_BACKGROUNDS);
}

/**
 * Paint the twelve swatch properties on the host - a rim and a fill for each
 * of the six colours - from the backgrounds the host carries now. Called
 * when the extension starts and whenever the theme changes. Where no
 * background can be read the properties are taken off the host rather than
 * guessed at, so the fallbacks stand: those are the light theme's answers,
 * where the unwalked hue would stand below the rim bar.
 */
export function applySwatchColours(host: HTMLElement): void {
  const style = getComputedStyle(host);
  const backgrounds = BACKGROUNDS.map(name =>
    resolve(host, style.getPropertyValue(name))
  ).filter((background): background is Rgb => background !== null);
  for (const colour of MARK_COLOURS) {
    const painters: [string, (hue: string, on: Rgb[]) => string][] = [
      [swatchProperty(colour), swatchBarring],
      [swatchEdgeProperty(colour), swatchRimming],
      [swatchFillProperty(colour), swatchFilling]
    ];
    for (const [property, paint] of painters) {
      if (backgrounds.length === 0) {
        host.style.removeProperty(property);
        continue;
      }
      host.style.setProperty(property, paint(HUE[colour], backgrounds));
    }
  }
}
