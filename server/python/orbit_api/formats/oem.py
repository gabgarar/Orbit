"""CCSDS OEM metadata and native tabulated-state readers."""

from __future__ import annotations

import datetime
import math
import re
from collections.abc import Iterable
from dataclasses import dataclass, replace

from orbit_api.frames import FrameId, FrameTransformService, StateVector
from orbit_api.timekeeping import TimeScale, utc_now

from .metadata import (
    EphemerisFormatError,
    OemMetadata,
    OemSegmentMetadata,
    ReferenceFrame,
    parse_reference_frame,
)
from .tabular import TabularStateProvider, source_epoch


_SEGMENT_FIELDS = {
    "OBJECT_NAME",
    "OBJECT_ID",
    "CENTER_NAME",
    "REF_FRAME",
    "TIME_SYSTEM",
    "START_TIME",
    "STOP_TIME",
    "USEABLE_START_TIME",
    "USEABLE_STOP_TIME",
    "INTERPOLATION",
    "INTERPOLATION_DEGREE",
}

_OEM_CALENDAR_EPOCH = re.compile(r"^\d{4}-(?:\d{2}-\d{2}|\d{3})T")
_LOCAL_COVARIANCE_FRAMES = frozenset({"RSW", "RTN", "TNW"})
_CARTESIAN_COVARIANCE_FRAMES = frozenset(
    {
        "TEME",
        "GCRF",
        "ICRF",
        "EME2000",
        "CIRS",
        "TIRS",
        "PEF",
        "ITRF",
        "IGS",
        "WGS84",
        "PZ90",
    }
)
_Matrix6 = tuple[tuple[float, float, float, float, float, float], ...]


