"""Durable ingestion of precise GNSS orbit and clock products.

The module accepts local files only.  Product portals such as NASA CDDIS,
IGS/MGEX and ESA NSO have different authentication, latency and filename
policies; Orbit therefore records their provenance after an operator has
downloaded the authoritative product instead of embedding credentials or
performing an unaudited network fetch during a state calculation.

An imported product is intentionally not reduced to a TLE.  Its native SP3
frame/time declaration, optional RINEX CLK records, source checksums and
provider classification remain attached to the runtime state provider.
"""

from __future__ import annotations

import base64
import binascii
import datetime
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import tempfile
import zipfile
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

from orbit_api.formats import (
    EphemerisFormatError,
    RinexClockProduct,
    Sp3StateProvider,
    TabularStateProvider,
    parse_rinex_clock_product,
    parse_sp3_state_provider,
)
from orbit_api.frames import FrameTransformService
from orbit_api.timekeeping import TimeScale, to_utc

MAX_PRECISE_PRODUCT_FILES = 8
MAX_PRECISE_PRODUCT_UPLOAD_BYTES = 64 * 1024 * 1024
MAX_PRECISE_PRODUCT_FILE_BYTES = 32 * 1024 * 1024
MAX_PRECISE_PRODUCT_EXPANDED_BYTES = 256 * 1024 * 1024
MAX_PRECISE_PRODUCT_ZIP_MEMBERS = 16
_PRODUCT_ID_PATTERN = re.compile(r"^precise-[0-9a-f]{20}$")

_PROVIDER_ALIASES = {
    "": "auto",
    "auto": "auto",
    "cddis-igs": "cddis_igs",
    "cddis_igs": "cddis_igs",
    "cddis": "cddis_igs",
    "nasa-cddis": "cddis_igs",
    "nasa_cddis": "cddis_igs",
    "igs": "cddis_igs",
    "igs-mgex": "igs_mgex",
    "igs_mgex": "igs_mgex",
    "mgex": "igs_mgex",
    "esa-nso": "esa_nso",
    "esa_nso": "esa_nso",
    "esa": "esa_nso",
    "custom": "custom",
}
_PRODUCT_CLASS_ALIASES = {
    "": "auto",
    "auto": "auto",
    "final": "final",
    "rapid": "rapid",
    "ultra": "ultra_rapid",
    "ultra-rapid": "ultra_rapid",
    "ultra_rapid": "ultra_rapid",
    "ultrarapid": "ultra_rapid",
    "unknown": "unknown",
}
_PROVIDER_LABELS = {
    "cddis_igs": "NASA CDDIS / IGS",
    "igs_mgex": "IGS MGEX",
    "esa_nso": "ESA Navigation Support Office",
    "custom": "Custom local product",
}
_PRODUCT_FAMILIES = {
    "cddis_igs": "igs",
    "igs_mgex": "mgex",
    "esa_nso": "esa_ops",
    "custom": "custom",
}


class PreciseProductImportError(ValueError):
    """Raised for a recoverable precise-product ingestion error."""


@dataclass(frozen=True, slots=True)
class DecodedProductFile:
    """One validated, uncompressed logical file supplied by an operator."""

    name: str
    data: bytes = field(repr=False, compare=False)
    uploaded_name: str
    uploaded_sha256: str
    compression: str
    archive_member: str | None = None

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.data).hexdigest()

    @property
    def byte_count(self) -> int:
        return len(self.data)


@dataclass(frozen=True, slots=True)
class ProductSourceFile:
    """Persisted provenance for one SP3/CLK logical source."""

    name: str
    kind: str
    sha256: str
    uploaded_name: str
    uploaded_sha256: str
    compression: str
    archive_member: str | None
    byte_count: int
    storage_name: str

    def payload(self) -> dict[str, object]:
        return {
            "name": self.name,
            "kind": self.kind,
            "sha256": self.sha256,
            "uploaded_name": self.uploaded_name,
            "uploaded_sha256": self.uploaded_sha256,
            "compression": self.compression,
            "archive_member": self.archive_member,
            "byte_count": self.byte_count,
        }


