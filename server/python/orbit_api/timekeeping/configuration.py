"""Process-startup configuration for deterministic local time data.

No time conversion fetches IERS/NTP data. Operators may mount a pinned
``leap-seconds.list`` file, verify it by SHA-256 and optionally require the
publisher-declared expiry horizon before Orbit begins serving requests.
"""

from __future__ import annotations

import datetime
import os
from collections.abc import Mapping

from .scales import (
    BUILTIN_LEAP_SECOND_TABLE,
    LeapSecondTable,
    LeapSecondTableError,
    configure_default_leap_second_table,
)


def _enabled(value: object) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def load_leap_second_table_from_environment(
    environment: Mapping[str, str] | None = None,
    *,
    now: datetime.datetime | None = None,
) -> LeapSecondTable:
    """Load an opt-in local IERS/NTP leap-second table without mutating state.

    ``ORBIT_LEAP_SECONDS_PATH`` is a filesystem path *inside the running
    process* (``/app/config/eop/leap-seconds.list`` in Compose).  The other
    supported values are ``ORBIT_LEAP_SECONDS_SHA256``, ``_SOURCE``,
    ``_VERSION``, ``_REQUIRED`` and ``_REQUIRE_UNEXPIRED``.
    """

    values = os.environ if environment is None else environment
    path = str(values.get("ORBIT_LEAP_SECONDS_PATH", "")).strip()
    # A strict terrestrial transform depends on both EOP and UTC->TT. Do not
    # let strict EOP accidentally retain the bundled, open-ended leap table.
    required = _enabled(values.get("ORBIT_LEAP_SECONDS_REQUIRED")) or _enabled(values.get("ORBIT_EOP_STRICT"))
    require_unexpired = _enabled(values.get("ORBIT_LEAP_SECONDS_REQUIRE_UNEXPIRED")) or _enabled(
        values.get("ORBIT_EOP_STRICT")
    )
    if not path:
        if required or require_unexpired:
            raise LeapSecondTableError(
                "ORBIT_LEAP_SECONDS_PATH es obligatorio cuando se exige una tabla local de leap seconds"
            )
        return BUILTIN_LEAP_SECOND_TABLE

    table = LeapSecondTable.from_file(
        path,
        source=str(values.get("ORBIT_LEAP_SECONDS_SOURCE", "IERS leap-seconds.list")).strip()
        or "IERS leap-seconds.list",
        version=str(values.get("ORBIT_LEAP_SECONDS_VERSION", "")).strip() or None,
        expected_sha256=str(values.get("ORBIT_LEAP_SECONDS_SHA256", "")).strip() or None,
    )
    if require_unexpired:
        table.require_current(now)
    return table


def configure_timekeeping_from_environment(
    environment: Mapping[str, str] | None = None,
    *,
    now: datetime.datetime | None = None,
) -> LeapSecondTable:
    """Install the startup table used by legacy-compatible conversion helpers."""

    return configure_default_leap_second_table(
        load_leap_second_table_from_environment(environment, now=now)
    )
