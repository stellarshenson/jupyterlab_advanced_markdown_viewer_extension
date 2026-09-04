import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { requestAPI } from './request';

/**
 * Initialization data for the jupyterlab_advanced_markdown_viewer_extension extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab_advanced_markdown_viewer_extension:plugin',
  description: 'Jupyterlab extension that finally allows Markdown files to receive live updates when underlying ai agentic tool is changing them. When change was performed - the title of the markdown file will give visual cue and the text in the markdown will be visibly removed (using pale red-ish bg colour) and added (using greenish bg colour) with the calm fade in and fade out. This will work in both view mode and edit mode - and will have the system manage, that content in the markdown isn\'t garbled when user edits the file at the same time. No more need to refresh the tab / view to see the latest changes',
  autoStart: true,
  optional: [ISettingRegistry],
  activate: (app: JupyterFrontEnd, settingRegistry: ISettingRegistry | null) => {
    console.log('JupyterLab extension jupyterlab_advanced_markdown_viewer_extension is activated!');

    if (settingRegistry) {
      settingRegistry
        .load(plugin.id)
        .then(settings => {
          console.log('jupyterlab_advanced_markdown_viewer_extension settings loaded:', settings.composite);
        })
        .catch(reason => {
          console.error('Failed to load settings for jupyterlab_advanced_markdown_viewer_extension.', reason);
        });
    }

    requestAPI<any>('hello', app.serviceManager.serverSettings)
      .then(data => {
        console.log(data);
      })
      .catch(reason => {
        console.error(
          `The jupyterlab_advanced_markdown_viewer_extension server extension appears to be missing.\n${reason}`
        );
      });
  }
};

export default plugin;
