"""Safe local registry for the official NGA EGM96 and EGM2008 archives.

The NGA downloads are operational cache inputs, not a dependency of a force
evaluation.  A background health monitor may refresh this registry, whereas
``resolve_selection`` and ``materialize_selection`` only read an already
validated local coefficient file.  This distinction prevents a Cowell RK4
stage from unexpectedly doing disk or network I/O.

The two official archives are not ICGEM ``.gfc`` files.  They contain the NGA
plain-text coefficient files ``EGM96`` and ``EGM2008_to2190_TideFree`` whose
rows are ``n m Cnm Snm sigmaC sigmaS`` (Fortran ``D`` exponents are allowed).
The reader deliberately recognises those exact entries rather than guessing
from an arbitrary ZIP member name.
"""

from __future__ import annotations

import datetime
import hashlib
import io
import math
import os
import re
import tempfile
import threading
import time
import zipfile
from collections import OrderedDict, deque
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, replace
from pathlib import Path, PurePosixPath
from typing import BinaryIO, Literal
from urllib.parse import parse_qs, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from orbit_api.core.settings import GEOPOTENTIAL_DATA_DIR
from orbit_api.timekeeping import ensure_utc, utc_now

from .geopotential import GravityFieldError, GravityFieldModel
from .limits import (
    MAX_PURE_PYTHON_RK4_GEOPOTENTIAL_TERMS,
    MAX_SUPPORTED_GRAVITY_FIELD_DEGREE,
)


NGA_EGM96_URL = "https://earth-info.nga.mil/php/download.php?file=egm-96spherical"
NGA_EGM2008_URL = "https://earth-info.nga.mil/php/download.php?file=egm-08spherical"
NGA_GRAVITY_REFRESH_AGE = datetime.timedelta(days=30)
NGA_GRAVITY_DOWNLOAD_TIMEOUT_SECONDS = 45.0

# The NGA HEAD responses currently advertise roughly 5 MB and 109 MB.  These
# independent ceilings leave a small format/update margin without treating an
# EGM2008 archive as a tiny generic download or allowing an arbitrary blob.
NGA_EGM96_MAX_ARCHIVE_BYTES = 16 * 1024 * 1024
NGA_EGM2008_MAX_ARCHIVE_BYTES = 160 * 1024 * 1024
NGA_EGM96_MAX_EXTRACTED_BYTES = 32 * 1024 * 1024
NGA_EGM2008_MAX_EXTRACTED_BYTES = 512 * 1024 * 1024
_MAX_ARCHIVE_MEMBERS = 128
_DEFAULT_MATERIALIZATION_TERM_LIMIT = 100_000
# Materialising an NGA selection requires one bounded sequential validation
# pass over the extracted member.  Keep a very small process-local LRU and
# rate-limit cache misses so changing N/M repeatedly cannot turn the API into
# a disk/CPU exhaustion primitive.  Cowell/RK4 receives only the resulting
# immutable in-memory field and never reaches this path itself.
_MAX_MATERIALIZED_SELECTIONS = 8
_MAX_MATERIALIZATION_MISSES_PER_MINUTE = 4
_MATERIALIZATION_WINDOW_SECONDS = 60.0
# Byte-oriented ZIP helpers are retained only for explicit offline fixtures;
# production always validates/extracts through bounded streams on disk.
_MAX_COMPAT_FIXTURE_ARCHIVE_BYTES = 4 * 1024 * 1024
_MAX_COMPAT_FIXTURE_MEMBER_BYTES = 8 * 1024 * 1024

GravityModelStatus = Literal["ok", "warning", "error", "unknown"]
GravityStartupProgressState = Literal["pending", "downloading", "validating", "ready", "error"]
DownloadFetcher = Callable[[str, float, int], bytes]


class GravityModelCacheError(GravityFieldError):
    """A downloaded/cached NGA archive is unsafe or not scientifically usable."""


class _RejectRedirects(HTTPRedirectHandler):
    """Prevent an official URL from silently becoming an arbitrary download."""

    def redirect_request(self, _req, _fp, _code, _msg, _headers, _newurl):  # type: ignore[no-untyped-def]
        raise OSError("La descarga automática de gravedad NGA no admite redirecciones")