@dataclass(frozen=True, slots=True)
class OemCovarianceRecord:
    """One OEM covariance matrix, retained in its declared source frame.

    OEM matrices are lower triangular in km-based units.  ``covariance`` is
    expanded to a symmetric 6x6 matrix in Orbit's SI contract; every element
    is therefore scaled by ``1_000_000``.  ``declared_reference_frame`` stays
    ``None`` when OEM omitted ``COV_REF_FRAME`` (which means the segment's
    ``REF_FRAME``), so consumers can still distinguish an inherited frame
    from an explicit declaration.
    """

    segment_index: int
    epoch: datetime.datetime
    time_scale: TimeScale
    reference_frame: ReferenceFrame
    declared_reference_frame: str | None
    covariance: _Matrix6
    comments: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class OemStateProvider:
    """Native, segment-aware state adapters read from a CCSDS OEM file.

    A single OEM may legitimately contain different ``REF_FRAME`` or
    ``TIME_SYSTEM`` metadata blocks.  The provider therefore keeps one
    :class:`TabularStateProvider` per segment and never interpolates across a
    metadata boundary. OEM covariance records retain their own epoch and
    frame. They are attached only at that exact epoch; Orbit never invents a
    covariance-interpolation rule. Cartesian covariance frames are converted
    to a segment state frame through the common frame service when necessary.
    Local orbital frames such as RTN/RSW/TNW remain explicit unsupported
    inputs until their state-dependent transforms are implemented.
    """

    metadata: OemMetadata
    segment_providers: tuple[TabularStateProvider, ...]
    covariance_records: tuple[tuple[OemCovarianceRecord, ...], ...] = ()
    frame_transformer: FrameTransformService | None = None

    def __post_init__(self) -> None:
        if len(self.segment_providers) != len(self.metadata.segments):
            raise EphemerisFormatError("Los estados OEM no coinciden con sus segmentos de metadatos")
        records = self.covariance_records or tuple(() for _ in self.segment_providers)
        if len(records) != len(self.segment_providers):
            raise EphemerisFormatError("Las covarianzas OEM no coinciden con sus segmentos de metadatos")
        for index, segment_records in enumerate(records):
            for record in segment_records:
                if record.segment_index != index:
                    raise EphemerisFormatError("La covarianza OEM está asociada al segmento equivocado")
                if record.time_scale is not self.metadata.segments[index].time_scale:
                    raise EphemerisFormatError("La covarianza OEM no conserva la escala temporal del segmento")
        if any(not isinstance(provider, TabularStateProvider) for provider in self.segment_providers):
            raise EphemerisFormatError("Los estados OEM deben usar proveedores tabulados")
        transformer = self.frame_transformer or FrameTransformService()
        # Keep source-time interpolation and covariance/frame conversion under
        # one immutable time-data contract even when a caller constructs this
        # provider directly instead of using ``from_text``.
        aligned_providers = tuple(
            replace(provider, frame_transformer=transformer)
            for provider in self.segment_providers
        )
        object.__setattr__(self, "segment_providers", aligned_providers)
        object.__setattr__(self, "covariance_records", tuple(tuple(group) for group in records))
        object.__setattr__(self, "frame_transformer", transformer)

    @classmethod
    def from_text(
        cls,
        source: str | Iterable[str],
        *,
        frame_transformer: FrameTransformService | None = None,
    ) -> "OemStateProvider":
        """Read OEM state records while retaining metadata per segment."""

        lines = _source_lines(source)
        metadata = parse_oem_metadata(lines)
        blocks = _oem_state_blocks(lines)
        if len(blocks) != len(metadata.segments):
            raise EphemerisFormatError("No se pudo asociar cada bloque de datos OEM a META_START/META_STOP")

        transformer = frame_transformer or FrameTransformService()
        providers: list[TabularStateProvider] = []
        covariance_records: list[tuple[OemCovarianceRecord, ...]] = []
        for index, (segment, block) in enumerate(zip(metadata.segments, blocks)):
            if segment.time_scale is TimeScale.UNKNOWN:
                raise EphemerisFormatError(
                    f"El segmento OEM {index} declara una escala temporal no soportada: "
                    f"{segment.time_scale_label}"
                )
            states = _oem_states_for_segment(
                segment,
                block,
                segment_index=index,
                oem_version=metadata.version,
            )
            covariance_records.append(
                _oem_covariances_for_segment(
                    segment,
                    block,
                    segment_index=index,
                    oem_version=metadata.version,
                )
            )
            providers.append(
                TabularStateProvider(
                    source_format="OEM",
                    samples=tuple(states),
                    declared_interpolation=segment.interpolation,
                    declared_interpolation_degree=segment.interpolation_degree,
                    frame_transformer=transformer,
                )
            )
        return cls(
            metadata=metadata,
            segment_providers=tuple(providers),
            covariance_records=tuple(covariance_records),
            frame_transformer=transformer,
        )

    @property
    def segment_count(self) -> int:
        return len(self.segment_providers)

    def segment(self, index: int) -> TabularStateProvider:
        """Return one OEM segment's tabulated native-state provider."""

        try:
            return self.segment_providers[index]
        except IndexError as exc:
            raise EphemerisFormatError(f"OEM no contiene el segmento {index}") from exc

    def native_state_at(
        self,
        instant: datetime.datetime,
        *,
        segment_index: int | None = None,
        time_scale: TimeScale | str = TimeScale.UTC,
    ) -> StateVector:
        """Sample one OEM segment in its source frame and source time scale."""

        selected_index = self._selected_segment_index(segment_index)
        state = self.segment_providers[selected_index].native_state_at(instant, time_scale=time_scale)
        return self._attach_covariance(state, selected_index)

    def state_at(
        self,
        instant: datetime.datetime,
        *,
        target_frame: FrameId | str = FrameId.ITRF,
        target_realization: str | None = None,
        segment_index: int | None = None,
        time_scale: TimeScale | str = TimeScale.UTC,
    ) -> StateVector:
        """Sample one segment and request an explicit target-frame view."""

        assert self.frame_transformer is not None
        return self.frame_transformer.transform(
            self.native_state_at(
                instant,
                segment_index=segment_index,
                time_scale=time_scale,
            ),
            target_frame=target_frame,
            target_realization=target_realization,
        )

    def _selected_segment_index(self, segment_index: int | None) -> int:
        if segment_index is None:
            if self.segment_count != 1:
                raise EphemerisFormatError(
                    "OEM contiene varios segmentos; selecciona segment_index para evitar mezclar metadata"
                )
            return 0
        try:
            self.segment_providers[segment_index]
        except (IndexError, TypeError) as exc:
            raise EphemerisFormatError(f"OEM no contiene el segmento {segment_index}") from exc
        return segment_index if segment_index >= 0 else self.segment_count + segment_index

    def covariances(self, *, segment_index: int | None = None) -> tuple[OemCovarianceRecord, ...]:
        """Return source-native OEM covariance records without relabelling them.

        With no segment selected all records are returned, each retaining its
        ``segment_index``.  This is read-only metadata access and does not
        interpolate or transform any covariance.
        """

        if segment_index is None:
            return tuple(record for group in self.covariance_records for record in group)
        return self.covariance_records[self._selected_segment_index(segment_index)]

    def _attach_covariance(self, state: StateVector, segment_index: int) -> StateVector:
        records = self.covariance_records[segment_index]
        record = next((item for item in records if item.epoch == state.epoch), None)
        provenance = dict(state.provenance)
        if record is None:
            if records:
                provenance["oem_covariance"] = {
                    "attached": False,
                    "reason": "OEM covariance matrices are retained only at their declared EPOCH",
                    "available_epochs": [item.epoch.isoformat() for item in records],
                }
                return replace(state, provenance=provenance)
            return state

        covariance, transformed = self._covariance_in_state_frame(record, state)
        provenance["oem_covariance"] = {
            "attached": True,
            "epoch": record.epoch.isoformat(),
            "declared_reference_frame": record.declared_reference_frame,
            "resolved_reference_frame": record.reference_frame.label,
            "state_reference_frame": state.frame_label,
            "transformed_to_state_frame": transformed,
            "comments": list(record.comments),
        }
        return replace(state, covariance=covariance, provenance=provenance)

    def _covariance_in_state_frame(
        self,
        record: OemCovarianceRecord,
        state: StateVector,
    ) -> tuple[_Matrix6, bool]:
        target_reference = ReferenceFrame(
            family=state.frame.value if isinstance(state.frame, FrameId) else state.frame,
            realization=state.frame_realization,
            label=state.frame_label,
        )
        if _same_reference_frame(record.reference_frame, target_reference):
            return record.covariance, False
        if record.reference_frame.family in _LOCAL_COVARIANCE_FRAMES:
            raise EphemerisFormatError(
                f"COV_REF_FRAME = {record.reference_frame.label} es un frame orbital local no implementado"
            )
        if (
            record.reference_frame.family == "ITRF"
            and record.reference_frame.realization is None
            and state.is_terrestrial
            and state.frame_realization is not None
        ):
            raise EphemerisFormatError(
                "No se puede relabelar una covarianza ITRF sin realización como una realización terrestre concreta"
            )
        if state.frame is FrameId.ITRF and state.frame_realization is None:
            raise EphemerisFormatError(
                "No se puede convertir una covarianza a ITRF sin una realización terrestre explícita"
            )
        assert self.frame_transformer is not None
        covariance_state = StateVector(
            epoch=record.epoch,
            time_scale=record.time_scale,
            frame=record.reference_frame.family,
            frame_realization=record.reference_frame.realization,
            center=state.center,
            position_m=(0.0, 0.0, 0.0),
            velocity_m_s=(0.0, 0.0, 0.0),
            covariance=record.covariance,
            provenance={
                "source_format": "OEM",
                "covariance_only": True,
                "covariance_reference_frame": record.reference_frame.label,
            },
        )
        try:
            transformed = self.frame_transformer.transform(
                covariance_state,
                target_frame=state.frame,
                target_realization=state.frame_realization,
            )
        except ValueError as exc:
            raise EphemerisFormatError(
                f"No se puede convertir COV_REF_FRAME = {record.reference_frame.label} "
                f"al frame del estado {state.frame_label}"
            ) from exc
        if transformed.covariance is None:  # Defensive: transformer must preserve a supplied matrix.
            raise EphemerisFormatError("La transformación de la covarianza OEM no devolvió una matriz")
        return transformed.covariance, True

    @property
    def dynamics_reference_frame(self) -> str:
        if self.segment_count != 1:
            return "MULTI_SEGMENT"
        return self.metadata.segments[0].reference_frame.family

    @property
    def dynamics_reference_realization(self) -> str | None:
        return self.metadata.segments[0].reference_frame.realization if self.segment_count == 1 else None

    @property
    def ephemeris_reference_frame(self) -> str:
        if self.segment_count != 1:
            return "MULTI_SEGMENT"
        return self.metadata.segments[0].reference_frame.label

    @property
    def ephemeris_reference_realization(self) -> str | None:
        return self.metadata.segments[0].reference_frame.realization if self.segment_count == 1 else None

    def propagate_datetime(
        self,
        instant: datetime.datetime,
        *,
        segment_index: int | None = None,
    ) -> tuple[float, float, float, float, float, float]:
        """Legacy ITRF component adapter for a selected OEM segment."""

        return self.state_at(instant, segment_index=segment_index).components()

    def propagate(self, *, segment_index: int | None = None) -> tuple[float, float, float, float, float, float]:
        return self.propagate_datetime(utc_now(), segment_index=segment_index)

    def propagate_offset(
        self,
        seconds: float,
        *,
        segment_index: int | None = None,
    ) -> tuple[float, float, float, float, float, float]:
        return self.propagate_datetime(
            utc_now() + datetime.timedelta(seconds=float(seconds)),
            segment_index=segment_index,
        )


