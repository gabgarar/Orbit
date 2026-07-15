"""Filesystem watcher event filtering tests."""

from orbit_api.infrastructure.config_watcher import ConfigurationWatcher


class Event:
    def __init__(self, path, directory=False): self.src_path, self.is_directory = path, directory


def test_watcher_reloads_only_relevant_files():
    calls = []
    watcher = ConfigurationWatcher(lambda: calls.append("reload"))
    watcher.on_modified(Event("/tmp/other.txt"))
    watcher.on_modified(Event("/tmp/system_config.json"))
    watcher.on_modified(Event("/tmp/catalog.json", directory=True))
    assert calls == ["reload"]
