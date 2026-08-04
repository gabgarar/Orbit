"""Filesystem watcher event filtering tests."""

import json

from orbit_api.infrastructure.config_watcher import ConfigurationWatcher


class Event:
    def __init__(self, path, directory=False, destination=None):
        self.src_path, self.is_directory, self.dest_path = path, directory, destination


def write_config(directory, catalog_file):
    (directory / "system_config.json").write_text(
        json.dumps({"system": {}, "data": {"satellites_catalog_file": catalog_file}}),
        encoding="utf-8",
    )


def test_watcher_reloads_only_the_active_configuration_and_catalogue(tmp_path):
    write_config(tmp_path, "mission.tle")
    calls = []
    watcher = ConfigurationWatcher(lambda: calls.append("reload"), tmp_path)
    watcher.on_modified(Event(tmp_path / "other.tle"))
    watcher.on_modified(Event(tmp_path / "mission.tle"))
    watcher.on_modified(Event(tmp_path / "system_config.json"))
    watcher.on_modified(Event(tmp_path / "mission.tle", directory=True))
    assert calls == ["reload", "reload"]


def test_watcher_reloads_when_an_atomic_move_replaces_active_files(tmp_path):
    write_config(tmp_path, "mission.tle")
    calls = []
    watcher = ConfigurationWatcher(lambda: calls.append("reload"), tmp_path)
    watcher.on_moved(Event(tmp_path / ".mission.tle.tmp", destination=tmp_path / "mission.tle"))
    watcher.on_moved(Event(tmp_path / ".system_config.tmp", destination=tmp_path / "system_config.json"))
    watcher.on_moved(Event(tmp_path / "other.tle", destination=tmp_path / "archive.tle"))
    assert calls == ["reload", "reload"]
