"""SGP4/TLE propagation with TEME native states and a common frame adapter."""

from __future__ import annotations

import datetime
import math

from sgp4.api import Satrec, jday

from orbit_api.frames import FrameId, FrameTransformService, StateVector
from orbit_api.timekeeping import EarthOrientation, ensure_utc, utc_now


_EARTH_ROTATION_RATE_RAD_S = 7.2921150e-5


class SGP4Propagator:
    """Propagate a two-line element set without relabelling its native TEME state."""

    dynamics_reference_frame = FrameId.TEME.value
    dynamics_reference_realization = None
    ephemeris_reference_frame = FrameId.ITRF.value
    ephemeris_reference_realization = None
    model_id = "sgp4"

    def __init__(
        self,
        tle_line1: str,
        tle_line2: str,
        *,
        frame_transformer: FrameTransformService | None = None,
        dut1_seconds: float = 0.0,
    ) -> None:
        self.sat = Satrec.twoline2rv(tle_line1, tle_line2)
        self._frame_transformer = frame_transformer or FrameTransformService()
        # Kept as a compatibility override for callers that previously passed
        # DUT1 directly. New code injects a versioned EOP provider into the
        # shared FrameTransformService instead.
        self._legacy_earth_orientation = (
            EarthOrientation(
                dut1_seconds=dut1_seconds,
                source="legacy SGP4 DUT1 override",
                version="constructor",
                quality="approximate",
            )
            if float(dut1_seconds) != 0.0 else None
        )

    @property
    def frame_transformer(self) -> FrameTransformService:
        return self._frame_transformer

    def propagate(self) -> tuple[float, float, float, float, float, float]:
        return self.propagate_datetime(utc_now())

    @staticmethod
    def _utc(instant: datetime.datetime) -> datetime.datetime:
        return ensure_utc(instant)

    def _teme_state_km(
        self,
        instant: datetime.datetime,
        *,
        strict: bool,
    ) -> tuple[float, float, float, float, float, float]:
        """Evaluate the native SGP4 TEME state at a UTC epoch."""

        utc = self._utc(instant)
        julian_day, julian_fraction = jday(
            utc.year,
            utc.month,
            utc.day,
            utc.hour,
            utc.minute,
            utc.second + (utc.microsecond / 1_000_000.0),
        )
        error_code, position_km, velocity_km_s = self.sat.sgp4(julian_day, julian_fraction)
        if error_code != 0:
            message = f"SGP4 propagation failed with code {error_code}"
            if strict:
                raise ValueError(message)
            print(f"SGP4 propagation warning: code {error_code}")
        return tuple(float(value) for value in (*position_km, *velocity_km_s))  # type: ignore[return-value]

    def native_state_at(self, instant: datetime.datetime, *, strict: bool = True) -> StateVector:
        """Return the native TEME state in SI units and explicit UTC metadata."""

        utc = self._utc(instant)
        x, y, z, vx, vy, vz = self._teme_state_km(utc, strict=strict)
        return StateVector.from_kilometres(
            epoch=utc,
            time_scale="UTC",
            frame=FrameId.TEME,
            frame_realization=None,
            center="EARTH",
            position_km=(x, y, z),
            velocity_km_s=(vx, vy, vz),
            provenance={"source": "TLE", "propagator": self.model_id, "native_frame": "TEME"},
        )

    def state_at(
        self,
        instant: datetime.datetime,
        *,
        target_frame: FrameId | str = FrameId.ITRF,
        target_realization: str | None = None,
    ) -> StateVector:
        """Evaluate TEME then apply the shared explicit frame transformation."""

        return self._frame_transformer.transform(
            self.native_state_at(instant),
            target_frame=target_frame,
            target_realization=target_realization,
            earth_orientation=self._legacy_earth_orientation,
        )

    def propagate_teme_datetime(self, instant: datetime.datetime) -> tuple[float, float, float, float, float, float]:
        """Legacy adapter returning raw TEME kilometres / kilometres-per-second."""

        return self._teme_state_km(instant, strict=True)

    def propagate_datetime(self, instant: datetime.datetime) -> tuple[float, float, float, float, float, float]:
        """Legacy renderer adapter returning ITRF SI components."""

        return self.state_at(instant, target_frame=FrameId.ITRF).components()

    def propagate_offset(self, seconds: float) -> tuple[float, float, float, float, float, float]:
        return self.propagate_datetime(utc_now() + datetime.timedelta(seconds=float(seconds)))

    @staticmethod
    def _teme_to_itrf(x, y, z, vx, vy, vz, gmst):
        """Compatibility helper retained for callers using the old low-level API.

        The production path now goes through :class:`FrameTransformService`,
        which also applies polar motion and records EOP provenance.
        """

        cos_gmst, sin_gmst = math.cos(gmst), math.sin(gmst)
        itrf_x = x * cos_gmst + y * sin_gmst
        itrf_y = -x * sin_gmst + y * cos_gmst
        itrf_vx = vx * cos_gmst + vy * sin_gmst + _EARTH_ROTATION_RATE_RAD_S * itrf_y
        itrf_vy = -vx * sin_gmst + vy * cos_gmst - _EARTH_ROTATION_RATE_RAD_S * itrf_x
        return itrf_x, itrf_y, z, itrf_vx, itrf_vy, vz
