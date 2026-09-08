"""Tests of the status, stat, write and events routes and of the file-watch registry.

The tests that need file events run only with watchdog installed; the rest hold either way.
"""
import asyncio
import contextlib
import hashlib
import json
import os
import shutil
import threading
import time

import pytest
from jupyter_server.auth.authorizer import Authorizer
from tornado.httpclient import HTTPClientError

from jupyterlab_advanced_markdown_viewer_extension import watch
from jupyterlab_advanced_markdown_viewer_extension.routes import NAMESPACE, SETTINGS_KEY

WINDOW = 0.2


@pytest.fixture
def registry(jp_serverapp):
    registry = jp_serverapp.web_app.settings[SETTINGS_KEY]
    yield registry
    registry.stop()


async def open_channel(jp_ws_fetch, *paths):
    """Connect the events socket and register `paths`; returns the open connection."""
    ws = await jp_ws_fetch(NAMESPACE, "events")
    ws.write_message(json.dumps({"type": "register", "paths": list(paths)}))
    registered = json.loads(await ws.read_message())
    assert registered == {"type": "registered", "paths": list(paths), "events": True}
    return ws


async def next_message(ws, timeout=WINDOW):
    return json.loads(await asyncio.wait_for(ws.read_message(), timeout))


async def assert_silent(ws, seconds):
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(ws.read_message(), seconds)


async def test_status_reports_events(jp_fetch, registry):
    pytest.importorskip("watchdog")
    response = await jp_fetch(NAMESPACE, "status")
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload["events"] is True
    assert isinstance(payload["version"], str)


async def test_stat(jp_fetch, jp_root_dir, registry):
    (jp_root_dir / "doc.md").write_text("# one\n")
    # a real file outside the root must be refused, not merely reported missing
    (jp_root_dir.parent / "outside.md").write_text("# outside\n")
    body = json.dumps({"paths": ["doc.md", "missing.md", "../outside.md"]})
    response = await jp_fetch(NAMESPACE, "stat", method="POST", body=body)
    assert response.code == 200
    paths = json.loads(response.body)["paths"]
    st = os.stat(jp_root_dir / "doc.md")
    assert paths["doc.md"] == {"mtime": st.st_mtime, "size": st.st_size}
    assert paths["missing.md"] is None
    # refused, which is not the same answer as a file that is not there
    assert "../outside.md" not in paths


async def test_stat_needs_read_on_contents(jp_fetch, jp_serverapp, registry, monkeypatch):
    """The HTTP routes ask the authorizer the same question the events socket asks."""

    class NoContents(Authorizer):
        def is_authorized(self, handler, user, action, resource):
            return not (action == "read" and resource == "contents")

    monkeypatch.setitem(jp_serverapp.web_app.settings, "authorizer", NoContents())
    body = json.dumps({"paths": ["doc.md"]})
    with pytest.raises(HTTPClientError) as refused:
        await jp_fetch(NAMESPACE, "stat", method="POST", body=body)
    assert refused.value.code == 403


async def test_stat_leaves_out_a_path_it_cannot_serve(jp_fetch, jp_root_dir, registry):
    """A path this registry cannot serve is left out of the answer; a file that is not there
    is answered null. A client reads null as a document deleted from disk, and a document on
    another drive - jupyter-collaboration spells every one of its own RTC:doc.md - is not
    deleted, only served by something this registry does not read.
    """
    (jp_root_dir / "doc.md").write_text("# one\n")
    (jp_root_dir / "RTC:doc.md").write_text("# colon\n")
    body = json.dumps({"paths": ["doc.md", "missing.md", "RTC:doc.md", "dir/RTC:doc.md"]})
    response = await jp_fetch(NAMESPACE, "stat", method="POST", body=body)
    assert response.code == 200
    paths = json.loads(response.body)["paths"]
    # a colon in a later segment is part of a file name and says nothing about a drive
    assert list(paths) == ["doc.md", "missing.md", "dir/RTC:doc.md"]
    assert paths["missing.md"] is None
    assert paths["dir/RTC:doc.md"] is None


