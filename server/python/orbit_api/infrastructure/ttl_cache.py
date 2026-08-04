"""Thread-safe, bounded TTL cache used by propagation services."""

import datetime
import threading
from collections import OrderedDict
from typing import Generic, TypeVar

from orbit_api.timekeeping import utc_now


T = TypeVar("T")


class TtlLruCache(Generic[T]):
    """Store recently computed values with expiry and least-recently-used eviction."""

    def __init__(self, capacity: int, ttl_seconds: float):
        self._capacity = capacity
        self._ttl = datetime.timedelta(seconds=ttl_seconds)
        self._items: OrderedDict[str, tuple[datetime.datetime, T]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> T | None:
        now = utc_now()
        with self._lock:
            item = self._items.get(key)
            if item is None:
                return None
            valid_until, value = item
            if now >= valid_until:
                self._items.pop(key, None)
                return None
            self._items.move_to_end(key)
            return value

    def set(self, key: str, value: T) -> None:
        valid_until = utc_now() + self._ttl
        with self._lock:
            self._items[key] = (valid_until, value)
            self._items.move_to_end(key)
            while len(self._items) > self._capacity:
                self._items.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
