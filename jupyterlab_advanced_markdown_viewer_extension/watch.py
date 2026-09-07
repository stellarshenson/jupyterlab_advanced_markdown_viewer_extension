"""File-event registry for open Markdown documents.

Keeps the set of documents the browser sessions are watching, holds one watchdog observer
with one non-recursive watch per distinct directory, and reports a change to a registered
document to its subscribers on the tornado IOLoop. Directories are watched rather than files
because a watch on the file itself dies when a writer replaces the file by rename, while a
directory watch survives delete and recreate and costs one descriptor per directory however
many documents it holds.

Containment follows jupyter_server's contents manager: absolute paths are compared without
resolving symbolic links, so a document the contents API serves through a link inside the
root is watched instead of being silently refused. The watch itself is set on the resolved
directory, because watchdog asks inotify not to follow links.

watchdog is a declared dependency, but the registry imports without it: `available` is then
False, register schedules nothing and only `stat` answers, so the frontend falls back to its
batched poll.
"""
import os
import posixpath

try:
    from watchdog.events import (
        DirDeletedEvent,
        FileClosedEvent,
        FileCreatedEvent,
        FileDeletedEvent,
        FileModifiedEvent,
        FileMovedEvent,
        FileSystemEventHandler,
    )
    from watchdog.observers import Observer
except ImportError:  # watchdog absent - the registry answers stat only
    FileSystemEventHandler = object
    Observer = None

# Events are coalesced per path for this long so that a truncate-then-write or a burst of
# writes reaches the browser as one change.
COALESCE_SECONDS = 0.1
# A window restarted by every event delivers nothing at all while a writer keeps writing,
# and a streaming writer - an agent producing a file token by token - is the case this
# extension exists for. The open window is therefore never held longer than this, so such a
# writer is delivered at this rate and still inside the half second the criteria allow.
MAX_COALESCE_SECONDS = 0.4


def _api_path(path):
    """Normalize one JupyterLab API path; None when it is not a path this registry serves.

    Two spellings of one document must reach one registry entry, otherwise the second
    registration hides the first and releasing them leaves the registry inconsistent.

    A first segment carrying a colon is a drive name, which is how JupyterLab spells a
    document served by something other than the contents manager: jupyter-collaboration
    gives every document it manages the drive RTC. This registry reads the server root, so
    it serves no such document. A file whose own first segment carries a colon is refused
    with them, because the two cannot be told apart from the path alone - JupyterLab itself
    tells them apart only by its list of registered drives, which the server does not hold.
    """
    if not isinstance(path, str):
        return None
    normalized = posixpath.normpath(path.lstrip("/"))
    if normalized == "." or normalized == ".." or normalized.startswith("../"):
        return None
    if ":" in normalized.split("/")[0]:
        return None
    return normalized


class _DirectoryHandler(FileSystemEventHandler):
    """Matches the events of one watched directory against the registered names in it."""

    def __init__(self, registry, directory):
        self._registry = registry
        self._directory = directory
        # macOS FSEvents reports every path with its symlinks resolved, so a watch whose
        # own path runs through a link must accept both spellings of the directory.
        self._real_directory = os.path.realpath(directory)

    def on_any_event(self, event):
        # Runs on the observer thread. Only the five kinds below carry a content change or a
        # removal; opened and closed_no_write fire on every read, including the read the
        # frontend performs after a change, and must not report anything.
        if isinstance(event, (FileCreatedEvent, FileModifiedEvent, FileClosedEvent)):
            self._report(event.src_path, "changed")
        elif isinstance(event, FileDeletedEvent):
            self._report(event.src_path, "deleted")
        elif isinstance(event, FileMovedEvent):
            self._report(event.src_path, "deleted")
            self._report(event.dest_path, "changed")
        elif isinstance(event, DirDeletedEvent):
            self._report_gone(event.src_path)

    def _report(self, os_path, kind):
        os_path = os.fsdecode(os_path)
        if os.path.dirname(os_path) in (self._directory, self._real_directory):
            self._registry._dispatch(self._directory, os.path.basename(os_path), kind)

    def _report_gone(self, os_path):
        # The watched directory itself was removed. watchdog stops the emitter of that watch
        # but keeps it in the observer's bookkeeping, so nothing would ever be reported
        # again; the registry drops the watch and the next stat schedules a new one. A rename
        # of the watched directory raises no event of any kind on Linux, and is found by
        # _revive_watches instead.
        if os.fsdecode(os_path) in (self._directory, self._real_directory):
            self._registry._directory_gone(self._directory)


