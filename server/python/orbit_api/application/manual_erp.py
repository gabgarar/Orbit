"""Durable, local ERP snapshots for manual-orbit force evaluations.

Manual Cowell designs can use an ERP that belongs to neither the process-wide
IERS C04 deployment snapshot nor an imported SP3 product.  This module keeps
that input local and content-addressed: a browser upload is parsed before it
is written, then the authored project stores only its immutable snapshot ID.

The repository deliberately never performs a download and never returns the
ERP bytes through the public API.  On project restore the snapshot is loaded
again from the mounted configuration volume and its source checksum and parser
identity are checked before it can influence an Earth-fixed force.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

from orbit_api.application.precise_products import (
    DecodedProductFile,
    PreciseProductImportError,
    decode_precise_product_upload,
)
from orbit_api.timekeeping import IgsErpEarthOrientationProvider


_SNAPSHOT_ID_RE = re.compile(r"^manual-erp:sha256:([0-9a-f]{64})$")
_ERP_UPLOAD_SUFFIXES = (".erp", ".erp.gz")
_MANIFEST_FILE = "manifest.json"
_SOURCE_FILE = "source.erp"
_MANIFEST_SCHEMA_VERSION = 2


class ManualErpError(ValueError):
    """A manual-orbit ERP upload or durable reference is invalid."""


def _safe_display_name(value: object, label: str) -> str:
    """Accept a compact provenance name without permitting path-like data."""

    name = str(value or "").strip()
    if not name or "\x00" in name or "/" in name or "\\" in name:
        raise ManualErpError(f"El {label} del ERP manual no es válido")
    return name


def _quality_from_filename(_name: str) -> str:
    """Describe an operator-selected ERP without inventing product class.

    A standalone manual ERP is structurally parsed, range checked, content
    addressed and non-extrapolating.  That proves it is safe as a local force
    input, but neither the browser nor the filename gets to claim an IGS
    ``final`` or ``rapid`` publication class.  The isolated transformer
    accepts this explicit quality only for the manual-orbit route.
    """

    return "local-validated"


def _snapshot_id(sha256: str) -> str:
    return f"manual-erp:sha256:{sha256}"


def _snapshot_sha256(snapshot_id: object) -> str:
    match = _SNAPSHOT_ID_RE.fullmatch(str(snapshot_id or "").strip().lower())
    if match is None:
        raise ManualErpError("La referencia del snapshot ERP manual no es válida")
    return match.group(1)


def _source_text(file: DecodedProductFile) -> str:
    try:
        return file.data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ManualErpError(
            f"{file.name} no está codificado como texto ASCII/UTF-8"
        ) from exc


def _decode_one_erp(name: object, content_base64: object) -> DecodedProductFile:
    """Use the already hardened GNSS upload decoder for one ERP only."""

    raw_name = str(name or "").strip()
    if not raw_name.casefold().endswith(_ERP_UPLOAD_SUFFIXES):
        raise ManualErpError("El ERP manual solo admite ficheros .ERP o .ERP.gz")
    try:
        decoded = decode_precise_product_upload([(raw_name, str(content_base64 or ""))])
    except PreciseProductImportError as exc:
        raise ManualErpError(str(exc)) from exc
    if len(decoded) != 1 or not decoded[0].name.casefold().endswith(".erp"):
        raise ManualErpError("El ERP manual debe contener exactamente un fichero ERP")
    return decoded[0]


@dataclass(frozen=True, slots=True)
class ManualErpSnapshot:
    """One verified manual ERP plus its portable, project-safe identity."""

    snapshot_id: str
    filename: str
    source_sha256: str
    byte_size: int
    uploaded_name: str
    uploaded_sha256: str
    compression: str
    provider: IgsErpEarthOrientationProvider

    def __post_init__(self) -> None:
        snapshot_sha = _snapshot_sha256(self.snapshot_id)
        filename = _safe_display_name(self.filename, "nombre lógico")
        uploaded_name = _safe_display_name(self.uploaded_name, "nombre de carga")
        if not filename.casefold().endswith(".erp"):
            raise ManualErpError("El nombre lógico del ERP manual no es válido")
        if not uploaded_name.casefold().endswith(_ERP_UPLOAD_SUFFIXES):
            raise ManualErpError("El nombre de carga del ERP manual no es válido")
        if not re.fullmatch(r"[0-9a-f]{64}", str(self.source_sha256 or "").lower()):
            raise ManualErpError("El checksum de origen del ERP manual no es válido")
        if not re.fullmatch(r"[0-9a-f]{64}", str(self.uploaded_sha256 or "").lower()):
            raise ManualErpError("El checksum de carga del ERP manual no es válido")
        if self.compression not in {"none", "gzip"}:
            raise ManualErpError("La compresión del ERP manual no es válida")
        if int(self.byte_size) < 1:
            raise ManualErpError("El ERP manual no puede estar vacío")
        # The durable ID is the SHA of the original logical upload bytes,
        # rather than the parser's decoded-text identity.  This preserves a
        # byte-for-byte reproducible source even for a UTF-8 BOM variant.
        if str(self.source_sha256).lower() != snapshot_sha:
            raise ManualErpError("La identidad del ERP manual no coincide con su snapshot")
        object.__setattr__(self, "filename", filename)
        object.__setattr__(self, "uploaded_name", uploaded_name)
        object.__setattr__(self, "source_sha256", str(self.source_sha256).lower())
        object.__setattr__(self, "uploaded_sha256", str(self.uploaded_sha256).lower())

    @property
    def coverage_start(self):
        identity = self.provider.snapshot_identity
        assert identity is not None
        return identity.coverage_start

    @property
    def coverage_end(self):
        identity = self.provider.snapshot_identity
        assert identity is not None
        return identity.coverage_end

    def payload(self) -> dict[str, object]:
        """Return provenance suitable for API responses and project JSON.

        `content_base64` is intentionally absent.  The snapshot ID is enough
        to restore a manual orbit when the same local configuration volume is
        available; otherwise the backend fails closed with an actionable
        message.
        """

        identity = self.provider.snapshot_identity
        assert identity is not None
        return {
            "snapshot_id": self.snapshot_id,
            "snapshotId": self.snapshot_id,
            "filename": self.filename,
            "sha256": self.source_sha256,
            "parser_sha256": identity.sha256,
            "source_sha256": self.source_sha256,
            "byte_size": self.byte_size,
            "uploaded_name": self.uploaded_name,
            "uploaded_sha256": self.uploaded_sha256,
            "compression": self.compression,
            "record_count": identity.record_count,
            "coverage_start": identity.coverage_start.isoformat(),
            "coverage_end": identity.coverage_end.isoformat(),
            "source": self.provider.samples[0].source,
            "version": self.provider.samples[0].version,
            "quality": self.provider.samples[0].quality,
            "persistence": {"scope": "config-volume", "reloadable": True},
        }


def parse_manual_erp_upload(name: object, content_base64: object) -> tuple[ManualErpSnapshot, DecodedProductFile]:
    """Decode and structurally validate a browser-provided ERP without saving it."""

    file = _decode_one_erp(name, content_base64)
    quality = _quality_from_filename(file.name)
    try:
        provider = IgsErpEarthOrientationProvider.from_text(
            _source_text(file),
            filename=file.name,
            source=f"ERP manual · {file.name}",
            version=file.sha256[:16],
            quality=quality,
            allow_extrapolation=False,
        )
    except ValueError as exc:
        raise ManualErpError(str(exc)) from exc
    identity = provider.snapshot_identity
    assert identity is not None
    return (
        ManualErpSnapshot(
            snapshot_id=_snapshot_id(file.sha256),
            filename=file.name,
            source_sha256=file.sha256,
            byte_size=file.byte_count,
            uploaded_name=file.uploaded_name,
            uploaded_sha256=file.uploaded_sha256,
            compression=file.compression,
            provider=provider,
        ),
        file,
    )


class ManualErpRepository:
    """Content-addressed store for verified manual ERP source snapshots."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def preview_upload(self, name: object, content_base64: object) -> ManualErpSnapshot:
        snapshot, _file = parse_manual_erp_upload(name, content_base64)
        return snapshot

    def save_upload(self, name: object, content_base64: object) -> ManualErpSnapshot:
        snapshot, file = parse_manual_erp_upload(name, content_base64)
        self.save(snapshot, file)
        return snapshot

    def save(self, snapshot: ManualErpSnapshot, file: DecodedProductFile) -> None:
        """Persist a parsed ERP atomically, never overwriting an existing ID."""

        snapshot_sha = _snapshot_sha256(snapshot.snapshot_id)
        if (
            file.name != snapshot.filename
            or file.sha256 != snapshot.source_sha256
            or file.uploaded_name != snapshot.uploaded_name
            or file.uploaded_sha256 != snapshot.uploaded_sha256
            or file.compression != snapshot.compression
        ):
            raise ManualErpError("La fuente del ERP manual no coincide con el snapshot validado")
        root = self.root.resolve()
        root.mkdir(parents=True, exist_ok=True)
        target = (root / snapshot_sha).resolve()
        if target.parent != root:
            raise ManualErpError("La ruta de almacenamiento del ERP manual no es segura")
        if target.exists():
            # Re-read all bytes and parser identity rather than trusting a
            # directory collision or a manually modified old manifest.
            self.load(snapshot.snapshot_id)
            return

        temporary = Path(tempfile.mkdtemp(prefix=".manual-erp-", dir=root))
        try:
            identity = snapshot.provider.snapshot_identity
            assert identity is not None
            _atomic_write(temporary / _SOURCE_FILE, file.data)
            _atomic_write(
                temporary / _MANIFEST_FILE,
                json.dumps(
                    {
                        "schema_version": _MANIFEST_SCHEMA_VERSION,
                        "snapshot_id": snapshot.snapshot_id,
                        "filename": snapshot.filename,
                        "source_sha256": snapshot.source_sha256,
                        "byte_size": snapshot.byte_size,
                        "uploaded_name": snapshot.uploaded_name,
                        "uploaded_sha256": snapshot.uploaded_sha256,
                        "compression": snapshot.compression,
                        "quality": snapshot.provider.samples[0].quality,
                        "parser_sha256": identity.sha256,
                        "record_count": identity.record_count,
                        "coverage_start": identity.coverage_start.isoformat(),
                        "coverage_end": identity.coverage_end.isoformat(),
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                    indent=2,
                ).encode("utf-8"),
            )
            try:
                os.replace(temporary, target)
            except FileExistsError:
                self.load(snapshot.snapshot_id)
            finally:
                if temporary.exists():
                    shutil.rmtree(temporary, ignore_errors=True)
        except Exception:
            if temporary.exists():
                shutil.rmtree(temporary, ignore_errors=True)
            raise

    def load(self, snapshot_id: object) -> ManualErpSnapshot:
        """Load one persisted ERP and verify bytes, parser and manifest."""

        snapshot_sha = _snapshot_sha256(snapshot_id)
        root = self.root.resolve()
        target = (root / snapshot_sha).resolve()
        if target.parent != root:
            raise ManualErpError("La ruta del snapshot ERP manual no es segura")
        manifest_path = target / _MANIFEST_FILE
        source_path = target / _SOURCE_FILE
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            source_bytes = source_path.read_bytes()
        except (OSError, ValueError) as exc:
            raise ManualErpError(
                "No se encuentra el snapshot ERP manual requerido; vuelva a adjuntar el fichero ERP."
            ) from exc
        schema_version = manifest.get("schema_version") if isinstance(manifest, dict) else None
        if schema_version not in {1, _MANIFEST_SCHEMA_VERSION}:
            raise ManualErpError("El manifest del snapshot ERP manual no es válido")
        if str(manifest.get("snapshot_id") or "").lower() != _snapshot_id(snapshot_sha):
            raise ManualErpError("El manifest del snapshot ERP manual no coincide con su directorio")
        filename = str(manifest.get("filename") or "")
        source_sha = str(manifest.get("source_sha256") or "").lower()
        # Schema v1 snapshots created before upload-level provenance was
        # recorded remain reloadable. Their persisted logical source is still
        # checksum-verified; direct non-compressed upload is the only safe
        # historical interpretation.
        uploaded_name = str(manifest.get("uploaded_name") or filename)
        uploaded_sha = str(manifest.get("uploaded_sha256") or source_sha).lower()
        compression = str(manifest.get("compression") or "none").strip().lower()
        if hashlib.sha256(source_bytes).hexdigest() != source_sha:
            raise ManualErpError("El fichero del snapshot ERP manual no coincide con su checksum")
        if int(manifest.get("byte_size") or 0) != len(source_bytes):
            raise ManualErpError("El tamaño del snapshot ERP manual no coincide con su manifest")
        quality = str(manifest.get("quality") or "unknown").strip().lower() or "unknown"
        if quality != "local-validated":
            raise ManualErpError("El manifest del snapshot ERP manual no conserva su calidad local validada")
        try:
            text = source_bytes.decode("utf-8-sig")
            provider = IgsErpEarthOrientationProvider.from_text(
                text,
                filename=filename,
                source=f"ERP manual · {filename}",
                version=source_sha[:16],
                quality=quality,
                allow_extrapolation=False,
            )
        except (UnicodeDecodeError, ValueError) as exc:
            raise ManualErpError("El snapshot ERP manual almacenado no es válido") from exc
        identity = provider.snapshot_identity
        assert identity is not None
        if schema_version == _MANIFEST_SCHEMA_VERSION:
            try:
                parser_identity_matches = (
                    str(manifest.get("parser_sha256") or "").lower() == identity.sha256
                    and int(manifest.get("record_count") or 0) == identity.record_count
                    and str(manifest.get("coverage_start") or "") == identity.coverage_start.isoformat()
                    and str(manifest.get("coverage_end") or "") == identity.coverage_end.isoformat()
                )
            except (TypeError, ValueError) as exc:
                raise ManualErpError("El manifest del snapshot ERP manual no es válido") from exc
            if not parser_identity_matches:
                raise ManualErpError(
                    "El manifest del snapshot ERP manual no coincide con su interpretación validada"
                )
        if hashlib.sha256(source_bytes).hexdigest() != snapshot_sha:
            raise ManualErpError("El snapshot ERP manual no coincide con su identidad")
        return ManualErpSnapshot(
            snapshot_id=_snapshot_id(snapshot_sha),
            filename=filename,
            source_sha256=source_sha,
            byte_size=len(source_bytes),
            uploaded_name=uploaded_name,
            uploaded_sha256=uploaded_sha,
            compression=compression,
            provider=provider,
        )


def resolve_manual_erp_input(
    value: object | None,
    repository: ManualErpRepository | None,
    *,
    allow_upload: bool = False,
) -> ManualErpSnapshot | None:
    """Resolve a typed/manual request value to a durable ERP snapshot.

    The function purposely uses a tiny structural protocol instead of
    importing the HTTP Pydantic model.  Executable create/export/AOS/LOS and
    inspector paths use its default reference-only mode, so raw browser bytes
    can enter only through the dedicated TIME preflight.  This prevents a
    project-like create payload from accidentally retaining base64.  The
    optional upload mode remains available only for a dedicated trusted
    ingestion boundary.
    """

    if value is None:
        return None
    if repository is None:
        raise ManualErpError("El almacenamiento local de snapshots ERP manuales no está disponible.")
    is_upload = bool(getattr(value, "is_upload", False))
    if is_upload:
        if not allow_upload:
            raise ManualErpError(
                "Adjunte primero el fichero ERP en la pestaña TIME para obtener su referencia local validada."
            )
        name = getattr(value, "name", None)
        content_base64 = getattr(value, "content_base64", None)
        if name is None or content_base64 is None:
            raise ManualErpError("El ERP manual con contenido debe declarar nombre y datos")
        return repository.save_upload(name, content_base64)
    return repository.load(getattr(value, "snapshot_id", None))


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    try:
        temporary.write_bytes(data)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink(missing_ok=True)


__all__ = [
    "ManualErpError",
    "ManualErpRepository",
    "ManualErpSnapshot",
    "parse_manual_erp_upload",
    "resolve_manual_erp_input",
]
