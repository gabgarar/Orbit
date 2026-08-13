"""Local, explicitly approximate celestial-force primitives.

This module deliberately has no downloader and no hidden ephemeris cache.  It
wraps the ERFA routines already used by Orbit's frame service and exposes the
model, revision, temporal coverage and leap-second identity alongside every
state.  It is a data/physics building block only: a numerical propagator must
still put its satellite state and the returned body vector in one declared
inertial frame before adding a force.

The two ERFA routines have different published accuracy envelopes:

* ``eraEpv00`` supplies the Earth's heliocentric vector from a simplified
  VSOP2000 solution.  Its documented comparison interval is 1900--2100.
  Negating that vector gives an *approximate* geocentric Sun vector.  ERFA
  expresses it on BCRS axes; this module labels its use as a GCRS-compatible
  geometric approximation rather than silently claiming a relativistic BCRS
  to GCRS reduction.
* ``eraMoon98`` supplies a geocentric lunar vector from the Meeus 1998
  solution.  Its published comparison interval is 1950--2100 and it is
  already expressed in GCRS.

UTC is converted locally to TT using Orbit's pinned leap-second table.  ERFA
allows TT in place of TDB for these approximate routines, and that substitution
is retained in provenance.  No network I/O occurs here.
"""

from __future__ import annotations

import datetime
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from types import MappingProxyType

try:  # ``pyerfa`` is a runtime dependency, but keep the error actionable.
    import erfa as _erfa
except ImportError:  # pragma: no cover - exercised only in a broken deployment.
    _erfa = None

from orbit_api.frames import FrameId, StateVector
from orbit_api.timekeeping import (
    LeapSecondTable,
    TimeScale,
    default_leap_second_table,
    ensure_utc,
    utc_to_tt,
)

Vector3 = tuple[float, float, float]

# IAU 2012 Resolution B2 defines the astronomical unit exactly.  ERFA's DAU
# uses that same SI value; retaining a fallback also keeps module constants
# inspectable if a deployment is missing pyerfa.
ASTRONOMICAL_UNIT_METRES = float(getattr(_erfa, "DAU", 149_597_870_700.0))
SECONDS_PER_DAY = 86_400.0

# SI gravitational parameters used by the differential acceleration helper.
# The solar value is the IAU 2015 nominal GM_sun.  The lunar value is the
# DE440-compatible Earth-centred lunar GM convention used in astrodynamics.
SUN_GRAVITATIONAL_PARAMETER_M3_S2 = 1.327_124_4e20
MOON_GRAVITATIONAL_PARAMETER_M3_S2 = 4.902_800_118e12

# Engineering cannonball-SRP reference values.  The pressure is the nominal
# solar-radiation pressure at one astronomical unit; callers must supply Cr,
# exposed area and mass explicitly.
SOLAR_RADIATION_PRESSURE_1_AU_N_M2 = 4.56e-6
EARTH_EQUATORIAL_RADIUS_METRES = 6_378_137.0

CELESTIAL_EPHEMERIS_PROVIDER_ID = "orbit-celestial-erfa"
CELESTIAL_EPHEMERIS_PROVIDER_VERSION = "1"
ERFA_VERSION = str(getattr(_erfa, "__version__", "unavailable"))

SUN_BODY = "SUN"
MOON_BODY = "MOON"

_SUN_MODEL = "ERFA eraEpv00 (simplified VSOP2000 Earth heliocentric solution)"
_SUN_MODEL_REVISION = "ERFA 2023-03-01"
_MOON_MODEL = "ERFA eraMoon98 (Meeus 1998 lunar theory)"
_MOON_MODEL_REVISION = "ERFA 2023-03-20"
_MODEL_START = {
    SUN_BODY: datetime.datetime(1900, 1, 1, tzinfo=datetime.UTC),
    MOON_BODY: datetime.datetime(1950, 1, 1, tzinfo=datetime.UTC),
}
_MODEL_END_EXCLUSIVE = {
    SUN_BODY: datetime.datetime(2101, 1, 1, tzinfo=datetime.UTC),
    MOON_BODY: datetime.datetime(2101, 1, 1, tzinfo=datetime.UTC),
}
_MODEL_DESCRIPTION = {
    SUN_BODY: _SUN_MODEL,
    MOON_BODY: _MOON_MODEL,
}
_MODEL_REVISION = {
    SUN_BODY: _SUN_MODEL_REVISION,
    MOON_BODY: _MOON_MODEL_REVISION,
}


