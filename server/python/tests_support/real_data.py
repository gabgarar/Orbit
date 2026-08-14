"""Opt-in, reproducible real-data support for integration tests.

Normal Orbit tests deliberately use compact fixtures and never open a network
connection.  This module is only imported by opt-in integration tests and the
``test-real-data`` helper.  It supplies a small, immutable CODE MGEX SP3/ERP
bundle with a pinned SHA-256, plus an optional current IERS C01 probe whose
contents are validated and recorded but cannot be source-pinned because IERS
updates that URL in place.

The downloader is intentionally conservative:

* HTTPS, an allow-listed hostname, no credentials, query strings or redirects;
* bounded streaming reads and atomic cache replacement;
* size, SHA-256 and format validation before a cache entry becomes usable;
* every cache reuse re-checks the bytes rather than trusting its sidecar.

It is test infrastructure, not a product-data acquisition feature.  Runtime
state calculations keep their existing local-only data boundaries.
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import json
import logging
import os
import re
import tempfile
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Protocol, Self
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

LOGGER = logging.getLogger(__name__)

_CACHE_SCHEMA_VERSION = 1
_FILENAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_CONTENT_KINDS = {"sp3-gzip", "erp-gzip", "iers-c01"}
_DEFAULT_TIMEOUT_SECONDS = 45.0
_DEFAULT_CHUNK_BYTES = 64 * 1024
_DEFAULT_CACHE_DIRECTORY = Path(__file__).resolve().parents[3] / "data" / "test-real-data"
_DEFAULT_LOCAL_SP3_DIRECTORY = Path(__file__).resolve().parents[4] / "SP3"


class RealDataError(RuntimeError):
    """Base error for a real-data test preflight failure."""


class RealDataUnavailable(RealDataError):
    """Raised when data are unavailable and network retrieval is disabled."""


class RealDataDownloadError(RealDataError):
    """Raised when a remote response violates the download boundary."""


class RealDataValidationError(RealDataError):
    """Raised when bytes fail integrity, size, or scientific-format checks."""


class _Response(Protocol):
    """Small structural type used by the downloader and fake unit responses."""

    headers: Any

    def read(self, amount: int = -1) -> bytes: ...

    def geturl(self) -> str: ...

    def getcode(self) -> int | None: ...

    def __enter__(self) -> Self: ...

    def __exit__(self, *args: object) -> object: ...


class _Opener(Protocol):
    def open(self, request: Request, timeout: float) -> _Response: ...


class _RejectRedirects(HTTPRedirectHandler):
    """Reject redirects rather than silently changing scientific provenance."""

    def redirect_request(self, _req, _fp, _code, _msg, _headers, _newurl):  # type: ignore[no-untyped-def]
        raise RealDataDownloadError("La descarga de datos reales no admite redirecciones")


@dataclass(frozen=True, slots=True)
class DatasetSpec:
    """One deliberately small, auditable real-data product specification."""

    identifier: str
    filename: str
    url: str
    allowed_host: str
    content_kind: Literal["sp3-gzip", "erp-gzip", "iers-c01"]
    min_bytes: int
    max_bytes: int
    max_expanded_bytes: int
    expected_sha256: str | None = None

    def __post_init__(self) -> None:
        identifier = str(self.identifier or "").strip()
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,80}", identifier):
            raise ValueError("El identificador del dataset de prueba no es seguro")
        filename = str(self.filename or "").strip()
        if not _FILENAME_PATTERN.fullmatch(filename):
            raise ValueError("El nombre del dataset de prueba no es seguro")
        if self.content_kind not in _CONTENT_KINDS:
            raise ValueError("El tipo de contenido del dataset de prueba no es válido")
        parsed = urlparse(str(self.url))
        allowed_host = str(self.allowed_host or "").strip().lower()
        if (
            parsed.scheme != "https"
            or parsed.hostname != allowed_host
            or parsed.port not in (None, 443)
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or not parsed.path.startswith("/")
        ):
            raise ValueError("La URL del dataset debe ser HTTPS, sin redirección ni parámetros, y usar su host permitido")
        if self.min_bytes < 1 or self.max_bytes < self.min_bytes:
            raise ValueError("Los límites comprimidos del dataset no son válidos")
        if self.max_expanded_bytes < self.min_bytes:
            raise ValueError("El límite expandido del dataset no es válido")
        digest = self.expected_sha256
        if digest is not None:
            digest = str(digest).lower().removeprefix("sha256:")
            if not _SHA256_PATTERN.fullmatch(digest):
                raise ValueError("El SHA-256 esperado del dataset no es válido")
            object.__setattr__(self, "expected_sha256", digest)
        object.__setattr__(self, "identifier", identifier)
        object.__setattr__(self, "filename", filename)
        object.__setattr__(self, "allowed_host", allowed_host)

    @property
    def cache_metadata_filename(self) -> str:
        return f"{self.filename}.metadata.json"


@dataclass(frozen=True, slots=True)
class ValidatedDataset:
    """Portable, post-validation facts about a local data file."""

    spec: DatasetSpec
    path: Path
    sha256: str
    byte_size: int
    content_length: int | None = None
    content_length_matches: bool | None = None
    origin: Literal["cache", "download", "local"] = "cache"

    def payload(self) -> dict[str, object]:
        return {
            "id": self.spec.identifier,
            "path": str(self.path),
            "filename": self.spec.filename,
            "sha256": self.sha256,
            "bytes": self.byte_size,
            "expectedSha256": self.spec.expected_sha256,
            "contentLength": self.content_length,
            "contentLengthMatches": self.content_length_matches,
            "origin": self.origin,
            "format": self.spec.content_kind,
        }


# The immutable bundle mirrors the fixed CODE MGEX files commonly present in
# the repository-level ``../SP3`` directory.  The hashes are the source bytes
# (the .gz transport files), so a network run cannot silently substitute a
# current product under the same filename.
CODE_MGEX_SP3 = DatasetSpec(
    identifier="code-mgex-sp3-2025-131",
    filename="COD0MGXFIN_20251310000_01D_05M_ORB.SP3.gz",
    url="https://ftp.aiub.unibe.ch/CODE_MGEX/CODE/2025/COD0MGXFIN_20251310000_01D_05M_ORB.SP3.gz",
    allowed_host="ftp.aiub.unibe.ch",
    content_kind="sp3-gzip",
    min_bytes=100_000,
    max_bytes=16 * 1024 * 1024,
    max_expanded_bytes=128 * 1024 * 1024,
    expected_sha256="40eee51e4afbf4b2101f92cb3e3bf201a8bb95ae4e2b291529675ddd52083ba1",
)
CODE_MGEX_ERP = DatasetSpec(
    identifier="code-mgex-erp-2025-131",
    filename="COD0MGXFIN_20251310000_01D_12H_ERP.ERP.gz",
    url="https://ftp.aiub.unibe.ch/CODE_MGEX/CODE/2025/COD0MGXFIN_20251310000_01D_12H_ERP.ERP.gz",
    allowed_host="ftp.aiub.unibe.ch",
    content_kind="erp-gzip",
    min_bytes=128,
    max_bytes=2 * 1024 * 1024,
    max_expanded_bytes=8 * 1024 * 1024,
    expected_sha256="1436fc62736fc11fa058f3726175cc28af98d76ff544fab59c43e8d7005a04ab",
)
# This file is intentionally unpinned because the documented ``latestVersion``
# endpoint is mutable.  Its SHA-256 is still recorded and re-verified on cache
# reuse, while the parser validates the product's scientific content.
IERS_C01 = DatasetSpec(
    identifier="iers-c01-current",
    filename="EOP_C01_IAU2000_1846-now.txt",
    url="https://datacenter.iers.org/data/latestVersion/EOP_C01_IAU2000_1846-now.txt",
    allowed_host="datacenter.iers.org",
    content_kind="iers-c01",
    min_bytes=4 * 1024,
    max_bytes=16 * 1024 * 1024,
    max_expanded_bytes=16 * 1024 * 1024,
)
PRECISE_PRODUCT_SPECS = (CODE_MGEX_SP3, CODE_MGEX_ERP)

# Keep these limits machine-readable so optional integration work cannot be
# mistaken for validation of a force model that Orbit does not currently
# implement.  The harness tests only the capabilities marked available.
REAL_DATA_CAPABILITIES: dict[str, dict[str, object]] = {
    "code_mgex_sp3_erp": {
        "available": True,
        "scope": "strict SP3/ERP ingestion, provenance and native interpolation",
    },
    "egm2008_2190x2190": {
        "available": False,
        "reason": "El evaluador RK4 puro actual limita el geopotencial a 2.555 términos (aprox. 70×70 denso).",
    },
    "msise_nrlmsise": {
        "available": False,
        "reason": "Orbit sólo implementa la atmósfera exponencial de ingeniería; MSISE/NRLMSISE aún no están integrados.",
    },
    "de430_spice": {
        "available": False,
        "reason": "No existe un lector SPICE/DE430; la efeméride solar/lunar actual usa ERFA local.",
    },
    "stk_gmat_24h_reference": {
        "available": False,
        "reason": "No hay una referencia STK/GMAT versionada en el repositorio para afirmar un umbral de 10 m.",
    },
}


def default_cache_directory() -> Path:
    """Return the ignored cache used by the explicit real-data commands."""

    configured = os.environ.get("ORBIT_REAL_DATA_CACHE", "").strip()
    return Path(configured).expanduser() if configured else _DEFAULT_CACHE_DIRECTORY


def default_local_sp3_directory() -> Path:
    """Return a user override or the repository-adjacent developer bundle."""

    configured = os.environ.get("ORBIT_REAL_DATA_DIR", "").strip()
    return Path(configured).expanduser() if configured else _DEFAULT_LOCAL_SP3_DIRECTORY


def is_real_data_enabled() -> bool:
    """Whether a caller explicitly opted into real data integration tests."""

    return os.environ.get("ORBIT_RUN_REAL_DATA") == "1"


def is_real_data_download_enabled() -> bool:
    """Whether a caller explicitly allowed a test preflight network fetch."""

    return os.environ.get("ORBIT_DOWNLOAD_REAL_DATA") == "1"


def is_real_data_performance_enabled() -> bool:
    """Whether expensive timing probes were explicitly requested."""

    return os.environ.get("ORBIT_RUN_REAL_DATA_PERFORMANCE") == "1"


class RealDataCache:
    """Validate/reuse or explicitly fetch immutable test data.

    The class is purposely free of background refreshes.  A test either uses
    a validated local source, a validated cache, or a caller explicitly asks
    for a bounded download.  This prevents an ordinary ``pytest`` invocation
    or CI run from touching the network.
    """

    def __init__(
        self,
        cache_directory: str | Path | None = None,
        *,
        timeout_seconds: float = _DEFAULT_TIMEOUT_SECONDS,
        opener: _Opener | None = None,
        now: Callable[[], dt.datetime] | None = None,
    ) -> None:
        try:
            timeout = float(timeout_seconds)
        except (TypeError, ValueError) as exc:
            raise ValueError("El timeout de datos reales debe ser numérico") from exc
        if not 0.1 <= timeout <= 120.0:
            raise ValueError("El timeout de datos reales debe estar entre 0.1 y 120 s")
        self.cache_directory = Path(cache_directory or default_cache_directory()).expanduser()
        self.timeout_seconds = timeout
        self._opener = opener or build_opener(_RejectRedirects())
        self._now = now or (lambda: dt.datetime.now(tz=dt.UTC))

    def cache_path(self, spec: DatasetSpec) -> Path:
        return self.cache_directory / spec.filename

    def metadata_path(self, spec: DatasetSpec) -> Path:
        return self.cache_directory / spec.cache_metadata_filename

    def validate_cached(self, spec: DatasetSpec) -> ValidatedDataset | None:
        """Return a freshly validated cached file, never merely a sidecar hit."""

        path = self.cache_path(spec)
        metadata_path = self.metadata_path(spec)
        if not path.is_file() or not metadata_path.is_file():
            return None
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            if not isinstance(metadata, dict) or metadata.get("schemaVersion") != _CACHE_SCHEMA_VERSION:
                raise RealDataValidationError("Los metadatos de caché tienen un formato no reconocido")
            if metadata.get("id") != spec.identifier or metadata.get("url") != spec.url:
                raise RealDataValidationError("Los metadatos de caché no pertenecen al dataset solicitado")
            validated = validate_dataset_file(spec, path, origin="cache")
            if metadata.get("sha256") != validated.sha256 or metadata.get("bytes") != validated.byte_size:
                raise RealDataValidationError("Los metadatos no coinciden con los bytes en caché")
            return validated
        except (OSError, TypeError, ValueError, json.JSONDecodeError, RealDataValidationError) as exc:
            LOGGER.warning("La caché de prueba %s no es utilizable: %s", spec.identifier, _safe_message(exc))
            return None

    def ensure(self, spec: DatasetSpec, *, download: bool = False) -> ValidatedDataset:
        """Return data from cache or explicitly download and validate it."""

        cached = self.validate_cached(spec)
        if cached is not None:
            return cached
        if not download:
            raise RealDataUnavailable(
                f"No hay una copia válida de {spec.filename}. Ejecute "
                ".\\.scripts\\test-real-data.ps1 -Download o establezca ORBIT_DOWNLOAD_REAL_DATA=1."
            )
        return self._download(spec)

    def ensure_many(self, specs: Iterable[DatasetSpec], *, download: bool = False) -> dict[str, ValidatedDataset]:
        """Resolve every requested product, failing before tests see partial data."""

        return {spec.identifier: self.ensure(spec, download=download) for spec in specs}

    def _download(self, spec: DatasetSpec) -> ValidatedDataset:
        self.cache_directory.mkdir(parents=True, exist_ok=True)
        destination = self.cache_path(spec)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{spec.filename}.", suffix=".partial", dir=self.cache_directory
        )
        temporary = Path(temporary_name)
        content_length: int | None = None
        try:
            request = Request(
                spec.url,
                headers={
                    "Accept": "application/octet-stream, text/plain;q=0.9, */*;q=0.1",
                    "User-Agent": "Orbit-Tracker-Real-Data-Tests/1",
                },
                method="GET",
            )
            with self._opener.open(request, timeout=self.timeout_seconds) as response:
                status = int(getattr(response, "status", response.getcode() or 0))
                if status != 200:
                    raise RealDataDownloadError(f"{spec.identifier}: el servidor respondió HTTP {status}")
                final_url = response.geturl()
                if final_url != spec.url:
                    raise RealDataDownloadError(f"{spec.identifier}: la respuesta cambió de URL")
                content_length = _parse_content_length(response.headers.get("Content-Length"), spec)
                total = 0
                with os.fdopen(descriptor, "wb") as handle:
                    while True:
                        chunk = response.read(_DEFAULT_CHUNK_BYTES)
                        if not chunk:
                            break
                        if not isinstance(chunk, bytes):
                            raise RealDataDownloadError(f"{spec.identifier}: la respuesta no devolvió bytes")
                        total += len(chunk)
                        if total > spec.max_bytes:
                            raise RealDataDownloadError(
                                f"{spec.identifier}: la descarga supera su límite de {spec.max_bytes} bytes"
                            )
                        handle.write(chunk)
                    handle.flush()
                    os.fsync(handle.fileno())
            validated = validate_dataset_file(
                spec,
                temporary,
                origin="download",
                content_length=content_length,
            )
            if content_length is not None and content_length != validated.byte_size:
                # A supplied digest plus complete scientific-format validation
                # is a stronger integrity condition than a broken progress
                # header. Preserve the discrepancy in metadata/logs rather
                # than accepting a truncated or wrongly hashed file.
                LOGGER.warning(
                    "%s declaró Content-Length=%s pero se recibieron %s bytes; SHA-256 y contenido válidos",
                    spec.identifier,
                    content_length,
                    validated.byte_size,
                )
            os.replace(temporary, destination)
            validated = ValidatedDataset(
                spec=spec,
                path=destination,
                sha256=validated.sha256,
                byte_size=validated.byte_size,
                content_length=content_length,
                content_length_matches=(content_length == validated.byte_size) if content_length is not None else None,
                origin="download",
            )
            self._write_metadata(validated)
            return validated
        except OSError as exc:
            raise RealDataDownloadError(f"No se pudo descargar {spec.identifier}: {_safe_message(exc)}") from exc
        finally:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass

    def _write_metadata(self, dataset: ValidatedDataset) -> None:
        self.cache_directory.mkdir(parents=True, exist_ok=True)
        target = self.metadata_path(dataset.spec)
        content = {
            "schemaVersion": _CACHE_SCHEMA_VERSION,
            "id": dataset.spec.identifier,
            "filename": dataset.spec.filename,
            "url": dataset.spec.url,
            "sha256": dataset.sha256,
            "bytes": dataset.byte_size,
            "expectedSha256": dataset.spec.expected_sha256,
            "contentLength": dataset.content_length,
            "contentLengthMatches": dataset.content_length_matches,
            "downloadedAt": self._now().astimezone(dt.UTC).isoformat(),
        }
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{target.name}.", suffix=".partial", dir=self.cache_directory
        )
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
                json.dump(content, handle, ensure_ascii=False, sort_keys=True, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, target)
        finally:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass


def validate_dataset_file(
    spec: DatasetSpec,
    path: str | Path,
    *,
    origin: Literal["cache", "download", "local"] = "local",
    content_length: int | None = None,
) -> ValidatedDataset:
    """Check physical bytes and declared scientific format before test use."""

    candidate = Path(path)
    try:
        byte_size = candidate.stat().st_size
    except OSError as exc:
        raise RealDataValidationError(f"No se puede leer {spec.filename}: {_safe_message(exc)}") from exc
    if not spec.min_bytes <= byte_size <= spec.max_bytes:
        raise RealDataValidationError(
            f"{spec.filename}: tamaño {byte_size} fuera de [{spec.min_bytes}, {spec.max_bytes}] bytes"
        )
    try:
        digest = _sha256(candidate)
    except OSError as exc:
        raise RealDataValidationError(f"No se puede calcular SHA-256 de {spec.filename}") from exc
    if spec.expected_sha256 is not None and digest != spec.expected_sha256:
        raise RealDataValidationError(
            f"{spec.filename}: SHA-256 inesperado ({digest}); se esperaba {spec.expected_sha256}"
        )
    _validate_content(spec, candidate)
    return ValidatedDataset(
        spec=spec,
        path=candidate,
        sha256=digest,
        byte_size=byte_size,
        content_length=content_length,
        content_length_matches=(content_length == byte_size) if content_length is not None else None,
        origin=origin,
    )


def resolve_precise_product_bundle(
    *,
    cache: RealDataCache | None = None,
    local_directory: str | Path | None = None,
    download: bool = False,
) -> dict[str, ValidatedDataset]:
    """Choose validated local CODE files first, then cache/explicit download.

    This makes an existing ``../SP3`` bundle useful without making it a test
    prerequisite.  When it is absent, ``download=True`` obtains the exact
    SHA-pinned pair into the ignored cache; otherwise callers receive a clear
    opt-in instruction.  Partial local bundles are not mixed with cache files.
    """

    source_directory = Path(local_directory or default_local_sp3_directory()).expanduser()
    local_candidates = {
        spec.identifier: source_directory / spec.filename
        for spec in PRECISE_PRODUCT_SPECS
    }
    if all(path.is_file() for path in local_candidates.values()):
        return {
            spec.identifier: validate_dataset_file(spec, local_candidates[spec.identifier], origin="local")
            for spec in PRECISE_PRODUCT_SPECS
        }
    active_cache = cache or RealDataCache()
    return active_cache.ensure_many(PRECISE_PRODUCT_SPECS, download=download)


def _parse_content_length(value: object, spec: DatasetSpec) -> int | None:
    if value is None:
        return None
    try:
        length = int(str(value))
    except (TypeError, ValueError) as exc:
        raise RealDataDownloadError(f"{spec.identifier}: Content-Length inválido") from exc
    if length < 0 or length > spec.max_bytes:
        raise RealDataDownloadError(f"{spec.identifier}: Content-Length fuera de límite")
    return length


def _sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(_DEFAULT_CHUNK_BYTES):
            hasher.update(block)
    return hasher.hexdigest()


def _read_gzip_bounded(path: Path, *, maximum_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    try:
        with gzip.open(path, "rb") as handle:
            while chunk := handle.read(_DEFAULT_CHUNK_BYTES):
                total += len(chunk)
                if total > maximum_bytes:
                    raise RealDataValidationError(
                        f"{path.name}: el contenido expandido supera {maximum_bytes} bytes"
                    )
                chunks.append(chunk)
    except (OSError, EOFError, gzip.BadGzipFile) as exc:
        raise RealDataValidationError(f"{path.name}: gzip inválido o truncado") from exc
    if not chunks:
        raise RealDataValidationError(f"{path.name}: gzip vacío")
    return b"".join(chunks)


def _validate_content(spec: DatasetSpec, path: Path) -> None:
    if spec.content_kind == "sp3-gzip":
        raw = _read_gzip_bounded(path, maximum_bytes=spec.max_expanded_bytes)
        try:
            text = raw.decode("ascii")
        except UnicodeDecodeError as exc:
            raise RealDataValidationError(f"{path.name}: SP3 no es texto ASCII") from exc
        lines = text.splitlines()
        if (
            len(lines) < 8
            or not lines[0].startswith("#")
            or not any(line.startswith("*") for line in lines)
            or not any(line.startswith("P") for line in lines)
        ):
            raise RealDataValidationError(f"{path.name}: el contenido no tiene la estructura SP3 mínima")
        return
    if spec.content_kind == "erp-gzip":
        raw = _read_gzip_bounded(path, maximum_bytes=spec.max_expanded_bytes)
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise RealDataValidationError(f"{path.name}: ERP no es UTF-8") from exc
        from orbit_api.timekeeping import IgsErpEarthOrientationProvider

        provider = IgsErpEarthOrientationProvider.from_text(text, filename=path.name)
        if len(provider.samples) < 2:
            raise RealDataValidationError(f"{path.name}: ERP no contiene dos muestras para interpolar")
        return
    if spec.content_kind == "iers-c01":
        raw = path.read_bytes()
        from orbit_api.timekeeping.iers_eop import IersC01EarthOrientationProvider

        provider = IersC01EarthOrientationProvider.from_bytes(raw, filename=path.name)
        if len(provider.samples) < 2:
            raise RealDataValidationError(f"{path.name}: IERS C01 no contiene dos muestras para interpolar")
        return
    raise AssertionError(f"Tipo de contenido no gestionado: {spec.content_kind}")


def _safe_message(exc: BaseException) -> str:
    message = " ".join(str(exc).split())
    return message[:500] if message else type(exc).__name__


def _cli_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Prepara un caché validado de datos reales para tests opcionales de Orbit."
    )
    parser.add_argument(
        "--download",
        action="store_true",
        help="Permite descargar los productos ausentes. Sin esta opción nunca se abre la red.",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        help="Directorio de caché (por defecto data/test-real-data o ORBIT_REAL_DATA_CACHE).",
    )
    parser.add_argument(
        "--local-dir",
        type=Path,
        help="Directorio SP3 local preferido (por defecto ../SP3 o ORBIT_REAL_DATA_DIR).",
    )
    parser.add_argument(
        "--include-iers",
        action="store_true",
        help="Añade la instantánea mutable IERS C01, validada por formato y registrada con SHA-256 local.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI used by the PowerShell wrapper; print only validated facts."""

    arguments = _cli_parser().parse_args(argv)
    cache = RealDataCache(arguments.cache_dir)
    try:
        datasets = resolve_precise_product_bundle(
            cache=cache,
            local_directory=arguments.local_dir,
            download=arguments.download,
        )
        if arguments.include_iers:
            datasets[IERS_C01.identifier] = cache.ensure(IERS_C01, download=arguments.download)
    except RealDataError as exc:
        print(f"ERROR: {_safe_message(exc)}")
        return 2
    print(json.dumps({key: item.payload() for key, item in datasets.items()}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised through the PowerShell command.
    raise SystemExit(main())
