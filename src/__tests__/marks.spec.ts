import {
  DEFAULT_COLOUR,
  IMark,
  IMarksSettings,
  MARK_COLOURS,
  newId,
  parseMarks,
  parseSettings,
  serialiseClosing,
  serialiseOpening,
  serialiseSettings
} from '../marks';

const ID = '0d4b0d0a-4a4e-4f6a-9d8c-1d6b0a3c2e11';
const OTHER = '7f2c9c58-3b8a-4b8f-8f7d-2e1a5b6c7d80';
const THIRD = '3c1e7a52-9b64-4a1d-b2f0-6e5d4c3b2a19';

/**
 * The text a mark encloses.
 */
function passageOf(source: string, mark: IMark): string {
  return mark.passage ? source.slice(mark.passage.start, mark.passage.end) : '';
}

/**
 * Remove a mark's two markers, closing first so the offsets stay valid.
 *
 * This is what removing a mark from the panel does to the source.
 */
function removeMark(source: string, mark: IMark): string {
  let out = source;
  for (const span of [mark.close, mark.open]) {
    if (span) {
      out = out.slice(0, span.start) + out.slice(span.end);
    }
  }
  return out;
}

/**
 * Store the settings, replacing every marker the source already holds.
 *
 * This is what a panel state change does to the source.
 */
function storeSettings(source: string, state: IMarksSettings): string {
  const { markers } = parseSettings(source);
  let out = source;
  for (const span of [...markers].reverse()) {
    out = out.slice(0, span.start) + out.slice(span.end);
  }
  return `${out.replace(/\s+$/, '')}\n\n${serialiseSettings(state)}\n`;
}

