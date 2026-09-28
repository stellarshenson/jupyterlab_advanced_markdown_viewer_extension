"""Tests of the watch script the jupyterlab-advanced-markdown-viewer-extension agent skill ships.

The script lives with the skill in .agents/skills, outside the package, so it is loaded
from the repository by path. Only its pure `scan` is tested: the loop around it reads
files and sleeps.
"""
import importlib.util
import pathlib

SCRIPT = (
    pathlib.Path(__file__).resolve().parents[2]
    / ".agents/skills/jupyterlab-advanced-markdown-viewer-extension/scripts/watch-marks.py"
)
SPEC = importlib.util.spec_from_file_location("watch_marks", SCRIPT)
watch_marks = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(watch_marks)

ID = "0f8e5a52-3c1d-4b7a-9e2f-6a1b2c3d4e5f"
USER = "@kj 2026-09-28T09:15:00Z: Per house or per farm?"
MINE = "@claude 2026-09-28T09:16:40Z: Per house, source table 2"


def marked(*lines, attributes="colour=blue"):
    body = "\n".join(lines)
    return f"Cost <!-- mark:{ID} note {attributes}\n{body}\n-->40 EUR<!-- /mark:{ID} -->\n"


def test_a_new_comment_is_reported_with_its_last_line():
    events, known = watch_marks.scan({}, marked(USER), "claude")

    assert events == [f"new note {ID[:8]} | {USER}"]
    assert ID in known


def test_my_own_line_last_is_not_reported():
    _, known = watch_marks.scan({}, marked(USER), "claude")

    events, _ = watch_marks.scan(known, marked(USER, MINE), "claude")

    assert events == []


def test_a_line_the_user_adds_after_mine_is_a_reply():
    _, known = watch_marks.scan({}, marked(USER, MINE), "claude")
    line = "@kj 2026-09-28T09:20:00Z: done"

    events, _ = watch_marks.scan(known, marked(USER, MINE, line), "claude")

    assert events == [f"reply {ID[:8]} | {line}"]


def test_a_change_of_colour_is_not_reported():
    _, known = watch_marks.scan({}, marked(USER), "claude")

    events, _ = watch_marks.scan(known, marked(USER, attributes="colour=red"), "claude")

    assert events == []


def test_a_closed_mark_is_not_reported():
    text = marked(USER, attributes="colour=blue status=closed")

    events, _ = watch_marks.scan({}, text, "claude")

    assert events == []


def test_a_mark_with_no_comment_is_not_reported():
    text = f"Cost <!-- mark:{ID} note colour=green -->40 EUR<!-- /mark:{ID} -->\n"

    events, known = watch_marks.scan({}, text, "claude")

    assert events == []
    assert ID in known


def test_a_table_row_marker_is_read_on_its_one_line():
    text = (
        f"| Heater | <!-- mark:{ID} note colour=red "
        f"@kj 2026-09-28T09:15:00Z: Wrong unit?\\n{MINE} -->40 kWh<!-- /mark:{ID} --> |\n"
    )

    events, _ = watch_marks.scan({}, text, "claude")

    assert events == []

    events, _ = watch_marks.scan({}, text, "someone-else")

    assert events == [f"new note {ID[:8]} | {MINE}"]


def test_a_comment_on_the_whole_document_is_reported():
    text = f"<!-- mark:{ID} document\n{USER}\n-->\n# Title\n"

    events, _ = watch_marks.scan({}, text, "claude")

    assert events == [f"new note {ID[:8]} | {USER}"]


def test_a_read_that_comes_back_empty_does_not_report_the_thread_again():
    # A save truncates the file before it writes, so one read can find it empty.
    _, known = watch_marks.scan({}, marked(USER), "claude")
    _, known = watch_marks.scan(known, "", "claude")

    events, _ = watch_marks.scan(known, marked(USER), "claude")

    assert events == []


def test_a_line_the_user_adds_before_my_next_line_is_reported():
    # The user writes while the assistant works, and both lines land between two passes.
    _, known = watch_marks.scan({}, marked(USER, MINE), "claude")
    line = "@kj 2026-09-28T09:20:00Z: And the heater?"
    later = "@claude 2026-09-28T09:20:03Z: Checked table 3"

    events, _ = watch_marks.scan(known, marked(USER, MINE, line, later), "claude")

    assert events == [f"reply {ID[:8]} | {line}"]
