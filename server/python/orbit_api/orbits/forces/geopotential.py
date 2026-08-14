r"""Versioned fully-normalized Earth gravity fields and their ITRF acceleration.

This module intentionally has no dependency on Cowell.  It evaluates a
static gravity field in the Earth-fixed ITRF axes supplied by its caller; a
time-aware force context is responsible for rotating a Cowell EME2000 stage
to ITRF and the resulting *free acceleration* back again.

The coefficient convention follows ICGEM's ``fully_normalized`` convention:

.. math::

   U = \frac{\mu}{r}\left[1 + \sum_{n=1}^{N}\left(\frac{a}{r}\right)^n
   \sum_{m=0}^{\min(n,M)} \bar P_{nm}(\sin\varphi)
   (\bar C_{nm}\cos m\lambda + \bar S_{nm}\sin m\lambda)\right].

``U`` is the positive gravitational potential, so the physical acceleration
is its spatial gradient.  The central term can be included or omitted by the
public evaluator; Cowell will eventually request only the perturbing part
because it already owns central gravity.

No network access is performed.  ICGEM files must be supplied locally and can
be pinned with an expected SHA-256 digest.
"""

from __future__ import annotations

import hashlib
import hmac
import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

from .limits import (
    MAX_LOCAL_ICGEM_FILE_BYTES,
    MAX_LOCAL_ICGEM_MATERIALIZED_COEFFICIENTS,
    MAX_SUPPORTED_GRAVITY_FIELD_DEGREE,
)

Vector3 = tuple[float, float, float]
CoefficientKey = tuple[int, int]
Coefficient = tuple[float, float]


# These values intentionally reproduce the existing Cowell WGS-84
# compatibility zonals.  They are exported from this gravity-field module so a
# future Cowell migration can import one authoritative definition instead of
# retaining a second Jn table.
WGS84_MU_KM3_S2 = 398600.4418
WGS84_REFERENCE_RADIUS_KM = 6378.137
WGS84_J2 = 1.08262668355315e-3
WGS84_J3 = -2.53265648533224e-6
WGS84_J4 = -1.61962159136700e-6

_FULLY_NORMALIZED = "fully_normalized"
_SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")
_INTEGER_RE = re.compile(r"^[+-]?\d+$")
_POLE_COSINE_FLOOR = 1.0e-12


class GravityFieldError(ValueError):
    """A gravity-field model, coefficient file, or evaluation is invalid."""


