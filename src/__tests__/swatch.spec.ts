import { MARK_COLOURS, MarkColour } from '../marks';
import {
  applySwatchColours,
  contrast,
  contrasting,
  HUE,
  MIN_CONTRAST,
  MIN_FILL,
  parse,
  swatchFillProperty,
  swatchProperty
} from '../swatch';

/** The two backgrounds a panel carries in the stock light theme. */
const LIGHT = [parse('#ffffff')!, parse('#eeeeee')!];

/** The two it carries in the stock dark theme. */
const DARK = [parse('#212121')!, parse('#424242')!];

/** A colour as hue, saturation and lightness, for the assertions below. */
function hsl(colour: string): [number, number, number] {
  const [red, green, blue] = parse(colour)!.map(channel => channel / 255);
  const high = Math.max(red, green, blue);
  const low = Math.min(red, green, blue);
  const lightness = (high + low) / 2;
  const span = high - low;
  if (span === 0) {
    return [0, 0, lightness];
  }
  const hue =
    high === red
      ? ((green - blue) / span + (green < blue ? 6 : 0)) / 6
      : high === green
        ? ((blue - red) / span + 2) / 6
        : ((red - green) / span + 4) / 6;
  return [hue, span / (1 - Math.abs(2 * lightness - 1)), lightness];
}

