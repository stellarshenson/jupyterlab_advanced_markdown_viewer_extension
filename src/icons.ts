/**
 * Icons for the menu entries, the palette commands and the panel controls of
 * the extension.
 *
 * Each mark colour has a swatch in that colour, so a reader picking a colour
 * from the context menu sees it before choosing; the swatch is the one the
 * panel shows on a row, drawn to the same geometry and filled from the same
 * property, which src/swatch.ts holds to a contrast bar. The note and
 * panel entries carry JupyterLab's own icons for editing, listing and
 * closing, so they read like the rest of the menu.
 */

import {
  addIcon,
  caretLeftIcon,
  caretRightIcon,
  closeIcon,
  copyIcon,
  deleteIcon,
  editIcon,
  LabIcon,
  linkIcon,
  listIcon,
  paletteIcon,
  tableRowsIcon
} from '@jupyterlab/ui-components';

import { MARK_COLOURS, MarkColour, PanelState } from './marks';

import { swatchFallback, swatchProperty } from './swatch';

/**
 * The geometry of the panel's row swatch (.jp-AdvancedMd-notesSwatch in
 * style/base.css): a 10 by 10 square with 2 px corners, here centred in the
 * 16 by 16 box of a menu icon. The stylesheet test holds the two together.
 */
export const SWATCH_SIZE = 10;
export const SWATCH_RADIUS = 2;

/**
 * The panel's row swatch in one colour, as a menu icon. The fallback is the
 * one the stylesheet gives the panel's own swatch, so the two renderings of
 * one swatch degrade alike where the properties are not on the page; without
 * it the rect would inherit the icon grey of whatever menu holds it.
 */
function swatch(colour: MarkColour): string {
  const offset = (16 - SWATCH_SIZE) / 2;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
    `<rect x="${offset}" y="${offset}" width="${SWATCH_SIZE}" ` +
    `height="${SWATCH_SIZE}" rx="${SWATCH_RADIUS}" ` +
    `fill="var(${swatchProperty(colour)}, ${swatchFallback(colour)})"/></svg>`
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
 * An eye in the 16 by 16 box of a menu icon, drawn in the current colour so
 * it follows the button it sits in. The eye says what the mark is now and
 * not what a press would do: open while the mark shows, crossed out while
 * it is hidden (ACC-NOTES-172).
 */
function eye(crossed: boolean): string {
  const stroke = 'fill="none" stroke="currentColor" stroke-width="1.5"';
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
    `<path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" ${stroke}/>` +
    `<circle cx="8" cy="8" r="2" ${stroke}/>` +
    (crossed ? `<path d="M2.5 13.5l11-11" ${stroke}/>` : '') +
    '</svg>'
  );
}

/** The eye a row carries while its mark shows: open. */
export const OPEN_EYE_ICON = new LabIcon({
  name: 'jupyterlab_advanced_markdown_viewer_extension:open-eye',
  svgstr: eye(false)
});

/** The eye a row carries while its mark is hidden, which is closed: crossed. */
export const CROSSED_EYE_ICON = new LabIcon({
  name: 'jupyterlab_advanced_markdown_viewer_extension:crossed-eye',
  svgstr: eye(true)
});

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

/** The icon of the entry that writes a note, and of the edit icon an entry carries. */
export const NOTE_ICON: LabIcon = editIcon;

/** The x an entry carries, which deletes it. */
export const DELETE_NOTE_ICON: LabIcon = closeIcon;

/** The icon of the panel control that adds a note on the document as a whole. */
export const ADD_ICON: LabIcon = addIcon;

/** Copying the rendered document, in JupyterLab's own copy icon. */
export const COPY_ICON: LabIcon = copyIcon;

/** Copying the address of a link, in JupyterLab's own link icon. */
export const LINK_ICON: LabIcon = linkIcon;

/** The icon of the entry that puts the panel in each state. */
export const PANEL_ICONS: Record<PanelState, LabIcon> = {
  expanded: listIcon,
  minimap: tableRowsIcon,
  hidden: closeIcon
};