def _finite_float(value: object, label: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise GravityFieldError(f"{label} debe ser numérico") from exc
    if not math.isfinite(result):
        raise GravityFieldError(f"{label} debe ser finito")
    return result


def _non_empty_string(value: object, label: str) -> str:
    result = str(value or "").strip()
    if not result:
        raise GravityFieldError(f"{label} es obligatorio")
    return result


def _normalise_sha256(value: str | None, *, label: str) -> str | None:
    if value is None:
        return None
    digest = str(value).strip().lower()
    if not _SHA256_RE.fullmatch(digest):
        raise GravityFieldError(f"{label} debe ser un SHA-256 hexadecimal de 64 caracteres")
    return digest


def _coefficient_key(value: object) -> CoefficientKey:
    try:
        degree, order = value  # type: ignore[misc]
    except (TypeError, ValueError) as exc:
        raise GravityFieldError("Cada clave de coeficiente debe ser (grado, orden)") from exc
    if isinstance(degree, bool) or isinstance(order, bool):
        raise GravityFieldError("El grado y el orden deben ser enteros")
    try:
        degree_int = int(degree)
        order_int = int(order)
    except (TypeError, ValueError) as exc:
        raise GravityFieldError("El grado y el orden deben ser enteros") from exc
    if degree_int != degree or order_int != order:
        raise GravityFieldError("El grado y el orden deben ser enteros")
    if degree_int < 0 or order_int < 0 or order_int > degree_int:
        raise GravityFieldError("Cada coeficiente debe cumplir 0 <= orden <= grado")
    return degree_int, order_int


def _coefficient(value: object, key: CoefficientKey) -> Coefficient:
    try:
        cosine, sine = value  # type: ignore[misc]
    except (TypeError, ValueError) as exc:
        raise GravityFieldError(f"El coeficiente {key} debe contener C y S") from exc
    return (
        _finite_float(cosine, f"C{key[0]},{key[1]}"),
        _finite_float(sine, f"S{key[0]},{key[1]}"),
    )


@dataclass(frozen=True, slots=True)
class GravityFieldModel:
    """An immutable, fully-normalized static Earth gravity model.

    Coefficients are indexed by ``(degree, order)`` and represented as
    ``(Cbar_nm, Sbar_nm)``.  The model contains degree one coefficients when
    its source supplies them; it deliberately has no synthetic ``J1`` switch.
    A conventional centre-of-mass Earth field normally stores zeros there.

    ``mu_km3_s2`` and ``reference_radius_km`` are expressed in the same km
    units used by the evaluator.  ICGEM readers convert their SI header values
    at the file boundary.
    """

    model_id: str
    source: str
    version: str | None
    sha256: str | None
    mu_km3_s2: float
    reference_radius_km: float
    normalization: str
    max_degree: int
    coefficients: Mapping[CoefficientKey, Coefficient]
    tide_system: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "model_id", _non_empty_string(self.model_id, "model_id"))
        object.__setattr__(self, "source", _non_empty_string(self.source, "source"))
        version = str(self.version).strip() if self.version is not None else None
        object.__setattr__(self, "version", version or None)
        object.__setattr__(self, "sha256", _normalise_sha256(self.sha256, label="sha256"))
        mu = _finite_float(self.mu_km3_s2, "mu_km3_s2")
        radius = _finite_float(self.reference_radius_km, "reference_radius_km")
        if mu <= 0.0 or radius <= 0.0:
            raise GravityFieldError("mu_km3_s2 y reference_radius_km deben ser mayores que cero")
        object.__setattr__(self, "mu_km3_s2", mu)
        object.__setattr__(self, "reference_radius_km", radius)
        normalization = str(self.normalization or "").strip().lower()
        if normalization != _FULLY_NORMALIZED:
            raise GravityFieldError(
                "El modelo de geopotencial debe usar coeficientes fully_normalized"
            )
        object.__setattr__(self, "normalization", normalization)
        if isinstance(self.max_degree, bool):
            raise GravityFieldError("max_degree debe ser un entero no negativo")
        try:
            maximum = int(self.max_degree)
        except (TypeError, ValueError) as exc:
            raise GravityFieldError("max_degree debe ser un entero no negativo") from exc
        if maximum != self.max_degree or maximum < 0:
            raise GravityFieldError("max_degree debe ser un entero no negativo")
        if maximum > MAX_SUPPORTED_GRAVITY_FIELD_DEGREE:
            raise GravityFieldError(
                f"max_degree supera el límite seguro de {MAX_SUPPORTED_GRAVITY_FIELD_DEGREE}"
            )
        object.__setattr__(self, "max_degree", maximum)

        try:
            supplied = dict(self.coefficients)
        except (TypeError, ValueError) as exc:
            raise GravityFieldError("coefficients debe ser un mapeo de coeficientes") from exc
        normalised: dict[CoefficientKey, Coefficient] = {}
        for raw_key, raw_value in supplied.items():
            key = _coefficient_key(raw_key)
            if key[0] > maximum:
                raise GravityFieldError(
                    f"El coeficiente {key} supera max_degree={maximum}"
                )
            normalised[key] = _coefficient(raw_value, key)
        central = normalised.get((0, 0))
        if central is not None:
            if not math.isclose(central[0], 1.0, rel_tol=0.0, abs_tol=1.0e-14) or central[1] != 0.0:
                raise GravityFieldError("El coeficiente fully_normalized C00/S00 debe ser 1/0")
        object.__setattr__(self, "coefficients", MappingProxyType(normalised))
        tide_system = str(self.tide_system).strip() if self.tide_system is not None else None
        object.__setattr__(self, "tide_system", tide_system or None)

    def coefficient(self, degree: int, order: int) -> Coefficient:
        """Return one coefficient, treating absent sparse entries as zero."""

        key = _coefficient_key((degree, order))
        if key[0] > self.max_degree:
            raise GravityFieldError(
                f"El grado {key[0]} supera el máximo del modelo ({self.max_degree})"
            )
        return self.coefficients.get(key, (0.0, 0.0))

    @classmethod
    def wgs84_zonal_degree4(cls) -> "GravityFieldModel":
        """Build the legacy WGS-84 degree-four zonal compatibility field.

        The legacy Cowell terms use unnormalised ``J_n`` in
        ``-J_n P_n(sin(phi))``.  ICGEM's fully-normalized zonal coefficient is
        therefore ``Cbar_n0 = -J_n / sqrt(2n + 1)``.  This constructor keeps
        those physical constants but makes them available through the same
        general coefficient contract as a future ICGEM model.
        """

        coefficients: dict[CoefficientKey, Coefficient] = {
            (degree, order): (0.0, 0.0)
            for degree in range(5)
            for order in range(degree + 1)
        }
        coefficients[(0, 0)] = (1.0, 0.0)
        for degree, zonal in ((2, WGS84_J2), (3, WGS84_J3), (4, WGS84_J4)):
            coefficients[(degree, 0)] = (-zonal / math.sqrt((2.0 * degree) + 1.0), 0.0)
        return cls(
            model_id="WGS84-zonal-degree4-compatibility",
            source="WGS-84 zonal coefficients used by legacy Cowell",
            version="legacy-cowell-j2-j3-j4",
            sha256=None,
            mu_km3_s2=WGS84_MU_KM3_S2,
            reference_radius_km=WGS84_REFERENCE_RADIUS_KM,
            normalization=_FULLY_NORMALIZED,
            max_degree=4,
            coefficients=coefficients,
            tide_system=None,
        )