@dataclass(frozen=True, slots=True)
class PreciseProduct:
    """An SP3 orbit product, its optional CLK companion and provenance."""

    product_id: str
    name: str
    provider_id: str
    product_class: str
    product_family: str
    detected_provider_id: str | None
    detected_product_class: str
    detected_product_family: str
    sp3: Sp3StateProvider
    clock: RinexClockProduct | None
    source_files: tuple[ProductSourceFile, ...]
    decoded_files: tuple[DecodedProductFile, ...] = field(repr=False, compare=False)

    def __post_init__(self) -> None:
        if not _PRODUCT_ID_PATTERN.fullmatch(self.product_id):
            raise PreciseProductImportError("El identificador del producto preciso no es válido")
        if self.provider_id not in _PROVIDER_LABELS:
            raise PreciseProductImportError("El proveedor del producto preciso no es válido")
        if self.product_class not in {"final", "rapid", "ultra_rapid", "unknown"}:
            raise PreciseProductImportError("La clase del producto preciso no es válida")
        if self.product_family not in {"igs", "mgex", "esa_ops", "custom"}:
            raise PreciseProductImportError("La familia del producto preciso no es válida")
        if self.detected_product_family not in {"igs", "mgex", "esa_ops", "custom", "unknown"}:
            raise PreciseProductImportError("La familia detectada del producto preciso no es válida")
        if not self.source_files or not self.decoded_files:
            raise PreciseProductImportError("El producto preciso no contiene ficheros de origen")

    @property
    def satellite_ids(self) -> tuple[str, ...]:
        return self.sp3.satellite_ids

    @property
    def orbit_file(self) -> ProductSourceFile:
        return next(source for source in self.source_files if source.kind == "sp3")

    @property
    def clock_file(self) -> ProductSourceFile | None:
        return next((source for source in self.source_files if source.kind == "clk"), None)

    def runtime_id(self, satellite_id: str) -> str:
        identifier = _satellite_id(satellite_id)
        return f"precise:{self.product_id}:{identifier}"

    def provider_for_satellite(self, satellite_id: str) -> TabularStateProvider:
        return self.sp3.for_satellite(satellite_id)

    def coverage_utc(self, satellite_id: str | None = None) -> tuple[datetime.datetime | None, datetime.datetime | None]:
        providers: Iterable[TabularStateProvider]
        if satellite_id is None:
            providers = self.sp3.satellites.values()
        else:
            providers = (self.provider_for_satellite(satellite_id),)
        values: list[datetime.datetime] = []
        for provider in providers:
            for sample in provider.samples:
                try:
                    values.append(to_utc(sample.epoch, sample.time_scale))
                except ValueError as exc:
                    raise PreciseProductImportError(
                        "No se puede convertir la cobertura temporal SP3 a UTC"
                    ) from exc
        return min(values, default=None), max(values, default=None)

    def clock_summary(self, satellite_id: str | None = None) -> dict[str, object]:
        embedded_samples = (
            self.sp3.clock_samples.get(_satellite_id(satellite_id), ())
            if satellite_id is not None
            else tuple(sample for samples in self.sp3.clock_samples.values() for sample in samples)
        )
        rinex_samples = (
            self.clock.samples_for_satellite(satellite_id)
            if self.clock is not None and satellite_id is not None
            else tuple(
                sample
                for samples in (self.clock.satellites.values() if self.clock is not None else ())
                for sample in samples
            )
        )
        return {
            "present": bool(embedded_samples or rinex_samples),
            "sp3_embedded": {
                "present": bool(embedded_samples),
                "sample_count": len(embedded_samples),
                "units": {"bias": "s", "rate": "s/s"},
                "coverage": _clock_coverage(
                    embedded_samples,
                    self.sp3.metadata.time_scale,
                ),
            },
            "rinex_clk": {
                "present": bool(rinex_samples),
                "file_present": self.clock is not None,
                "sample_count": len(rinex_samples),
                "satellite_count": len(self.clock.satellite_ids) if self.clock is not None else 0,
                "satellite_ids": list(self.clock.satellite_ids) if self.clock is not None else [],
                "time_scale": self.clock.metadata.time_scale_label if self.clock is not None else None,
                "file": self.clock_file.name if self.clock_file is not None else None,
                "coverage": _clock_coverage(
                    rinex_samples,
                    self.clock.metadata.time_scale if self.clock is not None else TimeScale.UNKNOWN,
                ),
            },
        }

    def rendering_summary(self) -> dict[str, object]:
        """Describe whether Orbit can presently produce an Earth-fixed view.

        Import always preserves the native SP3 realization.  A state declared
        as IGS14, or an IGS20-family product without its explicit policy, may
        not be silently painted as ITRF: the operator must register an
        explicit datum operation.  The opt-in IGS20-family policy is
        available for the published IGS20/IGb20/IGc20 relationships.
        """

        reference = self.sp3.metadata.reference_frame
        transformer = self.sp3.frame_transformer
        target_realization = (
            transformer.default_terrestrial_realization if transformer is not None else None
        )
        source_realization = reference.realization or reference.label
        available = False
        reason: str | None = None
        if reference.family == "ITRF" and (
            target_realization is None or source_realization == target_realization
        ):
            available = True
        elif transformer is not None and target_realization is not None:
            available = transformer.has_terrestrial_realization_transform(
                source_realization,
                target_realization,
            )
        if not available:
            if reference.family == "IGS":
                reason = (
                    f"{reference.label} requiere una transformación de realización terrestre "
                    "registrada para mostrar/AOS-LOS en ITRF. Para IGS20, IGb20 e IGc20, "
                    "configura ORBIT_TERRESTRIAL_REALIZATION=ITRF2020 y "
                    "ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT=true; IGS14 requiere "
                    "su propia operación publicada."
                )
            else:
                reason = (
                    f"El frame de origen {reference.label} no tiene una ruta ITRF activa. "
                    "Importa o registra una transformación de realización explícita."
                )
        if not available:
            status = "unavailable"
            display_label = reference.label
        elif reference.family == "ITRF":
            # A declared ITRF/ITRF20xx SP3 state is already terrestrial. No
            # EOP/ERP rotation or datum operation is implied by a renderer
            # requesting an Earth-fixed coordinate array.
            status = "native"
            display_label = reference.label
        else:
            status = "terrestrial_realization_transform"
            display_label = target_realization or "ITRF"
        terrestrial_source = reference.family in {"ITRF", "IGS", "ITRS", "WGS84", "PZ90"}
        return {
            "available": available,
            "target_frame": "ITRF",
            "target_realization": target_realization,
            "source_frame": reference.label,
            # Additive native/render split. Existing clients may continue to
            # read ``source_frame``; new clients must not infer ITRF from the
            # renderer target when no realization operation is registered.
            "native_reference_frame": reference.label,
            "native_frame": {
                "name": reference.family,
                "realization": reference.realization,
                "center": "EARTH",
                "time_scale": self.sp3.metadata.time_scale.value,
            },
            "status": status,
            "display_label": display_label,
            "earth_orientation": {
                # Typical SP3 coordinates are already terrestrial. Neither a
                # native ITRF state nor an explicit IGS->ITRF datum operation
                # uses EOP/ERP, so do not advertise a nonexistent solution.
                "required": not terrestrial_source,
                "applied": False,
                "source": None,
                "version": None,
                "quality": None,
                "snapshot_id": None,
            },
            "terrestrial_realization_operation": None,
            "reason": reason,
        }

    def satellite_payload(self, satellite_id: str) -> dict[str, object]:
        identifier = _satellite_id(satellite_id)
        provider = self.provider_for_satellite(identifier)
        start, end = self.coverage_utc(identifier)
        clock = self.clock_summary(identifier)
        rendering = self.rendering_summary()
        return {
            "id": self.runtime_id(identifier),
            "name": f"{identifier} · {self.name}",
            "display_name": identifier,
            "sourceFormat": "SP3",
            "source_format": "SP3",
            "satellite_id": identifier,
            "native_reference_frame": self.sp3.metadata.reference_frame.label,
            "native_frame": rendering["native_frame"],
            "renderer_reference": rendering,
            "norad": None,
            "product_id": self.product_id,
            "catalogMeta": {
                "sourceFormat": "SP3",
                "provider_id": self.provider_id,
                "product_class": self.product_class,
                "product_family": self.product_family,
                "detected_product_family": self.detected_product_family,
            },
            "sp3": {
                "version": self.sp3.metadata.version,
                "record_type": self.sp3.metadata.record_type,
                "reference_frame": self.sp3.metadata.reference_frame.label,
                "time_scale": self.sp3.metadata.time_scale_label,
                "agency": self.sp3.metadata.agency,
                "orbit_type": self.sp3.metadata.orbit_type,
                "sample_count": len(provider.samples),
                "start_time": _iso_or_none(start),
                "end_time": _iso_or_none(end),
                "clock": clock,
                "rendering": rendering,
            },
        }

    def payload(self) -> dict[str, object]:
        start, end = self.coverage_utc()
        rendering = self.rendering_summary()
        return {
            "id": self.product_id,
            "name": self.name,
            "provider_id": self.provider_id,
            # ``provider`` is kept for concise UI clients.  The canonical ID
            # above remains stable for saved projects and filtering.
            "provider": self.provider_id,
            "provider_label": _PROVIDER_LABELS[self.provider_id],
            "product_class": self.product_class,
            "product_family": self.product_family,
            "detected": {
                "provider_id": self.detected_provider_id,
                "product_class": self.detected_product_class,
                "product_family": self.detected_product_family,
            },
            "orbit_file": self.orbit_file.name,
            "clock_file": self.clock_file.name if self.clock_file is not None else None,
            "source_files": [source.payload() for source in self.source_files],
            "checksums": {source.name: source.sha256 for source in self.source_files},
            "frame": self.sp3.metadata.reference_frame.label,
            "native_reference_frame": self.sp3.metadata.reference_frame.label,
            "native_frame": rendering["native_frame"],
            "time_scale": self.sp3.metadata.time_scale_label,
            "time_system": self.sp3.metadata.time_scale_label,
            "start_time": _iso_or_none(start),
            "end_time": _iso_or_none(end),
            "start_time_ms": _epoch_millis(start),
            "end_time_ms": _epoch_millis(end),
            "clock": self.clock_summary(),
            "renderer_reference": rendering,
            "rendering": rendering,
            "satellite_count": len(self.satellite_ids),
            "satellite_ids": list(self.satellite_ids),
            "persistence": {"scope": "config-volume", "reloadable": True},
        }


