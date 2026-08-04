"""Typed, non-lossy Cartesian-state contract shared by all orbit sources."""

from __future__ import annotations

import datetime
import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import Enum
from types import MappingProxyType

from orbit_api.timekeeping import TimeScale


Vector3 = tuple[float, float, float]
Matrix6 = tuple[tuple[float, float, float, float, float, float], ...]


class FrameId(str, Enum):
    """Well-defined Earth-centred reference frames understood by Orbit."""

    TEME = "TEME"
    GCRF = "GCRF"
    ICRF = "ICRF"
    EME2000 = "EME2000"
    CIRS = "CIRS"
    TIRS = "TIRS"
    PEF = "PEF"
    ITRF = "ITRF"


_FRAME_ALIASES = {
    "J2000": FrameId.EME2000,
    "EME2K": FrameId.EME2000,
    "ITRS": FrameId.ITRF,
}
_AMBIGUOUS_FRAME_LABELS = {"ECI", "ECEF", "EARTHFIXED", "EARTH_FIXED"}


def _normalise_frame(value: FrameId | str) -> tuple[FrameId | str, str | None]:
    if isinstance(value, FrameId):
        return value, None
    label = str(value or "").strip().upper()
    if not label:
        raise ValueError("El marco de referencia es obligatorio")
    compact = "".join(character for character in label if character.isalnum())
    if label in _AMBIGUOUS_FRAME_LABELS or compact in _AMBIGUOUS_FRAME_LABELS:
        raise ValueError("ECI/ECEF son ambiguos; declara TEME, GCRF, EME2000 o una realización ITRF")
    if compact.startswith("ITRF") and compact[4:].isdigit():
        return FrameId.ITRF, compact
    # Match the format readers: IGS20, IGb20 and IGc20 are all source
    # realizations in the IGS terrestrial family. Canonicalizing direct API
    # input to the same pair avoids a reverse datum transform returning
    # ``frame='IGS', realization='IGS20'`` for a requested ``'IGS20'`` target.
    if re.fullmatch(r"IG(?:S|B|C)\d{2,4}", compact):
        return "IGS", compact
    if compact in _FRAME_ALIASES:
        return _FRAME_ALIASES[compact], None
    if compact in FrameId._value2member_map_:
        return FrameId(compact), None
    # Preserve imported source labels such as IGS20. The transform service
    # accepts them only for identity/registered terrestrial transformations.
    return compact, None


def _finite_vector(value: Sequence[object], label: str) -> Vector3:
    if isinstance(value, (str, bytes)):
        raise ValueError(f"{label} debe tener tres componentes")
    try:
        values = tuple(float(component) for component in value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} debe tener tres componentes numéricos") from exc
    if len(values) != 3:
        raise ValueError(f"{label} debe tener tres componentes")
    if not all(math.isfinite(component) for component in values):
        raise ValueError(f"{label} debe contener valores finitos")
    return values  # type: ignore[return-value]


def _finite_matrix(value: Sequence[Sequence[object]] | None) -> Matrix6 | None:
    if value is None:
        return None
    try:
        rows = tuple(tuple(float(component) for component in row) for row in value)
    except (TypeError, ValueError) as exc:
        raise ValueError("La covarianza debe ser una matriz 6x6 numérica") from exc
    if len(rows) != 6 or any(len(row) != 6 for row in rows):
        raise ValueError("La covarianza debe ser una matriz 6x6")
    if not all(math.isfinite(component) for row in rows for component in row):
        raise ValueError("La covarianza debe contener valores finitos")
    return rows  # type: ignore[return-value]


@dataclass(frozen=True, slots=True)
class StateVector:
    """An SI Cartesian state with explicit frame/time provenance.

    A source can keep a frame unknown to Orbit (for example an IGS realization)
    but it cannot enter with the generic labels ``ECI`` or ``ECEF``. This is
    intentional: relabelling an ambiguous vector is worse than rejecting it.
    """

    epoch: datetime.datetime
    time_scale: TimeScale | str
    frame: FrameId | str
    frame_realization: str | None
    center: str
    position_m: Vector3
    velocity_m_s: Vector3 | None = None
    acceleration_m_s2: Vector3 | None = None
    covariance: Matrix6 | None = None
    provenance: Mapping[str, object] = field(default_factory=dict)
    earth_orientation_source: str | None = None
    earth_orientation_version: str | None = None
    earth_orientation_quality: str | None = None
    transform_path: tuple[str, ...] = ()
    earth_orientation_snapshot_id: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.epoch, datetime.datetime) or self.epoch.tzinfo is None:
            raise ValueError("La época debe incluir una zona horaria/escala explícita")
        frame, implied_realization = _normalise_frame(self.frame)
        realization = str(self.frame_realization or implied_realization or "").strip().upper() or None
        center = str(self.center or "").strip().upper()
        if not center:
            raise ValueError("El centro del estado es obligatorio")
        time_scale = TimeScale.from_label(self.time_scale)
        if time_scale is TimeScale.UNKNOWN:
            raise ValueError("La escala temporal del estado no es reconocida")
        object.__setattr__(self, "frame", frame)
        object.__setattr__(self, "frame_realization", realization)
        object.__setattr__(self, "center", center)
        object.__setattr__(self, "time_scale", time_scale)
        object.__setattr__(self, "position_m", _finite_vector(self.position_m, "La posición"))
        if self.velocity_m_s is not None:
            object.__setattr__(self, "velocity_m_s", _finite_vector(self.velocity_m_s, "La velocidad"))
        if self.acceleration_m_s2 is not None:
            object.__setattr__(self, "acceleration_m_s2", _finite_vector(self.acceleration_m_s2, "La aceleración"))
        object.__setattr__(self, "covariance", _finite_matrix(self.covariance))
        object.__setattr__(self, "provenance", MappingProxyType(dict(self.provenance)))
        path = tuple(str(part) for part in self.transform_path if str(part))
        object.__setattr__(self, "transform_path", path)

    @classmethod
    def from_kilometres(
        cls,
        *,
        epoch: datetime.datetime,
        time_scale: TimeScale | str,
        frame: FrameId | str,
        frame_realization: str | None,
        center: str,
        position_km: Sequence[object],
        velocity_km_s: Sequence[object] | None = None,
        **kwargs: object,
    ) -> "StateVector":
        """Build an SI state from propagation engines that use km/km/s."""

        position_m = tuple(float(component) * 1_000.0 for component in position_km)
        velocity_m_s = (
            tuple(float(component) * 1_000.0 for component in velocity_km_s)
            if velocity_km_s is not None else None
        )
        return cls(
            epoch=epoch,
            time_scale=time_scale,
            frame=frame,
            frame_realization=frame_realization,
            center=center,
            position_m=position_m,  # type: ignore[arg-type]
            velocity_m_s=velocity_m_s,  # type: ignore[arg-type]
            **kwargs,
        )

    def components(self) -> tuple[float, float, float, float, float, float]:
        """Return the six SI components for legacy renderer adapters."""

        if self.velocity_m_s is None:
            raise ValueError("El estado no contiene velocidad")
        return (*self.position_m, *self.velocity_m_s)

    @property
    def frame_label(self) -> str:
        """Return a precise human/API frame label including realization."""

        name = self.frame.value if isinstance(self.frame, FrameId) else self.frame
        return self.frame_realization or name

    @property
    def is_terrestrial(self) -> bool:
        return self.frame in {FrameId.ITRF, FrameId.TIRS, FrameId.PEF} or (
            isinstance(self.frame, str) and self.frame.startswith(("IG", "WGS", "PZ"))
        )