@dataclass(frozen=True, slots=True)
class GeopotentialConfiguration:
    """Validated truncation of one :class:`GravityFieldModel`.

    Degree zero is permitted for callers that want a central-only diagnostic;
    degree one is not a user-facing ``J1`` toggle.  It simply includes the
    degree-one coefficients supplied by the selected model, which are normally
    zero in a centre-of-mass Earth gravity field.
    """

    degree: int
    order: int

    def __post_init__(self) -> None:
        if isinstance(self.degree, bool) or isinstance(self.order, bool):
            raise GravityFieldError("El grado y el orden del geopotencial deben ser enteros")
        try:
            degree = int(self.degree)
            order = int(self.order)
        except (TypeError, ValueError) as exc:
            raise GravityFieldError("El grado y el orden del geopotencial deben ser enteros") from exc
        if degree != self.degree or order != self.order or degree < 0 or order < 0 or order > degree:
            raise GravityFieldError("La configuración debe cumplir 0 <= orden <= grado")
        object.__setattr__(self, "degree", degree)
        object.__setattr__(self, "order", order)

    def validate_for(self, model: GravityFieldModel) -> None:
        if not isinstance(model, GravityFieldModel):
            raise TypeError("model debe ser GravityFieldModel")
        if self.degree > model.max_degree:
            raise GravityFieldError(
                f"El grado solicitado {self.degree} supera el máximo del modelo {model.max_degree}"
            )


def _as_position_km(value: Sequence[object]) -> Vector3:
    if isinstance(value, (str, bytes)):
        raise GravityFieldError("La posición ITRF debe tener tres componentes")
    try:
        result = tuple(float(component) for component in value)
    except (TypeError, ValueError) as exc:
        raise GravityFieldError("La posición ITRF debe tener tres componentes numéricos") from exc
    if len(result) != 3:
        raise GravityFieldError("La posición ITRF debe tener tres componentes")
    if not all(math.isfinite(component) for component in result):
        raise GravityFieldError("La posición ITRF debe contener valores finitos")
    radius = math.sqrt(sum(component * component for component in result))
    if radius <= 0.0:
        raise GravityFieldError("La posición ITRF no puede ser el origen terrestre")
    return result  # type: ignore[return-value]


