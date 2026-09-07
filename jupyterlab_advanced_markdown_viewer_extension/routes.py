"""HTTP and WebSocket routes of the server extension.

Three routes under the namespace `jupyterlab-advanced-markdown-viewer-extension`: `status`
says whether file events are available, `stat` answers the frontend's batched fallback poll
with mtime and size per path, and the `events` WebSocket carries register and release
messages from the browser and change messages back. One registry, shared by every
connection, lives in the web application settings.

The stat answer carries three cases and the frontend reads all three: a stat for a file that
is there, null for a file that is not, and no entry at all for a path the registry cannot
serve, which the frontend leaves out of its comparison rather than marking the document
gone.
"""
import json

import tornado
from jupyter_core.utils import ensure_async
from jupyter_server.auth.decorator import ws_authenticated
from jupyter_server.base.handlers import APIHandler, JupyterHandler
from jupyter_server.base.websocket import WebSocketMixin
from jupyter_server.utils import url_path_join
from tornado.ioloop import IOLoop
from tornado.websocket import WebSocketClosedError, WebSocketHandler

from . import __version__
from .watch import FileWatchRegistry

NAMESPACE = "jupyterlab-advanced-markdown-viewer-extension"
SETTINGS_KEY = "advanced_markdown_watch"


def _paths_of(body):
    """The path list of a request body, keeping only the entries that are strings.

    A body from anything other than this extension's frontend can carry a number, a null or
    a bare string where the list belongs; none of those name a document, and letting one
    through would abort the WebSocket or answer the stat request with a 500.
    """
    paths = body.get("paths")
    return [path for path in paths if isinstance(path, str)] if isinstance(paths, list) else []


class StatusHandler(APIHandler):
    """GET status -> whether file events are available, and the package version."""

    @tornado.web.authenticated
    def get(self):
        registry = self.settings[SETTINGS_KEY]
        self.finish(json.dumps({"events": registry.available, "version": __version__}))


class StatHandler(APIHandler):
    """POST stat with {"paths": [...]} -> {"paths": {path: {"mtime", "size"} | null}}.

    A path the registry cannot serve carries no entry in the answer at all.
    """

    @tornado.web.authenticated
    def post(self):
        body = self.get_json_body() or {}
        registry = self.settings[SETTINGS_KEY]
        self.finish(json.dumps({"paths": registry.stat(_paths_of(body))}))


class EventsHandler(WebSocketMixin, JupyterHandler, WebSocketHandler):
    """WebSocket events: the connection is the subscriber of every path it registers.

    Authentication follows jupyter_server's own events websocket: the user must be known and
    authorized to read contents before the upgrade completes.
    """

    def initialize(self):
        super().initialize()
        # Registry path -> the spelling this connection registered it under. Every answer of
        # this protocol names a document the way its client named it: the registered reply
        # and the stat result echo the request, and a change message is translated back here
        # from the normalized path the registry keys documents by. One spelling per document
        # per connection: the frontend keys its registrations by the exact string it sends
        # and counts them, so it registers one document once and releases it once.
        self._spellings = {}

    async def pre_get(self):
        authorized = await ensure_async(
            self.authorizer.is_authorized(self, self.current_user, "read", "contents")
        )
        if not authorized:
            raise tornado.web.HTTPError(403)

    @ws_authenticated
    async def get(self, *args, **kwargs):
        await self.pre_get()
        res = super().get(*args, **kwargs)
        if res is not None:
            await res

    @property
    def registry(self):
        return self.settings[SETTINGS_KEY]

    def on_message(self, message):
        try:
            data = json.loads(message)
        except ValueError:
            return
        if not isinstance(data, dict):
            return
        paths = _paths_of(data)
        if data.get("type") == "register":
            for path in paths:
                registered = self.registry.register(path, self)
                if registered is not None:
                    self._spellings[registered] = path
            self.write_message(
                json.dumps({"type": "registered", "paths": paths, "events": self.registry.available})
            )
        elif data.get("type") == "release":
            for path in paths:
                released = self.registry.release(path, self)
                if released is not None:
                    self._spellings.pop(released, None)

    def on_change(self, path, kind):
        path = self._spellings.get(path, path)
        try:
            self.write_message(json.dumps({"type": "change", "path": path, "event": kind}))
        except WebSocketClosedError:
            # The peer vanished without a close handshake, so on_close never ran.
            self.registry.release_all(self)

    def on_close(self):
        self.registry.release_all(self)


def setup_route_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]
    web_app.settings[SETTINGS_KEY] = FileWatchRegistry(
        web_app.settings["contents_manager"].root_dir, IOLoop.current()
    )
    handlers = [
        (url_path_join(base_url, NAMESPACE, "status"), StatusHandler),
        (url_path_join(base_url, NAMESPACE, "stat"), StatHandler),
        (url_path_join(base_url, NAMESPACE, "events"), EventsHandler),
    ]
    web_app.add_handlers(host_pattern, handlers)
