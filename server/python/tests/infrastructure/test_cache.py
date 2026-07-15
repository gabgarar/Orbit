"""Infrastructure cache tests."""

import time

from orbit_api.infrastructure.ttl_cache import TtlLruCache


def test_cache_expires_and_evicts_least_recent_item():
    cache = TtlLruCache(capacity=1, ttl_seconds=0.01)
    cache.set("a", 1); cache.set("b", 2)
    assert cache.get("a") is None and cache.get("b") == 2
    time.sleep(0.02)
    assert cache.get("b") is None