def _fully_normalized_legendre(
    degree: int,
    order: int,
    sine_latitude: float,
    cosine_latitude: float,
) -> tuple[dict[CoefficientKey, float], dict[CoefficientKey, float]]:
    """Return fully-normalized ``Pbar_nm`` and ``dPbar_nm/dphi``.

    The recurrence is evaluated directly in fully-normalized form and
    differentiates with respect to latitude ``phi`` rather than ``sin(phi)``.
    That avoids divisions by ``cos(phi)`` in the recurrence and remains stable
    near the poles.  The only longitude/cosine division left in the spherical
    gradient is handled by the caller with its pole limit.
    """

    values: dict[CoefficientKey, float] = {(0, 0): 1.0}
    derivatives: dict[CoefficientKey, float] = {(0, 0): 0.0}
    max_order = min(order, degree)

    # Diagonal Pbar_mm values.  The m=1 normalization is special because the
    # m=0 family does not carry the conventional factor of sqrt(2).
    for m in range(1, max_order + 1):
        previous = values[(m - 1, m - 1)]
        previous_derivative = derivatives[(m - 1, m - 1)]
        coefficient = math.sqrt(3.0) if m == 1 else math.sqrt((2.0 * m + 1.0) / (2.0 * m))
        values[(m, m)] = coefficient * cosine_latitude * previous
        derivatives[(m, m)] = coefficient * (
            (-sine_latitude * previous) + (cosine_latitude * previous_derivative)
        )

    for m in range(max_order + 1):
        if m + 1 <= degree:
            coefficient = math.sqrt((2.0 * m) + 3.0)
            diagonal = values[(m, m)]
            diagonal_derivative = derivatives[(m, m)]
            values[(m + 1, m)] = coefficient * sine_latitude * diagonal
            derivatives[(m + 1, m)] = coefficient * (
                (cosine_latitude * diagonal) + (sine_latitude * diagonal_derivative)
            )

        for n in range(m + 2, degree + 1):
            leading = math.sqrt(((2.0 * n - 1.0) * (2.0 * n + 1.0)) / ((n * n) - (m * m)))
            trailing = math.sqrt(
                ((2.0 * n + 1.0) * (((n - 1.0) * (n - 1.0)) - (m * m)))
                / ((2.0 * n - 3.0) * ((n * n) - (m * m)))
            )
            previous = values[(n - 1, m)]
            previous_derivative = derivatives[(n - 1, m)]
            before_previous = values[(n - 2, m)]
            before_previous_derivative = derivatives[(n - 2, m)]
            values[(n, m)] = (leading * sine_latitude * previous) - (trailing * before_previous)
            derivatives[(n, m)] = (
                leading * ((cosine_latitude * previous) + (sine_latitude * previous_derivative))
            ) - (trailing * before_previous_derivative)
    return values, derivatives