class CelestialEphemerisError(ValueError):
    """Raised when a local celestial state or force cannot be evaluated."""


class CelestialEphemerisCoverageError(CelestialEphemerisError):
    """Raised when an epoch lies outside an ERFA model's declared envelope."""


def _finite_vector(value: Sequence[object], label: str) -> Vector3:
    if isinstance(value, (str, bytes)):
        raise CelestialEphemerisError(f"{label} debe tener tres componentes numéricos")
    try:
        result = tuple(float(component) for component in value)
    except (TypeError, ValueError) as exc:
        raise CelestialEphemerisError(f"{label} debe tener tres componentes numéricos") from exc
    if len(result) != 3 or not all(math.isfinite(component) for component in result):
        raise CelestialEphemerisError(f"{label} debe tener tres componentes finitos")
    return result  # type: ignore[return-value]


def _finite_positive(value: object, label: str, *, allow_zero: bool = False) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise CelestialEphemerisError(f"{label} debe ser numérico") from exc
    if not math.isfinite(number) or (number < 0.0 if allow_zero else number <= 0.0):
        comparison = "mayor o igual que cero" if allow_zero else "mayor que cero"
        raise CelestialEphemerisError(f"{label} debe ser finito y {comparison}")
    return number


def _finite_unit_interval(value: object, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise CelestialEphemerisError(f"{label} debe ser numérico") from exc
    if not math.isfinite(number) or not 0.0 <= number <= 1.0:
        raise CelestialEphemerisError(f"{label} debe estar entre 0 y 1")
    return number


def _dot(left: Vector3, right: Vector3) -> float:
    return sum(a * b for a, b in zip(left, right, strict=True))


def _subtract(left: Vector3, right: Vector3) -> Vector3:
    return tuple(a - b for a, b in zip(left, right, strict=True))  # type: ignore[return-value]


def _scale(vector: Vector3, scalar: float) -> Vector3:
    return tuple(component * scalar for component in vector)  # type: ignore[return-value]


def _matvec(matrix: Sequence[Sequence[object]], vector: Vector3) -> Vector3:
    """Apply one finite 3x3 rotation without importing frame internals."""

    try:
        result = tuple(
            sum(float(matrix[row][column]) * vector[column] for column in range(3))
            for row in range(3)
        )
    except (IndexError, TypeError, ValueError) as exc:
        raise CelestialEphemerisError("ERFA devolvió una matriz de sesgo de marco inválida") from exc
    if len(result) != 3 or not all(math.isfinite(component) for component in result):
        raise CelestialEphemerisError("La rotación GCRS a EME2000 no es finita")
    return result  # type: ignore[return-value]


def _norm(vector: Vector3) -> float:
    return math.hypot(*vector)


def _require_nonzero_norm(vector: Vector3, label: str) -> float:
    norm = _norm(vector)
    if not math.isfinite(norm) or norm <= 0.0:
        raise CelestialEphemerisError(f"{label} no puede tener norma cero")
    return norm


def _normalise_body(value: object) -> str:
    body = str(value or "").strip().upper()
    aliases = {"SUN": SUN_BODY, "SOL": SUN_BODY, "MOON": MOON_BODY, "LUNA": MOON_BODY}
    canonical = aliases.get(body)
    if canonical is None:
        raise CelestialEphemerisError("Cuerpo celeste no compatible; use SUN o MOON")
    return canonical


def _format_utc(moment: datetime.datetime) -> str:
    return ensure_utc(moment).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True, slots=True)
