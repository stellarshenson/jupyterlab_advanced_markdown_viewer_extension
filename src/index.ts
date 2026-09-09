/**
 * Live updates, marks and notes for open Markdown previews.
 *
 * When a process outside JupyterLab rewrites a Markdown file, the open preview
 * follows it: the new content appears without a reload, the text the change
 * added and removed is highlighted and then fades, and the document tab says
 * that something arrived. The server reports file events over one change
 * channel shared by every open preview; a slow batched check stands in where
 * events cannot arrive.
 *
 * The reader marks passages of the rendered preview and writes notes on them.
 * A mark is a pair of HTML comments in the file itself, so the document alone
 * carries the whole conversation and any Markdown renderer ignores it. This
 * module is the wiring: it creates the three pieces per document (the live
 * controller, the notes controller and the notes panel), declares the commands
 * the context menu and the palette call, and reads the settings all three
 * share.
 *
 * The scope is the rendered preview. A Markdown file open in the editor is not
 * touched, and a document holding unsaved edits is left alone until it is
 * clean, because overwriting unsaved text needs a merge this extension does
 * not yet perform.
 */

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  IMarkdownViewerTracker,
  MarkdownDocument
} from '@jupyterlab/markdownviewer';
import { ICommandPalette } from '@jupyterlab/apputils';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { Menu } from '@lumino/widgets';

import { ChangeChannel } from './channel';
import { MARK_ICONS, MARK_MENU_ICON, NOTE_ICON, PANEL_ICONS } from './icons';
import {
  DEFAULT_SETTINGS,
  HIGHLIGHT_VISIBILITIES,
  HighlightVisibility,
  ILiveViewSettings,
  LiveViewController
} from './controller';
import {
  DEFAULT_COLOUR,
  HIDE_MINIMAP_LABEL,
  MARK_COLOURS,
  MarkColour,
  PANEL_LABELS,
  PanelState
} from './marks';
import { NotesController, SELECTING_CLASS } from './notes';
import { installNotesPanel, NotesPanel } from './notes-panel';

/**
 * The plugin identifier, which is also the settings identifier.
 */
const PLUGIN_ID = 'jupyterlab_advanced_markdown_viewer_extension:plugin';

/**
 * The commands the context menu and the palette call.
 */
export const COMMANDS = {
  /** Mark the selected passage in the colour named by the `colour` argument. */
  mark: 'advanced-markdown-viewer:mark',
  /**
   * The same from the palette and the keyboard: listed always and enabled
   * only with a selection, where the menu entry is hidden without one.
   */
  markSelection: 'advanced-markdown-viewer:mark-selection',
  /** Mark the selected passage and open the note entry on it. */
  addNote: 'advanced-markdown-viewer:add-note',
  /** Put the notes panel into the state named by the `state` argument. */
  panel: 'advanced-markdown-viewer:notes-panel'
};

/**
 * The element a context-menu entry of this extension is offered over, and the
 * one a mark is made in.
 */
const RENDERED_CLASS = 'jp-RenderedMarkdown';

/**
 * Selector the context-menu entries are registered on: the rendered output of
 * a Markdown preview, not of a notebook cell or any other rendered Markdown.
 */
const CONTEXT_SELECTOR = `.jp-MarkdownViewer .${RENDERED_CLASS}`;

/**
 * Where the Mark submenu is offered: the same, while the document widget
 * says a selection is held. A submenu entry is visible whenever its menu
 * exists, so the selector is what hides it without a selection.
 */
const MARKING_SELECTOR = `.${SELECTING_CLASS} ${CONTEXT_SELECTOR}`;

/**
 * The order the context menu offers the three states in.
 */
const PANEL_ORDER: PanelState[] = ['expanded', 'minimap', 'hidden'];

/**
 * The lowest value this code accepts for each numeric setting. A number below
 * its minimum is refused here and the default stands in. The settings schema
 * declares the same minimums so the editor refuses the value before it is
 * ever read, and the schema test compares the two, so a minimum is written
 * here once and nowhere else.
 */
export const MINIMUMS: Record<
  'pollInterval' | 'fadeDuration' | 'animationSpeed',
  number
> = {
  pollInterval: 1,
  fadeDuration: 0,
  animationSpeed: 0
};

/**
 * Read settings, falling back to a default for anything missing or invalid.
 */