def parse_oem_metadata(source: str | Iterable[str]) -> OemMetadata:
    """Parse an OEM header and every ``META_START``/``META_STOP`` block.

    State-vector lines are intentionally ignored.  A segment must declare both
    ``REF_FRAME`` and ``TIME_SYSTEM``: without them an OEM reader cannot safely
    decide whether a later transform is valid.
    """

    lines = _source_lines(source)
    global_fields: dict[str, str] = {}
    global_comments: list[str] = []
    global_extensions: list[tuple[str, str]] = []
    segment_fields: dict[str, str] | None = None
    segment_comments: list[str] = []
    segment_extensions: list[tuple[str, str]] = []
    segments: list[OemSegmentMetadata] = []
    inside_covariance = False

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        if line == "COVARIANCE_START":
            inside_covariance = True
            continue
        if line == "COVARIANCE_STOP":
            inside_covariance = False
            continue
        if inside_covariance:
            # Covariance is parsed/rejected by the state adapter. Header
            # parsing must not mistake COV_REF_FRAME/EPOCH for global OEM
            # metadata after META_STOP.
            continue
        if line == "META_START":
            if segment_fields is not None:
                raise EphemerisFormatError("OEM contiene META_START anidado")
            segment_fields = {}
            segment_comments = []
            segment_extensions = []
            continue
        if line == "META_STOP":
            if segment_fields is None:
                raise EphemerisFormatError("OEM contiene META_STOP sin META_START")
            segments.append(_segment_metadata(segment_fields, segment_comments, segment_extensions))
            segment_fields = None
            continue
        if line == "COMMENT" or line.startswith("COMMENT ") or line.startswith("COMMENT="):
            comment = _comment_text(line)
            if segment_fields is None:
                global_comments.append(comment)
            else:
                segment_comments.append(comment)
            continue
        if "=" not in line:
            # Once metadata has ended, remaining non-key/value lines are OEM
            # state/covariance records and are deliberately outside this reader.
            continue

        key, value = _key_value(line)
        if segment_fields is None:
            _store_field(global_fields, key, value)
            if key not in {"CCSDS_OEM_VERS", "CREATION_DATE", "ORIGINATOR"}:
                global_extensions.append((key, value))
        else:
            _store_field(segment_fields, key, value)
            if key not in _SEGMENT_FIELDS:
                segment_extensions.append((key, value))

    if segment_fields is not None:
        raise EphemerisFormatError("OEM termina antes de META_STOP")
    if inside_covariance:
        raise EphemerisFormatError("OEM termina antes de COVARIANCE_STOP")

    version = global_fields.get("CCSDS_OEM_VERS")
    if version is None:
        raise EphemerisFormatError("OEM no declara CCSDS_OEM_VERS")
    if not segments:
        raise EphemerisFormatError("OEM no contiene ningún bloque META_START")

    return OemMetadata(
        version=version,
        creation_date=global_fields.get("CREATION_DATE"),
        originator=global_fields.get("ORIGINATOR"),
        comments=tuple(global_comments),
        segments=tuple(segments),
        extensions=tuple(global_extensions),
    )


