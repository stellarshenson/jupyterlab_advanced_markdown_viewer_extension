"""Tests of the copy that keeps a reader's saved settings when the npm name moved their folder."""
import json
import logging
from pathlib import Path
from types import SimpleNamespace

import pytest
from jupyterlab_server.settings_utils import _path

import jupyterlab_advanced_markdown_viewer_extension as extension

REPO = Path(__file__).resolve().parents[2]
SAVED = '{"author": "kj"}'


def old_file(settings_dir):
    # Literal, not the module's constant: the folder JupyterLab really wrote under the old name.
    return settings_dir / "jupyterlab_advanced_markdown_viewer_extension/plugin.jupyterlab-settings"


def new_file(settings_dir):
    # JupyterLab's own path logic and the real package name, not the module's constant.
    name = json.loads((REPO / "package.json").read_text())["name"]
    return Path(_path(str(settings_dir), f"{name}:plugin", extension=".jupyterlab-settings"))


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def carry(settings_dir):
    extension._carry_saved_settings(
        SimpleNamespace(
            web_app=SimpleNamespace(
                settings={"lab": SimpleNamespace(user_settings_dir=str(settings_dir))}
            ),
            log=logging.getLogger(__name__),
        )
    )


def test_the_old_file_is_copied_once_and_stays(tmp_path):
    write(old_file(tmp_path), SAVED)
    carry(tmp_path)
    assert new_file(tmp_path).read_text() == SAVED
    # A change the reader saves after the copy is not undone by the next start.
    write(new_file(tmp_path), '{"author": "changed"}')
    carry(tmp_path)
    assert new_file(tmp_path).read_text() == '{"author": "changed"}'
    assert old_file(tmp_path).read_text() == SAVED


def test_an_existing_new_file_is_not_overwritten(tmp_path):
    write(old_file(tmp_path), SAVED)
    write(new_file(tmp_path), '{"author": "newer"}')
    carry(tmp_path)
    assert new_file(tmp_path).read_text() == '{"author": "newer"}'
    assert old_file(tmp_path).read_text() == SAVED


def test_no_old_file_does_nothing(tmp_path):
    carry(tmp_path)
    assert list(tmp_path.iterdir()) == []


def test_a_failure_logs_a_warning_and_the_old_file_stays(tmp_path, caplog):
    write(old_file(tmp_path), SAVED)
    # A file where the new folder has to go, so the folder cannot be made.
    (tmp_path / "@stellarshenson").write_text("")
    carry(tmp_path)
    warnings = [record.getMessage() for record in caplog.records if record.levelname == "WARNING"]
    assert len(warnings) == 1 and "were not copied" in warnings[0]
    assert old_file(tmp_path).read_text() == SAVED


@pytest.fixture
def settings_dir(tmp_path):
    """A configured settings folder that holds the old file before the server starts."""
    path = tmp_path / "configured-user-settings"
    write(old_file(path), SAVED)
    return path


@pytest.fixture
def jp_server_config(jp_server_config, settings_dir):
    return {
        **jp_server_config,
        "ServerApp": {
            **jp_server_config["ServerApp"],
            "jpserver_extensions": {
                "jupyterlab": True,
                "jupyterlab_advanced_markdown_viewer_extension": True,
            },
        },
        "LabApp": {"user_settings_dir": str(settings_dir)},
    }


def test_a_lab_server_copies_in_the_folder_it_is_configured_with(jp_serverapp, settings_dir):
    assert new_file(settings_dir).read_text() == SAVED
