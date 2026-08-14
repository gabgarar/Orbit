"""Time-aware frame context used by physical force models.

Cowell keeps its integration state in EME2000.  A force tied to the rotating
Earth, however, is evaluated in ITRF at the epoch of *each RK stage* and its
free acceleration vector is rotated back to EME2000.  We intentionally do
not integrate in ITRF: doing so would require centrifugal, Coriolis and Euler
terms in the equations of motion.

This module is intentionally conservative.  A terrestrial force may only use
the strict IAU 2006/2000A + versioned EOP route; the visual UTC≈UT1 fallback
is useful for rendering but is not a force-model input.
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass

from orbit_api.frames import FrameId, FrameTransformService, StateVector
from orbit_api.frames.transforms import FrameTransformationError
from orbit_api.timekeeping import ensure_utc

Vector3 = tuple[float, float, float]


class ForceEvaluationError(ValueError):
    """A requested physical force lacks a valid time/frame context."""


def _as_vector(value: tuple[float, float, float] | list[float], label: str) -> Vector3:
    try:
        result = tuple(float(component) for component in value)
    except (TypeError, ValueError) as exc:
        raise ForceEvaluationError(f"{label} debe tener tres componentes numéricos") from exc
    if len(result) != 3:
        raise ForceEvaluationError(f"{label} debe tener tres componentes")
    return result  # StateVector validates finiteness at the public boundary.


@dataclass(frozen=True, slots=True)
class ForceEvaluationContext:
    """One immutable force-evaluation epoch and its strict frame service.

    ``epoch_utc`` is an actual RK-stage epoch, not merely the initial orbit
    epoch.  Creating a context is cheap; the transformer owns its immutable
    local EOP/leap-second snapshots and keeps the provenance stable.
    """

    epoch_utc: datetime.datetime
    frame_transformer: FrameTransformService
    # Manual-orbit generation may use the process-wide IERS C01 cache.  That
    # service deliberately exposes an explicitly labelled visual/nominal EOP
    # fallback while its first refresh is pending or its coverage is absent.
    # Keeping the opt-in at this force-context boundary means precise GNSS and
    # direct Cowell callers retain their fail-closed contracts by default.
    allow_nominal_earth_orientation: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "epoch_utc", ensure_utc(self.epoch_utc))
        if not isinstance(self.frame_transformer, FrameTransformService):
            raise TypeError("frame_transformer debe ser un FrameTransformService")

    def require_terrestrial_route(self) -> None:
        """Fail closed unless a rigorous Earth-fixed route is configured."""

        transformer = self.frame_transformer
        if not transformer.strict_eop and not self.allow_nominal_earth_orientation:
            raise ForceEvaluationError(
                "La fuerza terrestre requiere EOP local estricto; configura un snapshot "
                "IERS C04 versionado con ORBIT_EOP_STRICT=true."
            )
        self.require_inertial_time_route()
        try:
            # Force coverage/quality to be checked before numerical work.
            transformer.earth_orientation_at(self.epoch_utc)
        except FrameTransformationError as exc:
            raise ForceEvaluationError(str(exc)) from exc
        except ValueError as exc:
            raise ForceEvaluationError(
                f"La fuerza terrestre no tiene datos temporales válidos para "
                f"{self.epoch_utc.isoformat()}: {exc}"
            ) from exc

    def require_inertial_time_route(self) -> None:
        """Require the local ERFA and leap-second contract for inertial forces.

        Third-body and solar-radiation terms are evaluated in EME2000.  They
        need a rigorous UTC-to-TT conversion and the GCRF-to-EME2000 frame
        bias, but not UT1, polar motion, or a terrestrial EOP sample.  Keeping
        this narrower than :meth:`require_terrestrial_route` avoids falsely
        making Sun/Moon/SRP depend on an unrelated ITRF conversion.
        """

        transformer = self.frame_transformer
        try:
            transformer.require_iau2006_2000a()
            leap_seconds = transformer.leap_second_table
            if (
                leap_seconds.version is None
                or leap_seconds.sha256 is None
                or leap_seconds.expires_at is None
            ):
                raise ForceEvaluationError(
                    "La fuerza inercial requiere una tabla local de segundos intercalares "
                    "versionada, con SHA-256 y vigencia publicada."
                )
            leap_seconds.require_coverage(self.epoch_utc, require_unexpired=True)
        except FrameTransformationError as exc:
            raise ForceEvaluationError(str(exc)) from exc
        except ValueError as exc:
            raise ForceEvaluationError(
                f"La fuerza inercial no tiene datos temporales válidos para "
                f"{self.epoch_utc.isoformat()}: {exc}"
            ) from exc

    def eme2000_state_to_itrf(
        self,
        position_km: tuple[float, float, float] | list[float],
        velocity_km_s: tuple[float, float, float] | list[float] | None = None,
    ) -> tuple[Vector3, Vector3 | None]:
        """Transform a stage state to ITRF, including the velocity derivative.

        The returned ITRF velocity contains the rotation-rate contribution and
        is therefore appropriate for atmospheric-relative velocity.  It must
        not be replaced by merely rotating an EME2000 velocity vector.
        """

        self.require_terrestrial_route()
        state = StateVector.from_kilometres(
            epoch=self.epoch_utc,
            time_scale="UTC",
            frame=FrameId.EME2000,
            frame_realization=None,
            center="EARTH",
            position_km=_as_vector(position_km, "La posición EME2000"),
            velocity_km_s=(
                _as_vector(velocity_km_s, "La velocidad EME2000")
                if velocity_km_s is not None
                else None
            ),
            provenance={"force_evaluation": "EME2000-to-ITRF"},
        )
        try:
            result = self.frame_transformer.transform(state, target_frame=FrameId.ITRF)
        except FrameTransformationError as exc:
            raise ForceEvaluationError(str(exc)) from exc
        position = tuple(component / 1_000.0 for component in result.position_m)
        velocity = (
            tuple(component / 1_000.0 for component in result.velocity_m_s)
            if result.velocity_m_s is not None
            else None
        )
        return position, velocity  # type: ignore[return-value]

    def itrf_free_vector_to_eme2000(
        self,
        vector_km_s2: tuple[float, float, float] | list[float],
    ) -> Vector3:
        """Rotate an ITRF free vector to EME2000 without fictitious terms.

        Acceleration is a free physical vector here, not a second derivative
        being transformed between rotating coordinate descriptions.  Encoding
        it in the position slot asks ``FrameTransformService`` for exactly the
        rotation matrix and deliberately avoids its velocity/acceleration
        derivative terms.
        """

        self.require_terrestrial_route()
        vector = _as_vector(vector_km_s2, "La aceleración ITRF")
        state = StateVector.from_kilometres(
            epoch=self.epoch_utc,
            time_scale="UTC",
            frame=FrameId.ITRF,
            frame_realization=None,
            center="EARTH",
            position_km=vector,
            provenance={"force_evaluation": "ITRF-free-vector-to-EME2000"},
        )
        try:
            result = self.frame_transformer.transform(state, target_frame=FrameId.EME2000)
        except FrameTransformationError as exc:
            raise ForceEvaluationError(str(exc)) from exc
        return tuple(component / 1_000.0 for component in result.position_m)  # type: ignore[return-value]

    def provenance(self) -> dict[str, object]:
        """Return auditable identities for a terrestrial force calculation."""

        self.require_terrestrial_route()
        orientation = self.frame_transformer.earth_orientation_at(self.epoch_utc)
        leap_seconds = self.frame_transformer.leap_second_table
        return {
            "epoch_utc": self.epoch_utc.isoformat(),
            "frame_route": "EME2000 -> ITRF -> EME2000",
            "frame_model": "IAU 2006/2000A + IERS EOP",
            "earth_orientation": {
                "source": orientation.source,
                "version": orientation.version,
                "quality": orientation.quality,
                "snapshot_id": orientation.snapshot_id,
            },
            "leap_seconds": {
                "source": leap_seconds.source,
                "version": leap_seconds.version,
                "sha256": leap_seconds.sha256,
                "expires_at": leap_seconds.expires_at.isoformat() if leap_seconds.expires_at else None,
            },
        }