def _finite(value: object, label: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise GravityModelCacheError(f"{label} debe ser numérico") from exc
    if not math.isfinite(result):
        raise GravityModelCacheError(f"{label} debe ser finito")
    return result


def _iso(value: datetime.datetime | None) -> str | None:
    return ensure_utc(value).isoformat() if value is not None else None


def _safe_error(exc: Exception) -> str:
    message = " ".join(str(exc).strip().split())
    return message[:500] if message else type(exc).__name__


def _normalise_model_id(value: object) -> str:
    token = str(value or "").strip().upper().replace("_", "").replace("-", "")
    aliases = {
        "EGM96": "EGM96",
        "EGM1996": "EGM96",
        "EGM2008": "EGM2008",
        "EGM08": "EGM2008",
    }
    try:
        return aliases[token]
    except KeyError as exc:
        raise GravityModelCacheError("Modelo gravitatorio no compatible. Use EGM96 o EGM2008.") from exc


def _as_positive_int(value: object, label: str) -> int:
    if isinstance(value, bool):
        raise GravityModelCacheError(f"{label} debe ser un entero positivo")
    if isinstance(value, str):
        token = value.strip()
        if not re.fullmatch(r"[+]?[0-9]+", token):
            raise GravityModelCacheError(f"{label} debe ser un entero positivo")
        result = int(token)
        if result <= 0:
            raise GravityModelCacheError(f"{label} debe ser un entero positivo")
        return result
    try:
        result = int(value)
    except (TypeError, ValueError) as exc:
        raise GravityModelCacheError(f"{label} debe ser un entero positivo") from exc
    if result != value or result <= 0:
        raise GravityModelCacheError(f"{label} debe ser un entero positivo")
    return result


def _as_nonnegative_int(value: object, label: str) -> int:
    if isinstance(value, bool):
        raise GravityModelCacheError(f"{label} debe ser un entero no negativo")
    if isinstance(value, str):
        token = value.strip()
        if not re.fullmatch(r"[+]?[0-9]+", token):
            raise GravityModelCacheError(f"{label} debe ser un entero no negativo")
        return int(token)
    try:
        result = int(value)
    except (TypeError, ValueError) as exc:
        raise GravityModelCacheError(f"{label} debe ser un entero no negativo") from exc
    if result != value or result < 0:
        raise GravityModelCacheError(f"{label} debe ser un entero no negativo")
    return result


@dataclass(frozen=True, slots=True)
class GravityModelSpec:
    """Immutable trust bounds for one accepted official NGA archive.

    ``max_degree`` and ``max_order`` are hard parser ceilings, not advertised
    selection caps. The effective degree/order envelope is learned only from
    the validated, decompressed coefficient member. The documented coverage
    fields remain expected/minimum provenance so a truncated archive cannot
    become usable merely because its remaining rows are well formed.
    """

    model_id: str
    url: str
    archive_filename: str
    coefficient_entry_names: tuple[str, ...]
    max_degree: int
    max_order: int
    archive_max_degree: int
    complete_through_degree: int
    tail_max_order: int
    mu_km3_s2: float
    reference_radius_km: float
    tide_system: str
    max_archive_bytes: int
    max_extracted_bytes: int
    minimum_degree: int | None = None

    def __post_init__(self) -> None:
        model_id = _normalise_model_id(self.model_id)
        object.__setattr__(self, "model_id", model_id)
        if not self.archive_filename.lower().endswith(".zip"):
            raise ValueError("archive_filename debe terminar en .zip")
        if not self.coefficient_entry_names:
            raise ValueError("Debe declararse al menos una entrada de coeficientes NGA")
        maximum_degree = _as_positive_int(self.max_degree, "max_degree")
        maximum_order = _as_positive_int(self.max_order, "max_order")
        if maximum_degree > MAX_SUPPORTED_GRAVITY_FIELD_DEGREE:
            raise ValueError(
                f"max_degree no puede superar {MAX_SUPPORTED_GRAVITY_FIELD_DEGREE}"
            )
        if maximum_order > MAX_SUPPORTED_GRAVITY_FIELD_DEGREE:
            raise ValueError(
                f"max_order no puede superar {MAX_SUPPORTED_GRAVITY_FIELD_DEGREE}"
            )
        archive_maximum = _as_positive_int(self.archive_max_degree, "archive_max_degree")
        complete = _as_positive_int(self.complete_through_degree, "complete_through_degree")
        tail = _as_positive_int(self.tail_max_order, "tail_max_order")
        if complete > archive_maximum or archive_maximum > maximum_degree or tail > maximum_order:
            raise ValueError("Los límites de completitud NGA no son compatibles con el modelo")
        object.__setattr__(self, "max_degree", maximum_degree)
        object.__setattr__(self, "max_order", maximum_order)
        object.__setattr__(self, "archive_max_degree", archive_maximum)
        object.__setattr__(self, "complete_through_degree", complete)
        object.__setattr__(self, "tail_max_order", tail)
        minimum = archive_maximum if self.minimum_degree is None else _as_positive_int(
            self.minimum_degree,
            "minimum_degree",
        )
        if minimum > maximum_degree:
            raise ValueError("minimum_degree no puede superar max_degree")
        object.__setattr__(self, "minimum_degree", minimum)
        if _finite(self.mu_km3_s2, "mu_km3_s2") <= 0.0:
            raise ValueError("mu_km3_s2 debe ser positivo")
        if _finite(self.reference_radius_km, "reference_radius_km") <= 0.0:
            raise ValueError("reference_radius_km debe ser positivo")
        archive_limit = _as_positive_int(self.max_archive_bytes, "max_archive_bytes")
        extracted_limit = _as_positive_int(self.max_extracted_bytes, "max_extracted_bytes")
        if extracted_limit < archive_limit:
            raise ValueError("max_extracted_bytes no puede ser menor que max_archive_bytes")
        object.__setattr__(self, "max_archive_bytes", archive_limit)
        object.__setattr__(self, "max_extracted_bytes", extracted_limit)

    def documented_max_order(self, degree: int) -> int:
        """Return the documented profile, never a parser override."""

        if degree <= self.complete_through_degree:
            return min(degree, self.max_order)
        return min(degree, self.tail_max_order)


EGM96_SPEC = GravityModelSpec(
    model_id="EGM96",
    url=NGA_EGM96_URL,
    archive_filename="EGM96_Spherical_Harmonics.zip",
    coefficient_entry_names=("EGM96",),
    max_degree=360,
    max_order=360,
    archive_max_degree=360,
    complete_through_degree=360,
    tail_max_order=360,
    # NGA's EGM96 reference constants, converted to the km units used by
    # GravityFieldModel.  The coefficient file itself has no ICGEM header.
    mu_km3_s2=398600.4418,
    reference_radius_km=6378.137,
    tide_system="not-declared-by-archive",
    max_archive_bytes=NGA_EGM96_MAX_ARCHIVE_BYTES,
    max_extracted_bytes=NGA_EGM96_MAX_EXTRACTED_BYTES,
)

EGM2008_SPEC = GravityModelSpec(
    model_id="EGM2008",
    url=NGA_EGM2008_URL,
    archive_filename="EGM2008_Spherical_Harmonics.zip",
    coefficient_entry_names=("EGM2008_to2190_TideFree",),
    # 2190x2190 is a hard safety ceiling, not a selection promise. The
    # decompressed archive determines the actual per-degree coverage.
    max_degree=2190,
    max_order=2190,
    archive_max_degree=2190,
    complete_through_degree=2159,
    tail_max_order=2159,
    mu_km3_s2=398600.4415,
    reference_radius_km=6378.1363,
    tide_system="tide_free",
    max_archive_bytes=NGA_EGM2008_MAX_ARCHIVE_BYTES,
    max_extracted_bytes=NGA_EGM2008_MAX_EXTRACTED_BYTES,
)

NGA_GRAVITY_SPECS: Mapping[str, GravityModelSpec] = {
    EGM96_SPEC.model_id: EGM96_SPEC,
    EGM2008_SPEC.model_id: EGM2008_SPEC,
}


@dataclass(frozen=True, slots=True)
class GravityArchiveInspection:
    """Validated scientific/provenance facts about one archive member."""

    coefficient_entry: str
    archive_sha256: str
    archive_byte_size: int
    coefficient_byte_size: int
    coefficient_sha256: str
    record_count: int
    first_degree: int
    max_degree: int
    max_order: int
    coefficient_c20: float
    degree_order_coverage: tuple[tuple[int, int], ...]
    complete_through_degree: int
    tail_max_order: int
    header_max_degree: int | None = None
    header_max_order: int | None = None

    def order_at_degree(self, degree: int) -> int:
        """Return the validated final order for one degree, or fail closed."""

        for candidate, maximum_order in self.degree_order_coverage:
            if candidate == degree:
                return maximum_order
        raise GravityModelCacheError(
            f"El archivo NGA validado no contiene cobertura para el grado {degree}"
        )

    def max_selectable_order(self, degree: int) -> int:
        """Return the largest N×M order whose every required row is present.

        A sparse tail does not mean missing coefficients are zero. For a
        selected degree, every lower degree must carry each required order.
        """

        if degree < self.first_degree or degree > self.max_degree:
            raise GravityModelCacheError(
                f"El grado {degree} no pertenece a la cobertura NGA validada"
            )
        maximum = degree
        for candidate_degree, candidate_order in self.degree_order_coverage:
            if candidate_degree > degree:
                break
            if candidate_order < candidate_degree:
                maximum = min(maximum, candidate_order)
        return maximum

    def coverage_payload(self) -> dict[str, object]:
        """Return a compact coverage profile rather than raw coefficient rows."""

        segments: list[dict[str, object]] = []
        for degree, maximum_order in self.degree_order_coverage:
            relation: object = "degree" if maximum_order == degree else maximum_order
            order_rule = "degree" if maximum_order == degree else "fixed"
            if (
                segments
                and segments[-1]["maxOrder"] == relation
                and int(segments[-1]["endDegree"]) + 1 == degree
            ):
                segments[-1]["endDegree"] = degree
            else:
                segments.append({
                    "startDegree": degree,
                    "endDegree": degree,
                    "maxOrder": relation,
                    "orderRule": order_rule,
                })
        return {
            "firstDegree": self.first_degree,
            "maxDegree": self.max_degree,
            "maxOrder": self.max_order,
            "completeThroughDegree": self.complete_through_degree,
            "tailMaxOrder": self.tail_max_order,
            "degreeCoverage": segments,
        }


@dataclass(frozen=True, slots=True)
class GravityModelRecord:
    """One registry slot.  A record is usable only when ``status == 'ok'``."""

    spec: GravityModelSpec
    status: GravityModelStatus
    archive_path: Path
    coefficient_path: Path
    inspection: GravityArchiveInspection | None = None
    last_update: datetime.datetime | None = None
    last_validation: datetime.datetime | None = None
    error: str | None = None
    refresh_due: bool = True
    using_cached_fallback: bool = False

    @property
    def available(self) -> bool:
        # A stale snapshot is still scientifically validated and may safely be
        # retained while a background refresh is unavailable.  ``status``
        # communicates freshness separately; it must not erase that fallback.
        return self.status in {"ok", "warning"} and self.inspection is not None

    def payload(self) -> dict[str, object]:
        inspection = self.inspection
        return {
            "id": self.spec.model_id,
            "status": self.status,
            "loaded": self.available,
            "available": self.available,
            "source": "NGA",
            "sourceUrl": self.spec.url,
            "cacheFile": str(self.archive_path),
            "coefficientFile": str(self.coefficient_path) if self.coefficient_path.exists() else None,
            "lastUpdate": _iso(self.last_update),
            "lastValidation": _iso(self.last_validation),
            # Only a validated decompressed archive is allowed to publish
            # selectable limits. The spec values below are parser ceilings /
            # expectations, never a claim that coefficients were installed.
            "maxDegree": inspection.max_degree if inspection is not None else None,
            "maxOrder": inspection.max_order if inspection is not None else None,
            "completeThroughDegree": (
                inspection.complete_through_degree if inspection is not None else None
            ),
            "tailMaxOrder": inspection.tail_max_order if inspection is not None else None,
            "coverage": inspection.coverage_payload() if inspection is not None else None,
            "degreeCoverage": (
                inspection.coverage_payload()["degreeCoverage"] if inspection is not None else None
            ),
            "executionLimit": {
                "maxHarmonicTerms": MAX_PURE_PYTHON_RK4_GEOPOTENTIAL_TERMS,
            },
            "headerMaxDegree": inspection.header_max_degree if inspection is not None else None,
            "headerMaxOrder": inspection.header_max_order if inspection is not None else None,
            "hardMaxDegree": self.spec.max_degree,
            "hardMaxOrder": self.spec.max_order,
            "expectedMinimumDegree": self.spec.minimum_degree,
            "archiveMaxDegree": self.spec.archive_max_degree,
            "normalization": "fully_normalized",
            "tideSystem": self.spec.tide_system,
            "recordCount": inspection.record_count if inspection is not None else 0,
            "coefficientMaxDegree": inspection.max_degree if inspection is not None else None,
            "coefficientMaxOrder": inspection.max_order if inspection is not None else None,
            "sha256": inspection.archive_sha256 if inspection is not None else None,
            "coefficientSha256": inspection.coefficient_sha256 if inspection is not None else None,
            "error": self.error,
            "refreshDue": self.refresh_due,
            "usingCachedFallback": self.using_cached_fallback,
            "automatic": True,
        }


@dataclass(frozen=True, slots=True)
class GravityStartupProgress:
    """One bounded, pollable startup fact for an NGA archive.

    ``percent`` is intentionally ``None`` when the NGA response has no
    ``Content-Length``.  Showing an indeterminate bar is more honest than
    inventing a percentage for a streaming transfer.  Validation/extraction
    is represented by ``state``/``stage`` rather than pretending it is a
    network-byte counter.
    """

    model_id: str
    state: GravityStartupProgressState
    stage: str
    downloaded_bytes: int
    total_bytes: int | None
    message: str | None
    updated_at: datetime.datetime

    @property
    def percent(self) -> int | None:
        if self.total_bytes is None or self.total_bytes <= 0:
            return None
        return max(0, min(100, int(round((self.downloaded_bytes * 100) / self.total_bytes))))

    def payload(self) -> dict[str, object]:
        return {
            "model": self.model_id,
            "state": self.state,
            "stage": self.stage,
            "bytesDownloaded": self.downloaded_bytes,
            "totalBytes": self.total_bytes,
            "percent": self.percent,
            "message": self.message,
            "updatedAt": _iso(self.updated_at),
        }


@dataclass(frozen=True, slots=True)
class GravityModelSelection:
    """Resolved model/degree/order before coefficient materialisation."""

    model_id: str
    requested_degree: int
    requested_order: int
    degree: int
    order: int
    available: bool
    warnings: tuple[str, ...]
    provenance: Mapping[str, object]

    @property
    def clamped(self) -> bool:
        return self.degree != self.requested_degree or self.order != self.requested_order

    @property
    def harmonic_term_count(self) -> int:
        """Exact non-central coefficients the current RK4 would evaluate."""

        return _harmonic_term_count(self.degree, self.order)

    @property
    def execution_allowed(self) -> bool:
        return self.harmonic_term_count <= MAX_PURE_PYTHON_RK4_GEOPOTENTIAL_TERMS

    def payload(self) -> dict[str, object]:
        return {
            "model": self.model_id,
            "requestedDegree": self.requested_degree,
            "requestedOrder": self.requested_order,
            "degree": self.degree,
            "order": self.order,
            "clamped": self.clamped,
            "available": self.available,
            "warnings": list(self.warnings),
            "harmonicTerms": self.harmonic_term_count,
            "executionLimit": {
                "maxHarmonicTerms": MAX_PURE_PYTHON_RK4_GEOPOTENTIAL_TERMS,
            },
            "executionAllowed": self.execution_allowed,
            "provenance": dict(self.provenance),
        }


def _canonical_url_for(spec: GravityModelSpec) -> None:
    """Ensure a registry cannot be redirected to an environment-provided URL."""

    expected = NGA_GRAVITY_SPECS.get(spec.model_id)
    if expected is None or spec.url != expected.url:
        raise ValueError("La URL de gravedad automática debe ser la URL oficial fija de NGA")
    parsed = urlparse(spec.url)
    query = parse_qs(parsed.query, keep_blank_values=True)
    if (
        parsed.scheme != "https"
        or parsed.netloc != "earth-info.nga.mil"
        or parsed.path != "/php/download.php"
        or query != parse_qs(urlparse(expected.url).query, keep_blank_values=True)
    ):
        raise ValueError("La URL de gravedad automática debe usar el host HTTPS oficial de NGA")


def _safe_zip_members(archive: zipfile.ZipFile, spec: GravityModelSpec) -> tuple[zipfile.ZipInfo, ...]:
    members = tuple(info for info in archive.infolist() if not info.is_dir())
    if not members:
        raise GravityModelCacheError("El ZIP NGA no contiene ficheros")
    if len(members) > _MAX_ARCHIVE_MEMBERS:
        raise GravityModelCacheError("El ZIP NGA contiene demasiados miembros")
    total_uncompressed = 0
    expected_names = {name.casefold() for name in spec.coefficient_entry_names}
    coefficient: list[zipfile.ZipInfo] = []
    for info in members:
        member_path = PurePosixPath(info.filename)
        if member_path.is_absolute() or ".." in member_path.parts or not info.filename:
            raise GravityModelCacheError("El ZIP NGA contiene una ruta insegura")
        # A POSIX symlink has its type in the top 16 Unix mode bits.  Do not
        # permit it even though we never call ZipFile.extractall().
        mode = (info.external_attr >> 16) & 0o170000
        if mode == 0o120000:
            raise GravityModelCacheError("El ZIP NGA contiene un enlace simbólico no permitido")
        if info.file_size < 0 or info.compress_size < 0:
            raise GravityModelCacheError("El ZIP NGA declara tamaños inválidos")
        total_uncompressed += info.file_size
        if total_uncompressed > spec.max_extracted_bytes:
            raise GravityModelCacheError("El ZIP NGA supera el tamaño descomprimido máximo permitido")
        # The NGA member name is an exact trust boundary. Accepting only the
        # basename would let a nested arbitrary path masquerade as EGM96.
        if info.filename.casefold() in expected_names:
            coefficient.append(info)
    if len(coefficient) != 1:
        expected = ", ".join(spec.coefficient_entry_names)
        raise GravityModelCacheError(
            f"El ZIP NGA no contiene exactamente el coeficiente esperado ({expected})"
        )
    selected = coefficient[0]
    if selected.file_size <= 0 or selected.file_size > spec.max_extracted_bytes:
        raise GravityModelCacheError("El fichero de coeficientes NGA tiene un tamaño inválido")
    return selected,


def _read_member_bytes(
    archive: zipfile.ZipFile,
    info: zipfile.ZipInfo,
    *,
    max_bytes: int,
) -> bytes:
    """Read one ZIP member with a second bounded streaming guard."""

    parts: list[bytes] = []
    total = 0
    with archive.open(info, "r") as handle:
        while True:
            chunk = handle.read(min(1024 * 1024, max_bytes + 1 - total))
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise GravityModelCacheError("El fichero de coeficientes NGA supera el límite permitido")
            parts.append(chunk)
    if total != info.file_size:
        raise GravityModelCacheError("El ZIP NGA no coincide con el tamaño declarado del coeficiente")
    return b"".join(parts)


def _nga_float(token: str, *, line_number: int, label: str) -> float:
    try:
        value = float(token.replace("D", "E").replace("d", "e"))
    except ValueError as exc:
        raise GravityModelCacheError(
            f"El coeficiente NGA {label} de la línea {line_number} no es numérico"
        ) from exc
    if not math.isfinite(value):
        raise GravityModelCacheError(
            f"El coeficiente NGA {label} de la línea {line_number} no es finito"
        )
    if abs(value) > 2.0:
        raise GravityModelCacheError(
            f"El coeficiente NGA {label} de la línea {line_number} está fuera de rango"
        )
    return value


def _nga_integer(token: str, *, line_number: int, label: str) -> int:
    try:
        value = int(token)
    except ValueError as exc:
        raise GravityModelCacheError(
            f"El coeficiente NGA {label} de la línea {line_number} no es entero"
        ) from exc
    if str(value) != token.lstrip("+"):
        # Reject 2.0 and scientific notation rather than silently interpreting
        # an offset/column-shifted text file as a coefficient set.
        raise GravityModelCacheError(
            f"El coeficiente NGA {label} de la línea {line_number} no es entero"
        )
    return value


_HEADER_DEGREE_RE = re.compile(
    r"^\s*(?:[#;!]\s*)?(?:max(?:imum)?[_\s-]*degree|degree[_\s-]*max|nmax)\s*(?:=|:)?\s*([0-9]+)\b",
    re.IGNORECASE,
)
_HEADER_ORDER_RE = re.compile(
    r"^\s*(?:[#;!]\s*)?(?:max(?:imum)?[_\s-]*order|order[_\s-]*max|mmax)\s*(?:=|:)?\s*([0-9]+)\b",
    re.IGNORECASE,
)


def _optional_nga_header_limits(raw: bytes) -> tuple[int | None, int | None]:
    """Read optional leading NGA/ICGEM-style limit claims.

    Current NGA files are naked coefficient rows. Some mirrors prepend a
    small header, so recognise only explicit ``max_degree``/``max_order``
    claims before the first numeric row. The rows remain authoritative: a
    header never manufactures missing coefficients.
    """

    prefix = raw[:64 * 1024]
    try:
        text = prefix.decode("ascii")
    except UnicodeDecodeError:
        try:
            text = prefix.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise GravityModelCacheError(
                "La cabecera NGA debe estar codificada en ASCII/UTF-8"
            ) from exc
    degree_limit: int | None = None
    order_limit: int | None = None
    for raw_line in text.splitlines():
        stripped = raw_line.strip()
        if not stripped:
            continue
        fields = stripped.split()
        if len(fields) >= 2:
            try:
                int(fields[0])
                int(fields[1])
            except ValueError:
                pass
            else:
                break
        degree_match = _HEADER_DEGREE_RE.match(stripped)
        order_match = _HEADER_ORDER_RE.match(stripped)
        if degree_match is not None:
            candidate = _as_positive_int(degree_match.group(1), "header max_degree")
            if degree_limit is not None and candidate != degree_limit:
                raise GravityModelCacheError("La cabecera NGA declara max_degree de forma contradictoria")
            degree_limit = candidate
        if order_match is not None:
            candidate = _as_positive_int(order_match.group(1), "header max_order")
            if order_limit is not None and candidate != order_limit:
                raise GravityModelCacheError("La cabecera NGA declara max_order de forma contradictoria")
            order_limit = candidate
    return degree_limit, order_limit


def _iter_nga_rows(raw: bytes) -> Iterable[tuple[int, int, float, float, int]]:
    """Yield strict NGA ``n m C S`` rows from one extracted coefficient file."""

    if not raw:
        raise GravityModelCacheError("El fichero de coeficientes NGA está vacío")
    if b"\x00" in raw:
        raise GravityModelCacheError("El fichero de coeficientes NGA no es texto plano")
    try:
        text = raw.decode("ascii")
    except UnicodeDecodeError:
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise GravityModelCacheError("El fichero de coeficientes NGA debe estar codificado en ASCII/UTF-8") from exc
    saw_data = False
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        stripped = raw_line.strip()
        if not stripped or stripped.startswith(("#", "!", ";")):
            continue
        fields = stripped.split()
        if len(fields) < 4:
            if not saw_data:
                # Documentation/Fortran comments are allowed before the data;
                # after the first row they would indicate a corrupt stream.
                continue
            raise GravityModelCacheError(
                f"La línea {line_number} del coeficiente NGA no tiene n, m, C y S"
            )
        try:
            degree = _nga_integer(fields[0], line_number=line_number, label="n")
            order = _nga_integer(fields[1], line_number=line_number, label="m")
        except GravityModelCacheError:
            if not saw_data:
                continue
            raise
        cosine = _nga_float(fields[2], line_number=line_number, label="Cnm")
        sine = _nga_float(fields[3], line_number=line_number, label="Snm")
        saw_data = True
        yield degree, order, cosine, sine, line_number
    if not saw_data:
        raise GravityModelCacheError("El fichero NGA no contiene coeficientes esféricos")


def _validate_and_collect_nga_rows(
    raw: bytes,
    spec: GravityModelSpec,
    *,
    collect_degree: int | None = None,
    collect_order: int | None = None,
) -> tuple[GravityArchiveInspection, dict[tuple[int, int], tuple[float, float]]]:
    """Validate contiguous rows and derive the usable N×M envelope."""

    selected: dict[tuple[int, int], tuple[float, float]] = {(0, 0): (1.0, 0.0)}
    header_max_degree, header_max_order = _optional_nga_header_limits(raw)
    if header_max_degree is not None and header_max_degree > spec.max_degree:
        raise GravityModelCacheError("La cabecera NGA supera el techo seguro de grado configurado")
    if header_max_order is not None and header_max_order > spec.max_order:
        raise GravityModelCacheError("La cabecera NGA supera el techo seguro de orden configurado")
    previous_degree: int | None = None
    previous_order: int | None = None
    first_degree: int | None = None
    max_degree = 0
    max_order = 0
    record_count = 0
    c20: float | None = None
    saw_c00 = False
    coverage: dict[int, int] = {}

    for degree, order, cosine, sine, line_number in _iter_nga_rows(raw):
        if degree < 0 or order < 0 or order > degree:
            raise GravityModelCacheError(
                f"El coeficiente NGA de la línea {line_number} incumple 0 <= m <= n"
            )
        if degree == 0:
            if order != 0 or not math.isclose(cosine, 1.0, rel_tol=0.0, abs_tol=1e-13) or sine != 0.0:
                raise GravityModelCacheError("El coeficiente NGA C00/S00 debe ser 1/0")
            saw_c00 = True
            continue
        if degree == 1:
            # Degree one is conventionally absent in the NGA products.  If a
            # later archive includes it, preserve it only after continuity of
            # the actual model starts at degree two.
            if collect_degree is not None and degree <= collect_degree and order <= (collect_order or 0):
                selected[(degree, order)] = (cosine, sine)
            continue
        if degree > spec.max_degree:
            raise GravityModelCacheError(
                f"El coeficiente NGA de grado {degree} supera el máximo declarado de {spec.archive_max_degree}"
            )
        allowed_order = spec.max_order
        if order > allowed_order:
            raise GravityModelCacheError(
                f"El coeficiente NGA {degree},{order} supera el orden publicado {allowed_order}"
            )
        if previous_degree is None:
            if degree != 2 or order != 0:
                raise GravityModelCacheError("El fichero NGA debe empezar en el coeficiente 2,0")
            first_degree = degree
        elif degree == previous_degree:
            assert previous_order is not None
            if order != previous_order + 1:
                raise GravityModelCacheError(
                    f"El orden NGA no es continuo en la línea {line_number}"
                )
        elif degree == previous_degree + 1:
            assert previous_order is not None
            if order != 0:
                raise GravityModelCacheError(
                    f"La cobertura NGA no es continua en la línea {line_number}"
                )
        else:
            raise GravityModelCacheError(
                f"El grado NGA no es continuo en la línea {line_number}"
            )
        previous_degree, previous_order = degree, order
        coverage[degree] = order
        record_count += 1
        max_degree = max(max_degree, degree)
        max_order = max(max_order, order)
        if degree == 2 and order == 0:
            c20 = cosine
        if (
            collect_degree is not None
            and degree <= collect_degree
            and collect_order is not None
            and order <= min(degree, collect_order)
        ):
            selected[(degree, order)] = (cosine, sine)

    if first_degree is None or previous_degree is None or previous_order is None:
        raise GravityModelCacheError("El fichero NGA no contiene la cobertura de grado 2 requerida")
    if max_degree < int(spec.minimum_degree):
        raise GravityModelCacheError(
            f"El fichero NGA no alcanza el grado mínimo esperado {spec.minimum_degree}"
        )
    # Documentation supplies a minimum coverage contract, not a selectable
    # cap. A future archive may carry more orders, but it may never omit a
    # documented coefficient and silently turn it into a zero term.
    for degree in range(2, min(spec.complete_through_degree, max_degree) + 1):
        if coverage.get(degree, -1) < degree:
            raise GravityModelCacheError(
                f"El archivo NGA no completa el grado documentado {degree}"
            )
    for degree in range(spec.complete_through_degree + 1, max_degree + 1):
        minimum_order = min(degree, spec.tail_max_order)
        if coverage.get(degree, -1) < minimum_order:
            raise GravityModelCacheError(
                f"El archivo NGA no cubre el orden mínimo documentado {degree},{minimum_order}"
            )
    if header_max_degree is not None and max_degree != header_max_degree:
        raise GravityModelCacheError(
            "La cabecera NGA y la cobertura de grado descomprimida no coinciden"
        )
    if header_max_order is not None and max_order > header_max_order:
        raise GravityModelCacheError(
            "La cabecera NGA declara un max_order menor que las filas descomprimidas"
        )
    if c20 is None or not -0.01 < c20 < -0.00001:
        raise GravityModelCacheError("El fichero NGA no declara un C20 físicamente plausible")
    # If it is present, C00 was checked.  Its absence is the actual NGA EGM96
    # layout and GravityFieldModel receives the canonical C00 independently.
    del saw_c00
    complete_through_degree = 1
    for degree, maximum_order in sorted(coverage.items()):
        if degree == complete_through_degree + 1 and maximum_order == degree:
            complete_through_degree = degree
        else:
            break
    inspection = GravityArchiveInspection(
        coefficient_entry="",
        archive_sha256="",
        archive_byte_size=0,
        coefficient_byte_size=len(raw),
        coefficient_sha256=hashlib.sha256(raw).hexdigest(),
        record_count=record_count,
        first_degree=first_degree,
        max_degree=max_degree,
        max_order=max_order,
        coefficient_c20=c20,
        degree_order_coverage=tuple(sorted(coverage.items())),
        complete_through_degree=complete_through_degree,
        tail_max_order=coverage[max_degree],
        header_max_degree=header_max_degree,
        header_max_order=header_max_order,
    )
    return inspection, selected


_MAX_NGA_LINE_BYTES = 16 * 1024


def _validate_and_collect_nga_stream(
    stream: BinaryIO,
    spec: GravityModelSpec,
    *,
    collect_degree: int | None = None,
    collect_order: int | None = None,
) -> tuple[GravityArchiveInspection, dict[tuple[int, int], tuple[float, float]]]:
    """Stream-validate a decompressed NGA member without materialising it.

    This is the production parser for EGM2008. It reads bounded lines from a
    ``ZipExtFile``, tracks byte size and digest incrementally, and retains only
    the requested N×M coefficients. The legacy bytes helper below remains for
    tiny injected test fixtures only.
    """

    selected: dict[tuple[int, int], tuple[float, float]] = {(0, 0): (1.0, 0.0)}
    previous_degree: int | None = None
    previous_order: int | None = None
    first_degree: int | None = None
    max_degree = 0
    max_order = 0
    record_count = 0
    c20: float | None = None
    coverage: dict[int, int] = {}
    header_max_degree: int | None = None
    header_max_order: int | None = None
    saw_data = False
    saw_c00 = False
    next_degree_one_order = 0
    digest = hashlib.sha256()
    byte_count = 0
    line_number = 0

    while True:
        raw_line = stream.readline(_MAX_NGA_LINE_BYTES + 1)
        if not raw_line:
            break
        line_number += 1
        if len(raw_line) > _MAX_NGA_LINE_BYTES:
            raise GravityModelCacheError("Una línea del coeficiente NGA supera el límite seguro")
        byte_count += len(raw_line)
        if byte_count > spec.max_extracted_bytes:
            raise GravityModelCacheError("El fichero de coeficientes NGA supera el límite permitido")
        digest.update(raw_line)
        if b"\x00" in raw_line:
            raise GravityModelCacheError("El fichero de coeficientes NGA no es texto plano")
        try:
            stripped = raw_line.decode("utf-8").strip()
        except UnicodeDecodeError as exc:
            raise GravityModelCacheError(
                f"La línea {line_number} del coeficiente NGA no es UTF-8/ASCII"
            ) from exc
        if not saw_data:
            degree_match = _HEADER_DEGREE_RE.match(stripped)
            order_match = _HEADER_ORDER_RE.match(stripped)
            if degree_match is not None:
                candidate = _as_positive_int(degree_match.group(1), "header max_degree")
                if header_max_degree is not None and candidate != header_max_degree:
                    raise GravityModelCacheError("La cabecera NGA declara max_degree de forma contradictoria")
                header_max_degree = candidate
            if order_match is not None:
                candidate = _as_positive_int(order_match.group(1), "header max_order")
                if header_max_order is not None and candidate != header_max_order:
                    raise GravityModelCacheError("La cabecera NGA declara max_order de forma contradictoria")
                header_max_order = candidate
        if not stripped or stripped.startswith(("#", "!", ";")):
            continue
        fields = stripped.split()
        if len(fields) < 4:
            if not saw_data:
                continue
            raise GravityModelCacheError(
                f"La línea {line_number} del coeficiente NGA no tiene n, m, C y S"
            )
        try:
            degree = _nga_integer(fields[0], line_number=line_number, label="n")
            order = _nga_integer(fields[1], line_number=line_number, label="m")
        except GravityModelCacheError:
            if not saw_data:
                continue
            raise
        cosine = _nga_float(fields[2], line_number=line_number, label="Cnm")
        sine = _nga_float(fields[3], line_number=line_number, label="Snm")
        saw_data = True
        if degree < 0 or order < 0 or order > degree:
            raise GravityModelCacheError(
                f"El coeficiente NGA de la línea {line_number} incumple 0 <= m <= n"
            )
        if degree == 0:
            if (
                saw_c00
                or previous_degree is not None
                or next_degree_one_order != 0
                or order != 0
                or not math.isclose(cosine, 1.0, rel_tol=0.0, abs_tol=1e-13)
                or sine != 0.0
            ):
                raise GravityModelCacheError("El coeficiente NGA C00/S00 debe ser 1/0")
            saw_c00 = True
            continue
        if degree == 1:
            if previous_degree is not None or order != next_degree_one_order or cosine != 0.0 or sine != 0.0:
                raise GravityModelCacheError(
                    "Los coeficientes de grado uno NGA deben ser ceros canónicos antes del grado dos"
                )
            next_degree_one_order += 1
            if next_degree_one_order > 2:
                raise GravityModelCacheError("La cobertura de grado uno NGA está duplicada")
            continue
        if next_degree_one_order not in {0, 2}:
            raise GravityModelCacheError("La cobertura de grado uno NGA es incompleta")
        if degree > spec.max_degree or order > spec.max_order:
            raise GravityModelCacheError("El coeficiente NGA supera el techo seguro declarado")
        if previous_degree is None:
            if degree != 2 or order != 0:
                raise GravityModelCacheError("El fichero NGA debe empezar en el coeficiente 2,0")
            first_degree = degree
        elif degree == previous_degree:
            assert previous_order is not None
            if order != previous_order + 1:
                raise GravityModelCacheError(
                    f"El orden NGA no es continuo en la línea {line_number}"
                )
        elif degree == previous_degree + 1:
            if order != 0:
                raise GravityModelCacheError(
                    f"La cobertura NGA no es continua en la línea {line_number}"
                )
        else:
            raise GravityModelCacheError(
                f"El grado NGA no es continuo en la línea {line_number}"
            )
        previous_degree, previous_order = degree, order
        coverage[degree] = order
        record_count += 1
        max_degree = max(max_degree, degree)
        max_order = max(max_order, order)
        if degree == 2 and order == 0:
            c20 = cosine
        if (
            collect_degree is not None
            and degree <= collect_degree
            and collect_order is not None
            and order <= min(degree, collect_order)
        ):
            selected[(degree, order)] = (cosine, sine)

    if byte_count <= 0 or not saw_data or first_degree is None or previous_degree is None:
        raise GravityModelCacheError("El fichero NGA no contiene la cobertura de grado 2 requerida")
    if header_max_degree is not None and header_max_degree > spec.max_degree:
        raise GravityModelCacheError("La cabecera NGA supera el techo seguro de grado configurado")
    if header_max_order is not None and header_max_order > spec.max_order:
        raise GravityModelCacheError("La cabecera NGA supera el techo seguro de orden configurado")
    if max_degree < int(spec.minimum_degree):
        raise GravityModelCacheError(
            f"El fichero NGA no alcanza el grado mínimo esperado {spec.minimum_degree}"
        )
    for degree in range(2, min(spec.complete_through_degree, max_degree) + 1):
        if coverage.get(degree, -1) < degree:
            raise GravityModelCacheError(
                f"El archivo NGA no completa el grado documentado {degree}"
            )
    for degree in range(spec.complete_through_degree + 1, max_degree + 1):
        minimum_order = min(degree, spec.tail_max_order)
        if coverage.get(degree, -1) < minimum_order:
            raise GravityModelCacheError(
                f"El archivo NGA no cubre el orden mínimo documentado {degree},{minimum_order}"
            )
    if header_max_degree is not None and max_degree != header_max_degree:
        raise GravityModelCacheError(
            "La cabecera NGA y la cobertura de grado descomprimida no coinciden"
        )
    if header_max_order is not None and max_order > header_max_order:
        raise GravityModelCacheError(
            "La cabecera NGA declara un max_order menor que las filas descomprimidas"
        )
    if c20 is None or not -0.01 < c20 < -0.00001:
        raise GravityModelCacheError("El fichero NGA no declara un C20 físicamente plausible")
    complete_through_degree = 1
    for degree, maximum_order in sorted(coverage.items()):
        if degree == complete_through_degree + 1 and maximum_order == degree:
            complete_through_degree = degree
        else:
            break
    inspection = GravityArchiveInspection(
        coefficient_entry="",
        archive_sha256="",
        archive_byte_size=0,
        coefficient_byte_size=byte_count,
        coefficient_sha256=digest.hexdigest(),
        record_count=record_count,
        first_degree=first_degree,
        max_degree=max_degree,
        max_order=max_order,
        coefficient_c20=c20,
        degree_order_coverage=tuple(sorted(coverage.items())),
        complete_through_degree=complete_through_degree,
        tail_max_order=coverage[max_degree],
        header_max_degree=header_max_degree,
        header_max_order=header_max_order,
    )
    return inspection, selected


def _inspection_from_archive_bytes(raw: bytes, spec: GravityModelSpec) -> tuple[GravityArchiveInspection, bytes]:
    if not isinstance(raw, bytes):
        raise GravityModelCacheError("La descarga NGA no devolvió bytes")
    if not raw:
        raise GravityModelCacheError("La descarga NGA está vacía")
    # This bytes adapter is test-only; production uses the path/stream reader.
    if len(raw) > min(spec.max_archive_bytes, _MAX_COMPAT_FIXTURE_ARCHIVE_BYTES):
        raise GravityModelCacheError("La descarga NGA supera el tamaño máximo permitido")
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            (info,) = _safe_zip_members(archive, spec)
            coefficient = _read_member_bytes(
                archive,
                info,
                max_bytes=min(spec.max_extracted_bytes, _MAX_COMPAT_FIXTURE_MEMBER_BYTES),
            )
    except zipfile.BadZipFile as exc:
        raise GravityModelCacheError("La descarga NGA no es un ZIP válido") from exc
    # Compatibility path for bounded injected test fixtures. Production cache
    # inspection uses ``_inspection_from_archive_path`` below and never builds
    # this coefficient byte string in memory.
    inspection, _unused = _validate_and_collect_nga_stream(io.BytesIO(coefficient), spec)
    return replace(
        inspection,
        coefficient_entry=info.filename,
        archive_sha256=hashlib.sha256(raw).hexdigest(),
        archive_byte_size=len(raw),
    ), coefficient


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _inspection_from_archive_path(path: Path, spec: GravityModelSpec) -> GravityArchiveInspection:
    try:
        size = path.stat().st_size
    except FileNotFoundError:
        raise
    except OSError as exc:
        raise GravityModelCacheError(f"No se puede leer el archivo NGA local: {path}") from exc
    if size <= 0 or size > spec.max_archive_bytes:
        raise GravityModelCacheError("El archivo NGA local tiene un tamaño inválido")
    try:
        with zipfile.ZipFile(path) as archive:
            (info,) = _safe_zip_members(archive, spec)
            with archive.open(info, "r") as member:
                inspection, _unused = _validate_and_collect_nga_stream(member, spec)
        return replace(
            inspection,
            coefficient_entry=info.filename,
            archive_sha256=_sha256_path(path),
            archive_byte_size=size,
        )
    except zipfile.BadZipFile as exc:
        raise GravityModelCacheError("El archivo NGA local no es un ZIP válido") from exc
    except OSError as exc:
        raise GravityModelCacheError(f"No se puede leer el archivo NGA local: {path}") from exc


def _temporary_path(destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.",
        suffix=".tmp",
        dir=destination.parent,
    )
    os.close(descriptor)
    return Path(temporary_name)


def _extract_coefficient_to_temporary(
    archive_path: Path,
    spec: GravityModelSpec,
    destination: Path,
    inspection: GravityArchiveInspection,
) -> Path:
    """Stream the exact validated member into a same-volume temporary file."""

    temporary = _temporary_path(destination)
    try:
        total = 0
        digest = hashlib.sha256()
        with zipfile.ZipFile(archive_path) as archive:
            (info,) = _safe_zip_members(archive, spec)
            if info.filename != inspection.coefficient_entry:
                raise GravityModelCacheError("El miembro NGA cambió durante la validación")
            with archive.open(info, "r") as source, temporary.open("wb") as target:
                while chunk := source.read(1024 * 1024):
                    total += len(chunk)
                    if total > spec.max_extracted_bytes:
                        raise GravityModelCacheError(
                            "El fichero de coeficientes NGA supera el límite permitido"
                        )
                    digest.update(chunk)
                    target.write(chunk)
                target.flush()
                os.fsync(target.fileno())
        if total != inspection.coefficient_byte_size or digest.hexdigest() != inspection.coefficient_sha256:
            raise GravityModelCacheError("El miembro NGA extraído no coincide con su validación")
        return temporary
    except Exception:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _coefficient_matches(path: Path, inspection: GravityArchiveInspection) -> bool:
    try:
        if path.stat().st_size != inspection.coefficient_byte_size:
            return False
        return _sha256_path(path) == inspection.coefficient_sha256
    except OSError:
        return False


def _harmonic_term_count(degree: int, order: int) -> int:
    maximum_order = min(degree, order)
    lower_triangle = maximum_order * (maximum_order + 3) // 2
    rectangular_tail = (degree - maximum_order) * (maximum_order + 1)
    return lower_triangle + rectangular_tail


class GravityModelRegistry:
    """Thread-safe cache/registry for the two immutable NGA model families.

    ``refresh_if_needed`` is deliberately the only method that can contact
    NGA.  It validates an entire archive before atomically replacing cache
    bytes or its extracted coefficient member.  Selection and materialisation
    work solely from the last validated local file.
    """

    def __init__(
        self,
        cache_root: str | Path = GEOPOTENTIAL_DATA_DIR,
        *,
        active_model: str = "EGM2008",
        specs: Iterable[GravityModelSpec] = NGA_GRAVITY_SPECS.values(),
        refresh_age: datetime.timedelta = NGA_GRAVITY_REFRESH_AGE,
        timeout_seconds: float = NGA_GRAVITY_DOWNLOAD_TIMEOUT_SECONDS,
        automatic_download: bool = True,
        fetcher: DownloadFetcher | None = None,
        now: Callable[[], datetime.datetime] = utc_now,
    ) -> None:
        if refresh_age <= datetime.timedelta(0):
            raise ValueError("refresh_age debe ser positivo")
        timeout = _finite(timeout_seconds, "timeout_seconds")
        if not 0.1 <= timeout <= 120.0:
            raise ValueError("timeout_seconds debe estar entre 0.1 y 120 segundos")
        supplied = tuple(specs)
        if not supplied:
            raise ValueError("El registro de gravedad requiere al menos un modelo")
        indexed: dict[str, GravityModelSpec] = {}
        for spec in supplied:
            _canonical_url_for(spec)
            if spec.model_id in indexed:
                raise ValueError(f"Modelo NGA duplicado: {spec.model_id}")
            indexed[spec.model_id] = spec
        selected = _normalise_model_id(active_model)
        if selected not in indexed:
            raise ValueError(f"El modelo activo {selected} no está instalado en el registro")
        self.cache_root = Path(cache_root)
        self.active_model = selected
        self.specs = indexed
        self.refresh_age = refresh_age
        self.timeout_seconds = timeout
        self.automatic_download = bool(automatic_download)
        # A custom byte fetcher exists solely for small, offline test fixtures.
        # Production downloads stream directly into a staged cache file.
        self._fetcher = fetcher
        self._now = now
        self._state_lock = threading.RLock()
        self._refresh_lock = threading.Lock()
        self._materialization_lock = threading.Lock()
        self._materialized: OrderedDict[tuple[str, int, int, str], GravityFieldModel] = OrderedDict()
        self._materialization_misses: deque[float] = deque()
        initial_progress_at = ensure_utc(now())
        self._records: dict[str, GravityModelRecord] = {
            model_id: self._missing_record(spec, None, "La comprobación de gravedad aún no se ha ejecutado.")
            for model_id, spec in indexed.items()
        }
        self._startup_progress: dict[str, GravityStartupProgress] = {
            model_id: GravityStartupProgress(
                model_id=model_id,
                state="pending",
                stage="waiting",
                downloaded_bytes=0,
                total_bytes=None,
                message="Pendiente de comprobación de inicio.",
                updated_at=initial_progress_at,
            )
            for model_id in indexed
        }

    def _paths(self, spec: GravityModelSpec) -> tuple[Path, Path]:
        folder = self.cache_root / spec.model_id.lower()
        entry_name = spec.coefficient_entry_names[0]
        return folder / spec.archive_filename, folder / entry_name

    def _missing_record(
        self,
        spec: GravityModelSpec,
        checked_at: datetime.datetime | None,
        error: str | None,
        *,
        status: GravityModelStatus = "warning",
    ) -> GravityModelRecord:
        archive, coefficient = self._paths(spec)
        return GravityModelRecord(
            spec=spec,
            status=status,
            archive_path=archive,
            coefficient_path=coefficient,
            last_validation=checked_at,
            error=error,
            refresh_due=True,
        )

    def record(self, model_id: object) -> GravityModelRecord:
        canonical = _normalise_model_id(model_id)
        with self._state_lock:
            try:
                return self._records[canonical]
            except KeyError as exc:
                raise GravityModelCacheError(f"El modelo {canonical} no está registrado") from exc

    def records(self) -> Mapping[str, GravityModelRecord]:
        with self._state_lock:
            return dict(self._records)

    def _publish_startup_progress(
        self,
        model_id: str,
        *,
        state: GravityStartupProgressState,
        stage: str,
        message: str | None,
        downloaded_bytes: int = 0,
        total_bytes: int | None = None,
    ) -> None:
        """Replace one model progress fact without touching files or network."""

        downloaded = max(0, int(downloaded_bytes))
        total = int(total_bytes) if total_bytes is not None else None
        if total is not None:
            total = max(0, total)
            downloaded = min(downloaded, total)
        safe_message = " ".join(str(message or "").split())[:500] or None
        progress = GravityStartupProgress(
            model_id=model_id,
            state=state,
            stage=str(stage or "waiting").strip()[:80] or "waiting",
            downloaded_bytes=downloaded,
            total_bytes=total,
            message=safe_message,
            updated_at=ensure_utc(self._now()),
        )
        with self._state_lock:
            self._startup_progress[model_id] = progress

    def _progress_snapshot(self, model_id: str) -> GravityStartupProgress:
        with self._state_lock:
            return self._startup_progress[model_id]

    @staticmethod
    def _startup_progress_payload(
        progress: Mapping[str, GravityStartupProgress],
    ) -> dict[str, object]:
        """Summarise model facts without disguising unknown byte totals."""

        entries = {model_id: item.payload() for model_id, item in progress.items()}
        values = tuple(progress.values())
        total_models = len(values)
        completed_models = sum(1 for item in values if item.state == "ready")
        if any(item.state == "error" for item in values):
            state: GravityStartupProgressState = "error"
        elif any(item.state == "downloading" for item in values):
            state = "downloading"
        elif any(item.state == "validating" for item in values):
            state = "validating"
        elif values and all(item.state == "ready" for item in values):
            state = "ready"
        else:
            state = "pending"
        active = next(
            (
                item
                for item in values
                if item.state in {"downloading", "validating", "pending", "error"}
            ),
            None,
        )
        # The aggregate is a startup-completion estimate. Per-model percent
        # remains the only byte-accurate transfer percentage.
        indeterminate_transfer = any(
            item.state == "downloading" and item.total_bytes is None for item in values
        )
        if not values:
            percent: int | None = 100
        elif indeterminate_transfer:
            percent = None
        else:
            fractions: list[float] = []
            for item in values:
                if item.state == "ready":
                    fractions.append(1.0)
                elif item.state == "downloading" and item.percent is not None:
                    fractions.append(item.percent / 100.0)
                else:
                    fractions.append(0.0)
            percent = int(round((sum(fractions) * 100.0) / total_models))
        return {
            "state": state,
            "currentModel": active.model_id if active is not None else None,
            "completedModels": completed_models,
            "totalModels": total_models,
            "percent": percent,
            "progressMode": "model-completion; per-model bytes when Content-Length is known",
            "models": entries,
        }

    def diagnostics_payload(self) -> dict[str, object]:
        """Return JSON-safe registry health without touching disk or network."""

        with self._state_lock:
            records = dict(self._records)
            startup_progress = dict(self._startup_progress)
            cached_selections = len(self._materialized)
            now_monotonic = time.monotonic()
            recent_misses = sum(
                1
                for timestamp in self._materialization_misses
                if now_monotonic - timestamp < _MATERIALIZATION_WINDOW_SECONDS
            )
        model_payloads = {model_id: record.payload() for model_id, record in records.items()}
        active = records[self.active_model]
        statuses = [record.status for record in records.values()]
        if active.status == "error":
            status: GravityModelStatus = "error"
        elif active.status != "ok" or "error" in statuses or "warning" in statuses:
            status = "warning"
        elif statuses and all(value == "ok" for value in statuses):
            status = "ok"
        else:
            status = "unknown"
        return {
            "status": status,
            "activeModel": self.active_model,
            "automatic": self.automatic_download,
            "cacheRoot": str(self.cache_root),
            "models": model_payloads,
            "progress": self._startup_progress_payload(startup_progress),
            "materialization": {
                "cachedSelections": cached_selections,
                "maxCachedSelections": _MAX_MATERIALIZED_SELECTIONS,
                "recentMisses": recent_misses,
                "maxMissesPerMinute": _MAX_MATERIALIZATION_MISSES_PER_MINUTE,
                "networkDuringEvaluation": False,
            },
            "lastValidation": max(
                (record.last_validation for record in records.values() if record.last_validation is not None),
                default=None,
            ) and _iso(max(
                record.last_validation for record in records.values() if record.last_validation is not None
            )),
            "error": active.error if active.status != "ok" else None,
        }

    def validate_cached(self) -> Mapping[str, GravityModelRecord]:
        """Validate local archives only; this method never opens the network."""

        checked_at = ensure_utc(self._now())
        records: dict[str, GravityModelRecord] = {}
        for model_id, spec in self.specs.items():
            records[model_id] = self._load_local_record(spec, checked_at)
        with self._state_lock:
            self._records = records
            self._materialized.clear()
            self._materialization_misses.clear()
        return self.records()

    def refresh_if_needed(self) -> Mapping[str, GravityModelRecord]:
        """Refresh missing/stale archives in a monitor worker, never in RK4."""

        if not self._refresh_lock.acquire(blocking=False):
            return self.records()
        try:
            checked_at = ensure_utc(self._now())
            records: dict[str, GravityModelRecord] = {}
            for model_id, spec in self.specs.items():
                self._publish_startup_progress(
                    model_id,
                    state="validating",
                    stage="local-cache",
                    message=f"Validando la caché local de {spec.model_id}.",
                )
                local = self._load_local_record(spec, checked_at)
                if local.available and not local.refresh_due:
                    records[model_id] = local
                    self._publish_startup_progress(
                        model_id,
                        state="ready",
                        stage="complete",
                        message=f"La caché de {spec.model_id} se ha validado.",
                    )
                    continue
                if not self.automatic_download:
                    if local.available:
                        records[model_id] = replace(
                            local,
                            status="warning",
                            error="El modelo NGA local está obsoleto y la descarga automática está desactivada.",
                            refresh_due=True,
                            using_cached_fallback=True,
                        )
                    else:
                        records[model_id] = replace(
                            local,
                            status="warning",
                            error="No hay un modelo NGA local válido y la descarga automática está desactivada.",
                        )
                    self._publish_startup_progress(
                        model_id,
                        state="error",
                        stage="automatic-download-disabled",
                        message=(
                            f"{spec.model_id} no está listo porque la descarga automática está desactivada."
                        ),
                    )
                    continue
                try:
                    self._publish_startup_progress(
                        model_id,
                        state="downloading",
                        stage="download",
                        message=f"Descargando {spec.model_id} desde NGA.",
                    )
                    archive_path, coefficient_path = self._paths(spec)
                    staged_archive = _temporary_path(archive_path)
                    staged_coefficient: Path | None = None
                    try:
                        if self._fetcher is None:
                            self._download_https_to_path(
                                spec.url,
                                self.timeout_seconds,
                                spec.max_archive_bytes,
                                staged_archive,
                                on_progress=lambda downloaded, total: self._publish_startup_progress(
                                    model_id,
                                    state="downloading",
                                    stage="download",
                                    message=f"Descargando {spec.model_id} desde NGA.",
                                    downloaded_bytes=downloaded,
                                    total_bytes=total,
                                ),
                            )
                        else:
                            raw = self._fetcher(
                                spec.url,
                                self.timeout_seconds,
                                spec.max_archive_bytes,
                            )
                            if not isinstance(raw, bytes):
                                raise GravityModelCacheError("El fetcher NGA de prueba no devolvió bytes")
                            if not raw or len(raw) > spec.max_archive_bytes:
                                raise GravityModelCacheError("El fetcher NGA de prueba supera el límite permitido")
                            self._publish_startup_progress(
                                model_id,
                                state="downloading",
                                stage="download",
                                message=f"{spec.model_id} descargado; validando el archivo.",
                                downloaded_bytes=len(raw),
                                total_bytes=len(raw),
                            )
                            with staged_archive.open("wb") as target:
                                target.write(raw)
                                target.flush()
                                os.fsync(target.fileno())
                        transfer = self._progress_snapshot(model_id)
                        self._publish_startup_progress(
                            model_id,
                            state="validating",
                            stage="archive-validation",
                            message=f"Validando el archivo y la cobertura de coeficientes de {spec.model_id}.",
                            downloaded_bytes=transfer.downloaded_bytes,
                            total_bytes=transfer.total_bytes,
                        )
                        inspection = _inspection_from_archive_path(staged_archive, spec)
                        transfer = self._progress_snapshot(model_id)
                        self._publish_startup_progress(
                            model_id,
                            state="validating",
                            stage="coefficient-extraction",
                            message=f"Extrayendo los coeficientes validados de {spec.model_id}.",
                            downloaded_bytes=transfer.downloaded_bytes,
                            total_bytes=transfer.total_bytes,
                        )
                        staged_coefficient = _extract_coefficient_to_temporary(
                            staged_archive,
                            spec,
                            coefficient_path,
                            inspection,
                        )
                        # Each file replacement is atomic. If a process dies
                        # between them, the next local validation rebuilds the
                        # extracted member from the authoritative ZIP.
                        os.replace(staged_archive, archive_path)
                        staged_archive = None
                        os.replace(staged_coefficient, coefficient_path)
                        staged_coefficient = None
                    finally:
                        for staged in (staged_archive, staged_coefficient):
                            if staged is not None:
                                try:
                                    staged.unlink(missing_ok=True)
                                except OSError:
                                    pass
                    update = datetime.datetime.fromtimestamp(archive_path.stat().st_mtime, tz=datetime.UTC)
                    records[model_id] = GravityModelRecord(
                        spec=spec,
                        status="ok",
                        archive_path=archive_path,
                        coefficient_path=coefficient_path,
                        inspection=inspection,
                        last_update=update,
                        last_validation=checked_at,
                        error=None,
                        refresh_due=False,
                        using_cached_fallback=False,
                    )
                    transfer = self._progress_snapshot(model_id)
                    self._publish_startup_progress(
                        model_id,
                        state="ready",
                        stage="complete",
                        message=f"{spec.model_id} se ha descargado y validado.",
                        downloaded_bytes=transfer.downloaded_bytes,
                        total_bytes=transfer.total_bytes,
                    )
                except Exception as exc:  # transport + untrusted archive boundary
                    message = _safe_error(exc)
                    if local.available:
                        records[model_id] = replace(
                            local,
                            status="warning",
                            last_validation=checked_at,
                            error=f"No se pudo actualizar {spec.model_id}; se conserva la última copia válida: {message}",
                            refresh_due=True,
                            using_cached_fallback=True,
                        )
                    else:
                        invalid = isinstance(exc, GravityModelCacheError)
                        records[model_id] = self._missing_record(
                            spec,
                            checked_at,
                            f"No hay una copia {spec.model_id} válida disponible: {message}",
                            status="error" if invalid else "warning",
                        )
                    transfer = self._progress_snapshot(model_id)
                    self._publish_startup_progress(
                        model_id,
                        state="error",
                        stage="failed",
                        message=f"Falló la validación de inicio de {spec.model_id}: {message}",
                        downloaded_bytes=transfer.downloaded_bytes,
                        total_bytes=transfer.total_bytes,
                    )
            with self._state_lock:
                self._records = records
                self._materialized.clear()
                self._materialization_misses.clear()
            return self.records()
        finally:
            self._refresh_lock.release()

    def resolve_selection(
        self,
        model_id: object | None = None,
        degree: object | None = None,
        order: object | None = None,
    ) -> GravityModelSelection:
        """Resolve against inspected archive coverage, never spec guesses.

        A missing, invalid or still-pending local archive fails closed. The
        diagnostics endpoint can show hard parser ceilings while it waits, but
        only this method turns validated coefficients into a selectable N×M.
        """

        selected = _normalise_model_id(model_id or self.active_model)
        try:
            spec = self.specs[selected]
        except KeyError as exc:
            raise GravityModelCacheError(f"El modelo {selected} no está registrado") from exc
        record = self.record(selected)
        inspection = record.inspection
        if not record.available or inspection is None:
            raise GravityModelCacheError(
                f"{selected} no está disponible localmente y validado; espere a la comprobación de inicio."
            )
        requested_degree = (
            inspection.max_degree
            if degree is None
            else _as_positive_int(degree, "geopotential_degree")
        )
        bounded_degree = min(requested_degree, inspection.max_degree)
        selectable_order = inspection.max_selectable_order(bounded_degree)
        requested_order = (
            selectable_order
            if order is None
            else _as_nonnegative_int(order, "geopotential_order")
        )
        bounded_order = min(requested_order, selectable_order)
        warnings: list[str] = []
        if requested_degree > inspection.max_degree or requested_order > selectable_order:
            warnings.append(
                "Requested degree/order exceeds validated archive coverage. "
                f"Using maxDegree={inspection.max_degree}, maxOrder={selectable_order}."
            )
        if requested_order > bounded_degree:
            warnings.append("El orden del geopotencial no puede superar el grado; se ajustó al grado efectivo.")
        provenance: dict[str, object] = {
            "source": "NGA",
            "sourceUrl": spec.url,
            "archive": str(record.archive_path),
            "sha256": inspection.archive_sha256,
            "normalization": "fully_normalized",
            "tideSystem": spec.tide_system,
            "modelMaxDegree": inspection.max_degree,
            "modelMaxOrder": inspection.max_order,
            "maxSelectableOrder": selectable_order,
            "archiveMaxDegree": spec.archive_max_degree,
            "completeThroughDegree": inspection.complete_through_degree,
            "tailMaxOrder": inspection.tail_max_order,
            "coverage": inspection.coverage_payload(),
            "headerMaxDegree": inspection.header_max_degree,
            "headerMaxOrder": inspection.header_max_order,
            "hardMaxDegree": spec.max_degree,
            "hardMaxOrder": spec.max_order,
        }
        return GravityModelSelection(
            model_id=selected,
            requested_degree=requested_degree,
            requested_order=requested_order,
            degree=bounded_degree,
            order=bounded_order,
            available=record.available,
            warnings=tuple(warnings),
            provenance=provenance,
        )

    def _cached_materialization(
        self,
        cache_key: tuple[str, int, int, str],
    ) -> GravityFieldModel | None:
        """Get one immutable field and promote it in the bounded LRU."""

        with self._state_lock:
            cached = self._materialized.get(cache_key)
            if cached is not None:
                self._materialized.move_to_end(cache_key)
            return cached

    def _reserve_materialization_miss(self) -> None:
        """Reserve a bounded sequential local validation/materialisation pass."""

        now_monotonic = time.monotonic()
        with self._state_lock:
            while (
                self._materialization_misses
                and now_monotonic - self._materialization_misses[0]
                >= _MATERIALIZATION_WINDOW_SECONDS
            ):
                self._materialization_misses.popleft()
            if len(self._materialization_misses) >= _MAX_MATERIALIZATION_MISSES_PER_MINUTE:
                raise GravityModelCacheError(
                    "Se han solicitado demasiadas materializaciones NGA nuevas en un minuto; "
                    "espere antes de cambiar otra vez grado u orden."
                )
            self._materialization_misses.append(now_monotonic)

    def _cache_materialization(
        self,
        cache_key: tuple[str, int, int, str],
        model: GravityFieldModel,
    ) -> None:
        """Store a field in the small LRU after its archive identity check."""

        with self._state_lock:
            self._materialized[cache_key] = model
            self._materialized.move_to_end(cache_key)
            while len(self._materialized) > _MAX_MATERIALIZED_SELECTIONS:
                self._materialized.popitem(last=False)

    def materialize_selection(
        self,
        selection: GravityModelSelection,
        *,
        max_harmonic_terms: int = _DEFAULT_MATERIALIZATION_TERM_LIMIT,
    ) -> GravityFieldModel:
        """Materialise one validated selection with bounded reuse and work.

        A cache hit returns immediately. A miss is serialised and rate-limited
        before the one-pass validation of the local coefficient member. This
        method never downloads; RK4 only receives its immutable return value.
        """

        if not isinstance(selection, GravityModelSelection):
            raise TypeError("selection debe ser GravityModelSelection")
        if max_harmonic_terms <= 0:
            raise ValueError("max_harmonic_terms debe ser positivo")
        record = self.record(selection.model_id)
        if not record.available or record.inspection is None:
            raise GravityModelCacheError(
                f"{selection.model_id} no estÃ¡ disponible localmente y validado; espere a la comprobaciÃ³n de inicio."
            )
        if (
            selection.degree < record.inspection.first_degree
            or selection.degree > record.inspection.max_degree
            or selection.order < 0
            or selection.order > record.inspection.max_selectable_order(selection.degree)
        ):
            raise GravityModelCacheError(
                "La selecciÃ³n NGA no estÃ¡ cubierta por el archivo validado."
            )
        terms = _harmonic_term_count(selection.degree, selection.order)
        if terms > int(max_harmonic_terms):
            raise GravityModelCacheError(
                f"La selecciÃ³n {selection.degree}Ã—{selection.order} requiere {terms} tÃ©rminos; "
                f"el evaluador actual admite {int(max_harmonic_terms)}."
            )
        cache_key = (
            selection.model_id,
            selection.degree,
            selection.order,
            record.inspection.archive_sha256,
        )
        cached = self._cached_materialization(cache_key)
        if cached is not None:
            return cached
        # Serialise misses so concurrent callers selecting the same N/M do
        # not each parse the full (potentially hundreds-of-MiB) member.
        with self._materialization_lock:
            cached = self._cached_materialization(cache_key)
            if cached is not None:
                return cached
            self._reserve_materialization_miss()
            return self._materialize_selection_uncached(
                selection,
                max_harmonic_terms=max_harmonic_terms,
            )

    def _materialize_selection_uncached(
        self,
        selection: GravityModelSelection,
        *,
        max_harmonic_terms: int = _DEFAULT_MATERIALIZATION_TERM_LIMIT,
    ) -> GravityFieldModel:
        """Build an immutable in-memory field from a validated local member.

        The ceiling guards the pure-Python dictionary/evaluator from a very
        large EGM allocation. It is an engine limit, not a scientific model
        cap; the selected N×M has already been derived from archive coverage.
        """

        if not isinstance(selection, GravityModelSelection):
            raise TypeError("selection debe ser GravityModelSelection")
        if max_harmonic_terms <= 0:
            raise ValueError("max_harmonic_terms debe ser positivo")
        record = self.record(selection.model_id)
        if not record.available or record.inspection is None:
            raise GravityModelCacheError(
                f"{selection.model_id} no está disponible localmente y validado; espere a la comprobación de inicio."
            )
        terms = _harmonic_term_count(selection.degree, selection.order)
        if terms > int(max_harmonic_terms):
            raise GravityModelCacheError(
                f"La selección {selection.degree}×{selection.order} requiere {terms} términos; "
                f"el evaluador actual admite {int(max_harmonic_terms)}."
            )
        cache_key = (
            selection.model_id,
            selection.degree,
            selection.order,
            record.inspection.archive_sha256,
        )
        cached = self._cached_materialization(cache_key)
        if cached is not None:
            return cached
        # The extracted file is an untrusted cache boundary too.  Revalidate
        # its entire coverage and check that it is still the archived member
        # whose digest/provenance was installed by the monitor.
        try:
            with record.coefficient_path.open("rb") as coefficient_file:
                inspection, coefficients = _validate_and_collect_nga_stream(
                    coefficient_file,
                    record.spec,
                    collect_degree=selection.degree,
                    collect_order=selection.order,
                )
        except OSError as exc:
            raise GravityModelCacheError(
                f"No se puede leer el coeficiente local de {selection.model_id}"
            ) from exc
        if (
            selection.degree > inspection.max_degree
            or selection.order > inspection.max_selectable_order(selection.degree)
        ):
            raise GravityModelCacheError(
                "El coeficiente local ya no cubre la selección NGA validada"
            )
        if (
            inspection.record_count != record.inspection.record_count
            or inspection.coefficient_byte_size != record.inspection.coefficient_byte_size
            or inspection.coefficient_sha256 != record.inspection.coefficient_sha256
        ):
            raise GravityModelCacheError("El coeficiente extraído ya no coincide con el archivo NGA validado")
        model = GravityFieldModel(
            model_id=selection.model_id,
            source=f"NGA {selection.model_id} spherical harmonics",
            version=f"sha256:{record.inspection.archive_sha256[:16]}",
            sha256=inspection.coefficient_sha256,
            mu_km3_s2=record.spec.mu_km3_s2,
            reference_radius_km=record.spec.reference_radius_km,
            normalization="fully_normalized",
            # Do not claim omitted high-degree coefficients are loaded.  The
            # field itself is deliberately bounded to the resolved selection.
            max_degree=selection.degree,
            coefficients=coefficients,
            tide_system=record.spec.tide_system,
        )
        with self._state_lock:
            # A concurrent refresh may have replaced the record while this
            # bounded local parse ran.  Never cache an old model under a new
            # archive digest; returning this immutable instance is still safe
            # for the caller that explicitly resolved the old selection.
            current = self._records.get(selection.model_id)
            if current is not None and current.inspection is not None and (
                current.inspection.archive_sha256 == record.inspection.archive_sha256
            ):
                self._cache_materialization(cache_key, model)
        return model

    def _load_local_record(
        self,
        spec: GravityModelSpec,
        checked_at: datetime.datetime,
    ) -> GravityModelRecord:
        archive_path, coefficient_path = self._paths(spec)
        try:
            inspection = _inspection_from_archive_path(archive_path, spec)
            # Recreate an absent/partial extracted member from the archive.
            # It is written atomically and no network request occurs here.
            if not _coefficient_matches(coefficient_path, inspection):
                temporary = _extract_coefficient_to_temporary(
                    archive_path,
                    spec,
                    coefficient_path,
                    inspection,
                )
                os.replace(temporary, coefficient_path)
            update = datetime.datetime.fromtimestamp(archive_path.stat().st_mtime, tz=datetime.UTC)
            fresh = self._is_fresh(update, checked_at)
            return GravityModelRecord(
                spec=spec,
                status="ok" if fresh else "warning",
                archive_path=archive_path,
                coefficient_path=coefficient_path,
                inspection=inspection,
                last_update=update,
                last_validation=checked_at,
                error=None if fresh else "El modelo NGA local supera la antigüedad máxima configurada.",
                refresh_due=not fresh,
                using_cached_fallback=not fresh,
            )
        except FileNotFoundError:
            return self._missing_record(spec, checked_at, "No existe una copia NGA local.")
        except Exception as exc:
            return self._missing_record(
                spec,
                checked_at,
                f"La copia local de {spec.model_id} no es válida: {_safe_error(exc)}",
                status="error",
            )

    def _is_fresh(self, update: datetime.datetime, now: datetime.datetime) -> bool:
        return ensure_utc(now) - ensure_utc(update) <= self.refresh_age

    @staticmethod
    def _download_https_to_path(
        url: str,
        timeout_seconds: float,
        max_bytes: int,
        destination: Path,
        *,
        on_progress: Callable[[int, int | None], None] | None = None,
    ) -> None:
        """Stream one fixed NGA archive into a staged file, without redirects."""

        spec = next((item for item in NGA_GRAVITY_SPECS.values() if item.url == url), None)
        if spec is None:
            raise ValueError("La descarga de gravedad debe usar una URL oficial fija de NGA")
        _canonical_url_for(spec)
        request = Request(url, headers={"Accept": "application/zip", "User-Agent": "Orbit-Tracker/0.2"})
        opener = build_opener(_RejectRedirects())
        with opener.open(request, timeout=float(timeout_seconds)) as response:
            if response.geturl() != url:
                raise OSError("La descarga automática de gravedad no admite redirecciones")
            advertised = response.headers.get("Content-Length")
            advertised_total: int | None = None
            if advertised is not None:
                try:
                    advertised_total = int(advertised)
                    if advertised_total <= 0:
                        raise GravityModelCacheError("La descarga NGA declara Content-Length no positivo")
                    if advertised_total > int(max_bytes):
                        raise GravityModelCacheError("La descarga NGA supera el tamaño máximo permitido")
                except ValueError as exc:
                    raise GravityModelCacheError("La descarga NGA declara Content-Length inválido") from exc
            if on_progress is not None:
                try:
                    on_progress(0, advertised_total)
                except Exception:
                    # Progress reporting is observational only; it must never
                    # interrupt a verified cache transfer.
                    pass
            total = 0
            with destination.open("wb") as target:
                while True:
                    chunk = response.read(min(1024 * 1024, int(max_bytes) + 1 - total))
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > int(max_bytes):
                        raise GravityModelCacheError("La descarga NGA supera el tamaño máximo permitido")
                    target.write(chunk)
                    if on_progress is not None:
                        try:
                            on_progress(total, advertised_total)
                        except Exception:
                            pass
                target.flush()
                os.fsync(target.fileno())
        if advertised_total is not None and total != advertised_total:
            raise GravityModelCacheError("La descarga NGA no coincide con Content-Length")
        if total <= 0:
            raise GravityModelCacheError("La descarga NGA está vacía")


def _bool(value: object, *, default: bool) -> bool:
    token = str(value or "").strip().lower()
    if not token:
        return default
    if token in {"1", "true", "yes", "on"}:
        return True
    if token in {"0", "false", "no", "off"}:
        return False
    raise ValueError("El valor booleano de gravedad debe ser true/false")


def build_gravity_model_registry_from_environment(
    environment: Mapping[str, str] | None = None,
    *,
    fetcher: DownloadFetcher | None = None,
    now: Callable[[], datetime.datetime] = utc_now,
) -> GravityModelRegistry:
    """Build the automatic NGA registry without doing network I/O.

    ``ORBIT_GRAVITY_CACHE_DIR`` defaults to ``data/geopotential``.
    ``ORBIT_GRAVITY_MODEL`` chooses ``EGM96`` or ``EGM2008`` (default EGM2008).
    ``ORBIT_GRAVITY_REFRESH_DAYS`` defaults to 30 and
    ``ORBIT_GRAVITY_AUTO_DOWNLOAD`` defaults to true.  The monitor invokes the
    first refresh after FastAPI is healthy; constructing the app does not.
    """

    values = os.environ if environment is None else environment
    cache_root = str(values.get("ORBIT_GRAVITY_CACHE_DIR", "")).strip() or str(GEOPOTENTIAL_DATA_DIR)
    active = str(values.get("ORBIT_GRAVITY_MODEL", "")).strip() or "EGM2008"
    refresh_days_raw = str(values.get("ORBIT_GRAVITY_REFRESH_DAYS", "")).strip()
    refresh_days = 30.0 if not refresh_days_raw else _finite(refresh_days_raw, "ORBIT_GRAVITY_REFRESH_DAYS")
    if not 1.0 <= refresh_days <= 3650.0:
        raise ValueError("ORBIT_GRAVITY_REFRESH_DAYS debe estar entre 1 y 3650")
    timeout_raw = str(values.get("ORBIT_GRAVITY_DOWNLOAD_TIMEOUT_SECONDS", "")).strip()
    timeout = NGA_GRAVITY_DOWNLOAD_TIMEOUT_SECONDS if not timeout_raw else _finite(
        timeout_raw, "ORBIT_GRAVITY_DOWNLOAD_TIMEOUT_SECONDS"
    )
    return GravityModelRegistry(
        cache_root,
        active_model=active,
        refresh_age=datetime.timedelta(days=refresh_days),
        timeout_seconds=timeout,
        automatic_download=_bool(values.get("ORBIT_GRAVITY_AUTO_DOWNLOAD"), default=True),
        fetcher=fetcher,
        now=now,
    )


__all__ = [
    "EGM96_SPEC",
    "EGM2008_SPEC",
    "NGA_EGM96_URL",
    "NGA_EGM2008_URL",
    "NGA_GRAVITY_REFRESH_AGE",
    "NGA_GRAVITY_DOWNLOAD_TIMEOUT_SECONDS",
    "GravityArchiveInspection",
    "GravityModelCacheError",
    "GravityModelRecord",
    "GravityModelRegistry",
    "GravityModelSelection",
    "GravityModelSpec",
    "GravityStartupProgress",
    "GravityStartupProgressState",
    "build_gravity_model_registry_from_environment",
]