def gravity_acceleration_itrf(
    position_itrf_km: Sequence[object],
    model: GravityFieldModel,
    configuration: GeopotentialConfiguration,
    *,
    include_central: bool = True,
) -> Vector3:
    """Evaluate static gravity acceleration in ITRF, in km/s².

    ``include_central=True`` returns the complete field represented by the
    model.  ``False`` returns only the degree-one-and-higher perturbation and
    is the intended setting for a future Cowell force term, where central
    gravity is already mandatory and separately summed.

    The calculation is analytical: no finite-difference gradient is used.
    Near an exactly polar position, longitude is assigned its harmless
    limiting value zero solely to resolve tesseral m=1 basis vectors; the
    radial direction remains the exact input radial vector.
    """

    if not isinstance(model, GravityFieldModel):
        raise TypeError("model debe ser GravityFieldModel")
    if not isinstance(configuration, GeopotentialConfiguration):
        raise TypeError("configuration debe ser GeopotentialConfiguration")
    configuration.validate_for(model)
    x, y, z = _as_position_km(position_itrf_km)
    radius = math.sqrt((x * x) + (y * y) + (z * z))
    horizontal = math.hypot(x, y)
    sine_geometry = z / radius
    cosine_geometry = horizontal / radius
    if cosine_geometry < _POLE_COSINE_FLOOR:
        # At a pole lambda is undefined.  The m=1 limit is nevertheless
        # well-defined in Cartesian coordinates; lambda=0 is a reproducible
        # basis choice that retains it without a division by zero.
        sine_evaluation = math.copysign(
            math.sqrt(1.0 - (_POLE_COSINE_FLOOR * _POLE_COSINE_FLOOR)),
            sine_geometry if sine_geometry else 1.0,
        )
        cosine_evaluation = _POLE_COSINE_FLOOR
        longitude = 0.0
    else:
        sine_evaluation = max(-1.0, min(1.0, sine_geometry))
        cosine_evaluation = cosine_geometry
        longitude = math.atan2(y, x)

    values, derivatives = _fully_normalized_legendre(
        configuration.degree,
        configuration.order,
        sine_evaluation,
        cosine_evaluation,
    )
    radial_series = 0.0
    latitude_series = 0.0
    longitude_series = 0.0
    for degree in range(1, configuration.degree + 1):
        radial_scale = (model.reference_radius_km / radius) ** degree
        for order in range(min(degree, configuration.order) + 1):
            cosine, sine = model.coefficient(degree, order)
            if cosine == 0.0 and sine == 0.0:
                continue
            angle = float(order) * longitude
            cosine_angle = math.cos(angle)
            sine_angle = math.sin(angle)
            harmonic = (cosine * cosine_angle) + (sine * sine_angle)
            longitude_harmonic_derivative = float(order) * (
                (-cosine * sine_angle) + (sine * cosine_angle)
            )
            legendre = values[(degree, order)]
            radial_series += (degree + 1.0) * radial_scale * legendre * harmonic
            latitude_series += radial_scale * derivatives[(degree, order)] * harmonic
            longitude_series += radial_scale * legendre * longitude_harmonic_derivative

    base = model.mu_km3_s2 / (radius * radius)
    radial_acceleration = -base * (1.0 if include_central else 0.0) - (base * radial_series)
    latitude_acceleration = base * latitude_series
    longitude_acceleration = base * longitude_series / cosine_evaluation

    # An axisymmetric field has an exact radial-only limit on the rotation
    # axis.  Evaluating its Legendre derivative at a small artificial cosine
    # above keeps the generic recurrence stable, but should not leak that
    # numerical regularisation into a nonzero transverse acceleration.
    if horizontal == 0.0:
        has_tesseral_or_sectorial = any(
            model.coefficient(degree, order) != (0.0, 0.0)
            for degree in range(1, configuration.degree + 1)
            for order in range(1, min(degree, configuration.order) + 1)
        )
        if not has_tesseral_or_sectorial:
            latitude_acceleration = 0.0
            longitude_acceleration = 0.0

    cosine_longitude = math.cos(longitude)
    sine_longitude = math.sin(longitude)
    radial_basis = (x / radius, y / radius, z / radius)
    latitude_basis = (
        -sine_geometry * cosine_longitude,
        -sine_geometry * sine_longitude,
        cosine_geometry,
    )
    longitude_basis = (-sine_longitude, cosine_longitude, 0.0)
    acceleration = tuple(
        (radial_acceleration * radial_basis[index])
        + (latitude_acceleration * latitude_basis[index])
        + (longitude_acceleration * longitude_basis[index])
        for index in range(3)
    )
    if not all(math.isfinite(component) for component in acceleration):
        raise GravityFieldError("La aceleración geopotencial no es finita")
    return acceleration  # type: ignore[return-value]


def geopotential_perturbation_acceleration_itrf(
    position_itrf_km: Sequence[object],
    model: GravityFieldModel,
    configuration: GeopotentialConfiguration,
) -> Vector3:
    """Return only the non-central ITRF perturbation in km/s²."""

    return gravity_acceleration_itrf(
        position_itrf_km,
        model,
        configuration,
        include_central=False,
    )


def _parse_icgem_integer(token: str, label: str) -> int:
    if not _INTEGER_RE.fullmatch(token):
        raise GravityFieldError(f"{label} debe ser un entero")
    result = int(token)
    if result < 0:
        raise GravityFieldError(f"{label} no puede ser negativo")
    return result


def _parse_icgem_float(token: str, label: str) -> float:
    # ICGEM examples commonly use Fortran D exponents.
    return _finite_float(token.replace("D", "E").replace("d", "e"), label)


def _required_header_value(headers: Mapping[str, str], *names: str) -> str:
    present = [(name, headers[name]) for name in names if name in headers]
    if not present:
        rendered = " o ".join(names)
        raise GravityFieldError(f"El encabezado ICGEM requiere {rendered}")
    if len(present) > 1:
        rendered = ", ".join(name for name, _value in present)
        raise GravityFieldError(f"El encabezado ICGEM declara variantes duplicadas: {rendered}")
    return present[0][1]


def _is_icgem_header_boundary(tokens: Sequence[str], marker: str) -> bool:
    """Return whether an ICGEM header boundary uses its published spelling.

    ICGEM 2.0 examples write both boundary keywords followed by a decorative
    run of ``=`` characters, while older files commonly put the keyword on
    its own line.  Treat those two spellings as equivalent, but do not accept
    arbitrary trailing words: doing so could turn a malformed header into a
    silently different model.
    """

    if not tokens or tokens[0].lower() != marker:
        return False
    return len(tokens) == 1 or all(token and set(token) == {"="} for token in tokens[1:])