def parse_oem_state_provider(
    source: str | Iterable[str],
    *,
    frame_transformer: FrameTransformService | None = None,
) -> OemStateProvider:
    """Convenience entry point for a segment-aware tabulated OEM source."""

    return OemStateProvider.from_text(source, frame_transformer=frame_transformer)


def _source_lines(source: str | Iterable[str]) -> tuple[str, ...]:
    if isinstance(source, str):
        lines = source.lstrip("\ufeff").splitlines()
    else:
        try:
            lines = [str(line).rstrip("\r\n") for line in source]
        except TypeError as exc:
            raise EphemerisFormatError("El contenido OEM debe ser texto o líneas de texto") from exc
    if not lines:
        raise EphemerisFormatError("El contenido OEM está vacío")
    return tuple(lines)


def _comment_text(line: str) -> str:
    if "=" in line:
        _key, value = _key_value(line)
        return value
    return line[len("COMMENT"):].strip()


def _key_value(line: str) -> tuple[str, str]:
    key, value = line.split("=", 1)
    normalized_key = key.strip().upper()
    normalized_value = value.strip()
    if not normalized_key or not normalized_value:
        raise EphemerisFormatError("La línea de metadatos OEM debe tener KEY = VALUE")
    return normalized_key, normalized_value


def _store_field(fields: dict[str, str], key: str, value: str) -> None:
    if key in fields:
        raise EphemerisFormatError(f"El metadato OEM {key} está repetido")
    fields[key] = value