describe('the colour a swatch is drawn in', () => {
  it('stands at three to one, the bar a graphical object is asked for', () => {
    // Pinned as a number: every case below reads the constant, so a change
    // to it would move the bar and the cases with it (ACC-NOTES-177).
    expect(MIN_CONTRAST).toBe(3);
  });

  it('holds the fill to a floor that sits below the rim bar', () => {
    // The rim carries the bar a graphical object is asked for. The fill is
    // held only to the floor that keeps it off the page, because meeting the
    // bar with the fill costs the hue (DEF-NOTES-112).
    expect(MIN_FILL).toBe(1.5);
    expect(MIN_FILL).toBeLessThan(MIN_CONTRAST);
  });

  it('stands the fill at that floor against both backgrounds of each theme', () => {
    for (const colour of MARK_COLOURS) {
      for (const backgrounds of [LIGHT, DARK]) {
        const drawn = parse(contrasting(HUE[colour], backgrounds, MIN_FILL))!;
        for (const background of backgrounds) {
          expect(contrast(drawn, background)).toBeGreaterThanOrEqual(MIN_FILL);
        }
      }
    }
  });

  it('walks the fill no further from the hue than the rim goes', () => {
    for (const colour of MARK_COLOURS) {
      const [, , lightness] = hsl(HUE[colour]);
      for (const backgrounds of [LIGHT, DARK]) {
        const [, , fill] = hsl(contrasting(HUE[colour], backgrounds, MIN_FILL));
        const [, , rim] = hsl(contrasting(HUE[colour], backgrounds));
        expect(Math.abs(fill - lightness)).toBeLessThanOrEqual(
          Math.abs(rim - lightness)
        );
      }
    }
  });

  it('leaves every fill the hue itself on a dark page', () => {
    // Every mark colour clears the rim bar on a dark page unwalked, so both
    // colours of a swatch are the hue there and the square is a plain colour
    // chip. On a light page the floor moves yellow alone.
    for (const colour of MARK_COLOURS) {
      expect(contrasting(HUE[colour], DARK, MIN_FILL)).toBe(HUE[colour]);
    }
    const moved = MARK_COLOURS.filter(
      colour => contrasting(HUE[colour], LIGHT, MIN_FILL) !== HUE[colour]
    );
    expect(moved).toEqual(['yellow']);
  });

  it('stands at the bar against both backgrounds of the light theme', () => {
    for (const colour of MARK_COLOURS) {
      const drawn = parse(contrasting(HUE[colour], LIGHT))!;
      for (const background of LIGHT) {
        expect(contrast(drawn, background)).toBeGreaterThanOrEqual(
          MIN_CONTRAST
        );
      }
    }
  });

  it('stands at the bar against both backgrounds of the dark theme', () => {
    for (const colour of MARK_COLOURS) {
      const drawn = parse(contrasting(HUE[colour], DARK))!;
      for (const background of DARK) {
        expect(contrast(drawn, background)).toBeGreaterThanOrEqual(
          MIN_CONTRAST
        );
      }
    }
  });

  it('keeps the hue and the saturation of the mark colour', () => {
    for (const colour of MARK_COLOURS) {
      const [hue, saturation] = hsl(HUE[colour]);
      for (const backgrounds of [LIGHT, DARK]) {
        const [walked, kept] = hsl(contrasting(HUE[colour], backgrounds));
        expect(walked).toBeCloseTo(hue, 2);
        expect(kept).toBeCloseTo(saturation, 1);
      }
    }
  });

  it('walks a light colour darker on a light page and lighter on a dark one', () => {
    // Yellow is the case saturation cannot answer: at full saturation it
    // stands at 1.28 to 1 on a selected row in the light theme, because it
    // is a light colour (ACC-NOTES-177).
    expect(contrast(parse(HUE.yellow)!, LIGHT[1])).toBeLessThan(MIN_CONTRAST);
    expect(hsl(contrasting(HUE.yellow, LIGHT))[2]).toBeLessThan(
      hsl(HUE.yellow)[2]
    );
    expect(hsl(contrasting(HUE.red, DARK))[2]).toBeGreaterThan(hsl(HUE.red)[2]);
  });

  it('leaves a colour that already stands at the bar where it is', () => {
    expect(contrasting(HUE.blue, LIGHT)).toBe(HUE.blue);
    expect(contrasting(HUE.green, DARK)).toBe(HUE.green);
  });

  it('leaves the hue unwalked when no background can be read', () => {
    for (const colour of MARK_COLOURS) {
      expect(contrasting(HUE[colour], [])).toBe(HUE[colour]);
    }
  });

  it('turns the walk round where one direction cannot reach the bar', () => {
    // Backgrounds on both sides of the crossover: walking away from the
    // lighter one never reaches the bar, and running to the end of that
    // direction would hand every colour the same white.
    const straddle = [parse('#5c5c5c')!, parse('#aaaaaa')!];
    const walked = MARK_COLOURS.map(colour =>
      contrasting(HUE[colour], straddle)
    );
    expect(new Set(walked).size).toBe(MARK_COLOURS.length);
    for (const written of walked) {
      for (const background of straddle) {
        expect(contrast(parse(written)!, background)).toBeGreaterThanOrEqual(
          MIN_CONTRAST
        );
      }
    }
  });

  it('meets the bar with the colour it paints, not the one behind it', () => {
    // The walk works in floating point and the property is written as a hex
    // triple, so the two differ by up to half a channel. Measured on the
    // colour written, a mid grey panel is the pair that catches it.
    for (const background of ['#909090', '#8a8a8a', '#a0a0a0', '#777777']) {
      const behind = [parse(background)!];
      for (const colour of MARK_COLOURS) {
        const written = contrasting(HUE[colour], behind);
        expect(contrast(parse(written)!, behind[0])).toBeGreaterThanOrEqual(
          MIN_CONTRAST
        );
      }
    }
  });

  it('keeps the mark colour where the bar cannot be met at all', () => {
    // One background too dark for a darker swatch and one too light for a
    // lighter one: neither black nor white clears both, so no lightness of
    // any hue does either.
    const impossible = [parse('#2b2b2b')!, parse('#999999')!];
    for (const end of ['#000000', '#ffffff']) {
      expect(
        Math.min(
          ...impossible.map(background => contrast(parse(end)!, background))
        )
      ).toBeLessThan(MIN_CONTRAST);
    }
    // The six stay six colours: the best available is the same colour for
    // every hue, and six swatches of one colour carry nothing at all.
    for (const colour of MARK_COLOURS) {
      expect(contrasting(HUE[colour], impossible)).toBe(HUE[colour]);
    }
  });

  it('reads a colour written as hex or as rgb, and nothing else', () => {
    expect(parse('#eee')).toEqual([238, 238, 238]);
    expect(parse('  #0F70F0 ')).toEqual([15, 112, 240]);
    expect(parse('rgb(255, 255, 255)')).toEqual([255, 255, 255]);
    expect(parse('rgb(30 210 50)')).toEqual([30, 210, 50]);
    expect(parse('rgba(30, 210, 50, 1)')).toEqual([30, 210, 50]);
    expect(parse('rgb(30 210 50 / 100%)')).toEqual([30, 210, 50]);
    // A background carrying an alpha is not the colour the swatch is seen
    // against, so it is refused rather than flattened. Transparent reads
    // back as rgba(0, 0, 0, 0) and would otherwise be taken for black.
    expect(parse('rgba(30, 210, 50, 0.5)')).toBeNull();
    expect(parse('rgb(30 210 50 / 17%)')).toBeNull();
    expect(parse('rgba(0, 0, 0, 0)')).toBeNull();
    expect(parse('')).toBeNull();
    expect(parse('transparent')).toBeNull();
  });
});

