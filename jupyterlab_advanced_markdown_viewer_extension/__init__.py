try:
    from ._version import __version__
except ImportError:
    # Fallback when using the package in dev mode without installing
    # in editable mode with pip. It is highly recommended to install
    # the package from a stable release or in editable mode: https://pip.pypa.io/en/stable/topics/local-project-installs/#editable-installs
    import warnings
    warnings.warn("Importing 'jupyterlab_advanced_markdown_viewer_extension' outside a proper installation.")
    __version__ = "dev"
import math

from jupyter_server.services.config import ConfigManager
from traitlets import Bool, Float, Integer, TraitError, Unicode
from traitlets.config import Config, Configurable

from .routes import setup_route_handlers

PAGE_CONFIG_KEY = "advancedMarkdownViewer"


class AdvancedMarkdownViewer(Configurable):
    """Server-wide options of the live preview, set in jupyter_server_config and read at server
    start. Each is None until set; an option left unset keeps the default the frontend carries,
    and the frontend also refuses a value below a minimum or outside the choices."""

    poll_interval = Float(
        None, allow_none=True,
        help="Seconds between the batched fallback checks for filesystems that raise no file "
             "events; file events are the primary path. Minimum 1. Unset: 10.",
    ).tag(config=True)
    fade_duration = Float(
        None, allow_none=True,
        help="Milliseconds the highlight stays on changed text. Minimum 0. Unset: 5000.",
    ).tag(config=True)
    animation_speed = Integer(
        None, allow_none=True,
        help="Characters per second, on average, at which added text is typed in and removed "
             "text deleted; 0 shows a change at once. Unset: 75.",
    ).tag(config=True)
    animation_jitter = Float(
        None, allow_none=True,
        help="How far the time of each typed or deleted character may stray from the even time, "
             "as a share of it, from 0 to 1. Unset: 0.25.",
    ).tag(config=True)
    highlight_visibility = Unicode(
        None, allow_none=True,
        help="Strength of the green and red highlight backgrounds: low, medium or high. "
             "Unset: medium.",
    ).tag(config=True)
    tab_cue = Bool(
        None, allow_none=True,
        help="Mark the document tab with what happened to its file. Unset: True.",
    ).tag(config=True)
    notes = Bool(
        None, allow_none=True,
        help="Marks and notes in the preview; off, the panel, the marks and the marking entries "
             "are hidden. Unset: True.",
    ).tag(config=True)


# Trait name to the frontend's field name in its settings.
FIELDS = {
    "poll_interval": "pollInterval",
    "fade_duration": "fadeDuration",
    "animation_speed": "animationSpeed",
    "animation_jitter": "animationJitter",
    "highlight_visibility": "highlightVisibility",
    "tab_cue": "tabCue",
    "notes": "notes",
}


def _jupyter_labextension_paths():
    return [{
        "src": "labextension",
        "dest": "jupyterlab_advanced_markdown_viewer_extension"
    }]


def _jupyter_server_extension_points():
    return [{
        "module": "jupyterlab_advanced_markdown_viewer_extension"
    }]


def _load_jupyter_server_extension(server_app):
    """Registers the API handler to receive HTTP requests from the frontend extension.

    Parameters
    ----------
    server_app: jupyterlab.labapp.LabApp
        JupyterLab application instance
    """
    setup_route_handlers(server_app.web_app)
    # traitlets reads no jupyter_server_config.d/ file, so it is read here, as jupyter-lsp does;
    # the server's own config takes precedence over it.
    config = Config(
        ConfigManager(read_config_path=server_app.config_file_paths).get("jupyter_server_config")
    )
    config.merge(server_app.config)
    # get, because item access on a Config creates a missing section.
    section = config.get("AdvancedMarkdownViewer", {})
    # A scalar or a list is no set of options, and the loop below would raise on it.
    if not isinstance(section, dict):
        server_app.log.warning(
            f"AdvancedMarkdownViewer is not a section of options "
            f"({type(section).__name__}) and is ignored"
        )
        section = {}
    # The builds below see one known option each, so traitlets never names a misspelt one.
    for key in section:
        if key not in FIELDS:
            server_app.log.warning(
                f"AdvancedMarkdownViewer.{key} = {section[key]!r} is not a known option and is "
                "ignored"
            )
    page_config = {}
    for trait, field in FIELDS.items():
        if trait not in section:
            continue
        # One option per build, so a value of the wrong type loses only its own option; a Config
        # and not setattr, so traitlets still converts a value given on the command line.
        try:
            options = AdvancedMarkdownViewer(
                config=Config({"AdvancedMarkdownViewer": {trait: section[trait]}})
            )
        except TraitError:
            server_app.log.warning(
                f"AdvancedMarkdownViewer.{trait} = {section[trait]!r} has the wrong type and is "
                "ignored"
            )
            continue
        value = getattr(options, trait)
        # The page template would write inf or nan as Infinity or NaN, which no JSON parser reads.
        if isinstance(value, float) and not math.isfinite(value):
            server_app.log.warning(
                f"AdvancedMarkdownViewer.{trait} = {value} is not a finite number and is ignored"
            )
        elif value is not None:
            page_config[field] = value
    server_app.web_app.settings.setdefault("page_config_data", {})[PAGE_CONFIG_KEY] = page_config
    name = "jupyterlab_advanced_markdown_viewer_extension"
    server_app.log.info(f"Registered {name} server extension")