class CelestialEphemeris:
    """Provide local, approximate Sun and Moon states with immutable provenance.

    ``leap_seconds`` is injected rather than downloaded, making an execution
    reproducible.  Setting ``require_unexpired_leap_seconds`` is appropriate
    for a strict operational path: the provider then fails rather than using a
    snapshot past its publisher-declared ``#@`` horizon.
    """

    leap_seconds: LeapSecondTable = field(default_factory=default_leap_second_table)
    require_unexpired_leap_seconds: bool = False

    def __post_init__(self) -> None:
        if _erfa is None:
            raise CelestialEphemerisError(
                "CelestialEphemeris requiere pyerfa/ERFA; instale las dependencias del runtime de Orbit"
            )
        if not isinstance(self.leap_seconds, LeapSecondTable):
            raise TypeError("leap_seconds debe ser una LeapSecondTable")

    @property
    def provider_id(self) -> str:
        """Stable implementation identifier suitable for manifests and caches."""

        return CELESTIAL_EPHEMERIS_PROVIDER_ID

    @property
    def provider_version(self) -> str:
        """Return Orbit's provider-contract version, not a precision claim."""

        return CELESTIAL_EPHEMERIS_PROVIDER_VERSION

    @property
    def identity_token(self) -> tuple[str, str, str, str, str | None, str | None]:
        """Return every local input that can change a body-state result."""

        return (
            self.provider_id,
            self.provider_version,
            ERFA_VERSION,
            self.leap_seconds.source,
            self.leap_seconds.version,
            self.leap_seconds.sha256,
        )

    def provenance(self) -> Mapping[str, object]:
        """Describe the fixed local provider without evaluating an epoch."""

        return MappingProxyType({
            "provider": self.provider_id,
            "provider_version": self.provider_version,
            "implementation": "pyerfa/ERFA",
            "erfa_version": ERFA_VERSION,
            "network_access": False,
            "time_conversion": {
                "input_scale": "UTC",
                "evaluation_scale": "TT",
                "tdb_substitution": "TT is used where ERFA permits TT in place of TDB for these approximate models",
                "leap_seconds": {
                    "source": self.leap_seconds.source,
                    "version": self.leap_seconds.version,
                    "sha256": self.leap_seconds.sha256,
                    "expires_at": _format_utc(self.leap_seconds.expires_at) if self.leap_seconds.expires_at else None,
                    "require_unexpired": self.require_unexpired_leap_seconds,
                },
            },
            "bodies": {
                SUN_BODY: self._body_provenance(SUN_BODY),
                MOON_BODY: self._body_provenance(MOON_BODY),
            },
        })

    def _body_provenance(self, body: str) -> dict[str, object]:
        return {
            "model": _MODEL_DESCRIPTION[body],
            "model_revision": _MODEL_REVISION[body],
            "documented_coverage_start": _format_utc(_MODEL_START[body]),
            "documented_coverage_end_exclusive": _format_utc(_MODEL_END_EXCLUSIVE[body]),
            "reference_center": "EARTH",
            "reference_frame": "GCRS",
            "frame_note": (
                "eraEpv00 is expressed on BCRS axes; Orbit uses its negated Earth-heliocentric vector "
                "as a GCRS-compatible geometric approximation without a relativistic BCRS-to-GCRS correction"
                if body == SUN_BODY else
                "eraMoon98 returns an approximate geocentric GCRS vector"
            ),
        }

    def state_at(self, body: str, epoch: datetime.datetime) -> StateVector:
        """Return an approximate Earth-centred ``GCRS`` body state in SI units.

        The returned state remains explicit about its model and coverage.  A
        caller that combines it with a satellite state must first ensure that
        both vectors are expressed in the same inertial frame and epoch.
        """

        canonical_body = _normalise_body(body)
        utc = ensure_utc(epoch)
        self._validate_coverage(canonical_body, utc)
        tt1, tt2 = self._tt_julian_date_parts(utc)

        if canonical_body == SUN_BODY:
            # ``epv00`` returns Earth relative to Sun (heliocentric) in AU and
            # AU/day.  Negating it yields the geocentric Sun vector.
            earth_heliocentric, _earth_barycentric = _erfa.epv00(tt1, tt2)  # type: ignore[union-attr]
            raw_position = _scale(_finite_vector(earth_heliocentric[0], "Posición heliocéntrica ERFA"), -1.0)
            raw_velocity = _scale(_finite_vector(earth_heliocentric[1], "Velocidad heliocéntrica ERFA"), -1.0)
        else:
            moon = _erfa.moon98(tt1, tt2)  # type: ignore[union-attr]
            raw_position = _finite_vector(moon[0], "Posición lunar ERFA")
            raw_velocity = _finite_vector(moon[1], "Velocidad lunar ERFA")

        position_m = _scale(raw_position, ASTRONOMICAL_UNIT_METRES)
        velocity_m_s = _scale(raw_velocity, ASTRONOMICAL_UNIT_METRES / SECONDS_PER_DAY)
        # StateVector independently rejects non-finite components.  Keep this
        # explicit check at the provider boundary so an ERFA anomaly receives a
        # contextual error rather than a generic state-contract message.
        if not all(math.isfinite(component) for component in (*position_m, *velocity_m_s)):
            raise CelestialEphemerisError(f"ERFA devolvió un estado no finito para {canonical_body}")

        provenance = dict(self.provenance())
        provenance.update({
            "celestial_body": canonical_body,
            "ephemeris_model": _MODEL_DESCRIPTION[canonical_body],
            "ephemeris_model_revision": _MODEL_REVISION[canonical_body],
            "ephemeris_documented_coverage": {
                "start": _format_utc(_MODEL_START[canonical_body]),
                "end_exclusive": _format_utc(_MODEL_END_EXCLUSIVE[canonical_body]),
            },
            "evaluation_epoch_tt": self._tt_isoformat(utc),
            "source_units": {"position": "AU", "velocity": "AU/day"},
            "output_units": {"position": "m", "velocity": "m/s"},
        })
        return StateVector(
            epoch=utc,
            time_scale=TimeScale.UTC,
            frame=FrameId.GCRF,
            frame_realization=None,
            center="EARTH",
            position_m=position_m,
            velocity_m_s=velocity_m_s,
            provenance=provenance,
        )

    def sun_state_at(self, epoch: datetime.datetime) -> StateVector:
        """Return the local approximate geocentric Sun state."""

        return self.state_at(SUN_BODY, epoch)

    def moon_state_at(self, epoch: datetime.datetime) -> StateVector:
        """Return the local approximate geocentric Moon state."""

        return self.state_at(MOON_BODY, epoch)

    def eme2000_state_at(self, body: str, epoch: datetime.datetime) -> StateVector:
        """Return the local body state in Orbit's EME2000 compatibility axes.

        ERFA's ``bp00`` frame-bias matrix maps GCRS axes to mean J2000 axes.
        This inertial conversion deliberately uses TT and the pinned leap-
        second table only: Earth orientation parameters belong to an
        ITRF/terrestrial conversion and are not required to evaluate a
        Sun/Moon differential force in EME2000.
        """

        source = self.state_at(body, epoch)
        tt1, tt2 = self._tt_julian_date_parts(source.epoch)
        try:
            frame_bias, _precession, _bias_precession = _erfa.bp00(tt1, tt2)  # type: ignore[union-attr]
        except Exception as exc:  # ERFA exposes specialised exception types.
            raise CelestialEphemerisError(
                "No se pudo obtener el sesgo GCRS a EME2000 de ERFA"
            ) from exc
        position_m = _matvec(frame_bias, source.position_m)
        velocity_m_s = (
            _matvec(frame_bias, source.velocity_m_s)
            if source.velocity_m_s is not None
            else None
        )
        provenance = dict(source.provenance)
        provenance["frame_transform"] = {
            "source_frame": "GCRF",
            "target_frame": "EME2000",
            "path": ["GCRF", "EME2000"],
            "model": "ERFA bp00 frame bias",
            "earth_orientation_required": False,
        }
        return StateVector(
            epoch=source.epoch,
            time_scale=source.time_scale,
            frame=FrameId.EME2000,
            frame_realization=None,
            center=source.center,
            position_m=position_m,
            velocity_m_s=velocity_m_s,
            provenance=provenance,
            transform_path=("GCRF", "EME2000"),
        )

    def _validate_coverage(self, body: str, utc: datetime.datetime) -> None:
        start, end = _MODEL_START[body], _MODEL_END_EXCLUSIVE[body]
        if not start <= utc < end:
            raise CelestialEphemerisCoverageError(
                f"{body} solo está disponible entre {_format_utc(start)} y {_format_utc(end)} "
                "según la cobertura documentada del modelo ERFA"
            )
        try:
            self.leap_seconds.require_coverage(
                utc,
                require_unexpired=self.require_unexpired_leap_seconds,
            )
        except ValueError as exc:
            raise CelestialEphemerisCoverageError(
                "La tabla local de segundos intercalares no cubre la época solicitada para la efeméride celeste"
            ) from exc

    def _tt_julian_date_parts(self, utc: datetime.datetime) -> tuple[float, float]:
        """Return a SOFA-compatible two-part TT Julian Date using local UTC–TAI."""

        tt = utc_to_tt(utc, leap_seconds=self.leap_seconds)
        seconds = tt.second + (tt.microsecond / 1_000_000.0)
        try:
            first, second = _erfa.dtf2d("TT", tt.year, tt.month, tt.day, tt.hour, tt.minute, seconds)  # type: ignore[union-attr]
        except Exception as exc:  # ERFA exposes several specialised exception types.
            raise CelestialEphemerisError("No se pudo convertir la época UTC a fecha juliana TT para ERFA") from exc
        return float(first), float(second)

    def _tt_isoformat(self, utc: datetime.datetime) -> str:
        # The calendar representation comes from a UTC-aware ``datetime`` for
        # convenience, but its *scale* is TT.  Do not render a trailing ``Z``:
        # that would incorrectly claim this is a UTC timestamp.
        tt = utc_to_tt(utc, leap_seconds=self.leap_seconds)
        return f"{tt.isoformat().replace('+00:00', '')} TT"