def test_drive_path_is_ignored(registry):
    """A first segment carrying a colon names a drive this registry does not read; watching
    it would put a watch on the root under a name no event ever carries."""
    registry.register("RTC:doc.md", object())
    assert registry.paths == {}
    assert registry.watches == {}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


async def contents_hash(jp_fetch, path):
    """The hash the contents API reports for `path`, which is what the Context holds."""
    response = await jp_fetch("api", "contents", path, params={"content": "0", "hash": "1"})
    return json.loads(response.body)["hash"]


async def write(jp_fetch, path, expected, content):
    body = json.dumps({"path": path, "expected": expected, "content": content})
    return await jp_fetch(NAMESPACE, "write", method="POST", body=body)


async def test_write_lands_when_expected_matches(jp_fetch, jp_ws_fetch, jp_root_dir, registry):
    """DEF-NOTES-33: the hash the client passes back is the one the contents API gave it, the
    write is reported to the events channel like any other change, and the answer carries
    the hash the file has afterwards."""
    pytest.importorskip("watchdog")
    doc = jp_root_dir / "doc.md"
    doc.write_text("# one\n")
    ws = await open_channel(jp_ws_fetch, "doc.md")
    held = await contents_hash(jp_fetch, "doc.md")
    response = await write(jp_fetch, "doc.md", held, "# one\r\n<!-- m -->\n")
    assert response.code == 200
    assert doc.read_bytes() == b"# one\r\n<!-- m -->\n"
    assert json.loads(response.body) == {"hash": sha256(doc.read_bytes())}
    assert json.loads(response.body)["hash"] == await contents_hash(jp_fetch, "doc.md")
    assert await next_message(ws, 1.0) == {"type": "change", "path": "doc.md", "event": "changed"}
    ws.close()


async def test_write_with_stale_expected_answers_409(jp_fetch, jp_root_dir, registry):
    doc = jp_root_dir / "doc.md"
    doc.write_text("# one\n")
    stale = sha256(b"# zero\n")
    before = os.stat(doc)
    with pytest.raises(HTTPClientError) as refused:
        await write(jp_fetch, "doc.md", stale, "# one\n<!-- m -->\n")
    assert refused.value.code == 409
    current = json.loads(refused.value.response.body)
    assert current == {"content": "# one\n", "hash": sha256(b"# one\n")}
    assert doc.read_bytes() == b"# one\n"
    assert os.stat(doc).st_mtime_ns == before.st_mtime_ns


async def test_concurrent_writes_one_lands(jp_fetch, jp_root_dir, registry, monkeypatch):
    """Two writes carrying the same expected hash race on the per-path lock: one lands and
    the other finds the file changed. The window between read and write is widened with a
    barrier so that, without the lock, both reads happen before either write."""
    doc = jp_root_dir / "doc.md"
    doc.write_text("# one\n")
    expected = sha256(b"# one\n")
    barrier = threading.Barrier(2)
    read_bytes = watch._read_bytes

    def slow_read(os_path):
        data = read_bytes(os_path)
        with contextlib.suppress(threading.BrokenBarrierError):
            barrier.wait(0.3)
        return data

    monkeypatch.setattr(watch, "_read_bytes", slow_read)

    async def attempt(content):
        try:
            return (await write(jp_fetch, "doc.md", expected, content)).code
        except HTTPClientError as error:
            return error.code

    codes = await asyncio.gather(attempt("# one\n<!-- a -->\n"), attempt("# one\n<!-- b -->\n"))
    assert sorted(codes) == [200, 409]
    assert doc.read_text() in ("# one\n<!-- a -->\n", "# one\n<!-- b -->\n")