describe('the swatch properties on the page', () => {
  /** A host carrying the two backgrounds of one theme. */
  function host(row: string, selected: string): HTMLElement {
    const node = document.createElement('div');
    node.style.setProperty('--jp-layout-color1', row);
    node.style.setProperty('--jp-layout-color2', selected);
    document.body.appendChild(node);
    return node;
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('writes one property per mark colour, each standing at the bar', () => {
    const node = host('#ffffff', '#eeeeee');
    applySwatchColours(node);
    for (const colour of MARK_COLOURS) {
      const written = node.style.getPropertyValue(swatchProperty(colour));
      expect(written).not.toBe('');
      for (const background of LIGHT) {
        expect(contrast(parse(written)!, background)).toBeGreaterThanOrEqual(
          MIN_CONTRAST
        );
      }
    }
  });

  it('writes a fill beside each rim, each standing at its own bar', () => {
    const node = host('#ffffff', '#eeeeee');
    applySwatchColours(node);
    for (const colour of MARK_COLOURS) {
      const fill = node.style.getPropertyValue(swatchFillProperty(colour));
      expect(fill).not.toBe('');
      for (const background of LIGHT) {
        expect(contrast(parse(fill)!, background)).toBeGreaterThanOrEqual(
          MIN_FILL
        );
      }
    }
  });

  it('answers a theme change with the colours that theme asks for', () => {
    const node = host('#ffffff', '#eeeeee');
    applySwatchColours(node);
    const light = node.style.getPropertyValue(swatchProperty('yellow'));
    node.style.setProperty('--jp-layout-color1', '#212121');
    node.style.setProperty('--jp-layout-color2', '#424242');
    applySwatchColours(node);
    const dark = node.style.getPropertyValue(swatchProperty('yellow'));
    expect(dark).not.toBe(light);
    for (const background of DARK) {
      expect(contrast(parse(dark)!, background)).toBeGreaterThanOrEqual(
        MIN_CONTRAST
      );
    }
  });

  it('reads a background the theme writes as a keyword', () => {
    // The stock light theme gives --jp-layout-color1 the keyword white, and
    // a browser resolves it on readback. jsdom hands a keyword back as it
    // was written, so the probe's readback is stood in for here.
    const node = host('white', 'whitesmoke');
    const painted: Record<string, string> = {
      white: 'rgb(255, 255, 255)',
      whitesmoke: 'rgb(245, 245, 245)'
    };
    const real = window.getComputedStyle;
    const spy = jest
      .spyOn(window, 'getComputedStyle')
      .mockImplementation((element: Element) => {
        const resolved = painted[(element as HTMLElement).style.color];
        return resolved
          ? ({ color: resolved } as CSSStyleDeclaration)
          : real.call(window, element);
      });
    applySwatchColours(node);
    spy.mockRestore();
    for (const colour of MARK_COLOURS) {
      const written = node.style.getPropertyValue(swatchProperty(colour));
      expect(written).not.toBe('');
      expect(contrast(parse(written)!, [255, 255, 255])).toBeGreaterThanOrEqual(
        MIN_CONTRAST
      );
    }
  });

  it('takes the properties off where no background can be read', () => {
    const node = host('#ffffff', '#eeeeee');
    applySwatchColours(node);
    expect(node.style.getPropertyValue(swatchProperty('yellow'))).not.toBe('');
    node.style.removeProperty('--jp-layout-color1');
    node.style.removeProperty('--jp-layout-color2');
    applySwatchColours(node);
    for (const colour of MARK_COLOURS) {
      // Nothing is written over the stylesheet's fallback, which is the
      // light theme's answer and stands at the bar; the unwalked hue,
      // which is what deriving a colour from nothing gives, does not.
      expect(node.style.getPropertyValue(swatchProperty(colour))).toBe('');
      expect(node.style.getPropertyValue(swatchFillProperty(colour))).toBe('');
    }
  });

  it('names each property after the colour', () => {
    expect(swatchProperty('pink' as MarkColour)).toBe(
      '--jp-AdvancedMd-swatch-pink'
    );
    expect(swatchFillProperty('pink' as MarkColour)).toBe(
      '--jp-AdvancedMd-swatch-fill-pink'
    );
  });
});
