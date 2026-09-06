/**
 * Live updates for open Markdown previews.
 *
 * When a process outside JupyterLab rewrites a Markdown file, the open preview
 * follows it: the new content appears without a reload, the text the change
 * added and removed is highlighted and then fades, and the document tab says
 * that something arrived.
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
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { Widget } from '@lumino/widgets';

import {
  DEFAULT_SETTINGS,
  ILiveViewSettings,
  LiveViewController
} from './controller';

/**
 * The plugin identifier, which is also the settings identifier.
 */
const PLUGIN_ID = 'jupyterlab_advanced_markdown_viewer_extension:plugin';

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
  const num = (key: keyof ILiveViewSettings, min: number): number => {
    const value = composite[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= min
      ? value
      : (DEFAULT_SETTINGS[key] as number);
  };
  return {
    enabled: bool('enabled'),
    pollInterval: num('pollInterval', 1),
    fadeDuration: num('fadeDuration', 0),
    animation: bool('animation'),
    animationSpeed: num('animationSpeed', 0),
    highlight: bool('highlight'),
    tabCue: bool('tabCue')
  };
}

/**
 * Initialization data for the jupyterlab_advanced_markdown_viewer_extension
 * extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  description:
    'Keeps an open Markdown preview current with its file, highlighting what an external change added and removed',
  autoStart: true,
  requires: [IMarkdownViewerTracker],
  optional: [ISettingRegistry, ILabShell],
  activate: (
    app: JupyterFrontEnd,
    tracker: IMarkdownViewerTracker,
    settingRegistry: ISettingRegistry | null,
    labShell: ILabShell | null
  ) => {
    const contents = app.serviceManager.contents;
    const controllers = new Map<MarkdownDocument, LiveViewController>();
    let current: ILiveViewSettings = { ...DEFAULT_SETTINGS };

    const attach = (widget: MarkdownDocument): void => {
      if (controllers.has(widget)) {
        return;
      }
      const controller = new LiveViewController({
        widget,
        contents,
        settings: current
      });
      controllers.set(widget, controller);
      widget.disposed.connect(() => {
        controllers.delete(widget);
      });
    };

    tracker.forEach(attach);
    tracker.widgetAdded.connect((_, widget) => attach(widget));

    if (labShell) {
      // Another extension takes the scroll position for a few seconds after a
      // tab is activated. Controllers need to know when that clock started.
      labShell.currentChanged.connect((_, args) => {
        const widget = args.newValue as Widget | null;
        const controller = widget
          ? controllers.get(widget as MarkdownDocument)
          : undefined;
        controller?.noteActivated();
      });
    }

    if (settingRegistry) {
      settingRegistry
        .load(PLUGIN_ID)
        .then(settings => {
          const apply = () => {
            current = readSettings(settings);
            for (const controller of controllers.values()) {
              controller.updateSettings(current);
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