async def test_write_keeps_the_inode(jp_fetch, jp_root_dir, registry):
    """An agent appending to the file holds it open; a rename would send its next line to
    the unlinked inode, so the write goes into the file that is there."""
    doc = jp_root_dir / "doc.md"
    doc.write_text("# one\n")
    inode = os.stat(doc).st_ino
    with open(doc, "a") as appender:
        response = await write(jp_fetch, "doc.md", sha256(b"# one\n"), "# one\n<!-- m -->\n")
        assert response.code == 200
        assert os.stat(doc).st_ino == inode
        appender.write("next\n")
    assert doc.read_text() == "# one\n<!-- m -->\nnext\n"


async def test_write_outside_the_root_is_refused(jp_fetch, jp_root_dir, registry):
    outside = jp_root_dir.parent / "outside.md"
    outside.write_text("# outside\n")
    with pytest.raises(HTTPClientError) as refused:
        await write(jp_fetch, "../outside.md", sha256(b"# outside\n"), "# replaced\n")
    assert refused.value.code == 404
    assert json.loads(refused.value.response.body)["message"] == "path not served"
    assert outside.read_text() == "# outside\n"


async def test_write_reports_one_change_within_200ms(
    jp_ws_fetch, jp_root_dir, registry, monkeypatch
):
    """ACC-EVENT-81, measured with the coalescing window shortened.

    The criterion's 200 ms covers the fixed coalescing window plus the machine: inotify, the
    observer thread, the IOLoop hop and the socket read. Measuring both against 200 ms leaves
    the machine 100 ms and turns a loaded runner into a failure, so the window is shortened
    here; test_burst_writes_coalesce holds it to its production value separately.
    """
    pytest.importorskip("watchdog")
    monkeypatch.setattr(watch, "COALESCE_SECONDS", 0.01)
    doc = jp_root_dir / "doc.md"
    doc.write_text("# one\n")
    ws = await open_channel(jp_ws_fetch, "doc.md")
    started = time.monotonic()
    doc.write_text("# two\n")
    message = await next_message(ws)
    assert time.monotonic() - started < WINDOW
    assert message == {"type": "change", "path": "doc.md", "event": "changed"}
    await assert_silent(ws, 0.3)
    ws.close()


async def test_burst_writes_coalesce(jp_ws_fetch, jp_root_dir, registry):
    pytest.importorskip("watchdog")
    doc = jp_root_dir / "doc.md"
    doc.write_text("# one\n")
    ws = await open_channel(jp_ws_fetch, "doc.md")
    doc.write_text("# two\n")
    await asyncio.sleep(0.05)
    doc.write_text("# three\n")
    message = await next_message(ws)
    assert message == {"type": "change", "path": "doc.md", "event": "changed"}
    await assert_silent(ws, 0.3)
    ws.close()


async def test_continuous_writer_is_reported_while_it_writes(jp_ws_fetch, jp_root_dir, registry):
    """ACC-EVENT-84 for a streaming writer, the case the extension exists for.

    A window restarted by every event holds everything back until the writer stops, so the
    wait is capped: writing every 50 ms for a second must deliver changes during that second,
    not one message after it.
    """
    pytest.importorskip("watchdog")
    doc = jp_root_dir / "doc.md"
    doc.write_text("# one\n")
    ws = await open_channel(jp_ws_fetch, "doc.md")
    arrivals = []
    started = time.monotonic()

    async def collect():
        while True:
            await ws.read_message()
            arrivals.append(time.monotonic() - started)

    reader = asyncio.ensure_future(collect())
    for index in range(20):
        doc.write_text(f"# line {index}\n")
        await asyncio.sleep(0.05)
    writing_ended = time.monotonic() - started
    reader.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await reader
    ws.close()
    during = [arrival for arrival in arrivals if arrival < writing_ended]
    assert len(during) >= 2
    assert during[0] < watch.MAX_COALESCE_SECONDS + WINDOW


