/**
 * Icons for the menu entries, the palette commands and the panel controls of
 * the extension.
 *
 * Each mark colour has a swatch in that colour, so a reader picking a colour
 * from the context menu sees it before choosing; the swatch is the one the
 * panel shows on a row, drawn to the same geometry from the hue the painted
 * mark has in the light theme, at the mark's own alpha. The note and
 * panel entries carry JupyterLab's own icons for editing, listing and
 * closing, so they read like the rest of the menu.
 */

import {
  addIcon,
  caretLeftIcon,
  caretRightIcon,
  closeIcon,
  deleteIcon,
  editIcon,
  LabIcon,
  listIcon,
  paletteIcon,
  tableRowsIcon
} from '@jupyterlab/ui-components';

import { MARK_COLOURS, MarkColour, PanelState } from './marks';

/**
 * The hue of each mark colour, as the painted mark has it before its alpha:
 * the light-theme rgb values of style/base.css, so the swatch and the
 * highlight are one colour.
 */
const HUE: Record<MarkColour, string> = {
  yellow: '#f0d40f',
  blue: '#0f70f0',
  pink: '#f631b1',
  orange: '#f19422',
  red: '#e61e46',
  green: '#1ed232'
};

/**
 * The alpha the painted mark lays its hue down with in the light theme, from
 * style/base.css, so the swatch is the highlight as the reader sees it on the
 * page and not the hue at full strength.
 */
const TINT: Record<MarkColour, number> = {
  yellow: 0.2,
  blue: 0.11,
  pink: 0.14,
  orange: 0.17,
  red: 0.18,
  green: 0.17
};

/**
 * The geometry of the panel's row swatch (.jp-AdvancedMd-notesSwatch in
 * style/base.css): a 10 by 10 square with 2 px corners, here centred in the
 * 16 by 16 box of a menu icon. The stylesheet test holds the two together.
 */
export const SWATCH_SIZE = 10;
export const SWATCH_RADIUS = 2;

/** The panel's row swatch in one colour, as a menu icon. */
function swatch(colour: MarkColour): string {
  const offset = (16 - SWATCH_SIZE) / 2;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
    `<rect x="${offset}" y="${offset}" width="${SWATCH_SIZE}" ` +
    `height="${SWATCH_SIZE}" rx="${SWATCH_RADIUS}" fill="${HUE[colour]}" ` +
    `fill-opacity="${TINT[colour]}"/></svg>`
  );
}

/** One icon per mark colour, keyed by the colour. */
export const MARK_ICONS = {} as Record<MarkColour, LabIcon>;
for (const colour of MARK_COLOURS) {
  MARK_ICONS[colour] = new LabIcon({
    name: `jupyterlab_advanced_markdown_viewer_extension:mark-${colour}`,
    svgstr: swatch(colour)
  });
}

/** The icon of the Mark entry, which opens the submenu of colours. */
export const MARK_MENU_ICON: LabIcon = paletteIcon;

/** The removal control of a panel row: JupyterLab's trash can. */
export const REMOVE_ICON: LabIcon = deleteIcon;

/**
 * The control on the minimap strip that expands the panel: a caret pointing
 * the way the panel grows, into the preview on its left.
 */
export const EXPAND_ICON: LabIcon = caretLeftIcon;

/**
 * The control on the expanded panel that collapses it to the minimap: a caret
 * pointing the way the panel shrinks, towards its own edge on the right.
 */
export const COLLAPSE_ICON: LabIcon = caretRightIcon;

/** The icon of the entry that writes a note. */
export const NOTE_ICON: LabIcon = editIcon;

/** The icon of the panel control that adds a note on the document as a whole. */
export const ADD_ICON: LabIcon = addIcon;

/** The icon of the entry that puts the panel in each state. */
export const PANEL_ICONS: Record<PanelState, LabIcon> = {
  expanded: listIcon,
  minimap: tableRowsIcon,
  hidden: closeIcon
};