describe('parseMarks', () => {
  it('round-trips a bare mark and reports its passage', () => {
    const open = `<!-- mark:${ID} note colour=yellow -->`;
    const close = `<!-- /mark:${ID} -->`;
    const source = `This is the intro. ${open}This sentence needs work${close} and the rest follows.\n`;

    const marks = parseMarks(source);

    expect(marks).toHaveLength(1);
    expect(marks[0].id).toBe(ID);
    expect(marks[0].type).toBe('note');
    expect(marks[0].notes).toEqual([]);
    expect(marks[0].colour).toBe('yellow');
    expect(passageOf(source, marks[0])).toBe('This sentence needs work');
    expect(source.slice(marks[0].open!.start, marks[0].open!.end)).toBe(open);
    expect(source.slice(marks[0].close!.start, marks[0].close!.end)).toBe(
      close
    );
    expect(serialiseOpening(marks[0])).toBe(open);
    expect(serialiseClosing(marks[0].id)).toBe(close);
  });

  it('round-trips a thread and keeps the entries in file order', () => {
    const open = [
      `<!-- mark:${OTHER} note colour=blue owner=agent`,
      '@kj 2026-09-06T16:00:00Z: This contradicts the intro.',
      '@claude 2026-09-06T16:05:12Z: Agreed. I will rewrite it in the next pass,',
      'keeping the numbers.',
      '-->'
    ].join('\n');
    const source = `Later paragraph ${open}with a marked passage<!-- /mark:${OTHER} --> and more text.\n`;

    const marks = parseMarks(source);

    expect(marks).toHaveLength(1);
    expect(marks[0].notes).toEqual([
      {
        author: 'kj',
        stamp: '2026-09-06T16:00:00Z',
        text: 'This contradicts the intro.'
      },
      {
        author: 'claude',
        stamp: '2026-09-06T16:05:12Z',
        text: 'Agreed. I will rewrite it in the next pass,\nkeeping the numbers.'
      }
    ]);
    expect(passageOf(source, marks[0])).toBe('with a marked passage');
    expect(serialiseOpening(marks[0])).toBe(open);
  });

  it('keeps a note line that opens with an at sign as a continuation', () => {
    const written = serialiseOpening({
      id: ID,
      type: 'note',
      attributes: [],
      notes: [
        {
          author: 'kj',
          stamp: '2026-09-06T16:00:00Z',
          text: 'ask\n@claude to answer'
        }
      ]
    });

    expect(written).toContain('\n @claude to answer\n');
    const marks = parseMarks(`${written}text<!-- /mark:${ID} -->`);
    expect(marks[0].notes[0].text).toBe('ask\n@claude to answer');
    // Rewriting the same mark again must not add a second leading space.
    expect(serialiseOpening(marks[0])).toBe(written);
  });

  it('drops a blank line inside a note so the paragraph is not ended', () => {
    const written = serialiseOpening({
      id: ID,
      type: 'note',
      attributes: [],
      notes: [
        {
          author: 'kj',
          stamp: '2026-09-06T16:00:00Z',
          text: 'first\n\nsecond'
        }
      ]
    });

    expect(written).not.toContain('\n\n');
    expect(
      parseMarks(`${written}text<!-- /mark:${ID} -->`)[0].notes[0].text
    ).toBe('first\nsecond');
  });

  it('keeps a first line that opens no entry as an entry without an author', () => {
    const source = [
      `<!-- mark:${ID} note`,
      'a loose line',
      '@kj 2026-09-06T16:00:00Z: a proper entry',
      '-->'
    ].join('\n');

    const marks = parseMarks(`${source}text<!-- /mark:${ID} -->`);

    expect(marks[0].notes).toEqual([
      { author: '', stamp: '', text: 'a loose line' },
      {
        author: 'kj',
        stamp: '2026-09-06T16:00:00Z',
        text: 'a proper entry'
      }
    ]);
    expect(serialiseOpening(marks[0])).toBe(source);
  });

  it('takes the line below an entry with no text as that entry', () => {
    const source = [
      `<!-- mark:${ID} note`,
      '@kj 2026-09-06T16:00:00Z:',
      'the text sits here',
      '-->'
    ].join('\n');

    const marks = parseMarks(`${source}text${serialiseClosing(ID)}`);

    expect(marks[0].notes).toEqual([
      {
        author: 'kj',
        stamp: '2026-09-06T16:00:00Z',
        text: 'the text sits here'
      }
    ]);
  });

  it('reads a document marker as a mark with no closing marker and no passage', () => {
    const marks = parseMarks(
      `<!-- mark:${ID} document\n@kj 2026-09-08T12:00:00Z: On the whole\n-->\n# Title\n`
    );
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({
      id: ID,
      type: 'document',
      close: null,
      passage: null,
      notes: [
        { author: 'kj', stamp: '2026-09-08T12:00:00Z', text: 'On the whole' }
      ]
    });
    expect(marks[0].open).toEqual({ start: 0, end: 98 });
  });

  it('reads a document written with carriage returns', () => {
    const source = [
      `<!-- mark:${ID} note colour=blue`,
      '@kj 2026-09-06T16:00:00Z: first line',
      'second line',
      '-->'
    ].join('\r\n');

    const marks = parseMarks(`${source}passage${serialiseClosing(ID)}`);

    expect(marks[0].colour).toBe('blue');
    expect(marks[0].notes).toEqual([
      {
        author: 'kj',
        stamp: '2026-09-06T16:00:00Z',
        text: 'first line\nsecond line'
      }
    ]);
  });

  it('preserves an unknown type byte for byte', () => {
    const open = `<!-- mark:${ID} task colour=pink due=2026-09-30 -->`;
    const marks = parseMarks(`x ${open}the work${serialiseClosing(ID)} y`);

    expect(marks[0].type).toBe('task');
    expect(serialiseOpening(marks[0])).toBe(open);
  });

  it('preserves unknown attributes in order and spelling across a rewrite', () => {
    const open = `<!-- mark:${ID} note colour=blue owner=agent due="2026-09-30 09:00" note-of="" -->`;
    const marks = parseMarks(`x ${open}passage${serialiseClosing(ID)} y`);

    expect(marks[0].attributes).toEqual([
      { key: 'colour', value: 'blue' },
      { key: 'owner', value: 'agent' },
      { key: 'due', value: '2026-09-30 09:00' },
      { key: 'note-of', value: '' }
    ]);

    marks[0].notes.push({
      author: 'kj',
      stamp: '2026-09-06T16:00:00Z',
      text: 'a note'
    });
    const rewritten = serialiseOpening(marks[0]);

    expect(rewritten.split('\n')[0]).toBe(
      `<!-- mark:${ID} note colour=blue owner=agent due="2026-09-30 09:00" note-of=""`
    );
    expect(
      parseMarks(`${rewritten}passage${serialiseClosing(ID)}`)[0].attributes
    ).toEqual(marks[0].attributes);
  });

  it('reads each of the colours from the marker', () => {
    for (const colour of MARK_COLOURS) {
      const source = `<!-- mark:${ID} note colour=${colour} -->p${serialiseClosing(
        ID
      )}`;
      expect(parseMarks(source)[0].colour).toBe(colour);
    }
  });

  it('renders a missing or unknown colour as the default and writes it as-is', () => {
    const missing = `<!-- mark:${ID} note -->p${serialiseClosing(ID)}`;
    expect(parseMarks(missing)[0].colour).toBe(DEFAULT_COLOUR);
    expect(parseMarks(missing)[0].attributes).toEqual([]);

    const unknown = `<!-- mark:${ID} note colour=chartreuse -->p${serialiseClosing(
      ID
    )}`;
    const mark = parseMarks(unknown)[0];
    expect(mark.colour).toBe(DEFAULT_COLOUR);
    expect(mark.attributes).toEqual([{ key: 'colour', value: 'chartreuse' }]);
    expect(serialiseOpening(mark)).toBe(
      `<!-- mark:${ID} note colour=chartreuse -->`
    );
  });

  it('ignores a malformed marker and leaves it in the source', () => {
    const malformed = [
      `<!-- mark:${ID} -->no type`,
      '<!-- mark:not-a-uuid note -->bad id',
      `<!-- mark:${ID.toUpperCase()} note -->upper case id`,
      `<!-- mark:${ID} note colour=yellow junk -->trailing junk`,
      `<!-- mark:${ID} note colour= -->empty value`,
      '<!-- not a marker at all -->',
      '<!-- /mark:not-a-uuid -->',
      `text <!-- mark:${ID} note colour=yellow`
    ];

    for (const source of malformed) {
      expect(parseMarks(source)).toEqual([]);
    }

    // A malformed opening does not pair with a sound closing marker.
    const mixed = parseMarks(
      `<!-- mark:${ID} note colour=yellow junk -->text${serialiseClosing(ID)}`
    );
    expect(mixed).toHaveLength(1);
    expect(mixed[0].open).toBeNull();
  });

  it('reports a lone opening and a lone closing marker as unanchored', () => {
    const lone = parseMarks(`text <!-- mark:${ID} note --> more text`)[0];
    expect(lone.close).toBeNull();
    expect(lone.passage).toBeNull();
    expect(lone.open).not.toBeNull();

    const orphan = parseMarks(`text ${serialiseClosing(ID)} more`)[0];
    expect(orphan.id).toBe(ID);
    expect(orphan.open).toBeNull();
    expect(orphan.passage).toBeNull();
    expect(orphan.close).not.toBeNull();
  });

  it('keeps two overlapping marks as independent pairs', () => {
    const source = [
      `one <!-- mark:${ID} note -->two`,
      '',
      `three <!-- mark:${OTHER} note -->four ${serialiseClosing(ID)} five`,
      '',
      `six ${serialiseClosing(OTHER)} seven`
    ].join('\n');

    const marks = parseMarks(source);

    expect(marks.map(mark => mark.id)).toEqual([ID, OTHER]);
    expect(marks.every(mark => mark.passage !== null)).toBe(true);
    expect(passageOf(source, marks[0])).toContain('three');
    expect(passageOf(source, marks[1])).toContain('four');
  });

  it('reads a repeated identifier as the one mark its first marker opened', () => {
    const open = `<!-- mark:${ID} note -->`;
    const source = `${open}one${open}two${serialiseClosing(ID)} tail`;

    const marks = parseMarks(source);

    expect(marks).toHaveLength(1);
    expect(marks[0].open).toEqual({ start: 0, end: open.length });
    expect(passageOf(source, marks[0])).toBe(`one${open}two`);
    // The repeated opening marker is read as nothing and stays where it is,
    // inside the passage of the mark the first one opened.
    expect(source.match(/mark:/g)).toHaveLength(3);
  });

  it('yields one mark for a passage copied with both its markers', () => {
    // Copying a marked paragraph in the editor copies its markers with it, so
    // the file holds the identifier twice. An identifier names one mark: the
    // first pair in document order, the copy being text like any other.
    const open = `<!-- mark:${ID} note colour=yellow -->`;
    const close = serialiseClosing(ID);
    const pair = `Alpha ${open}beta gamma${close} delta.`;
    const source = `${pair}\n\n${pair}\n`;

    const marks = parseMarks(source);

    expect(marks).toHaveLength(1);
    expect(passageOf(source, marks[0])).toBe('beta gamma');
    expect(marks[0].open!.start).toBe(source.indexOf(open));
    expect(marks[0].close!.end).toBe(source.indexOf(close) + close.length);
    // Both markers of the copy sit past the mark and are left as they are.
    expect(marks[0].close!.end).toBeLessThan(source.lastIndexOf(open));
    expect(source.match(/mark:/g)).toHaveLength(4);
  });

  it('reads the pair, not the orphan, when a copied closing marker comes first', () => {
    // A reader who copies the tail of a marked paragraph leaves a closing
    // marker above the pair it came from. The identifier carries an opening
    // marker, so the mark is the one that marker begins, and the stray
    // closing marker above it is left where it stands.
    const open = [
      `<!-- mark:${ID} note colour=yellow`,
      '@kj 2026-09-08T10:00:00Z: Worth checking.',
      '-->'
    ].join('\n');
    const close = serialiseClosing(ID);
    const source = `Stray ${close} line.\n\nAlpha ${open}beta gamma${close} delta.\n`;

    const marks = parseMarks(source);

    expect(marks).toHaveLength(1);
    expect(passageOf(source, marks[0])).toBe('beta gamma');
    expect(marks[0].notes).toEqual([
      { author: 'kj', stamp: '2026-09-08T10:00:00Z', text: 'Worth checking.' }
    ]);
    expect(marks[0].open!.start).toBe(source.indexOf(open));
    expect(marks[0].close!.start).toBe(source.lastIndexOf(close));
    // Removing the mark takes its own two markers and leaves the stray one.
    expect(removeMark(source, marks[0])).toBe(
      `Stray ${close} line.\n\nAlpha beta gamma delta.\n`
    );
  });

  it('reads a lone closing marker as an orphan while another pair stands', () => {
    const close = serialiseClosing(OTHER);
    const source = `Alpha <!-- mark:${ID} note -->beta${serialiseClosing(
      ID
    )} gamma ${close} delta.\n`;

    const marks = parseMarks(source);

    expect(marks.map(mark => mark.id)).toEqual([ID, OTHER]);
    expect(passageOf(source, marks[0])).toBe('beta');
    // The identifier of the lone marker carries no opening marker anywhere
    // in the source, so the marker is the mark it names, which is what has it
    // deleted as a leftover.
    expect(marks[1].open).toBeNull();
    expect(marks[1].close).not.toBeNull();
  });

  it('reads the opening marker when the only closing marker sits above it', () => {
    // An agent reordering the file can put the closing marker above the
    // opening one it belongs to. The identifier carries an opening marker, so
    // the marker above it is not the mark: the mark is the one the opening
    // marker begins, with the notes it holds, and it is unanchored for want
    // of a closing marker below it.
    const open = [
      `<!-- mark:${ID} note colour=yellow`,
      '@kj 2026-09-08T10:00:00Z: Worth checking.',
      '-->'
    ].join('\n');
    const close = serialiseClosing(ID);
    const source = `Stray ${close} line.\n\nAlpha ${open}beta gamma delta.\n`;

    const marks = parseMarks(source);

    expect(marks).toHaveLength(1);
    expect(marks[0].type).toBe('note');
    expect(marks[0].open!.start).toBe(source.indexOf(open));
    expect(marks[0].close).toBeNull();
    expect(marks[0].passage).toBeNull();
    expect(marks[0].notes).toEqual([
      { author: 'kj', stamp: '2026-09-08T10:00:00Z', text: 'Worth checking.' }
    ]);
  });

  it('reads a document marker a stray closing marker sits above', () => {
    // A document marker has no closing marker of its own, so a stray one
    // carrying its identifier never pairs with it. The marker and its thread
    // are the mark all the same.
    const open = [
      `<!-- mark:${ID} document`,
      '@kj 2026-09-08T10:00:00Z: The whole piece needs a pass.',
      '-->'
    ].join('\n');
    const source = `Stray ${serialiseClosing(ID)} line.\n\n${open}\nAlpha beta.\n`;

    const marks = parseMarks(source);

    expect(marks).toHaveLength(1);
    expect(marks[0].type).toBe('document');
    expect(marks[0].open!.start).toBe(source.indexOf(open));
    expect(marks[0].close).toBeNull();
    expect(marks[0].notes).toEqual([
      {
        author: 'kj',
        stamp: '2026-09-08T10:00:00Z',
        text: 'The whole piece needs a pass.'
      }
    ]);
  });

  it('keeps a lone closing marker the mark where nothing opens its identifier', () => {
    // The other side of the rule: an identifier with no opening marker
    // anywhere is named by the closing marker alone, whatever other marks the
    // document holds, which is the leftover the cleanup sweeps.
    const stray = serialiseClosing(THIRD);
    const source =
      `Alpha <!-- mark:${ID} note -->beta${serialiseClosing(ID)} gamma.\n\n` +
      `Delta ${stray} epsilon.\n\n` +
      `Zeta <!-- mark:${OTHER} note -->eta delta.\n`;

    const marks = parseMarks(source);

    expect(marks.map(mark => mark.id)).toEqual([ID, THIRD, OTHER]);
    expect(marks[1].open).toBeNull();
    expect(source.slice(marks[1].close!.start, marks[1].close!.end)).toBe(
      stray
    );
  });

  it('keeps two pairs with different identifiers as two marks', () => {
    const pair = (id: string) =>
      `Alpha <!-- mark:${id} note colour=yellow -->beta gamma${serialiseClosing(
        id
      )} delta.`;
    const source = `${pair(ID)}\n\n${pair(OTHER)}\n`;

    const marks = parseMarks(source);

    expect(marks.map(mark => mark.id)).toEqual([ID, OTHER]);
    expect(marks.map(mark => passageOf(source, mark))).toEqual([
      'beta gamma',
      'beta gamma'
    ]);
  });

  it('lists three marks in document order with their passages', () => {
    const source = [
      `First <!-- mark:${ID} note colour=yellow -->alpha${serialiseClosing(
        ID
      )} paragraph.`,
      '',
      `Second <!-- mark:${OTHER} note colour=blue -->beta${serialiseClosing(
        OTHER
      )} paragraph.`,
      '',
      `Third <!-- mark:${THIRD} note colour=pink -->gamma${serialiseClosing(
        THIRD
      )} paragraph.`
    ].join('\n');

    const marks = parseMarks(source);

    expect(marks.map(mark => passageOf(source, mark))).toEqual([
      'alpha',
      'beta',
      'gamma'
    ]);
    expect(marks.map(mark => mark.colour)).toEqual(['yellow', 'blue', 'pink']);
  });

  it('leaves the marked text unchanged when both markers are removed', () => {
    const plain = 'One two three.\n\nFour five six.\n';
    const source = `One <!-- mark:${ID} note colour=yellow -->two${serialiseClosing(
      ID
    )} three.\n\nFour five six.\n`;

    const stripped = removeMark(source, parseMarks(source)[0]);

    expect(stripped).toBe(plain);
    expect(parseMarks(stripped)).toEqual([]);
  });

  it('keeps a mark anchored when an external rewrite changes another block', () => {
    const marked = `One <!-- mark:${ID} note colour=yellow -->two${serialiseClosing(
      ID
    )} three.`;
    const before = `${marked}\n\nSecond paragraph.\n\nThird paragraph.\n`;
    const after = `${marked}\n\nSecond paragraph.\n\nA rewritten third paragraph.\n`;

    const mark = parseMarks(after)[0];

    expect(mark.id).toBe(ID);
    expect(passageOf(after, mark)).toBe('two');
    expect(passageOf(before, parseMarks(before)[0])).toBe('two');
  });

  it('keeps a marker readable when the note text holds a comment end', () => {
    const written = serialiseOpening({
      id: ID,
      type: 'note',
      attributes: [],
      notes: [
        {
          author: 'kj',
          stamp: '2026-09-06T16:00:00Z',
          text: 'the marker ends with --> here'
        }
      ]
    });
    const source = `x ${written}passage${serialiseClosing(ID)} y`;

    expect(written).toContain('-- > here');
    const marks = parseMarks(source);
    expect(marks).toHaveLength(1);
    expect(marks[0].notes[0].text).toBe('the marker ends with -- > here');
    expect(passageOf(source, marks[0])).toBe('passage');
    expect(serialiseOpening(marks[0])).toBe(written);
  });

  it('writes a marker asked inline on one line with its notes escaped, and reads it back (ACC-NOTES-154)', () => {
    const notes = [
      {
        author: 'kj',
        stamp: '2026-09-11T18:40:00Z',
        text: 'first line\nsecond line with a | pipe and a \\ backslash'
      },
      { author: 'kj', stamp: '2026-09-11T18:41:00Z', text: 'another note' }
    ];
    const written = serialiseOpening(
      {
        id: ID,
        type: 'note',
        attributes: [{ key: 'colour', value: 'yellow' }],
        notes
      },
      true
    );

    // One line, and neither a newline nor a bare pipe inside it.
    expect(written).not.toContain('\n');
    expect(written).toBe(
      `<!-- mark:${ID} note colour=yellow @kj 2026-09-11T18:40:00Z: first line\\nsecond line with a \\| pipe and a \\\\ backslash\\n@kj 2026-09-11T18:41:00Z: another note -->`
    );
    const source = `| cell ${written}passage${serialiseClosing(ID)} more | 3 |`;
    const marks = parseMarks(source);
    expect(marks).toHaveLength(1);
    expect(marks[0].colour).toBe('yellow');
    expect(marks[0].notes).toEqual(notes);
    expect(passageOf(source, marks[0])).toBe('passage');
    // Rewritten inline it is the same text; rewritten in the multi-line form
    // it reads back the same notes.
    expect(serialiseOpening(marks[0], true)).toBe(written);
    expect(
      parseMarks(`x ${serialiseOpening(marks[0])}p${serialiseClosing(ID)}`)[0]
        .notes
    ).toEqual(notes);
  });

  it('reads the multi-line form as before, backslashes untouched', () => {
    const open = [
      `<!-- mark:${ID} note`,
      '@kj 2026-09-11T18:40:00Z: a path C:\\temp\\new and a literal \\n',
      '-->'
    ].join('\n');
    const marks = parseMarks(`x ${open}p${serialiseClosing(ID)}`);
    expect(marks[0].notes[0].text).toBe(
      'a path C:\\temp\\new and a literal \\n'
    );
  });
});