async def test_temp_file_and_rename(jp_ws_fetch, jp_root_dir, registry):
    pytest.importorskip("watchdog")
    doc = jp_root_dir / "doc.md"
    doc.write_text("# one\n")
    ws = await open_channel(jp_ws_fetch, "doc.md")
    temp = jp_root_dir / "doc.md.tmp"
    temp.write_text("# two\n")
    os.replace(temp, doc)
    message = await next_message(ws)
    assert message == {"type": "change", "path": "doc.md", "event": "changed"}
    ws.close()


async def test_delete_then_recreate(jp_ws_fetch, jp_root_dir, registry):
    pytest.importorskip("watchdog")
    doc = jp_root_dir / "doc.md"
    doc.write_text("# one\n")
    ws = await open_channel(jp_ws_fetch, "doc.md")
    os.remove(doc)
    assert await next_message(ws) == {"type": "change", "path": "doc.md", "event": "deleted"}
    doc.write_text("# two\n")
    assert await next_message(ws) == {"type": "change", "path": "doc.md", "event": "changed"}
    assert len(registry.watches) == 1
    ws.close()


async def test_symlinked_directory_inside_the_root_is_watched(jp_ws_fetch, jp_root_dir, registry):
    """A directory reached through a link inside the root is served by the contents API, so
    its documents open in the browser and must be watched like any other."""
    pytest.importorskip("watchdog")
    target = jp_root_dir.parent / "linked_target"
    target.mkdir(exist_ok=True)
    doc = target / "doc.md"
    doc.write_text("# one\n")
    (jp_root_dir / "link").symlink_to(target)
    ws = await open_channel(jp_ws_fetch, "link/doc.md")
    assert registry.stat(["link/doc.md"])["link/doc.md"]["size"] == 6
    doc.write_text("# two\n")
    assert await next_message(ws) == {"type": "change", "path": "link/doc.md", "event": "changed"}
    ws.close()


def test_event_with_symlinks_resolved_still_matches(registry, jp_root_dir):
    """macOS FSEvents reports every path with its symlinks resolved, so a watch whose own
    path runs through a link never matches the directory it was scheduled on."""
    pytest.importorskip("watchdog")
    target = jp_root_dir.parent / "resolved_target"
    target.mkdir(exist_ok=True)
    link = jp_root_dir / "resolved"
    link.symlink_to(target)
    seen = []
    registry._dispatch = lambda directory, name, kind: seen.append((name, kind))
    handler = watch._DirectoryHandler(registry, str(link))
    handler.on_any_event(
        watch.FileModifiedEvent(os.path.join(os.path.realpath(str(link)), "doc.md"))
    )
    assert seen == [("doc.md", "changed")]


async def test_directory_deleted_and_recreated_is_watched_again(
    jp_ws_fetch, jp_fetch, jp_root_dir, registry
):
    """Removing the watched directory stops watchdog's emitter for good, so the watch is
    dropped and the next fallback stat schedules a new one."""
    pytest.importorskip("watchdog")
    sub = jp_root_dir / "sub"
    sub.mkdir()
    (sub / "doc.md").write_text("# one\n")
    ws = await open_channel(jp_ws_fetch, "sub/doc.md")
    shutil.rmtree(sub)
    assert await next_message(ws) == {"type": "change", "path": "sub/doc.md", "event": "deleted"}
    sub.mkdir()
    body = json.dumps({"paths": ["sub/doc.md"]})
    await jp_fetch(NAMESPACE, "stat", method="POST", body=body)
    (sub / "doc.md").write_text("# two\n")
    assert await next_message(ws) == {"type": "change", "path": "sub/doc.md", "event": "changed"}
    ws.close()


