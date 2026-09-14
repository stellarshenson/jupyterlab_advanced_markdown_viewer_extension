"""Tests of the packaging metadata this extension ships with.

A sibling dropped from the dependency list or renamed is invisible until someone runs
the install, so these tests read pyproject.toml itself, which is the file pip resolves.
"""
import pathlib
import tomllib

import pytest
from packaging.requirements import Requirement

PYPROJECT = pathlib.Path(__file__).resolve().parents[2] / "pyproject.toml"

# The Markdown family, as the COMPAT criteria name it.
SUITE = {
    "jupyterlab_colourful_tab_extension",
    "jupyterlab_edit_markdown_at_content_extension",
    "jupyterlab_export_markdown_extension",
    "jupyterlab_github_markdown_alerts_extension",
    "jupyterlab_markdown_insert_content_extension",
    "jupyterlab_markdown_switch_tab_scrolling_fix",
    "jupyterlab_markdown_syntax_rendering_fix",
    "jupyterlab_markdown_viewer_toc_fix",
    "jupyterlab_paste_content_as_markdown_extension",
    "jupyterlab_refresh_view_extension",
}

# Extensions this one is proved compatible with but does not install. The SVG export
# extension puts Copy as PNG and Save as PNG on the same rendered root, which
# ACC-COMPAT-162 holds this extension to leaving alone; that is a neighbour to not
# break, not a member of the family.
NEIGHBOURS = {"jupyterlab_export_svg_as_png_extension"}


@pytest.fixture(scope="module")
def project():
    return tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))["project"]


@pytest.fixture(scope="module")
def required(project):
    return {Requirement(item).name: Requirement(item) for item in project["dependencies"]}


def test_the_install_brings_the_whole_markdown_family(required):
    """ACC-COMPAT-161: one install command puts every sibling on the machine."""
    assert SUITE <= set(required)


def test_every_sibling_carries_a_version_floor(required):
    """Each floor records the version that sibling was published at on the survey date."""
    for name in SUITE:
        assert required[name].specifier, f"{name} has no version floor"


def test_a_neighbour_is_never_installed_as_a_dependency(project, required):
    """A package this one must not break is not a package this one pulls in."""
    declared = set(required) | {
        Requirement(item).name
        for group in project.get("optional-dependencies", {}).values()
        for item in group
    }
    assert declared.isdisjoint(NEIGHBOURS)
