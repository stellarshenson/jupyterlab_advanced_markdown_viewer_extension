"""HTTP and WebSocket routes of the server extension.

Four routes under the namespace `jupyterlab-advanced-markdown-viewer-extension`: `status`
says whether file events are available, `stat` answers the frontend's batched fallback poll
with mtime and size per path, `write` rewrites a document only while its file still carries
the hash the browser holds, and the `events` WebSocket carries register and release messages
from the browser and change messages back. One registry, shared by every connection, lives
in the web application settings.

The stat answer carries three cases and the frontend reads all three: a stat for a file that
is there, null for a file that is not, and no entry at all for a path the registry cannot
serve, which the frontend leaves out of its comparison rather than marking the document
gone.
"""
import json

import tornado
from jupyter_core.utils import ensure_async
from jupyter_server.auth.decorator import authorized, ws_authenticated
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
    @authorized(action="read", resource="contents")
    def get(self):
        registry = self.settings[SETTINGS_KEY]
        self.finish(json.dumps({"events": registry.available, "version": __version__}))


class StatHandler(APIHandler):
    """POST stat with {"paths": [...]} -> {"paths": {path: {"mtime", "size"} | null}}.

    A path the registry cannot serve carries no entry in the answer at all.
    """

    @tornado.web.authenticated
    @authorized(action="read", resource="contents")
    def post(self):
        body = self.get_json_body() or {}
        registry = self.settings[SETTINGS_KEY]
        self.finish(json.dumps({"paths": registry.stat(_paths_of(body))}))


class WriteHandler(APIHandler):
    """POST write {"path", "expected", "content"} -> 200 {"hash"} or 409 {"content", "hash"}.

    `expected` is the hash the contents API reported for the document, which the browser's
    Context holds; the file is rewritten only while it still carries it. A 409 carries the
    file as it is, so the browser can rebase its edit and send it again. 400 for a body that
    is not those three strings; 404 for a file that is not there or a path the registry does
    not serve, the two the stat answer tells apart.
    """

    @tornado.web.authenticated
    @authorized(action="write", resource="contents")
    async def post(self):
        body = self.get_json_body() or {}
        fields = [body.get(name) for name in ("path", "expected", "content")]
        if not all(isinstance(field, str) for field in fields):
            raise tornado.web.HTTPError(400, "path, expected and content must be strings")
        registry = self.settings[SETTINGS_KEY]
        # Off the IOLoop: the swap blocks on the disk while it holds the path's lock, and
        # two requests for one path must be able to wait on that lock at the same time.
        try:
            result = await IOLoop.current().run_in_executor(None, registry.swap, *fields)
        except FileNotFoundError:
            raise tornado.web.HTTPError(404, "no such file") from None
        if result is None:
            raise tornado.web.HTTPError(404, "path not served")
        if "content" in result:
            self.set_status(409)
        self.finish(json.dumps(result))


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
    contents_manager = web_app.settings["contents_manager"]
    web_app.settings[SETTINGS_KEY] = FileWatchRegistry(
        contents_manager.root_dir,
        IOLoop.current(),
        # The file contents managers carry the algorithm their hash answers use; sha256 is
        # its default and what a manager without the trait is taken to use.
        getattr(contents_manager, "hash_algorithm", "sha256"),
    )
    handlers = [
        (url_path_join(base_url, NAMESPACE, "status"), StatusHandler),
        (url_path_join(base_url, NAMESPACE, "stat"), StatHandler),
        (url_path_join(base_url, NAMESPACE, "write"), WriteHandler),
        (url_path_join(base_url, NAMESPACE, "events"), EventsHandler),
    ]
    web_app.add_handlers(host_pattern, handlers)