def _triangular_coefficient_count(max_degree: int) -> int:
    """Return the complete static ICGEM row count through ``max_degree``."""

    return (max_degree + 1) * (max_degree + 2) // 2


def _largest_complete_degree_within(coefficient_limit: int) -> int:
    """Return the highest dense triangular degree fitting a positive limit."""

    degree = 0
    while _triangular_coefficient_count(degree + 1) <= coefficient_limit:
        degree += 1
    return degree


def _local_icgem_size_error(actual_size: int | None = None) -> GravityFieldError:
    detail = (
        f" ({actual_size} bytes)" if actual_size is not None else ""
    )
    return GravityFieldError(
        "El fichero ICGEM local"
        f"{detail} supera el límite seguro de {MAX_LOCAL_ICGEM_FILE_BYTES} bytes. "
        "Use la caché NGA validada para EGM96/EGM2008 o un motor de misión optimizado."
    )


def _ensure_local_icgem_materialization_budget(max_degree: int) -> None:
    """Reject a complete local field before its coefficient rows are retained.

    The local ICGEM route constructs one complete immutable model at startup.
    It cannot safely retain a dense mission-scale triangular field simply
    because an eventual request might use only a small N x M subset.  The NGA
    registry owns that selective streaming/materialisation path instead.
    """

    coefficient_count = _triangular_coefficient_count(max_degree)
    if coefficient_count <= MAX_LOCAL_ICGEM_MATERIALIZED_COEFFICIENTS:
        return
    dense_degree = _largest_complete_degree_within(
        MAX_LOCAL_ICGEM_MATERIALIZED_COEFFICIENTS
    )
    raise GravityFieldError(
        f"El campo ICGEM local declara max_degree={max_degree}, que requiere "
        f"{coefficient_count} coeficientes completos. El cargador local solo "
        f"materializa hasta {MAX_LOCAL_ICGEM_MATERIALIZED_COEFFICIENTS} "
        f"coeficientes (campo denso {dense_degree}x{dense_degree}) para "
        "proteger memoria. Use la caché NGA validada para EGM96/EGM2008 o un "
        "motor de misión optimizado."
    )


def _read_bounded_local_icgem_payload(candidate: Path) -> bytes:
    """Read a regular local ICGEM file without an unbounded ``read_bytes``.

    The stat preflight provides a clear startup error before opening a known
    oversized file.  The bounded read is retained as a TOCTOU guard in case a
    file changes between ``stat`` and ``open``.
    """

    try:
        if not candidate.is_file():
            raise GravityFieldError(
                f"El fichero ICGEM '{candidate}' debe ser un fichero regular"
            )
        size = candidate.stat().st_size
    except OSError as exc:
        raise GravityFieldError(f"No se pudo leer el fichero ICGEM '{candidate}'") from exc
    if size > MAX_LOCAL_ICGEM_FILE_BYTES:
        raise _local_icgem_size_error(size)
    try:
        with candidate.open("rb") as source_file:
            # Read at most one byte beyond the policy.  This also prevents a
            # replacement after the stat check from causing an unbounded read.
            payload = source_file.read(MAX_LOCAL_ICGEM_FILE_BYTES + 1)
    except OSError as exc:
        raise GravityFieldError(f"No se pudo leer el fichero ICGEM '{candidate}'") from exc
    if len(payload) > MAX_LOCAL_ICGEM_FILE_BYTES:
        raise _local_icgem_size_error(len(payload))
    return payload


