"""The agent skill travels in the wheel as shared data (DEF-NOTES-127).

pip puts it under <sys.prefix>/share/jupyter/agents/skills, where the README
links it from. The installed copy is compared with the repository copy, so a
wheel built without the pyproject.toml entry, or before a change to the skill,
fails here.
"""
import pathlib
import sys

NAME = "jupyterlab-advanced-markdown-viewer-extension"
SOURCE = pathlib.Path(__file__).resolve().parents[2] / ".agents/skills" / NAME
INSTALLED = pathlib.Path(sys.prefix) / "share/jupyter/agents/skills" / NAME


def files(root):
    # The watch script's tests import it, which writes bytecode beside it.
    return sorted(
        path.relative_to(root)
        for path in root.rglob("*")
        if path.is_file() and "__pycache__" not in path.parts
    )


def test_the_installed_skill_is_the_repository_skill():
    assert files(SOURCE) == [
        pathlib.Path("SKILL.md"),
        pathlib.Path("scripts/watch-marks.py"),
    ]
    assert files(INSTALLED) == files(SOURCE)
    for name in files(SOURCE):
        assert (INSTALLED / name).read_bytes() == (SOURCE / name).read_bytes()