class FileWatchRegistry:
    """Registry of watched document paths, keyed by JupyterLab API path.

    `paths` maps each registered path to its set of subscribers; `watches` maps each watched
    directory (an OS path) to its scheduled watchdog watch. A subscriber is any object with
    an `on_change(path, kind)` method, called on the IOLoop with kind "changed" or "deleted".
    """

    def __init__(self, root_dir, loop):
        self._root = root_dir
        self._abs_root = os.path.abspath(root_dir)
        self._loop = loop
        self.paths = {}
        self.watches = {}
        self._observer = None
        # directory -> {basename: API path}, read by the directory handlers
        self._names = {}
        # directory -> its handler, reused so a failed schedule leaves no second handler
        self._handlers = {}
        # directory -> os.stat of the directory its watch was scheduled on, so that a name
        # now leading somewhere else is found
        self._identities = {}
        # API path -> (kind, timeout handle, time of the first event) while a window is open
        self._pending = {}

    @property
    def available(self):
        """True when watchdog imported, so file events can be delivered."""
        return Observer is not None

    def register(self, path, subscriber):
        """Subscribe to the changes of `path`; a path outside the root is ignored.

        Returns the registry path, the normalized spelling this document is reported under
        internally, or None when the path was ignored.
        """
        path = _api_path(path)
        os_path = None if path is None else self._os_path(path)
        if os_path is None:
            return None
        subscribers = self.paths.get(path)
        if subscribers is None:
            subscribers = self.paths[path] = set()
            directory, name = os.path.split(os_path)
            self._names.setdefault(directory, {})[name] = path
            self._schedule(directory)
        subscribers.add(subscriber)
        return path

    def release(self, path, subscriber):
        """Drop one subscription; the directory watch goes with the last path in it.

        Returns the registry path, as `register` does, or None when there was no such
        subscription.
        """
        path = _api_path(path)
        subscribers = None if path is None else self.paths.get(path)
        if subscribers is None:
            return None
        subscribers.discard(subscriber)
        if subscribers:
            return path
        del self.paths[path]
        self._cancel(path)
        directory, name = os.path.split(self._os_path(path))
        names = self._names[directory]
        del names[name]
        if not names:
            del self._names[directory]
            self._handlers.pop(directory, None)
            self._drop_watch(directory)
        return path

    def release_all(self, subscriber):
        """Drop every subscription held by `subscriber`."""
        for path in [p for p, s in self.paths.items() if subscriber in s]:
            self.release(path, subscriber)

    def stat(self, paths):
        """mtime and size per path from os.stat; None for a file that is not there.

        A path this registry cannot serve is left out of the answer altogether rather than
        answered None: a client reads None as a document deleted from disk, and a path
        naming another drive or lying outside the root names a document that is not this
        registry's to answer for.
        """
        self._revive_watches()
        result = {}
        for path in paths:
            normalized = _api_path(path)
            os_path = None if normalized is None else self._os_path(normalized)
            if os_path is None:
                continue
            try:
                st = os.stat(os_path)
            except FileNotFoundError:
                st = None
            except (OSError, ValueError):
                # The operating system refuses the path or cannot express it, a NUL byte
                # among them; either way it says nothing about a file being gone.
                continue
            result[path] = None if st is None else {"mtime": st.st_mtime, "size": st.st_size}
        return result

    def stop(self):
        """Stop the observer thread and drop every pending window; used by tests."""
        for path in list(self._pending):
            self._cancel(path)
        if self._observer is not None:
            self._observer.stop()
            self._observer.join()
            self._observer = None
            self.watches.clear()
            self._identities.clear()

    def _os_path(self, path):
        os_path = os.path.join(self._root, *path.split("/"))
        if not (os.path.abspath(os_path) + os.sep).startswith(self._abs_root + os.sep):
            return None
        return os_path

    def _schedule(self, directory):
        if not self.available or directory in self.watches:
            return
        try:
            # watchdog asks inotify not to follow symbolic links, so a watch set on a link
            # would report nothing at all: the watch goes on the resolved directory while the
            # handler keeps reporting under the spelling the browser registered.
            target = os.path.realpath(directory)
            # The directory must exist. watchdog registers the handler before it starts the
            # emitter, so a schedule that raises would leave a handler behind that reports
            # every later event of that directory a second time.
            if not os.path.isdir(target):
                return
            identity = os.stat(target)
            if self._observer is None:
                self._observer = Observer()
                self._observer.start()
            handler = self._handlers.get(directory)
            if handler is None:
                handler = self._handlers[directory] = _DirectoryHandler(self, directory)
            self.watches[directory] = self._observer.schedule(handler, target, recursive=False)
            self._identities[directory] = identity
        except (OSError, ValueError):
            # The directory went away between the check and the schedule, or it is a path the
            # operating system cannot express; the path stays registered and a later stat
            # schedules the watch again once the directory is back.
            pass

    def _revive_watches(self):
        # A directory that was deleted, or that did not exist when its document was opened,
        # holds no watch; the frontend's fallback stat is the tick that schedules one again.
        # A watch whose directory was renamed away is worse than no watch: it reports the
        # directory that left under the path of the document that stayed. Renaming a watched
        # directory raises no event watchdog delivers on Linux, so the directory is
        # identified here by its stat instead - one stat per registered directory per
        # fallback tick, and one rule covering rename, swap and delete.
        for directory in list(self._names):
            if directory in self.watches and self._moved_away(directory):
                self._drop_watch(directory)
            if directory not in self.watches:
                self._schedule(directory)

    def _moved_away(self, directory):
        """True when the name no longer leads to the directory its watch was scheduled on."""
        identity = self._identities.get(directory)
        try:
            return identity is None or not os.path.samestat(os.stat(directory), identity)
        except (OSError, ValueError):
            return True

    def _directory_gone(self, directory):
        # Observer thread: the watches are owned by the IOLoop.
        self._loop.add_callback(self._drop_watch, directory)

    def _drop_watch(self, directory):
        watch = self.watches.pop(directory, None)
        self._identities.pop(directory, None)
        # Two directories that resolve to one target share one watchdog watch, which must
        # stand while any of them is still registered.
        if watch is None or self._observer is None or watch in self.watches.values():
            return
        try:
            self._observer.unschedule(watch)
        except KeyError:
            # watchdog already removed the emitter that stopped itself; it still holds this
            # handler, so this one is kept rather than replaced by a second one.
            return
        # The handler matches events against the directory it resolved at construction, so it
        # would discard every event of a name that now leads elsewhere. watchdog dropped it
        # with the watch, and the next schedule builds one against the current target.
        self._handlers.pop(directory, None)

    def _dispatch(self, directory, name, kind):
        # Observer thread: a dict read under the GIL, then a hop to the IOLoop.
        path = self._names.get(directory, {}).get(name)
        if path is not None:
            self._loop.add_callback(self._queue, path, kind)

    def _queue(self, path, kind):
        # Restart the window on every event, but never past MAX_COALESCE_SECONDS after the
        # first event of the window; the last kind wins, which also turns a delete followed
        # by a create or a move-to inside the window into "changed".
        pending = self._pending.pop(path, None)
        now = self._loop.time()
        if pending is None:
            first_at = now
        else:
            first_at = pending[2]
            self._loop.remove_timeout(pending[1])
        delay = min(COALESCE_SECONDS, max(0.0, first_at + MAX_COALESCE_SECONDS - now))
        handle = self._loop.call_later(delay, self._flush, path)
        self._pending[path] = (kind, handle, first_at)

    def _cancel(self, path):
        pending = self._pending.pop(path, None)
        if pending is not None:
            self._loop.remove_timeout(pending[1])

    def _flush(self, path):
        kind = self._pending.pop(path)[0]
        for subscriber in list(self.paths.get(path, ())):
            subscriber.on_change(path, kind)