async def test_renamed_directory_is_watched_again(jp_ws_fetch, jp_fetch, jp_root_dir, registry):
    """Renaming the watched directory away and putting another one under its name raises no
    event watchdog delivers on Linux, so the watch has to be found stale by its identity: it
    would otherwise report the directory that moved, under the path of the open document."""
    pytest.importorskip("watchdog")
    sub = jp_root_dir / "sub"
    sub.mkdir()
    (sub / "doc.md").write_text("# one\n")
    ws = await open_channel(jp_ws_fetch, "sub/doc.md")
    moved = jp_root_dir / "sub.bak"
    os.rename(sub, moved)
    sub.mkdir()
    (sub / "doc.md").write_text("# two\n")
    body = json.dumps({"paths": ["sub/doc.md"]})
    await jp_fetch(NAMESPACE, "stat", method="POST", body=body)
    (sub / "doc.md").write_text("# three\n")
    assert await next_message(ws, 1.0) == {
        "type": "change",
        "path": "sub/doc.md",
        "event": "changed",
    }
    (moved / "doc.md").write_text("# not this one\n")
    await assert_silent(ws, 0.3)
    ws.close()


async def test_retargeted_symlink_is_watched_again(jp_ws_fetch, jp_fetch, jp_root_dir, registry):
    """Pointing the link at another directory moves the watch, and the new watch must carry a
    handler built for the new target: a handler matches events against the directory it
    resolved at construction, so a reused one discarded every event of the new target and the
    open document raised nothing again until it was reopened."""
    pytest.importorskip("watchdog")
    first = jp_root_dir.parent / "first_target"
    second = jp_root_dir.parent / "second_target"
    first.mkdir()
    second.mkdir()
    (first / "doc.md").write_text("# one\n")
    (second / "doc.md").write_text("# two\n")
    link = jp_root_dir / "link"
    link.symlink_to(first)
    ws = await open_channel(jp_ws_fetch, "link/doc.md")
    link.unlink()
    link.symlink_to(second)
    body = json.dumps({"paths": ["link/doc.md"]})
    await jp_fetch(NAMESPACE, "stat", method="POST", body=body)
    (second / "doc.md").write_text("# three\n")
    assert await next_message(ws, 1.0) == {
        "type": "change",
        "path": "link/doc.md",
        "event": "changed",
    }
    (first / "doc.md").write_text("# not this one\n")
    await assert_silent(ws, 0.3)
    ws.close()


def test_missing_directory_leaves_no_handler_behind(registry):
    """watchdog registers the handler before it starts the emitter, so a schedule that raises
    leaves a handler that reports every later event of that directory once more."""
    pytest.importorskip("watchdog")
    subscriber = object()
    for index in range(3):
        registry.register(f"gone/doc{index}.md", subscriber)
        registry.release(f"gone/doc{index}.md", subscriber)
    handlers = getattr(registry._observer, "_handlers", {})
    assert registry.watches == {}
    assert all(len(handler_set) <= 1 for handler_set in handlers.values())


def test_fifty_paths_share_one_watch(registry):
    pytest.importorskip("watchdog")
    subscriber = object()
    paths = [f"doc{i}.md" for i in range(50)]
    for path in paths:
        registry.register(path, subscriber)
    assert len(registry.paths) == 50
    assert all(registry.paths[path] == {subscriber} for path in paths)
    assert len(registry.watches) == 1
    registry.release_all(subscriber)
    assert registry.paths == {}
    assert registry.watches == {}


def test_two_subscribers_share_a_watch(registry):
    pytest.importorskip("watchdog")
    first, second = object(), object()
    registry.register("doc.md", first)
    registry.register("doc.md", second)
    assert len(registry.watches) == 1
    registry.release("doc.md", first)
    assert registry.paths == {"doc.md": {second}}
    assert len(registry.watches) == 1
    registry.release("doc.md", second)
    assert registry.paths == {}
    assert registry.watches == {}