def differential_third_body_acceleration(
    satellite_position_m: Sequence[object],
    body_position_m: Sequence[object],
    body_gravitational_parameter_m3_s2: object,
) -> Vector3:
    """Return Earth-centred differential third-body acceleration in m/s².

    Both positions must be Earth-centred and expressed in the same inertial
    frame at the same epoch.  The indirect Earth acceleration is retained:

    ``mu_b * ((r_b-r)/|r_b-r|³ - r_b/|r_b|³)``.

    Consequently the acceleration is exactly zero at the Earth origin; using
    the direct term alone would incorrectly accelerate the geocentric origin.
    """

    satellite = _finite_vector(satellite_position_m, "La posición del satélite")
    body = _finite_vector(body_position_m, "La posición del tercer cuerpo")
    gravitational_parameter = _finite_positive(
        body_gravitational_parameter_m3_s2,
        "El parámetro gravitatorio del tercer cuerpo",
    )
    body_to_satellite = _subtract(body, satellite)
    body_distance = _require_nonzero_norm(body, "La posición del tercer cuerpo")
    separation = _require_nonzero_norm(body_to_satellite, "La separación satélite-tercer cuerpo")
    direct = _scale(body_to_satellite, 1.0 / (separation ** 3))
    indirect = _scale(body, 1.0 / (body_distance ** 3))
    acceleration = _scale(_subtract(direct, indirect), gravitational_parameter)
    if not all(math.isfinite(component) for component in acceleration):
        raise CelestialEphemerisError("La aceleración de tercer cuerpo no es finita")
    return acceleration