def _segment_metadata(
    fields: dict[str, str],
    comments: list[str],
    extensions: list[tuple[str, str]],
) -> OemSegmentMetadata:
    frame_label = fields.get("REF_FRAME")
    time_scale_label = fields.get("TIME_SYSTEM")
    if frame_label is None:
        raise EphemerisFormatError("El segmento OEM no declara REF_FRAME")
    if time_scale_label is None:
        raise EphemerisFormatError("El segmento OEM no declara TIME_SYSTEM")

    interpolation = str(fields.get("INTERPOLATION") or "").strip().upper() or None
    interpolation_degree = _interpolation_degree(fields.get("INTERPOLATION_DEGREE"))
    _validate_oem_interpolation(interpolation, interpolation_degree)
    return OemSegmentMetadata(
        object_name=fields.get("OBJECT_NAME"),
        object_id=fields.get("OBJECT_ID"),
        center_name=fields.get("CENTER_NAME"),
        reference_frame=parse_reference_frame(frame_label),
        time_scale=TimeScale.from_label(time_scale_label),
        time_scale_label=time_scale_label.strip().upper(),
        start_time=fields.get("START_TIME"),
        stop_time=fields.get("STOP_TIME"),
        usable_start_time=fields.get("USEABLE_START_TIME"),
        usable_stop_time=fields.get("USEABLE_STOP_TIME"),
        interpolation=interpolation,
        interpolation_degree=interpolation_degree,
        comments=tuple(comments),
        extensions=tuple(extensions),
    )


