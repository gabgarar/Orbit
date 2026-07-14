import time

from orbit_api.infrastructure.ttl_cache import TtlLruCache


def test_cache_returns_unexpired_value():
    cache = TtlLruCache(capacity=2, ttl_seconds=1)
    cache.set("orbit", {"samples": 10})
    assert cache.get("orbit") == {"samples": 10}


def test_cache_expires_value():
    cache = TtlLruCache(capacity=2, ttl_seconds=0.01)
    cache.set("orbit", "payload")
    time.sleep(0.02)
    assert cache.get("orbit") is None