def cannonball_solar_radiation_pressure_acceleration(
    satellite_position_m: Sequence[object],
    sun_position_m: Sequence[object],
    *,
    reflectivity_coefficient: object,
    area_m2: object,
    mass_kg: object,
    eclipse_factor: object = 1.0,
    solar_radiation_pressure_1_au_n_m2: object = SOLAR_RADIATION_PRESSURE_1_AU_N_M2,
) -> Vector3:
    """Return cannonball SRP acceleration away from the Sun in m/s².

    ``satellite_position_m`` and ``sun_position_m`` must share one
    Earth-centred inertial frame.  The function does not infer attitude:
    ``reflectivity_coefficient`` and illuminated projected ``area_m2`` are
    explicit effective cannonball parameters.  ``eclipse_factor`` is normally
    the binary value from :func:`cylindrical_umbra_eclipse_factor`.
    """

    satellite = _finite_vector(satellite_position_m, "La posición del satélite")
    sun = _finite_vector(sun_position_m, "La posición del Sol")
    reflectivity = _finite_positive(reflectivity_coefficient, "El coeficiente de reflectividad", allow_zero=True)
    area = _finite_positive(area_m2, "El área de referencia", allow_zero=True)
    mass = _finite_positive(mass_kg, "La masa")
    illumination = _finite_unit_interval(eclipse_factor, "El factor de eclipse")
    reference_pressure = _finite_positive(
        solar_radiation_pressure_1_au_n_m2,
        "La presión solar de referencia",
        allow_zero=True,
    )

    # From Sun to satellite: SRP pushes in this outgoing direction.
    sun_to_satellite = _subtract(satellite, sun)
    distance = _require_nonzero_norm(sun_to_satellite, "La distancia Sol-satélite")
    unit_direction = _scale(sun_to_satellite, 1.0 / distance)
    scale = (
        illumination
        * reference_pressure
        * ((ASTRONOMICAL_UNIT_METRES / distance) ** 2)
        * reflectivity
        * area
        / mass
    )
    acceleration = _scale(unit_direction, scale)
    if not all(math.isfinite(component) for component in acceleration):
        raise CelestialEphemerisError("La aceleración SRP no es finita")
    return acceleration