function readSettings(settings: ISettingRegistry.ISettings): ILiveViewSettings {
  const composite = settings.composite as Partial<
    Record<keyof ILiveViewSettings, unknown>
  >;
  const bool = (key: keyof ILiveViewSettings): boolean => {
    const value = composite[key];
    return typeof value === 'boolean'
      ? value
      : (DEFAULT_SETTINGS[key] as boolean);
  };
  const num = (key: keyof typeof MINIMUMS): number => {
    const value = composite[key];
    return typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= MINIMUMS[key]
      ? value
      : (DEFAULT_SETTINGS[key] as number);
  };
  const str = (key: keyof ILiveViewSettings): string => {
    const value = composite[key];
    return typeof value === 'string'
      ? value
      : (DEFAULT_SETTINGS[key] as string);
  };
  // A choice outside the declared list is refused here as well as by the
  // editor, so a settings file edited by hand cannot leave the stylesheet
  // keyed off a value no rule matches.
  const visibility = (): HighlightVisibility => {
    const value = composite.highlightVisibility;
    return HIGHLIGHT_VISIBILITIES.includes(value as HighlightVisibility)
      ? (value as HighlightVisibility)
      : DEFAULT_SETTINGS.highlightVisibility;
  };
  return {
    enabled: bool('enabled'),
    pollInterval: num('pollInterval'),
    fadeDuration: num('fadeDuration'),
    animation: bool('animation'),
    animationSpeed: num('animationSpeed'),
    highlight: bool('highlight'),
    highlightVisibility: visibility(),
    tabCue: bool('tabCue'),
    notes: bool('notes'),
    author: str('author')
  };
}

/**
 * The three pieces attached to one open preview.
 */
interface IAttachment {
  widget: MarkdownDocument;
  live: LiveViewController;
  notes: NotesController;
  panel: NotesPanel;
}

/** A colour as the Mark submenu names it. */
function colourLabel(colour: MarkColour): string {
  return colour[0].toUpperCase() + colour.slice(1);
}

/**
 * The colour a mark command was asked for, falling back to the default
 * colour so an entry added without an argument still marks.
 */
function colourOf(value: unknown): MarkColour {
  return MARK_COLOURS.includes(value as MarkColour)
    ? (value as MarkColour)
    : DEFAULT_COLOUR;
}