def parse_icgem_gfc(
    payload: bytes | str,
    *,
    expected_sha256: str | None = None,
    source: str = "ICGEM",
    version: str | None = None,
) -> GravityFieldModel:
    """Parse a strict local ICGEM ``.gfc`` payload.

    Required header keys are ``earth_gravity_constant`` (or ``gm``),
    ``radius``, ``norm`` and ``max_degree``.  The parser accepts only static
    ``gfc`` coefficients: time-variable ``gfct``/``trnd`` records are rejected
    rather than silently discarding a physical part of the published field.
    ``earth_gravity_constant`` and ``radius`` are interpreted in ICGEM SI
    units and converted to km³/s² and km respectively.
    """

    if isinstance(payload, str):
        # A caller already owns a str payload, but reject an obviously
        # oversized one before making a second byte representation of it.
        if len(payload) > MAX_LOCAL_ICGEM_FILE_BYTES:
            raise _local_icgem_size_error(len(payload))
        raw = payload.encode("utf-8")
    elif isinstance(payload, bytes):
        raw = payload
    else:
        raise TypeError("payload debe ser bytes o texto ICGEM")
    if len(raw) > MAX_LOCAL_ICGEM_FILE_BYTES:
        raise _local_icgem_size_error(len(raw))
    actual_sha256 = hashlib.sha256(raw).hexdigest()
    required_sha256 = _normalise_sha256(expected_sha256, label="expected_sha256")
    if required_sha256 is not None and not hmac.compare_digest(actual_sha256, required_sha256):
        raise GravityFieldError(
            "El SHA-256 del fichero ICGEM no coincide con el valor esperado"
        )
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise GravityFieldError("El fichero ICGEM debe estar codificado como UTF-8") from exc

    headers: dict[str, str] = {}
    coefficients: dict[CoefficientKey, Coefficient] = {}
    in_header = True
    ended_header = False
    declared_max_degree: int | None = None
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        stripped = raw_line.strip()
        if not stripped or stripped.startswith(("#", "%")):
            continue
        tokens = stripped.split()
        keyword = tokens[0].lower()
        if in_header:
            if keyword == "begin_of_head":
                if not _is_icgem_header_boundary(tokens, "begin_of_head"):
                    raise GravityFieldError("begin_of_head solo admite el separador '=' de ICGEM")
                # The marker is optional in legacy ICGEM files and carries no
                # model value.  Do not record it as a header key.
                continue
            if keyword == "end_of_head":
                if not _is_icgem_header_boundary(tokens, "end_of_head"):
                    raise GravityFieldError("end_of_head solo admite el separador '=' de ICGEM")
                # Reject an oversized local header before any data rows or
                # triangular completeness allocation can consume O(N²)
                # memory/time. The header is a hard parser boundary, not a
                # display-only advisory.
                declared_max_degree = _parse_icgem_integer(
                    _required_header_value(headers, "max_degree").strip(),
                    "max_degree",
                )
                if declared_max_degree > MAX_SUPPORTED_GRAVITY_FIELD_DEGREE:
                    raise GravityFieldError(
                        "max_degree supera el límite seguro de "
                        f"{MAX_SUPPORTED_GRAVITY_FIELD_DEGREE}"
                    )
                _ensure_local_icgem_materialization_budget(declared_max_degree)
                in_header = False
                ended_header = True
                continue
            if keyword in {"gfc", "gfct", "trnd", "asin", "acos"}:
                raise GravityFieldError(
                    "El encabezado ICGEM debe terminar con end_of_head antes de los coeficientes"
                )
            if len(tokens) < 2:
                raise GravityFieldError(
                    f"Encabezado ICGEM inválido en la línea {line_number}"
                )
            if keyword in headers:
                raise GravityFieldError(
                    f"Encabezado ICGEM duplicado para '{keyword}' en la línea {line_number}"
                )
            headers[keyword] = " ".join(tokens[1:])
            continue

        if keyword != "gfc":
            raise GravityFieldError(
                f"Registro ICGEM no compatible '{tokens[0]}' en la línea {line_number}; "
                "solo se admiten coeficientes estáticos gfc"
            )
        if len(tokens) < 5:
            raise GravityFieldError(
                f"Registro gfc incompleto en la línea {line_number}"
            )
        degree = _parse_icgem_integer(tokens[1], f"El grado gfc de la línea {line_number}")
        order = _parse_icgem_integer(tokens[2], f"El orden gfc de la línea {line_number}")
        if declared_max_degree is None:
            raise GravityFieldError("El encabezado ICGEM no declaró max_degree")
        if degree > declared_max_degree:
            raise GravityFieldError(
                f"El coeficiente gfc {degree},{order} supera max_degree={declared_max_degree}"
            )
        if order > degree:
            raise GravityFieldError(
                f"El registro gfc de la línea {line_number} tiene orden mayor que grado"
            )
        key = degree, order
        if key in coefficients:
            raise GravityFieldError(
                f"El coeficiente gfc {degree},{order} está duplicado"
            )
        coefficients[key] = (
            _parse_icgem_float(tokens[3], f"C{degree},{order}"),
            _parse_icgem_float(tokens[4], f"S{degree},{order}"),
        )

    if not ended_header:
        raise GravityFieldError("El fichero ICGEM no contiene end_of_head")
    product_type = headers.get("product_type", "").strip().lower()
    if product_type != "gravity_field":
        raise GravityFieldError("El encabezado ICGEM debe declarar product_type gravity_field")
    normalization = _required_header_value(headers, "norm").strip().lower()
    if normalization != _FULLY_NORMALIZED:
        raise GravityFieldError(
            "El fichero ICGEM debe declarar norm fully_normalized"
        )
    if declared_max_degree is None:
        raise GravityFieldError("El encabezado ICGEM no declaró max_degree")
    max_degree = declared_max_degree
    gm_m3_s2 = _parse_icgem_float(
        _required_header_value(headers, "earth_gravity_constant", "gm").strip(),
        "earth_gravity_constant",
    )
    radius_m = _parse_icgem_float(
        _required_header_value(headers, "radius").strip(),
        "radius",
    )
    if gm_m3_s2 <= 0.0 or radius_m <= 0.0:
        raise GravityFieldError("earth_gravity_constant y radius deben ser mayores que cero")
    if not coefficients:
        raise GravityFieldError("El fichero ICGEM no contiene registros gfc")
    expected_count = _triangular_coefficient_count(max_degree)
    if len(coefficients) != expected_count:
        # Do not build a second O(N²) ``expected_keys`` set. Coefficient rows
        # were bounded against the header as they were read; scan only until
        # the first strict-completeness gap is found.
        for degree in range(max_degree + 1):
            for order in range(degree + 1):
                if (degree, order) not in coefficients:
                    raise GravityFieldError(
                        f"El fichero ICGEM no declara el coeficiente gfc obligatorio {degree},{order}"
                    )
        raise GravityFieldError("El fichero ICGEM declara coeficientes inconsistentes")
    central = coefficients[(0, 0)]
    if not math.isclose(central[0], 1.0, rel_tol=0.0, abs_tol=1.0e-14) or central[1] != 0.0:
        raise GravityFieldError("El fichero ICGEM debe declarar C00=1 y S00=0")

    model_id = headers.get("modelname", "").strip() or "ICGEM-gravity-field"
    parsed_version = version if version is not None else headers.get("modelname", "").strip() or None
    return GravityFieldModel(
        model_id=model_id,
        source=_non_empty_string(source, "source"),
        version=parsed_version,
        sha256=actual_sha256,
        mu_km3_s2=gm_m3_s2 / 1_000_000_000.0,
        reference_radius_km=radius_m / 1_000.0,
        normalization=normalization,
        max_degree=max_degree,
        coefficients=coefficients,
        tide_system=headers.get("tide_system", "").strip() or None,
    )


