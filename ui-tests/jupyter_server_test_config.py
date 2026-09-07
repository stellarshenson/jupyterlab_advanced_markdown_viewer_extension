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

# Uncomment to set server log level to debug level
# c.ServerApp.log_level = "DEBUG"