/**
 * Initialization data for the jupyterlab_advanced_markdown_viewer_extension
 * extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  description:
    'Keeps an open Markdown preview current with its file, highlighting what an external change added and removed, and holds the reader marks and notes the file itself carries',
  autoStart: true,
  requires: [IMarkdownViewerTracker],
  optional: [ISettingRegistry, ICommandPalette],
  activate: (
    app: JupyterFrontEnd,
    tracker: IMarkdownViewerTracker,
    settingRegistry: ISettingRegistry | null,
    palette: ICommandPalette | null
  ) => {
    const contents = app.serviceManager.contents;
    const channel = new ChangeChannel(app.serviceManager.serverSettings);
    const attachments = new Map<MarkdownDocument, IAttachment>();
    let current: ILiveViewSettings = { ...DEFAULT_SETTINGS };

    const attach = (widget: MarkdownDocument): void => {
      if (attachments.has(widget)) {
        return;
      }
      const live = new LiveViewController({
        widget,
        contents,
        channel,
        settings: current
      });
      const notes = new NotesController({
        widget,
        settled: live.settled,
        // A change waiting on disk is applied before a marker is written, so
        // the save that follows the write cannot report the file as changed.
        refresh: () => live.refresh(),
        serverSettings: app.serviceManager.serverSettings,
        settings: current
      });
      const root = (): HTMLElement | null =>
        widget.node.querySelector(`.${RENDERED_CLASS}`);
      const panel = new NotesPanel({
        root,
        handlers: {
          addNote: (id, text) => notes.addNote(id, text),
          setColour: (id, colour) => void notes.setColour(id, colour),
          removeMark: id => void notes.remove(id),
          markDocument: () => notes.markDocument(),
          setState: state => void notes.setPanelState(state)
        },
        state: notes.panelState
      });
      // Nothing is added to the document toolbar: one visible item would make
      // JupyterLab open the toolbar to its full height on every preview, where
      // it stays a two-pixel strip while empty. The context menu and the
      // panel's own header are the controls.
      installNotesPanel(widget, panel);

      // The panel holds no model: every change of the marks or of the state is
      // read back out of the controller and handed to it whole.
      const sync = (): void => {
        // With the feature off nothing of it is offered, and the document
        // keeps the markers it already carries: no write path is reachable.
        panel.state = current.notes ? notes.panelState : 'hidden';
        // The badge is the feature's one control outside the panel: off with
        // the setting, else shown with the hidden state as _apply has it.
        panel.badge.hidden = !current.notes || panel.state !== 'hidden';
        panel.setMarks(
          notes.marks.map(mark => ({
            mark,
            passage: mark.text,
            anchored: !mark.unanchored,
            position: mark.position
          }))
        );
      };
      notes.changed.connect(sync);
      // A click on a marked passage is the second way to the note entry.
      notes.activated.connect((_, id) => panel.selectMark(id, true));
      sync();

      attachments.set(widget, { widget, live, notes, panel });
      widget.disposed.connect(() => {
        attachments.delete(widget);
      });
    };

    tracker.forEach(attach);
    tracker.widgetAdded.connect((_, widget) => attach(widget));

    /**
     * The preview a command acts on: the one the context menu was opened
     * over, else the one in front, which a right click or a Tab focused.
     * Null while the feature is off.
     *
     * The hit test walks up from the node the menu was opened over, and a
     * render between the menu and the choice replaces that node, so the walk
     * then reaches no preview; the preview in front is the same one.
     */
    const target = (): IAttachment | null => {
      if (!current.notes) {
        return null;
      }
      const node = app.contextMenuHitTest(candidate =>
        candidate.classList.contains(RENDERED_CLASS)
      );
      let found: IAttachment | undefined;
      if (node) {
        for (const attachment of attachments.values()) {
          if (attachment.widget.node.contains(node)) {
            found = attachment;
          }
        }
      }
      const widget = found?.widget ?? tracker.currentWidget;
      return (widget && attachments.get(widget)) ?? null;
    };

    /**
     * The preview to mark, for the commands that need a selection: the
     * target while its controller holds one. Null hides the menu entries and
     * disables the palette command.
     */
    const marking = (): IAttachment | null => {
      const attachment = target();
      return attachment && attachment.notes.selection ? attachment : null;
    };

    app.commands.addCommand(COMMANDS.mark, {
      label: args => colourLabel(colourOf(args.colour)),
      icon: args => MARK_ICONS[colourOf(args.colour)],
      isVisible: () => marking() !== null,
      execute: async args => {
        await marking()?.notes.mark(colourOf(args.colour));
      }
    });

    app.commands.addCommand(COMMANDS.markSelection, {
      label: 'Mark the selected passage',
      icon: args => MARK_ICONS[colourOf(args.colour)],
      isEnabled: () => marking() !== null,
      execute: async args => {
        await marking()?.notes.mark(colourOf(args.colour));
      }
    });

    app.commands.addCommand(COMMANDS.addNote, {
      label: 'Add note',
      icon: NOTE_ICON,
      isVisible: () => marking() !== null,
      execute: async () => {
        const attachment = marking();
        if (!attachment) {
          return;
        }
        // The Kindle model: the note is written on a mark, so a note on
        // unmarked text marks it first and opens the entry on the new mark.
        const id = await attachment.notes.mark(DEFAULT_COLOUR);
        if (id) {
          attachment.panel.selectMark(id, true);
        }
      }
    });

    app.commands.addCommand(COMMANDS.panel, {
      label: args => {
        const state = args.state as PanelState;
        return state === 'hidden' && target()?.panel.state === 'minimap'
          ? HIDE_MINIMAP_LABEL
          : PANEL_LABELS[state];
      },
      icon: args => PANEL_ICONS[args.state as PanelState],
      isVisible: args => {
        const attachment = target();
        return !!attachment && attachment.panel.state !== args.state;
      },
      execute: async args => {
        await target()?.notes.setPanelState(args.state as PanelState);
      }
    });

    // The menu hides the marking entries without a selection; the palette
    // must list the command to be found, so it greys it instead.
    palette?.addItem({
      command: COMMANDS.markSelection,
      category: 'Markdown Viewer'
    });
    // The panel has no toolbar item, so the palette is the route to it that
    // the keyboard reaches without the context menu; listed while a preview
    // is the target, since the command's visibility rules the palette too.
    palette?.addItem({
      command: COMMANDS.panel,
      args: { state: 'expanded' },
      category: 'Markdown Viewer'
    });

    // Marking needs a selection, so its entry leads: one Mark entry opening
    // the six colours, so the menu is not six entries long before the
    // reader reaches the rest. The panel entries follow and are offered with
    // or without a selection.
    const markMenu = new Menu({ commands: app.commands });
    markMenu.title.label = 'Mark';
    markMenu.title.icon = MARK_MENU_ICON;
    for (const colour of MARK_COLOURS) {
      markMenu.addItem({ command: COMMANDS.mark, args: { colour } });
    }
    app.contextMenu.addItem({
      type: 'submenu',
      submenu: markMenu,
      selector: MARKING_SELECTOR,
      rank: 10
    });
    app.contextMenu.addItem({
      command: COMMANDS.addNote,
      selector: CONTEXT_SELECTOR,
      rank: 20
    });
    PANEL_ORDER.forEach((state, index) => {
      app.contextMenu.addItem({
        command: COMMANDS.panel,
        args: { state },
        selector: CONTEXT_SELECTOR,
        rank: 30 + index
      });
    });

    if (settingRegistry) {
      settingRegistry
        .load(PLUGIN_ID)
        .then(settings => {
          const apply = () => {
            current = readSettings(settings);
            channel.interval = current.pollInterval;
            for (const attachment of attachments.values()) {
              attachment.live.updateSettings(current);
              // The notes controller reports the change, which is what puts
              // the panel into the state the new settings ask for.
              attachment.notes.updateSettings(current);
            }
          };
          apply();
          settings.changed.connect(apply);
        })
        .catch(reason => {
          console.error(
            `Failed to load settings for ${PLUGIN_ID}, using defaults.`,
            reason
          );
        });
    }
  }
};

export default plugin;