def normalize_provider_hint(value: object) -> str:
    """Normalize public provider spellings without inventing provenance."""

    compact = str(value or "").strip().lower().replace(" ", "-")
    canonical = _PROVIDER_ALIASES.get(compact)
    if canonical is None:
        available = "auto, cddis-igs, igs-mgex, esa-nso, custom"
        raise PreciseProductImportError(f"Proveedor de producto preciso no admitido: {value!s}. Usa {available}.")
    return canonical


def normalize_product_class(value: object) -> str:
    """Normalize public Final/Rapid/Ultra-Rapid labels."""

    compact = str(value or "").strip().lower().replace(" ", "-")
    canonical = _PRODUCT_CLASS_ALIASES.get(compact)
    if canonical is None:
        available = "auto, final, rapid, ultra-rapid"
        raise PreciseProductImportError(f"Clase de producto preciso no admitida: {value!s}. Usa {available}.")
    return canonical


def import_precise_product(
    files: Sequence[tuple[str, str]],
    *,
    provider_hint: object = "auto",
    product_class: object = "auto",
    frame_transformer: FrameTransformService | None = None,
) -> PreciseProduct:
    """Decode, validate and parse one local SP3 product plus optional CLK."""

    decoded_files = decode_precise_product_upload(files)
    return build_precise_product(
        decoded_files,
        provider_hint=provider_hint,
        product_class=product_class,
        frame_transformer=frame_transformer,
    )


def build_precise_product(
    files: Sequence[DecodedProductFile],
    *,
    provider_hint: object = "auto",
    product_class: object = "auto",
    frame_transformer: FrameTransformService | None = None,
    product_id: str | None = None,
    product_name: str | None = None,
    detected_provider_id: str | None = None,
    detected_product_class: str | None = None,
    detected_product_family: str | None = None,
    source_files: Sequence[ProductSourceFile] | None = None,
) -> PreciseProduct:
    """Build a precise product from already safe, logical source files.

    This is also the repository reload boundary.  It performs exactly the
    same format parsing as a new upload, ensuring a persisted manifest cannot
    resurrect a different runtime interpretation after a restart.
    """

    if not files:
        raise PreciseProductImportError("Debes seleccionar al menos un fichero SP3")
    if len(files) > MAX_PRECISE_PRODUCT_FILES:
        raise PreciseProductImportError("El producto preciso contiene demasiados ficheros")
    recognized: dict[str, DecodedProductFile] = {}
    for file in files:
        kind = _detect_format(file)
        if kind is None:
            raise PreciseProductImportError(
                f"No se reconoce {file.name} como SP3 o RINEX CLK"
            )
        if kind in recognized:
            raise PreciseProductImportError(
                f"Un producto preciso admite un SP3 y, opcionalmente, un CLK; se repite {kind.upper()}"
            )
        recognized[kind] = file
    if "sp3" not in recognized:
        raise PreciseProductImportError("El producto preciso requiere un fichero SP3 de órbita")

    provider_hint_id = normalize_provider_hint(provider_hint)
    requested_class = normalize_product_class(product_class)
    detected_provider, detected_class, detected_family = _detect_profile(
        tuple(file.name for file in files)
    )
    selected_provider = detected_provider if provider_hint_id == "auto" else provider_hint_id
    selected_provider = selected_provider or "custom"
    selected_class = detected_class if requested_class == "auto" else requested_class
    selected_class = selected_class or "unknown"
    if detected_provider_id is not None:
        detected_provider = _provider_or_none(detected_provider_id)
    if detected_product_class is not None:
        detected_class = _normalize_detected_class(detected_product_class)
    if detected_product_family is not None:
        detected_family = _normalize_detected_family(detected_product_family)
    selected_family = _selected_product_family(selected_provider, detected_family)

    try:
        sp3 = parse_sp3_state_provider(
            _decode_text(recognized["sp3"]),
            frame_transformer=frame_transformer,
        )
        clock = (
            parse_rinex_clock_product(_decode_text(recognized["clk"]))
            if "clk" in recognized
            else None
        )
    except EphemerisFormatError as exc:
        raise PreciseProductImportError(str(exc)) from exc

    sources = tuple(source_files or _source_metadata(files))
    expected_id = _product_id(
        files,
        provider_id=selected_provider,
        product_class=selected_class,
    )
    if product_id is not None:
        if not _PRODUCT_ID_PATTERN.fullmatch(product_id):
            raise PreciseProductImportError("El manifest del producto preciso tiene un ID inválido")
        if product_id != expected_id:
            raise PreciseProductImportError(
                "El manifest del producto preciso no coincide con los checksums de sus fuentes"
            )
    return PreciseProduct(
        product_id=product_id or expected_id,
        name=_clean_product_name(product_name or recognized["sp3"].name),
        provider_id=selected_provider,
        product_class=selected_class,
        product_family=selected_family,
        detected_provider_id=detected_provider,
        detected_product_class=detected_class or "unknown",
        detected_product_family=detected_family or "unknown",
        sp3=sp3,
        clock=clock,
        source_files=sources,
        decoded_files=tuple(files),
    )