def test_two_spellings_of_one_path_share_one_registration(registry, jp_root_dir):
    """One document holds one registry entry however the client spells its path; a second
    spelling used to hide the first and releasing them then raised."""
    subscriber = object()
    (jp_root_dir / "dir").mkdir()
    registry.register("dir/doc.md", subscriber)
    registry.register("dir//doc.md", subscriber)
    registry.register("/dir/doc.md", subscriber)
    assert list(registry.paths) == ["dir/doc.md"]
    registry.release("dir//doc.md", subscriber)
    assert registry.paths == {}
    assert registry.watches == {}
    registry.release("dir/doc.md", subscriber)


async def test_every_answer_uses_the_spelling_the_client_sent(
    jp_ws_fetch, jp_fetch, jp_root_dir, registry
):
    """The registered reply, the stat answer and the change message all name a document the
    way its client named it, so a client can key on what it sent; the registry keys the same
    document under one normalized path however its clients spell it."""
    pytest.importorskip("watchdog")
    doc = jp_root_dir / "doc.md"
    doc.write_text("# one\n")
    ws = await open_channel(jp_ws_fetch, "./doc.md")
    plain = await open_channel(jp_ws_fetch, "doc.md")
    body = json.dumps({"paths": ["./doc.md"]})
    response = await jp_fetch(NAMESPACE, "stat", method="POST", body=body)
    assert list(json.loads(response.body)["paths"]) == ["./doc.md"]
    assert list(registry.paths) == ["doc.md"]
    doc.write_text("# two\n")
    assert await next_message(ws, 1.0) == {
        "type": "change",
        "path": "./doc.md",
        "event": "changed",
    }
    assert await next_message(plain, 1.0) == {
        "type": "change",
        "path": "doc.md",
        "event": "changed",
    }
    ws.close()
    plain.close()


def test_path_outside_root_is_ignored(registry):
    registry.register("../outside.md", object())
    assert registry.paths == {}
    assert registry.watches == {}


async def test_malformed_register_keeps_the_connection(jp_ws_fetch, jp_root_dir, registry):
    """A body from anything but this frontend must not abort the socket: the registers that
    follow on the same connection would never be processed."""
    (jp_root_dir / "doc.md").write_text("# one\n")
    ws = await jp_ws_fetch(NAMESPACE, "events")
    for paths in (None, "doc.md", [7]):
        ws.write_message(json.dumps({"type": "register", "paths": paths}))
        assert json.loads(await ws.read_message())["paths"] == []
    ws.write_message(json.dumps({"type": "register", "paths": [7, "doc.md"]}))
    assert json.loads(await ws.read_message())["paths"] == ["doc.md"]
    assert list(registry.paths) == ["doc.md"]
    ws.close()


async def test_stat_ignores_malformed_paths(jp_fetch, jp_root_dir, registry):
    (jp_root_dir / "doc.md").write_text("# one\n")
    # a NUL byte is a path the operating system cannot express: os.stat raises ValueError,
    # which says nothing about a file being gone, so the path is left out of the answer
    nul_path = "with\x00nul.md"
    body = json.dumps({"paths": [7, None, "doc.md", nul_path]})
    response = await jp_fetch(NAMESPACE, "stat", method="POST", body=body)
    assert response.code == 200
    paths = json.loads(response.body)["paths"]
    assert list(paths) == ["doc.md"]
    assert paths["doc.md"]["size"] == 6
    response = await jp_fetch(NAMESPACE, "stat", method="POST", body=json.dumps({"paths": None}))
    assert json.loads(response.body)["paths"] == {}


async def test_without_watchdog(jp_fetch, jp_root_dir, registry, monkeypatch):
    monkeypatch.setattr(watch, "Observer", None)
    assert registry.available is False
    response = await jp_fetch(NAMESPACE, "status")
    assert json.loads(response.body)["events"] is False
    registry.register("doc.md", object())
    assert registry.watches == {}
    (jp_root_dir / "doc.md").write_text("# one\n")
    body = json.dumps({"paths": ["doc.md"]})
    response = await jp_fetch(NAMESPACE, "stat", method="POST", body=body)
    assert json.loads(response.body)["paths"]["doc.md"]["size"] == 6
