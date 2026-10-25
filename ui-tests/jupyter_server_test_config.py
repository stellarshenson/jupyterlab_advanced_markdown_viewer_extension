"""Server configuration for integration tests.

!! Never use this configuration in production because it
opens the server to the world and provide access to JupyterLab
JavaScript objects through the global window variable.
"""
import os

from jupyterlab.galata import configure_jupyter_server

configure_jupyter_server(c)

# `or`, not a get() default: an exported-but-empty JUPYTER_TEST_PORT would
# raise here while Playwright waited happily on the default port.
c.ServerApp.port = int(os.environ.get("JUPYTER_TEST_PORT") or "8888")

# The fixtures each test removes go for good: a move to the trash fails on a
# root outside the home directory and leaves every fixture behind.
c.FileContentsManager.delete_to_trash = False

# The GalaxaHub message-of-the-day extension, where it is installed, opens a
# Welcome tab some time after the lab has started. A test that has opened its
# document by then loses the front tab to it. traitlets ignores the line
# where the extension is not installed, as in CI.
c.GalaxaHubMotd.open_on_start = False

# The server options of this extension, set once for the whole suite. All
# seven are set, the defaults included, so a developer's own server
# configuration cannot reach the suite. The fallback check every 30 s never
# fires inside a test that must not see it and fires within the wait of the
# two that need it; a highlight stands for 30 s; added text types at 20
# characters a second with no jitter, where a test turns the animation on.
c.AdvancedMarkdownViewer.poll_interval = 30
c.AdvancedMarkdownViewer.fade_duration = 30000
c.AdvancedMarkdownViewer.animation_speed = 20
c.AdvancedMarkdownViewer.animation_jitter = 0
c.AdvancedMarkdownViewer.highlight_visibility = "medium"
c.AdvancedMarkdownViewer.tab_cue = True
c.AdvancedMarkdownViewer.notes = True

# Uncomment to set server log level to debug level
# c.ServerApp.log_level = "DEBUG"