def decode_precise_product_upload(files: Sequence[tuple[str, str]]) -> tuple[DecodedProductFile, ...]:
    """Decode base64 uploads with archive and decompression safety limits."""

    if not files:
        raise PreciseProductImportError("Debes adjuntar un SP3 y, opcionalmente, un CLK")
    if len(files) > MAX_PRECISE_PRODUCT_FILES:
        raise PreciseProductImportError(
            f"Se permiten como máximo {MAX_PRECISE_PRODUCT_FILES} ficheros por producto preciso"
        )
    total_upload = 0
    decoded: list[DecodedProductFile] = []
    for raw_name, encoded in files:
        name = _safe_file_name(raw_name)
        if not isinstance(encoded, str) or not encoded.strip():
            raise PreciseProductImportError(f"{name} no contiene datos base64")
        if encoded.lstrip().startswith("data:"):
            raise PreciseProductImportError("Envía content_base64 sin un prefijo data: URI")
        # Base64 expands binary data by roughly 4/3. Reject before decoding a
        # pathological JSON string into another full-size bytes allocation.
        if len(encoded) > ((MAX_PRECISE_PRODUCT_FILE_BYTES * 4) // 3) + 16:
            raise PreciseProductImportError(f"{name} supera el límite de tamaño de carga")
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise PreciseProductImportError(f"{name} no contiene base64 válido") from exc
        if not raw:
            raise PreciseProductImportError(f"{name} está vacío")
        if len(raw) > MAX_PRECISE_PRODUCT_FILE_BYTES:
            raise PreciseProductImportError(f"{name} supera el límite de {MAX_PRECISE_PRODUCT_FILE_BYTES // (1024 * 1024)} MiB")
        total_upload += len(raw)
        if total_upload > MAX_PRECISE_PRODUCT_UPLOAD_BYTES:
            raise PreciseProductImportError("La carga total de producto preciso supera el límite permitido")
        remaining_expanded = MAX_PRECISE_PRODUCT_EXPANDED_BYTES - sum(
            file.byte_count for file in decoded
        )
        if remaining_expanded <= 0:
            raise PreciseProductImportError("El contenido descomprimido supera el límite de seguridad")
        decoded.extend(
            _expand_uploaded_file(
                name,
                raw,
                max_expanded_bytes=remaining_expanded,
            )
        )
        if len(decoded) > MAX_PRECISE_PRODUCT_FILES:
            raise PreciseProductImportError("El archivo comprimido contiene demasiados productos")
        if sum(file.byte_count for file in decoded) > MAX_PRECISE_PRODUCT_EXPANDED_BYTES:
            raise PreciseProductImportError("El contenido descomprimido supera el límite de seguridad")
    names = [file.name.casefold() for file in decoded]
    if len(names) != len(set(names)):
        raise PreciseProductImportError("La carga contiene nombres de fichero lógicos duplicados")
    return tuple(decoded)


class PreciseProductRepository:
    """Filesystem persistence for local precise-product imports.

    The configured directory is mounted into the Docker service as part of
    Orbit's normal config volume.  Each product lives in a content-addressed
    directory, with an atomically-written manifest and verified source bytes.
    Corrupt products are skipped during a bulk reload and surfaced to callers
    through ``load_all``'s diagnostic list rather than crashing the entire
    constellation.
    """

    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def save(self, product: PreciseProduct) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        root = self.root.resolve()
        target = (root / product.product_id).resolve()
        if target.parent != root:
            raise PreciseProductImportError("La ruta de almacenamiento del producto no es segura")
        if target.exists():
            # A content-addressed ID can be reused only if all declared source
            # bytes still validate. This avoids overwriting a product that a
            # user may currently be reading in another process.
            self.load(product.product_id, frame_transformer=product.sp3.frame_transformer)
            return

        temporary = Path(tempfile.mkdtemp(prefix=".precise-upload-", dir=root))
        try:
            source_by_name = {source.name: source for source in product.source_files}
            for decoded in product.decoded_files:
                source = source_by_name.get(decoded.name)
                if source is None:
                    raise PreciseProductImportError("El producto no puede persistir una fuente sin metadatos")
                destination = temporary / source.storage_name
                _atomic_write(destination, decoded.data)
            _atomic_write(
                temporary / "manifest.json",
                json.dumps(_manifest_payload(product), ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8"),
            )
            try:
                os.replace(temporary, target)
            except FileExistsError:
                # A concurrent import saved the same content-addressed product.
                self.load(product.product_id, frame_transformer=product.sp3.frame_transformer)
            finally:
                if temporary.exists():
                    shutil.rmtree(temporary, ignore_errors=True)
        except Exception:
            if temporary.exists():
                shutil.rmtree(temporary, ignore_errors=True)
            raise

    def load(
        self,
        product_id: str,
        *,
        frame_transformer: FrameTransformService | None = None,
    ) -> PreciseProduct:
        if not _PRODUCT_ID_PATTERN.fullmatch(product_id):
            raise PreciseProductImportError("El identificador del producto preciso no es válido")
        root = self.root.resolve()
        product_dir = (root / product_id).resolve()
        if product_dir.parent != root:
            raise PreciseProductImportError("La ruta del producto preciso no es segura")
        manifest_path = product_dir / "manifest.json"
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise PreciseProductImportError(f"No se puede leer el manifest de {product_id}") from exc
        if not isinstance(manifest, dict) or manifest.get("product_id") != product_id:
            raise PreciseProductImportError("El manifest de producto preciso no coincide con su directorio")
        raw_sources = manifest.get("source_files")
        if not isinstance(raw_sources, list) or not raw_sources:
            raise PreciseProductImportError("El manifest de producto preciso no contiene fuentes")
        decoded: list[DecodedProductFile] = []
        sources: list[ProductSourceFile] = []
        total_bytes = 0
        for raw_source in raw_sources:
            if not isinstance(raw_source, dict):
                raise PreciseProductImportError("El manifest contiene una fuente inválida")
            source = _source_from_manifest(raw_source)
            file_path = (product_dir / source.storage_name).resolve()
            if file_path.parent != product_dir:
                raise PreciseProductImportError("El manifest contiene una ruta de fuente insegura")
            try:
                data = file_path.read_bytes()
            except OSError as exc:
                raise PreciseProductImportError(f"No se puede leer la fuente {source.name}") from exc
            if len(data) > MAX_PRECISE_PRODUCT_EXPANDED_BYTES:
                raise PreciseProductImportError("Una fuente persistida supera el límite de seguridad")
            total_bytes += len(data)
            if total_bytes > MAX_PRECISE_PRODUCT_EXPANDED_BYTES:
                raise PreciseProductImportError("El producto persistido supera el límite de seguridad")
            if hashlib.sha256(data).hexdigest() != source.sha256:
                raise PreciseProductImportError(f"El checksum de {source.name} no coincide")
            decoded.append(DecodedProductFile(
                name=source.name,
                data=data,
                uploaded_name=source.uploaded_name,
                uploaded_sha256=source.uploaded_sha256,
                compression=source.compression,
                archive_member=source.archive_member,
            ))
            sources.append(source)
        return build_precise_product(
            decoded,
            provider_hint=manifest.get("provider_id"),
            product_class=manifest.get("product_class"),
            frame_transformer=frame_transformer,
            product_id=product_id,
            product_name=manifest.get("name"),
            detected_provider_id=manifest.get("detected_provider_id"),
            detected_product_class=manifest.get("detected_product_class"),
            detected_product_family=manifest.get("detected_product_family"),
            source_files=sources,
        )

    def load_all(
        self,
        *,
        frame_transformer: FrameTransformService | None = None,
    ) -> tuple[tuple[PreciseProduct, ...], tuple[str, ...]]:
        if not self.root.exists():
            return (), ()
        products: list[PreciseProduct] = []
        diagnostics: list[str] = []
        for product_dir in sorted(self.root.iterdir(), key=lambda item: item.name):
            if not product_dir.is_dir() or not _PRODUCT_ID_PATTERN.fullmatch(product_dir.name):
                continue
            try:
                products.append(self.load(product_dir.name, frame_transformer=frame_transformer))
            except PreciseProductImportError as exc:
                diagnostics.append(f"{product_dir.name}: {exc}")
        return tuple(products), tuple(diagnostics)


def _source_metadata(files: Sequence[DecodedProductFile]) -> tuple[ProductSourceFile, ...]:
    sources: list[ProductSourceFile] = []
    occupied: set[str] = set()
    for index, file in enumerate(files, start=1):
        kind = _detect_format(file)
        assert kind is not None  # build_precise_product checked it first.
        stem = _safe_file_name(file.name)
        storage_name = f"{index:02d}-{stem}"
        if storage_name.casefold() in occupied:
            raise PreciseProductImportError("No se puede asignar una ruta única a las fuentes")
        occupied.add(storage_name.casefold())
        sources.append(ProductSourceFile(
            name=file.name,
            kind=kind,
            sha256=file.sha256,
            uploaded_name=file.uploaded_name,
            uploaded_sha256=file.uploaded_sha256,
            compression=file.compression,
            archive_member=file.archive_member,
            byte_count=file.byte_count,
            storage_name=storage_name,
        ))
    return tuple(sources)


def _source_from_manifest(value: Mapping[str, Any]) -> ProductSourceFile:
    try:
        name = _safe_file_name(value.get("name"))
        kind = str(value.get("kind") or "").strip().lower()
        if kind not in {"sp3", "clk"}:
            raise ValueError
        sha256 = _checksum(value.get("sha256"))
        uploaded_name = _safe_file_name(value.get("uploaded_name"))
        uploaded_sha256 = _checksum(value.get("uploaded_sha256"))
        compression = str(value.get("compression") or "none").strip().lower()
        archive_member = value.get("archive_member")
        if archive_member is not None:
            archive_member = _safe_file_name(archive_member)
        byte_count = int(value.get("byte_count"))
        storage_name = _safe_storage_name(value.get("storage_name"))
    except (TypeError, ValueError) as exc:
        raise PreciseProductImportError("El manifest contiene metadatos de fuente inválidos") from exc
    if byte_count < 1 or byte_count > MAX_PRECISE_PRODUCT_EXPANDED_BYTES:
        raise PreciseProductImportError("El manifest contiene un tamaño de fuente inválido")
    return ProductSourceFile(
        name=name,
        kind=kind,
        sha256=sha256,
        uploaded_name=uploaded_name,
        uploaded_sha256=uploaded_sha256,
        compression=compression,
        archive_member=archive_member,
        byte_count=byte_count,
        storage_name=storage_name,
    )


def _manifest_payload(product: PreciseProduct) -> dict[str, object]:
    return {
        "schema_version": 1,
        "product_id": product.product_id,
        "name": product.name,
        "provider_id": product.provider_id,
        "product_class": product.product_class,
        "detected_provider_id": product.detected_provider_id,
        "detected_product_class": product.detected_product_class,
        "detected_product_family": product.detected_product_family,
        "source_files": [
            {**source.payload(), "storage_name": source.storage_name}
            for source in product.source_files
        ],
    }


def _expand_uploaded_file(
    name: str,
    data: bytes,
    *,
    max_expanded_bytes: int = MAX_PRECISE_PRODUCT_EXPANDED_BYTES,
) -> list[DecodedProductFile]:
    lower_name = name.casefold()
    if lower_name.endswith(".zip"):
        return _expand_zip(name, data, max_expanded_bytes=max_expanded_bytes)
    return [
        _expand_non_zip(
            name,
            data,
            uploaded_name=name,
            uploaded_sha256=_sha256(data),
            archive_member=None,
            max_expanded_bytes=max_expanded_bytes,
        )
    ]


def _expand_zip(
    name: str,
    data: bytes,
    *,
    max_expanded_bytes: int,
) -> list[DecodedProductFile]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise PreciseProductImportError(f"{name} no es un ZIP válido") from exc
    with archive:
        members = [member for member in archive.infolist() if not member.is_dir()]
        if not members:
            raise PreciseProductImportError(f"{name} no contiene ficheros")
        if len(members) > MAX_PRECISE_PRODUCT_ZIP_MEMBERS:
            raise PreciseProductImportError(f"{name} supera el número máximo de miembros ZIP")
        results: list[DecodedProductFile] = []
        total_expanded = 0
        for member in members:
            if member.flag_bits & 0x1:
                raise PreciseProductImportError(f"{name} contiene un ZIP cifrado, que no es compatible")
            member_name = _safe_archive_member(member.filename)
            remaining_expanded = max_expanded_bytes - total_expanded
            if remaining_expanded <= 0:
                raise PreciseProductImportError("El contenido ZIP descomprimido supera el límite de seguridad")
            if member.file_size < 1 or member.file_size > remaining_expanded:
                raise PreciseProductImportError(f"{name} contiene un miembro ZIP demasiado grande")
            try:
                with archive.open(member, "r") as stream:
                    content = _read_limited(stream, remaining_expanded)
            except (OSError, RuntimeError, zipfile.BadZipFile) as exc:
                raise PreciseProductImportError(f"No se puede leer {member_name} dentro de {name}") from exc
            if member_name.casefold().endswith(".zip"):
                raise PreciseProductImportError("Los ZIP anidados no están permitidos en productos precisos")
            expanded = _expand_non_zip(
                member_name,
                content,
                uploaded_name=name,
                uploaded_sha256=_sha256(data),
                archive_member=member_name,
                max_expanded_bytes=remaining_expanded,
            )
            results.append(expanded)
            total_expanded += expanded.byte_count
        return results


def _expand_non_zip(
    name: str,
    data: bytes,
    *,
    uploaded_name: str,
    uploaded_sha256: str,
    archive_member: str | None,
    max_expanded_bytes: int,
) -> DecodedProductFile:
    lower_name = name.casefold()
    compression = "none"
    logical_name = name
    if lower_name.endswith(".gz"):
        data = _decompress_gzip(data, max_expanded_bytes=max_expanded_bytes)
        logical_name = name[:-3]
        compression = "gzip" if archive_member is None else "zip+gzip"
    elif lower_name.endswith(".z"):
        data = _decompress_unix_compress(data, max_expanded_bytes=max_expanded_bytes)
        logical_name = name[:-2]
        compression = "unix-compress" if archive_member is None else "zip+unix-compress"
    if not data:
        raise PreciseProductImportError(f"{name} se descomprimió vacío")
    if len(data) > max_expanded_bytes:
        raise PreciseProductImportError(f"{name} supera el límite descomprimido")
    return DecodedProductFile(
        name=_safe_file_name(logical_name),
        data=data,
        uploaded_name=uploaded_name,
        uploaded_sha256=uploaded_sha256,
        compression=compression,
        archive_member=archive_member,
    )


def _decompress_gzip(
    data: bytes,
    *,
    max_expanded_bytes: int = MAX_PRECISE_PRODUCT_EXPANDED_BYTES,
) -> bytes:
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(data), mode="rb") as stream:
            return _read_limited(stream, max_expanded_bytes)
    except (OSError, EOFError) as exc:
        raise PreciseProductImportError("El fichero gzip de producto preciso no es válido") from exc


class _UnixCompressReader:
    """Read the variable-width packets used by historical UNIX ``compress``."""

    def __init__(self, data: bytes) -> None:
        self._data = data
        self._position = 0
        self._width = 0
        self._buffer = b""
        self._offset = 0
        self._size = 0

    def reset_packet(self) -> None:
        self._width = 0
        self._buffer = b""
        self._offset = 0
        self._size = 0

    def read(self, width: int) -> int | None:
        # ``compress`` flushes/pads the current width packet before a code
        # width change or CLEAR.  A width reset must discard that padding,
        # not interpret it as synthetic code zeroes.
        if self._width != width or self._offset >= self._size:
            if self._position >= len(self._data):
                return None
            self._width = width
            self._buffer = self._data[self._position:self._position + width]
            self._position += len(self._buffer)
            self._offset = 0
            self._size = (len(self._buffer) * 8) - (width - 1)
            if self._size <= 0:
                return None
        packed = int.from_bytes(self._buffer, "little")
        code = (packed >> self._offset) & ((1 << width) - 1)
        self._offset += width
        return code


def _decompress_unix_compress(
    data: bytes,
    *,
    max_expanded_bytes: int = MAX_PRECISE_PRODUCT_EXPANDED_BYTES,
) -> bytes:
    """Safely decode legacy LZW ``.Z`` bytes produced by UNIX ``compress``.

    The decoder follows the historical packet alignment rule at code-width
    changes and CLEAR codes.  It never invokes a shell utility, bounds both
    dictionary width and output, and rejects the reserved header bits.
    """

    if len(data) < 4 or data[:2] != b"\x1f\x9d":
        raise PreciseProductImportError("El fichero .Z no tiene una cabecera UNIX compress válida")
    flags = data[2]
    if flags & 0x60:
        raise PreciseProductImportError("El fichero .Z usa flags UNIX compress no compatibles")
    max_bits = flags & 0x1F
    block_mode = bool(flags & 0x80)
    if not 9 <= max_bits <= 16:
        raise PreciseProductImportError("El fichero .Z declara un ancho LZW no compatible")
    max_entries = 1 << max_bits
    reader = _UnixCompressReader(data[3:])
    prefix = [0] * max_entries
    suffix = bytearray(max_entries)
    for index in range(256):
        suffix[index] = index
    clear_code = 256
    free_entry = 257 if block_mode else 256
    width = 9
    max_code = (1 << width) - 1
    first = reader.read(width)
    if first is None:
        return b""
    if block_mode and first == clear_code:
        reader.reset_packet()
        first = reader.read(width)
    if first is None or first > 255:
        raise PreciseProductImportError("El fichero .Z no empieza con un código LZW literal válido")
    if max_expanded_bytes < 1:
        raise PreciseProductImportError("El fichero .Z supera el límite descomprimido")
    output = bytearray((first,))
    previous = first
    final_character = first
    stack: list[int] = []

    while True:
        code = reader.read(width)
        if code is None:
            break
        if block_mode and code == clear_code:
            free_entry = 257
            width = 9
            max_code = (1 << width) - 1
            reader.reset_packet()
            next_code = reader.read(width)
            if next_code is None:
                break
            if next_code > 255:
                raise PreciseProductImportError("El código posterior a CLEAR en .Z no es un literal válido")
            _append_limited(output, next_code, max_expanded_bytes=max_expanded_bytes)
            previous = next_code
            final_character = next_code
            continue

        in_code = code
        if code >= free_entry:
            if code != free_entry:
                raise PreciseProductImportError("El fichero .Z contiene un código LZW fuera de su diccionario")
            stack.append(final_character)
            code = previous
        while code >= 256:
            if code >= free_entry or len(stack) >= max_entries:
                raise PreciseProductImportError("El fichero .Z contiene una cadena LZW inválida")
            stack.append(suffix[code])
            code = prefix[code]
        final_character = suffix[code]
        stack.append(final_character)
        while stack:
            _append_limited(output, stack.pop(), max_expanded_bytes=max_expanded_bytes)
        if free_entry < max_entries:
            prefix[free_entry] = previous
            suffix[free_entry] = final_character
            free_entry += 1
            if free_entry > max_code and width < max_bits:
                width += 1
                max_code = (1 << width) - 1
                reader.reset_packet()
        previous = in_code
    return bytes(output)


def _append_limited(output: bytearray, value: int, *, max_expanded_bytes: int) -> None:
    if len(output) >= max_expanded_bytes:
        raise PreciseProductImportError("El fichero .Z supera el límite descomprimido")
    output.append(value)


def _read_limited(stream: Any, limit: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = stream.read(min(1024 * 1024, limit + 1))
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise PreciseProductImportError("El contenido comprimido supera el límite de seguridad")
        chunks.append(chunk)
    return b"".join(chunks)


def _atomic_write(path: Path, data: bytes) -> None:
    """Write one product member without exposing a partial manifest/source."""

    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    try:
        temporary.write_bytes(data)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink(missing_ok=True)


def _detect_format(file: DecodedProductFile) -> str | None:
    name = file.name.casefold()
    if name.endswith((".sp3", ".sp3c", ".sp3d")):
        return "sp3"
    if name.endswith((".clk", ".clk_30s", ".clk_05s")):
        return "clk"
    prefix = file.data[:2_048].decode("ascii", errors="ignore")
    if prefix.lstrip("\ufeff").startswith("#") and "%c" in file.data[:8_192].decode("ascii", errors="ignore"):
        return "sp3"
    if "RINEX VERSION / TYPE" in prefix and "C" in prefix[:80]:
        return "clk"
    return None


def _decode_text(file: DecodedProductFile) -> str:
    try:
        return file.data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise PreciseProductImportError(f"{file.name} no está codificado como texto ASCII/UTF-8") from exc


def _detect_profile(file_names: tuple[str, ...]) -> tuple[str | None, str | None, str | None]:
    """Classify filename provenance without replacing an explicit operator hint.

    Provider and family are deliberately separate.  ESA can publish an
    operational ESA product (``esa_ops``) or distribute an MGEX product;
    ``ESA0MGN*`` must therefore retain ``esa_nso`` as provider while exposing
    ``mgex`` as the product family.
    """

    combined = " ".join(name.upper() for name in file_names)
    provider: str | None
    if "ESA0" in combined or re.search(r"(?:^|[^A-Z])ESA(?:[^A-Z]|$)", combined):
        provider = "esa_nso"
    elif "MGEX" in combined or "MGX" in combined or re.search(r"(?:^|[^A-Z])MGN", combined):
        provider = "igs_mgex"
    elif any(token in combined for token in ("IGS0OPS", "IGS0MGX", "IGS0MGN")) or re.search(r"(?:^|[^A-Z])IG[SRU]\d{4,}", combined):
        provider = "cddis_igs"
    else:
        provider = None

    if (
        re.search(r"(?:OPS|MG[NX])FIN", combined)
        or re.search(r"(?:^|[^A-Z])IGS\d{4,}", combined)
    ):
        product_class = "final"
    elif (
        re.search(r"(?:OPS|MG[NX])RAP", combined)
        or re.search(r"(?:^|[^A-Z])IGR\d{4,}", combined)
    ):
        product_class = "rapid"
    elif (
        re.search(r"(?:OPS|MG[NX])ULT", combined)
        or re.search(r"(?:^|[^A-Z])IGU\d{4,}", combined)
    ):
        product_class = "ultra_rapid"
    else:
        product_class = None
    if re.search(r"MG(?:EX|[NX])", combined):
        family = "mgex"
    elif provider == "esa_nso":
        family = "esa_ops"
    elif provider == "cddis_igs":
        family = "igs"
    elif provider == "igs_mgex":
        family = "mgex"
    else:
        family = None
    return provider, product_class, family


def _selected_product_family(provider_id: str, detected_family: str | None) -> str:
    """Choose the public family while retaining source-derived semantics.

    An explicit ``custom`` provider is a deliberate provenance override, so
    it receives the custom family.  Other provider overrides do not erase an
    unambiguous MGEX/IGS/ESA product family detected from the source names.
    """

    if provider_id == "custom":
        return "custom"
    return detected_family or _PRODUCT_FAMILIES[provider_id]


def _normalize_detected_family(value: object) -> str | None:
    family = str(value or "").strip().lower()
    if not family or family == "unknown":
        return None
    if family not in {"igs", "mgex", "esa_ops", "custom"}:
        raise PreciseProductImportError("El manifest contiene una familia de producto precisa no válida")
    return family


def _product_id(
    files: Sequence[DecodedProductFile],
    *,
    provider_id: str,
    product_class: str,
) -> str:
    fingerprint = {
        "provider_id": provider_id,
        "product_class": product_class,
        "sources": sorted(
            ({"name": file.name, "sha256": file.sha256} for file in files),
            key=lambda source: (str(source["name"]), str(source["sha256"])),
        ),
    }
    digest = hashlib.sha256(
        json.dumps(fingerprint, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return f"precise-{digest[:20]}"


def _safe_file_name(value: object) -> str:
    text = str(value or "").strip().replace("\\", "/")
    path = PurePosixPath(text)
    windows_path = PureWindowsPath(str(value or "").strip())
    if (
        not text
        or path.is_absolute()
        or windows_path.is_absolute()
        or windows_path.drive
        or len(path.parts) != 1
        or len(windows_path.parts) != 1
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        raise PreciseProductImportError("El nombre de fichero no es seguro")
    name = path.name
    if not name or name in {".", ".."} or len(name) > 180:
        raise PreciseProductImportError("El nombre de fichero no es válido")
    return name


def _safe_archive_member(value: object) -> str:
    text = str(value or "").strip().replace("\\", "/")
    path = PurePosixPath(text)
    if not text or path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise PreciseProductImportError("El ZIP contiene una ruta de miembro insegura")
    return _safe_file_name(path.name)


def _safe_storage_name(value: object) -> str:
    name = _safe_file_name(value)
    if not re.fullmatch(r"\d{2}-[^/\\]+", name):
        raise PreciseProductImportError("El manifest contiene una ruta de almacenamiento inválida")
    return name


def _checksum(value: object) -> str:
    result = str(value or "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", result):
        raise PreciseProductImportError("El checksum SHA-256 de fuente no es válido")
    return result


def _clean_product_name(value: object) -> str:
    name = _safe_file_name(value)
    # Remove one or more transport/format suffixes but leave the operational
    # filename token intact (for example IGS0OPSFIN_..._ORB).
    while True:
        stem, extension = os.path.splitext(name)
        if extension.casefold() in {".gz", ".z", ".zip", ".sp3", ".sp3c", ".sp3d", ".clk"} and stem:
            name = stem
            continue
        break
    return name[:120] or "Precise GNSS product"


def _satellite_id(value: object) -> str:
    identifier = str(value or "").strip().upper()
    if not identifier or not re.fullmatch(r"[A-Z0-9]{1,12}", identifier):
        raise PreciseProductImportError("El identificador de satélite preciso no es válido")
    return identifier


def _provider_or_none(value: object) -> str | None:
    normalized = normalize_provider_hint(value)
    return None if normalized == "auto" else normalized


def _normalize_detected_class(value: object) -> str:
    normalized = normalize_product_class(value)
    return "unknown" if normalized == "auto" else normalized


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _iso_or_none(value: datetime.datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _clock_coverage(samples: Iterable[object], time_scale: TimeScale) -> dict[str, object]:
    """Expose clock coverage without silently reinterpreting an unknown scale.

    RINEX CLK and the fourth SP3 component are retained as timing products,
    not Cartesian data.  Their calendar values are therefore reported with
    the declared source scale and, only when the conversion is supported,
    alongside an explicit UTC convenience value.
    """

    epochs = sorted(
        sample.epoch
        for sample in samples
        if isinstance(getattr(sample, "epoch", None), datetime.datetime)
    )
    start = epochs[0] if epochs else None
    end = epochs[-1] if epochs else None
    utc_start = utc_end = None
    if start is not None and time_scale is not TimeScale.UNKNOWN:
        try:
            utc_start = to_utc(start, time_scale)
            utc_end = to_utc(end, time_scale) if end is not None else None
        except ValueError:
            # A missing/expired local leap-second table is an operational
            # diagnostic for a later time conversion, not a reason to lose
            # the imported native clock coverage.
            pass
    return {
        "start_time": _iso_or_none(start),
        "end_time": _iso_or_none(end),
        "time_scale": time_scale.value,
        "start_time_utc": _iso_or_none(utc_start),
        "end_time_utc": _iso_or_none(utc_end),
    }


def _epoch_millis(value: datetime.datetime | None) -> int | None:
    return int(value.timestamp() * 1000) if value is not None else None