def cylindrical_umbra_eclipse_factor(
    satellite_position_m: Sequence[object],
    sun_position_m: Sequence[object],
    *,
    earth_radius_m: object = EARTH_EQUATORIAL_RADIUS_METRES,
) -> float:
    """Return a binary cylindrical-umbra illumination factor (0 or 1).

    The Sun is treated as infinitely distant for the occultation geometry.
    Earth casts a cylinder in the anti-solar direction.  A tangent ray is
    treated as illuminated, avoiding a false eclipse from round-off at the
    limb; any strictly interior ray is occulted.  Penumbra, atmosphere,
    refraction and finite solar-disc effects are intentionally outside this
    primitive.
    """

    satellite = _finite_vector(satellite_position_m, "La posición del satélite")
    sun = _finite_vector(sun_position_m, "La posición del Sol")
    earth_radius = _finite_positive(earth_radius_m, "El radio terrestre")
    sun_distance = _require_nonzero_norm(sun, "La posición del Sol")
    earth_to_sun = _scale(sun, 1.0 / sun_distance)
    axial_distance = _dot(satellite, earth_to_sun)

    # The shadow begins at Earth's anti-solar plane.  Objects on the sunward
    # side cannot be occulted by Earth in a parallel-ray cylindrical model.
    if axial_distance >= 0.0:
        return 1.0

    perpendicular = _subtract(satellite, _scale(earth_to_sun, axial_distance))
    perpendicular_distance = _norm(perpendicular)
    if not math.isfinite(perpendicular_distance):
        raise CelestialEphemerisError("La geometría de eclipse no es finita")
    return 0.0 if perpendicular_distance < earth_radius else 1.0
