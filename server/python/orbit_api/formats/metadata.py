"""Metadata contracts shared by ephemeris interchange-format readers.

The readers in :mod:`orbit_api.formats` deliberately only describe a file.
They do not propagate, interpolate or transform a state vector.  In
particular, a timestamp is always accompanied by its declared time scale and
a reference-frame label is never silently renamed to a different realization.
"""

from __future__ import annotations

import datetime
import re
from dataclasses import dataclass

from orbit_api.timekeeping import TimeScale


# IGS operational products progressed from IGS20 to IGb20 and then IGc20.
# The latter transition is documented by IGSMAIL-8634:
# https://lists.igs.org/pipermail/igsmail/2025/008630.html
# These are parser labels only.  Grouping them under ``IGS`` preserves their
# source provenance; it does not register a datum operation to any ITRF frame.
_IGS_REALIZATION_PATTERN = re.compile(r"IG(?:S|B|C)\d{2,4}")


class EphemerisFormatError(ValueError):
    """Raised when an SP3 or OEM header cannot be interpreted safely."""


@dataclass(frozen=True, slots=True)
class ReferenceFrame:
    """A source frame with its explicitly declared realization, if any.

    ``label`` is the exact normalized label from the file.  ``family`` is only
    a conservative grouping used by Orbit: for example ``ITRF2020`` becomes
    ``family='ITRF', realization='ITRF2020'`` and ``IGS14`` becomes
    ``family='IGS', realization='IGS14'``.  The operational variants
    ``IGb20`` and ``IGc20`` are treated the same way. IGS realizations are
    intentionally not relabelled as ITRF because that would lose provenance
    and can imply a transformation that has not actually been performed.
    """

    family: str
    realization: str | None
    label: str


def parse_reference_frame(value: str) -> ReferenceFrame:
    """Build a non-lossy frame reference from an SP3/OEM frame label."""

    label = _normalized_label(value, field_name="REF_FRAME")
    compact = re.sub(r"[\s_-]+", "", label)

    if compact == "ITRF":
        return ReferenceFrame(family="ITRF", realization=None, label="ITRF")
    if re.fullmatch(r"ITRF\d{2,4}", compact):
        return ReferenceFrame(family="ITRF", realization=compact, label=compact)
    if compact in {"ITRS", "WGS84", "PZ90"}:
        return ReferenceFrame(family=compact, realization=None, label=compact)
    if _IGS_REALIZATION_PATTERN.fullmatch(compact):
        return ReferenceFrame(family="IGS", realization=compact, label=compact)
    return ReferenceFrame(family=label, realization=None, label=label)


def _normalized_label(value: str, *, field_name: str) -> str:
    if not isinstance(value, str):
        raise EphemerisFormatError(f"{field_name} debe ser texto")
    label = value.strip().upper()
    if not label:
        raise EphemerisFormatError(f"{field_name} no puede estar vacío")
    return label


@dataclass(frozen=True, slots=True)
class Sp3Metadata:
    """Header metadata needed to interpret an SP3 ephemeris safely.

    ``epoch`` is a calendar value with no Python timezone attached.  Its scale
    is exactly ``time_scale``/``time_scale_label``; callers must convert it
    explicitly rather than assuming UTC.
    """

    version: str
    record_type: str
    epoch: datetime.datetime
    number_of_epochs: int | None
    data_used: str | None
    reference_frame: ReferenceFrame
    time_scale: TimeScale
    time_scale_label: str
    orbit_type: str | None
    agency: str | None

    @property
    def format_name(self) -> str:
        return "SP3"


@dataclass(frozen=True, slots=True)
class OemSegmentMetadata:
    """The metadata block for one OEM segment.

    OEM files may contain multiple segments with different source frames or
    time systems.  Keeping metadata at segment granularity prevents consumers
    from accidentally treating the entire file as one homogeneous ephemeris.
    Epoch strings remain raw because their interpretation belongs to the
    declared ``time_scale``.
    """

    object_name: str | None
    object_id: str | None
    center_name: str | None
    reference_frame: ReferenceFrame
    time_scale: TimeScale
    time_scale_label: str
    start_time: str | None
    stop_time: str | None
    usable_start_time: str | None
    usable_stop_time: str | None
    interpolation: str | None
    interpolation_degree: int | None
    comments: tuple[str, ...]
    extensions: tuple[tuple[str, str], ...]


@dataclass(frozen=True, slots=True)
class OemMetadata:
    """File-level OEM metadata plus its independently-described segments."""

    version: str
    creation_date: str | None
    originator: str | None
    comments: tuple[str, ...]
    segments: tuple[OemSegmentMetadata, ...]
    extensions: tuple[tuple[str, str], ...]

    @property
    def format_name(self) -> str:
        return "OEM"
