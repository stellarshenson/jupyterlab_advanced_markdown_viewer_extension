"""Tests of the server options the extension hands the frontend through the page config."""
import json
import logging
from types import SimpleNamespace

import pytest
from traitlets.config import Config

import jupyterlab_advanced_markdown_viewer_extension as extension
from jupyterlab_advanced_markdown_viewer_extension import PAGE_CONFIG_KEY
from jupyterlab_advanced_markdown_viewer_extension.routes import NAMESPACE


@pytest.fixture
def options():
    return {}


@pytest.fixture
def jp_server_config(jp_server_config, options):
    return {**jp_server_config, "AdvancedMarkdownViewer": options}


@pytest.fixture
def conf_d(jp_config_dir):
    """A file in jupyter_server_config.d/ that sets fade_duration 3000, written before the server
    starts."""
    path = jp_config_dir / "jupyter_server_config.d"
    path.mkdir()
    (path / "advanced-markdown-viewer.json").write_text(
        json.dumps({"AdvancedMarkdownViewer": {"fade_duration": 3000}})
    )


def page_config(serverapp):
    return serverapp.web_app.settings["page_config_data"][PAGE_CONFIG_KEY]


@pytest.mark.parametrize("options", [{"fade_duration": 3000}])
def test_a_configured_option_reaches_the_page_config(jp_serverapp):
    assert page_config(jp_serverapp) == {"fadeDuration": 3000.0}


def test_an_unset_option_is_absent_from_the_page_config(jp_serverapp):
    assert page_config(jp_serverapp) == {}


def test_an_option_in_a_config_d_file_reaches_the_page_config(conf_d, jp_serverapp):
    assert page_config(jp_serverapp) == {"fadeDuration": 3000.0}


@pytest.mark.parametrize("options", [{"fade_duration": 1000}])
def test_the_server_config_takes_precedence_over_a_config_d_file(conf_d, jp_serverapp):
    assert page_config(jp_serverapp) == {"fadeDuration": 1000.0}


@pytest.mark.parametrize("options", [
    {trait: value, "tab_cue": False}
    for trait in ("poll_interval", "fade_duration", "animation_jitter")
    for value in (float("inf"), float("nan"))
])
def test_a_float_option_that_is_not_finite_is_absent_from_the_page_config(jp_serverapp):
    assert page_config(jp_serverapp) == {"tabCue": False}


@pytest.mark.parametrize("options", [{"fade_duration": 3000, "tab_cue": "false"}])
async def test_an_option_of_the_wrong_type_loses_only_itself(jp_serverapp, jp_fetch):
    assert page_config(jp_serverapp) == {"fadeDuration": 3000.0}
    response = await jp_fetch(NAMESPACE, "status")
    assert response.code == 200


@pytest.mark.parametrize("section, kind", [(5, "int"), ([1], "list")])
def test_a_section_that_is_not_a_section_is_named_in_one_warning_and_ignored(
    monkeypatch, caplog, section, kind
):
    monkeypatch.setattr(extension, "setup_route_handlers", lambda web_app: None)
    server_app = SimpleNamespace(
        config=Config({"AdvancedMarkdownViewer": section}),
        config_file_paths=[],
        web_app=SimpleNamespace(settings={}),
        log=logging.getLogger(__name__),
    )
    extension._load_jupyter_server_extension(server_app)
    assert page_config(server_app) == {}
    warnings = [record.getMessage() for record in caplog.records if record.levelname == "WARNING"]
    assert warnings == [
        f"AdvancedMarkdownViewer is not a section of options ({kind}) and is ignored"
    ]


def test_a_misspelt_option_is_named_in_one_warning_and_ignored(monkeypatch, caplog):
    # A stand-in server, because the jp_serverapp fixture leaves the server log with no handler
    # and no propagation while the extension loads, so caplog never sees its warnings.
    monkeypatch.setattr(extension, "setup_route_handlers", lambda web_app: None)
    server_app = SimpleNamespace(
        config=Config({"AdvancedMarkdownViewer": {"fade_duraton": 3000, "tab_cue": False}}),
        config_file_paths=[],
        web_app=SimpleNamespace(settings={}),
        log=logging.getLogger(__name__),
    )
    extension._load_jupyter_server_extension(server_app)
    assert page_config(server_app) == {"tabCue": False}
    warnings = [record.getMessage() for record in caplog.records if record.levelname == "WARNING"]
    assert warnings == [
        "AdvancedMarkdownViewer.fade_duraton = 3000 is not a known option and is ignored"
    ]
