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
 * the context menu and the toolbar call, and reads the settings all three
 * share.
 *
 * The scope is the rendered preview. A Markdown file open in the editor is not
 * touched, and a document holding unsaved edits is left alone until it is
 * clean, because overwriting unsaved text needs a merge this extension does
 * not yet perform.
 */

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
  ILabShell
} from '@jupyterlab/application';
import {
  IMarkdownViewerTracker,
  MarkdownDocument
} from '@jupyterlab/markdownviewer';
import { ICommandPalette } from '@jupyterlab/apputils';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { Widget } from '@lumino/widgets';

import { ChangeChannel } from './channel';
import {
  DEFAULT_SETTINGS,
  ILiveViewSettings,
  LiveViewController
} from './controller';
import { MARK_COLOURS, MarkColour, PanelState } from './marks';
import { NotesController } from './notes';
import { installNotesPanel, NotesPanel } from './notes-panel';

/**
 * The plugin identifier, which is also the settings identifier.
 */
const PLUGIN_ID = 'jupyterlab_advanced_markdown_viewer_extension:plugin';

/**
 * The commands the context menu, the palette and the toolbar button call.
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
const CONTEXT_SELECTOR = '.jp-MarkdownViewer .jp-RenderedMarkdown';

/**
 * The name of each panel state as the context menu offers it.
 */
const PANEL_LABELS: Record<PanelState, string> = {
  expanded: 'Show notes',
  minimap: 'Show notes minimap',
  hidden: 'Hide notes'
};

/**
 * The order the toolbar button cycles the three states in.
 */
const PANEL_CYCLE: PanelState[] = ['expanded', 'minimap', 'hidden'];

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
  return {
    enabled: bool('enabled'),
    pollInterval: num('pollInterval'),
    fadeDuration: num('fadeDuration'),
    animation: bool('animation'),
    animationSpeed: num('animationSpeed'),
    highlight: bool('highlight'),
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

/**
 * The colour a mark command was asked for, falling back to the first of the
 * four so an entry added without an argument still marks.
 */
function colourOf(value: unknown): MarkColour {
  return MARK_COLOURS.includes(value as MarkColour)
    ? (value as MarkColour)
    : MARK_COLOURS[0];
}

/**
 * The toolbar control that shows and hides the notes panel.
 *
 * The panel's own header closes it, so the reader needs a control outside the
 * panel to bring it back. It cycles the three states rather than offering
 * three buttons, and carries the JupyterLab toolbar classes so it looks like
 * every other button on that toolbar.
 */
function notesToolbarButton(onClick: () => void): Widget {
  const node = document.createElement('button');
  node.className = 'jp-ToolbarButtonComponent jp-mod-minimal jp-Button';
  node.title = 'Show the notes panel, its minimap, or neither';
  const label = document.createElement('span');
  label.className = 'jp-ToolbarButtonComponent-label';
  label.textContent = 'Notes';
  node.appendChild(label);
  node.addEventListener('click', onClick);
  const item = new Widget({ node });
  item.addClass('jp-ToolbarButton');
  return item;
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
  optional: [ISettingRegistry, ILabShell, ICommandPalette],
  activate: (
    app: JupyterFrontEnd,
    tracker: IMarkdownViewerTracker,
    settingRegistry: ISettingRegistry | null,
    labShell: ILabShell | null,
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
        user: app.serviceManager.user,
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
          setState: state => void notes.setPanelState(state)
        },
        state: notes.panelState
      });
      installNotesPanel(widget, panel);
      const control = notesToolbarButton(() => {
        const next = PANEL_CYCLE[(PANEL_CYCLE.indexOf(panel.state) + 1) % 3];
        void notes.setPanelState(next);
      });
      widget.toolbar.addItem('advancedMdNotes', control);

      // The panel holds no model: every change of the marks or of the state is
      // read back out of the controller and handed to it whole.
      const sync = (): void => {
        // With the feature off nothing of it is offered, and the document
        // keeps the markers it already carries: no write path is reachable.
        control.setHidden(!current.notes);
        panel.state = current.notes ? notes.panelState : 'hidden';
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

    if (labShell) {
      // Another extension takes the scroll position for a few seconds after a
      // tab is activated. Controllers need to know when that clock started.
      labShell.currentChanged.connect((_, args) => {
        const widget = args.newValue as Widget | null;
        const attachment = widget
          ? attachments.get(widget as MarkdownDocument)
          : undefined;
        attachment?.live.noteActivated();
      });
    }

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
      label: args => `Mark ${colourOf(args.colour)}`,
      isVisible: () => marking() !== null,
      execute: async args => {
        await marking()?.notes.mark(colourOf(args.colour));
      }
    });

    app.commands.addCommand(COMMANDS.markSelection, {
      label: 'Mark the selected passage',
      isEnabled: () => marking() !== null,
      execute: async args => {
        await marking()?.notes.mark(colourOf(args.colour));
      }
    });

    app.commands.addCommand(COMMANDS.addNote, {
      label: 'Add note',
      isVisible: () => marking() !== null,
      execute: async () => {
        const attachment = marking();
        if (!attachment) {
          return;
        }
        // The Kindle model: the note is written on a mark, so a note on
        // unmarked text marks it first and opens the entry on the new mark.
        const id = await attachment.notes.mark(MARK_COLOURS[0]);
        if (id) {
          attachment.panel.selectMark(id, true);
        }
      }
    });

    app.commands.addCommand(COMMANDS.panel, {
      label: args => PANEL_LABELS[args.state as PanelState],
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

    // Marking needs a selection, so its entries lead. The panel entries follow
    // and are offered with or without one.
    MARK_COLOURS.forEach((colour, index) => {
      app.contextMenu.addItem({
        command: COMMANDS.mark,
        args: { colour },
        selector: CONTEXT_SELECTOR,
        rank: 10 + index
      });
    });
    app.contextMenu.addItem({
      command: COMMANDS.addNote,
      selector: CONTEXT_SELECTOR,
      rank: 20
    });
    PANEL_CYCLE.forEach((state, index) => {
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