def load_icgem_gfc(
    path: str | Path,
    *,
    expected_sha256: str | None = None,
    source: str | None = None,
    version: str | None = None,
) -> GravityFieldModel:
    """Load a local ICGEM ``.gfc`` file without any network fallback."""

    if isinstance(path, str) and re.match(r"^[a-z][a-z0-9+.-]*://", path.strip(), flags=re.IGNORECASE):
        raise GravityFieldError("ICGEM debe cargarse desde un fichero local, no desde una URL")
    candidate = Path(path).expanduser()
    if candidate.suffix.lower() != ".gfc":
        raise GravityFieldError("El fichero de geopotencial debe usar la extensión .gfc")
    raw = _read_bounded_local_icgem_payload(candidate)
    return parse_icgem_gfc(
        raw,
        expected_sha256=expected_sha256,
        source=source or f"ICGEM local: {candidate.name}",
        version=version,
    )


__all__ = [
    "Coefficient",
    "CoefficientKey",
    "GeopotentialConfiguration",
    "GravityFieldError",
    "GravityFieldModel",
    "Vector3",
    "WGS84_J2",
    "WGS84_J3",
    "WGS84_J4",
    "WGS84_MU_KM3_S2",
    "WGS84_REFERENCE_RADIUS_KM",
    "geopotential_perturbation_acceleration_itrf",
    "gravity_acceleration_itrf",
    "load_icgem_gfc",
    "parse_icgem_gfc",
]