describe('settings marker', () => {
  it('round-trips every panel state', () => {
    for (const panel of ['expanded', 'minimap', 'hidden'] as const) {
      const source = `Body text.\n\n${serialiseSettings({ panel })}\n`;
      expect(parseSettings(source).settings).toEqual({ panel });
    }
  });

  it('reports the marker span so it can be replaced', () => {
    const marker = '<!-- marks:settings panel=minimap -->';
    const source = `Body text.\n\n${marker}\n`;
    const { markers } = parseSettings(source);

    expect(markers).toHaveLength(1);
    expect(source.slice(markers[0].start, markers[0].end)).toBe(marker);
  });

  it('drops a key this version no longer writes', () => {
    const source =
      'Body text.\n\n<!-- marks:settings panel=hidden legacy=1 -->\n';

    const stored = storeSettings(source, { panel: 'minimap' });

    expect(stored).toContain('<!-- marks:settings panel=minimap -->');
    expect(stored).not.toContain('legacy');
    expect(parseSettings(stored).settings).toEqual({ panel: 'minimap' });
  });

  it('holds exactly one settings marker after three changes', () => {
    let source = 'Body text.\n';
    for (const panel of ['minimap', 'hidden', 'expanded'] as const) {
      source = storeSettings(source, { panel });
    }

    expect(parseSettings(source).markers).toHaveLength(1);
    expect(parseSettings(source).settings).toEqual({ panel: 'expanded' });
    expect(source.match(/marks:settings/g)).toHaveLength(1);
  });

  it('ignores a malformed marker and replaces it on the next change', () => {
    const broken = [
      'Body text.\n\n<!-- marks:settings panel=sideways -->\n',
      'Body text.\n\n<!-- marks:settings ??? -->\n',
      'Body text.\n\n<!-- marks:settings -->\n'
    ];

    for (const source of broken) {
      expect(parseSettings(source).settings).toBeNull();
      expect(parseSettings(source).markers).toHaveLength(1);
      const stored = storeSettings(source, { panel: 'expanded' });
      expect(parseSettings(stored).markers).toHaveLength(1);
      expect(parseSettings(stored).settings).toEqual({ panel: 'expanded' });
    }
  });

  it('leaves one marker for a document that already held two', () => {
    const source =
      'Body text.\n\n<!-- marks:settings panel=hidden -->\n\n<!-- marks:settings panel=minimap -->\n';

    expect(parseSettings(source).markers).toHaveLength(2);
    expect(parseSettings(source).settings).toEqual({ panel: 'minimap' });

    const stored = storeSettings(source, { panel: 'expanded' });

    expect(stored.match(/marks:settings/g)).toHaveLength(1);
    expect(parseSettings(stored).settings).toEqual({ panel: 'expanded' });
  });

  it('reports no marker for a document that has none', () => {
    expect(parseSettings('Just text.\n')).toEqual({
      settings: null,
      markers: []
    });
  });

  it('leaves the document text and its marks untouched when stored', () => {
    const body = `One <!-- mark:${ID} note colour=yellow -->two${serialiseClosing(
      ID
    )} three.`;
    const source = `${body}\n`;

    const stored = storeSettings(source, { panel: 'minimap' });
    const marker = parseSettings(stored).markers[0];

    expect(stored.slice(0, marker.start)).toBe(`${body}\n\n`);
    expect(parseMarks(stored).map(mark => passageOf(stored, mark))).toEqual([
      'two'
    ]);
  });
});

describe('newId', () => {
  it('makes a lowercase version 4 identifier the parser accepts', () => {
    const id = newId();

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(newId()).not.toBe(id);

    const source = `x <!-- mark:${id} note colour=yellow -->p${serialiseClosing(
      id
    )} y`;
    expect(parseMarks(source)[0].id).toBe(id);
  });

  it('takes the identifier from crypto.randomUUID where there is one', () => {
    const provided = '9a1f5c3e-7d24-4b18-8c6a-2f0e1d3b4a57';
    const platform = globalThis.crypto as unknown as {
      randomUUID?: () => string;
    };

    platform.randomUUID = () => provided;
    try {
      expect(newId()).toBe(provided);
    } finally {
      delete platform.randomUUID;
    }
  });
});