def _interpolation_degree(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        degree = int(value)
    except ValueError as exc:
        raise EphemerisFormatError("INTERPOLATION_DEGREE debe ser un entero") from exc
    if degree < 0:
        raise EphemerisFormatError("INTERPOLATION_DEGREE no puede ser negativo")
    return degree


def _validate_oem_interpolation(method: str | None, degree: int | None) -> None:
    if method is None:
        if degree is not None:
            raise EphemerisFormatError("INTERPOLATION_DEGREE requiere declarar INTERPOLATION")
        return
    if method not in {"LINEAR", "LAGRANGE", "HERMITE"}:
        raise EphemerisFormatError(f"INTERPOLATION = {method} no está soportada por Orbit")
    if degree is None:
        raise EphemerisFormatError("INTERPOLATION_DEGREE es obligatorio cuando se declara INTERPOLATION")
    if method == "LINEAR" and degree != 1:
        raise EphemerisFormatError("INTERPOLATION = LINEAR requiere INTERPOLATION_DEGREE = 1")
    if method in {"LAGRANGE", "HERMITE"} and degree < 1:
        raise EphemerisFormatError(f"INTERPOLATION = {method} requiere un grado mayor o igual que 1")
    if method == "HERMITE" and degree % 2 == 0:
        raise EphemerisFormatError(
            "INTERPOLATION = HERMITE requiere un grado impar para datos posición/velocidad"
        )


def _oem_state_blocks(lines: tuple[str, ...]) -> tuple[tuple[str, ...], ...]:
    """Associate raw data lines with the metadata segment that precedes them."""

    blocks: list[list[str]] = []
    collecting = False
    for raw_line in lines:
        line = raw_line.strip()
        if line == "META_START":
            collecting = False
            continue
        if line == "META_STOP":
            blocks.append([])
            collecting = True
            continue
        if collecting:
            blocks[-1].append(raw_line)
    return tuple(tuple(block) for block in blocks)


def _oem_states_for_segment(
    segment: OemSegmentMetadata,
    block: tuple[str, ...],
    *,
    segment_index: int,
    oem_version: str,
) -> list[StateVector]:
    states: list[StateVector] = []
    for raw_line in block:
        line = raw_line.strip()
        if not line or not _looks_like_oem_epoch(line):
            continue
        fields = line.split()
        if len(fields) not in {7, 10}:
            raise EphemerisFormatError(
                "Una línea de estado OEM debe contener época, posición XYZ y velocidad XYZ; "
                "la aceleración, si existe, debe incluir sus tres componentes"
            )
        epoch = _parse_oem_epoch(fields[0])
        try:
            position_km = tuple(float(component) for component in fields[1:4])
            velocity_km_s = tuple(float(component) for component in fields[4:7])
            acceleration_km_s2 = tuple(float(component) for component in fields[7:10]) if len(fields) == 10 else None
        except ValueError as exc:
            raise EphemerisFormatError("Una línea de estado OEM contiene componentes no numéricos") from exc
        if acceleration_km_s2 is not None and not _oem_version_supports_acceleration(oem_version):
            raise EphemerisFormatError("Las aceleraciones OEM requieren CCSDS_OEM_VERS = 2.0 o posterior")
        states.append(
            StateVector.from_kilometres(
                epoch=source_epoch(epoch),
                time_scale=segment.time_scale,
                frame=segment.reference_frame.family,
                frame_realization=segment.reference_frame.realization,
                center=segment.center_name or "EARTH",
                position_km=position_km,
                velocity_km_s=velocity_km_s,
                acceleration_m_s2=(
                    tuple(component * 1_000.0 for component in acceleration_km_s2)
                    if acceleration_km_s2 is not None
                    else None
                ),
                provenance={
                    "source_format": "OEM",
                    "segment_index": segment_index,
                    "object_id": segment.object_id,
                    "reference_frame": segment.reference_frame.label,
                    "time_system": segment.time_scale_label,
                    "declared_interpolation": segment.interpolation,
                    "declared_interpolation_degree": segment.interpolation_degree,
                },
            )
        )
    if not states:
        raise EphemerisFormatError(f"El segmento OEM {segment_index} no contiene estados utilizables")
    return states


def _oem_covariances_for_segment(
    segment: OemSegmentMetadata,
    block: tuple[str, ...],
    *,
    segment_index: int,
    oem_version: str,
) -> tuple[OemCovarianceRecord, ...]:
    """Parse OEM covariance records without treating them as state samples.

    A covariance block can contain several lower-triangular 6x6 matrices. The
    records stay in their declared frame and time scale; attachment to a state
    is handled later only at the same EPOCH.
    """

    records: list[OemCovarianceRecord] = []
    inside = False
    records_at_section_start = 0
    active_epoch: datetime.datetime | None = None
    active_reference_label: str | None = None
    active_rows: list[tuple[float, ...]] = []
    active_comments: list[str] = []

    def finish_active() -> None:
        nonlocal active_epoch, active_reference_label, active_rows, active_comments
        if active_epoch is None:
            return
        if len(active_rows) != 6:
            raise EphemerisFormatError(
                "Cada covarianza OEM debe contener las seis filas triangulares después de EPOCH"
            )
        for row_index, row in enumerate(active_rows):
            expected = row_index + 1
            if len(row) != expected:
                raise EphemerisFormatError(
                    f"La fila {row_index + 1} de una covarianza OEM debe contener {expected} valores"
                )
        reference = parse_reference_frame(active_reference_label or segment.reference_frame.label)
        if reference.family in _LOCAL_COVARIANCE_FRAMES:
            raise EphemerisFormatError(
                f"COV_REF_FRAME = {reference.label} es un frame orbital local no implementado"
            )
        if (
            not _same_reference_frame(reference, segment.reference_frame)
            and reference.family not in _CARTESIAN_COVARIANCE_FRAMES
        ):
            raise EphemerisFormatError(
                f"COV_REF_FRAME = {reference.label} no es un frame cartesiano convertible por Orbit"
            )
        if not _oem_version_supports_covariance(oem_version):
            raise EphemerisFormatError("Las covarianzas OEM requieren CCSDS_OEM_VERS = 2.0 o posterior")
        records.append(
            OemCovarianceRecord(
                segment_index=segment_index,
                epoch=source_epoch(active_epoch),
                time_scale=segment.time_scale,
                reference_frame=reference,
                declared_reference_frame=active_reference_label,
                covariance=_lower_triangular_km_to_si(active_rows),
                comments=tuple(active_comments),
            )
        )
        active_epoch = None
        active_reference_label = None
        active_rows = []
        active_comments = []

    for raw_line in block:
        line = raw_line.strip()
        if not line:
            continue
        if line == "COVARIANCE_START":
            if inside:
                raise EphemerisFormatError("OEM contiene COVARIANCE_START anidado")
            if not _oem_version_supports_covariance(oem_version):
                raise EphemerisFormatError("Las covarianzas OEM requieren CCSDS_OEM_VERS = 2.0 o posterior")
            inside = True
            records_at_section_start = len(records)
            continue
        if line == "COVARIANCE_STOP":
            if not inside:
                raise EphemerisFormatError("OEM contiene COVARIANCE_STOP sin COVARIANCE_START")
            finish_active()
            if len(records) == records_at_section_start:
                raise EphemerisFormatError("COVARIANCE_START debe contener al menos una matriz OEM")
            inside = False
            continue
        if not inside:
            continue
        if line == "COMMENT" or line.startswith("COMMENT ") or line.startswith("COMMENT="):
            active_comments.append(_comment_text(line))
            continue
        if "=" in line:
            key, value = _key_value(line)
            if key == "EPOCH":
                finish_active()
                active_epoch = _parse_oem_epoch(value)
                continue
            if key == "COV_REF_FRAME":
                if active_epoch is None:
                    raise EphemerisFormatError("COV_REF_FRAME debe aparecer después de EPOCH")
                if active_rows:
                    raise EphemerisFormatError("COV_REF_FRAME debe aparecer antes de la matriz OEM")
                if active_reference_label is not None:
                    raise EphemerisFormatError("COV_REF_FRAME está repetido en una covarianza OEM")
                active_reference_label = value.strip().upper()
                continue
            raise EphemerisFormatError(f"El campo de covarianza OEM {key} no está soportado")
        if active_epoch is None:
            raise EphemerisFormatError("La matriz de covarianza OEM requiere EPOCH antes de sus filas")
        try:
            row = tuple(float(component) for component in line.split())
        except ValueError as exc:
            raise EphemerisFormatError("Una fila de covarianza OEM contiene valores no numéricos") from exc
        if len(active_rows) >= 6:
            raise EphemerisFormatError("Una covarianza OEM contiene más de seis filas")
        expected = len(active_rows) + 1
        if len(row) != expected:
            raise EphemerisFormatError(
                f"La fila {expected} de una covarianza OEM debe contener {expected} valores"
            )
        active_rows.append(row)

    if inside:
        raise EphemerisFormatError("OEM termina antes de COVARIANCE_STOP")
    if active_epoch is not None:
        # ``finish_active`` normally resets it at COVARIANCE_STOP. This
        # branch makes a malformed raw block fail even if callers bypass the
        # metadata parser.
        raise EphemerisFormatError("OEM termina antes de cerrar una matriz de covarianza")
    epochs = tuple(record.epoch for record in records)
    if any(right <= left for left, right in zip(epochs, epochs[1:])):
        raise EphemerisFormatError("Las covarianzas OEM deben estar ordenadas por EPOCH sin duplicados")
    return tuple(records)


def _lower_triangular_km_to_si(rows: list[tuple[float, ...]]) -> _Matrix6:
    matrix = [[0.0 for _ in range(6)] for _ in range(6)]
    for row_index, row in enumerate(rows):
        for column_index, value in enumerate(row):
            if not math.isfinite(value):
                raise EphemerisFormatError("La covarianza OEM debe contener valores finitos")
            converted = value * 1_000_000.0
            matrix[row_index][column_index] = converted
            matrix[column_index][row_index] = converted
    return tuple(tuple(row) for row in matrix)  # type: ignore[return-value]


def _same_reference_frame(left: ReferenceFrame, right: ReferenceFrame) -> bool:
    return left.family == right.family and left.realization == right.realization


def _oem_version_supports_acceleration(version: str) -> bool:
    return _oem_major_version(version) >= 2


def _oem_version_supports_covariance(version: str) -> bool:
    return _oem_major_version(version) >= 2


def _oem_major_version(version: str) -> int:
    try:
        return int(str(version).strip().split(".", 1)[0])
    except ValueError as exc:
        raise EphemerisFormatError("CCSDS_OEM_VERS no es una versión válida") from exc


def _looks_like_oem_epoch(line: str) -> bool:
    return bool(_OEM_CALENDAR_EPOCH.match(line))


def _parse_oem_epoch(value: str) -> datetime.datetime:
    """Parse calendar or year/day-of-year CCSDS epochs without guessing scale."""

    normalized = value.strip()
    day_of_year_match = re.match(r"^(\d{4})-(\d{3})T(.+)$", normalized)
    if day_of_year_match is not None:
        year, day_of_year, time_part = day_of_year_match.groups()
        try:
            date = datetime.datetime(int(year), 1, 1) + datetime.timedelta(days=int(day_of_year) - 1)
        except ValueError as exc:
            raise EphemerisFormatError("La época OEM de día del año no es válida") from exc
        normalized = f"{date.date().isoformat()}T{time_part}"
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"
    try:
        epoch = datetime.datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise EphemerisFormatError("La época OEM no es válida") from exc
    return epoch
