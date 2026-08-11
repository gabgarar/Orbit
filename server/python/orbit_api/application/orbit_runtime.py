"""Stateful application service coordinating catalogues and orbital propagation."""

from __future__ import annotations

import datetime
import hashlib
import json
import threading
from collections.abc import Mapping
from dataclasses import replace

from fastapi import HTTPException

from orbit_api.application.precise_products import (
    PreciseProduct,
    PreciseProductImportError,
    PreciseProductRepository,
    import_precise_product,
)
from orbit_api.catalog.repository import find_entry, load_entries
from orbit_api.catalog.tle_loader import load_all_tles_from_config
from orbit_api.formats import EphemerisFormatError
from orbit_api.frames import FrameId, FrameTransformService, StateVector
from orbit_api.core.settings import (
    AUTO_MAX_ORBIT_SAMPLES, AUTO_MIN_ORBIT_SAMPLES, CONFIG_DIR,
    EPHEMERIS_CACHE_TTL_SECONDS, MAX_EPHEMERIS_CACHE_ITEMS, MAX_EPHEMERIS_POINTS,
    MAX_TOTAL_ORBIT_POINTS_PER_BATCH, ORBIT_CACHE_TTL_SECONDS, PRECISE_PRODUCTS_DIR, SYSTEM_CONFIG_PATH,
)
from orbit_api.frames.transforms import FrameTransformationError
from orbit_api.core.system_config import clamp_propagation_hours, load_system_config
from orbit_api.infrastructure.ttl_cache import TtlLruCache
from orbit_api.orbits.propagators import OrbitPropagator, build_default_registry
from orbit_api.orbits.sampling import compute_auto_samples
from orbit_api.timekeeping import ensure_utc, utc_now


class OrbitRuntime:
    """Own the mutable runtime state required by API route adapters."""

    def __init__(
        self,
        frame_transformer: FrameTransformService | None = None,
        *,
        precise_products_dir=None,
    ) -> None:
        self._lock = threading.Lock()
        self._propagators: list[tuple[str, OrbitPropagator]] = []
        self._propagators_by_name: dict[str, OrbitPropagator] = {}
        self._system_config: dict = {}
        self._orbit_point_cache: dict = {}
        self._orbit_cache_payload: list = []
        self._orbit_cache_key = None
        self._orbit_cache_valid_until = datetime.datetime.min.replace(tzinfo=datetime.UTC)
        self._runtime_config_mtime = None
        self._runtime_propagation_hours = 12.0
        self._ephemeris_cache = TtlLruCache(MAX_EPHEMERIS_CACHE_ITEMS, EPHEMERIS_CACHE_TTL_SECONDS)
        self._frame_transformer = frame_transformer or FrameTransformService()
        self._propagator_registry = build_default_registry(self._frame_transformer)
        self._precise_product_repository = PreciseProductRepository(
            precise_products_dir or PRECISE_PRODUCTS_DIR
        )
        self._precise_products_by_id: dict[str, PreciseProduct] = {}
        self._precise_product_diagnostics: tuple[str, ...] = ()

    @property
    def frame_transformer(self) -> FrameTransformService:
        """The shared EOP/frame service used by runtime-created propagators."""

        return self._frame_transformer

    @staticmethod
    def ensure_utc(value: datetime.datetime) -> datetime.datetime:
        """Compatibility adapter for the independent UTC boundary."""
        return ensure_utc(value)

    def serialize_state(
        self,
        name: str,
        moment: datetime.datetime,
        x=None,
        y=None,
        z=None,
        vx=None,
        vy=None,
        vz=None,
        include_velocity: bool = True,
        eci_state_km: tuple[float, float, float, float, float, float] | None = None,
        *,
        state: StateVector | None = None,
        native_state: StateVector | None = None,
        native_reference: dict | None = None,
    ) -> dict:
        """Serialize an explicit state while retaining legacy scalar support.

        New callers pass ``state`` and, optionally, ``native_state``. The
        scalar path is retained for third-party propagators until they adopt
        ``state_at``; it is labelled as a legacy ITRF compatibility view.
        """

        utc = self.ensure_utc(moment)
        if state is None:
            if any(value is None for value in (x, y, z, vx, vy, vz)):
                raise ValueError("Un estado serializado requiere seis componentes o un StateVector")
            state = StateVector(
                epoch=utc,
                time_scale="UTC",
                frame=FrameId.ITRF,
                frame_realization=None,
                center="EARTH",
                position_m=(float(x), float(y), float(z)),
                velocity_m_s=(float(vx), float(vy), float(vz)),
                provenance={"compatibility": "legacy tuple propagator"},
            )
        payload = {
            "satellite": name,
            "time": utc.isoformat(),
            **self._state_payload(state, include_velocity=include_velocity),
        }
        if native_state is None and eci_state_km is not None:
            native_state = StateVector.from_kilometres(
                epoch=utc,
                time_scale="UTC",
                frame=FrameId.EME2000,
                frame_realization=None,
                center="EARTH",
                position_km=eci_state_km[:3],
                velocity_km_s=eci_state_km[3:],
                provenance={"compatibility": "legacy eci tuple; interpreted as EME2000"},
            )
        if native_state is not None:
            native_payload = self._state_payload(native_state, include_velocity=include_velocity)
            payload["native_state"] = native_payload
            native_reference = self._reference_metadata(native_state)
            # Existing visual editor code reads ``point.eci``. Preserve that
            # field temporarily, but make its true EME2000 label explicit.
            if native_state.frame in {FrameId.EME2000, FrameId.GCRF, FrameId.ICRF}:
                payload["eci"] = {**native_payload, "legacy_field": True}
        if native_reference is not None:
            payload["native_reference_frame"] = native_reference["reference_frame"]
            payload["native_frame"] = {
                **native_reference["frame"],
                "time_scale": native_reference["time_scale"],
            }
        payload["renderer_reference"] = self._renderer_reference_metadata(
            state,
            native_reference=native_reference,
        )
        return payload

    @staticmethod
    def _reference_metadata(state: StateVector) -> dict:
        """Return the declared frame/time identity without coordinates.

        This deliberately reports the source realization (for example
        ``IGS20``) rather than a renderer preference.  It is used alongside
        coordinate payloads so clients can distinguish native input from a
        later display transformation.
        """

        frame_name = state.frame.value if isinstance(state.frame, FrameId) else state.frame
        return {
            "reference_frame": state.frame_label,
            "frame": {
                "name": frame_name,
                "realization": state.frame_realization,
                "center": state.center,
            },
            "time_scale": state.time_scale.value,
        }

    @staticmethod
    def _native_reference_metadata_for_propagator(propagator: OrbitPropagator) -> dict | None:
        """Describe a provider's native frame without forcing a state sample.

        Position-only AOS/LOS sampling intentionally avoids a second native
        state evaluation.  Tabular providers still expose their source
        contract through ``dynamics_reference_*`` and ``native_time_scale``;
        preserve that metadata instead of calling the renderer target ITRF.
        """

        raw_frame = getattr(propagator, "dynamics_reference_frame", None)
        if raw_frame is None:
            return None
        frame_name = raw_frame.value if isinstance(raw_frame, FrameId) else str(raw_frame).strip().upper()
        if not frame_name:
            return None
        realization = getattr(propagator, "dynamics_reference_realization", None)
        realization = str(realization).strip().upper() if realization is not None else None
        if not realization:
            realization = None
        time_scale = getattr(propagator, "native_time_scale", None)
        if hasattr(time_scale, "value"):
            time_scale = time_scale.value
        elif time_scale is not None:
            time_scale = str(time_scale).strip().upper() or None
        return {
            "reference_frame": realization or frame_name,
            "frame": {
                "name": frame_name,
                "realization": realization,
                "center": "EARTH",
            },
            "time_scale": time_scale,
        }

    @staticmethod
    def _renderer_reference_metadata(
        state: StateVector,
        *,
        native_reference: dict | None = None,
    ) -> dict:
        """Qualify an Earth-fixed renderer state without changing its vectors.

        ``reference_frame`` remains the frame of the returned coordinates for
        compatibility with Cesium and existing clients.  The sibling
        ``renderer_reference`` is the canonical semantic contract: a visual
        UTC~UT1 / zero-polar-motion transformation is explicitly an
        *approximate Earth-fixed* view, not a rigorous ITRF realization.
        """

        renderer = OrbitRuntime._reference_metadata(state)
        operation = state.provenance.get("terrestrial_realization_transform")
        operation_payload = dict(operation) if isinstance(operation, Mapping) else None
        eop_applied = state.earth_orientation_source is not None
        eop_quality = state.earth_orientation_quality
        approximate_eop = str(eop_quality or "").strip().lower() in {
            "approximate",
            "extrapolated",
        }
        earth_orientation = {
            "required": eop_applied,
            "applied": eop_applied,
            "source": state.earth_orientation_source,
            "version": state.earth_orientation_version,
            "quality": eop_quality,
            "snapshot_id": state.earth_orientation_snapshot_id,
        }
        same_native_frame = bool(
            native_reference
            and native_reference.get("reference_frame") == renderer["reference_frame"]
            and native_reference.get("frame") == renderer["frame"]
        )
        compatibility = state.provenance.get("compatibility")
        # A visual EOP marker wins even if a provider happens to return the
        # same nominal frame label as its source. The state was still born
        # from UTC~UT1 / zero-polar-motion orientation data and must not be
        # presented as a rigorous ITRF realization.
        if eop_applied and approximate_eop:
            status = "approximate_earth_fixed"
            display_label = "Earth-fixed (visual approximation)"
            reason = (
                "UTC~UT1 and zero polar motion were used for a visual Earth-fixed view; "
                "this is not a rigorous ITRF realization."
            )
        elif same_native_frame:
            status = "native"
            display_label = renderer["reference_frame"]
            reason = "The returned coordinates are in the source-native frame; no renderer transformation was applied."
        elif operation_payload is not None:
            status = "terrestrial_realization_transform"
            display_label = renderer["reference_frame"]
            reason = "A registered terrestrial-realization operation produced the renderer coordinates."
        elif eop_applied:
            status = "earth_orientation_transform"
            display_label = renderer["reference_frame"]
            reason = "The renderer coordinates were transformed with the declared Earth-orientation data."
        elif compatibility is not None:
            status = "legacy_compatibility"
            display_label = "Earth-fixed compatibility view"
            reason = "The legacy provider did not declare a native frame or a renderer transformation."
        else:
            status = "transformed"
            display_label = renderer["reference_frame"]
            reason = "The renderer coordinates were produced by the selected state provider."
        payload = {
            "available": True,
            "requested_frame": "ITRF",
            "target_frame": "ITRF",
            "target_realization": renderer["frame"]["realization"],
            "reference_frame": renderer["reference_frame"],
            "frame": renderer["frame"],
            "status": status,
            "display_label": display_label,
            "reason": reason,
            "earth_orientation": earth_orientation,
            "terrestrial_realization_operation": operation_payload,
        }
        # Product-bound SP3 states carry an explicit marker installed by the
        # precise GNSS importer.  A generic renderer otherwise sees an ITRF
        # coordinate vector and would incorrectly present it as a fully
        # transformable ITRF product even when its ERP companion is absent.
        precise_contract = state.provenance.get("precise_gnss_frame_contract")
        if isinstance(precise_contract, Mapping):
            erp_present = bool(precise_contract.get("erp_present"))
            route_available = bool(precise_contract.get("eci_route_available"))
            within_coverage = bool(
                precise_contract.get("eci_available_within_erp_coverage")
            )
            conversion = {
                "required": True,
                "available": bool(precise_contract.get("eci_available")),
                "route_available": route_available,
                "available_within_erp_coverage": within_coverage,
                "target_frame": precise_contract.get("eci_target_frame", "EME2000"),
                "erp_applied": route_available and within_coverage,
                "coverage": (
                    dict(precise_contract["eci_coverage"])
                    if isinstance(precise_contract.get("eci_coverage"), Mapping)
                    else None
                ),
                "reason": precise_contract.get("eci_reason")
                or "Debe proporcionar un fichero ERP para convertir a ECI.",
            }
            payload["eci_conversion"] = conversion
            payload["earth_orientation"] = {
                "required": True,
                "applied": route_available and within_coverage,
                "source": precise_contract.get("erp_source"),
                "version": precise_contract.get("erp_version"),
                "quality": precise_contract.get("erp_quality"),
                "snapshot_id": precise_contract.get("erp_snapshot_id"),
            }
            if not erp_present:
                payload.update({
                    "status": "approximate_earth_fixed",
                    "display_label": "Marco terrestre aproximado (sin ERP)",
                    "reason": "Debe proporcionar un fichero ERP para convertir a ECI.",
                })
            elif route_available and within_coverage:
                payload.update({
                    "status": "earth_orientation_transform",
                    "display_label": "ITRF (con ERP aplicado)",
                    "reason": str(conversion["reason"]),
                })
        if native_reference is not None:
            payload["native_reference_frame"] = native_reference["reference_frame"]
            payload["source_frame"] = native_reference["reference_frame"]
            payload["native_frame"] = {
                **native_reference["frame"],
                "time_scale": native_reference["time_scale"],
            }
        return payload

    @staticmethod
    def _unavailable_renderer_reference(
        detail: object,
        *,
        native_reference: dict | None = None,
    ) -> dict:
        """Return the same frame contract when no Earth-fixed view exists."""

        payload = {
            "available": False,
            "requested_frame": "ITRF",
            "target_frame": "ITRF",
            "target_realization": None,
            "reference_frame": None,
            "frame": None,
            "status": "unavailable",
            "display_label": "Renderer unavailable",
            "reason": str(detail),
            "earth_orientation": {
                "required": None,
                "applied": False,
                "source": None,
                "version": None,
                "quality": None,
                "snapshot_id": None,
            },
            "terrestrial_realization_operation": None,
        }
        if native_reference is not None:
            payload["native_reference_frame"] = native_reference["reference_frame"]
            payload["source_frame"] = native_reference["reference_frame"]
            payload["native_frame"] = {
                **native_reference["frame"],
                "time_scale": native_reference["time_scale"],
            }
        return payload

    @staticmethod
    def _state_payload(state: StateVector, *, include_velocity: bool) -> dict:
        frame_name = state.frame.value if isinstance(state.frame, FrameId) else state.frame
        payload = {
            "reference_frame": state.frame_label,
            "frame": {
                "name": frame_name,
                "realization": state.frame_realization,
                "center": state.center,
            },
            # ``time`` at the outer payload level is always the UTC request
            # instant for UI/timeline compatibility. This field is the native
            # state epoch, expressed in the scale declared immediately below
            # (for example a GPS SP3 record).
            "epoch": state.epoch.isoformat(),
            "time_scale": state.time_scale.value,
            "position_units": "m",
            "velocity_units": "m/s",
            "position": {"x": state.position_m[0], "y": state.position_m[1], "z": state.position_m[2]},
        }
        if include_velocity and state.velocity_m_s is not None:
            payload["velocity"] = {
                "x": state.velocity_m_s[0],
                "y": state.velocity_m_s[1],
                "z": state.velocity_m_s[2],
            }
        if state.earth_orientation_source is not None:
            payload["earth_orientation"] = {
                "source": state.earth_orientation_source,
                "version": state.earth_orientation_version,
                "quality": state.earth_orientation_quality,
            }
            if state.earth_orientation_snapshot_id is not None:
                payload["earth_orientation"]["snapshot_id"] = state.earth_orientation_snapshot_id
        if state.transform_path:
            payload["transform_path"] = list(state.transform_path)
        return payload

    def renderer_state_at(self, propagator: OrbitPropagator, moment: datetime.datetime) -> StateVector:
        """Return the common ITRF renderer view for any propagator.

        Native-state providers use their own source frame and the shared
        transformer. Older tuple providers remain usable during migration and
        are explicitly marked as compatibility output.
        """

        utc = self.ensure_utc(moment)
        provider = getattr(propagator, "state_at", None)
        if callable(provider):
            result = provider(utc, target_frame=FrameId.ITRF)
            if isinstance(result, StateVector):
                return result
            raise ValueError("state_at debe devolver un StateVector")
        x, y, z, vx, vy, vz = propagator.propagate_datetime(utc)
        return StateVector(
            epoch=utc,
            time_scale="UTC",
            frame=FrameId.ITRF,
            frame_realization=None,
            center="EARTH",
            position_m=(float(x), float(y), float(z)),
            velocity_m_s=(float(vx), float(vy), float(vz)),
            provenance={"compatibility": "legacy tuple propagator"},
        )

    def renderer_position_at(self, propagator: OrbitPropagator, moment: datetime.datetime) -> StateVector:
        """Return the common ITRF renderer position without velocity work.

        Access-window planning needs only a terrestrial position.  Calling a
        normal ``state_at`` implementation for every sample also transforms
        velocity, which makes :class:`FrameTransformService` evaluate matrix
        derivatives that AOS/LOS never consumes.  Prefer a propagator's
        dedicated position adapter when it has one (SGP4 uses this to retain
        its legacy DUT1 override).  Otherwise transform its native state with
        velocity, acceleration and covariance deliberately removed.

        The returned ITRF *position* is the same frame transformation used by
        the normal renderer path; only unneeded derivatives are skipped.
        """

        utc = self.ensure_utc(moment)
        position_provider = getattr(propagator, "position_at", None)
        if callable(position_provider):
            result = position_provider(utc, target_frame=FrameId.ITRF)
            if not isinstance(result, StateVector):
                raise ValueError("position_at debe devolver un StateVector")
            return result if result.velocity_m_s is None else replace(
                result,
                velocity_m_s=None,
                acceleration_m_s2=None,
                covariance=None,
            )

        native_provider = getattr(propagator, "native_state_at", None)
        if callable(native_provider):
            native_state = native_provider(utc)
            if not isinstance(native_state, StateVector):
                raise ValueError("native_state_at debe devolver un StateVector")
            transformer = getattr(propagator, "frame_transformer", None)
            if not isinstance(transformer, FrameTransformService):
                transformer = self._frame_transformer
            return transformer.transform(
                replace(
                    native_state,
                    velocity_m_s=None,
                    acceleration_m_s2=None,
                    covariance=None,
                ),
                target_frame=FrameId.ITRF,
            )

        # Legacy tuple providers cannot avoid producing six components, but
        # the public access ephemeris still remains position-only.
        x, y, z, _vx, _vy, _vz = propagator.propagate_datetime(utc)
        return StateVector(
            epoch=utc,
            time_scale="UTC",
            frame=FrameId.ITRF,
            frame_realization=None,
            center="EARTH",
            position_m=(float(x), float(y), float(z)),
            provenance={"compatibility": "legacy tuple propagator"},
        )

    def native_state_at(self, propagator: OrbitPropagator, moment: datetime.datetime) -> StateVector | None:
        """Return a propagator's declared native state when it exposes one."""

        utc = self.ensure_utc(moment)
        provider = getattr(propagator, "native_state_at", None)
        if callable(provider):
            result = provider(utc)
            if not isinstance(result, StateVector):
                raise ValueError("native_state_at debe devolver un StateVector")
            return result
        legacy = getattr(propagator, "propagate_eme2000_datetime", None)
        if not callable(legacy):
            legacy = getattr(propagator, "propagate_eci_datetime", None)
        if not callable(legacy):
            return None
        x, y, z, vx, vy, vz = legacy(utc)
        return StateVector.from_kilometres(
            epoch=utc,
            time_scale="UTC",
            frame=FrameId.EME2000,
            frame_realization=None,
            center="EARTH",
            position_km=(x, y, z),
            velocity_km_s=(vx, vy, vz),
            provenance={"compatibility": "legacy ECI tuple; interpreted as EME2000"},
        )

    def get_state_snapshot(self) -> tuple[list, dict, dict]:
        with self._lock:
            return list(self._propagators), dict(self._system_config), dict(self._propagators_by_name)

    def import_precise_product(
        self,
        files,
        *,
        require_eci: bool = False,
    ) -> PreciseProduct:
        """Persist and register a local SP3/CLK precise product.

        The source is written to the mounted configuration volume before it
        becomes visible to callers.  A browser refresh or container restart
        can therefore reconstruct the same runtime IDs from checksummed input
        rather than leaving project layers dangling.
        """

        product = import_precise_product(
            files,
            require_eci=require_eci,
            frame_transformer=self._frame_transformer,
        )
        self._precise_product_repository.save(product)
        with self._lock:
            products = dict(self._precise_products_by_id)
            products[product.product_id] = product
            self._set_precise_products_locked(products)
        return product

    def precise_products_payload(self) -> dict:
        """Return persisted precise products and registered satellite entries."""

        with self._lock:
            products = tuple(self._precise_products_by_id.values())
            diagnostics = self._precise_product_diagnostics
        return {
            "items": [
                {
                    "product": product.payload(),
                    "satellites": [
                        product.satellite_payload(identifier)
                        for identifier in product.satellite_ids
                    ],
                    "importedIds": [product.runtime_id(identifier) for identifier in product.satellite_ids],
                }
                for product in products
            ],
            "diagnostics": list(diagnostics),
        }

    def precise_product_import_payload(self, product: PreciseProduct) -> dict:
        """Return the public payload shared by POST import and GET hydration."""

        satellites = [product.satellite_payload(identifier) for identifier in product.satellite_ids]
        return {
            "ok": True,
            "product": product.payload(),
            "satellites": satellites,
            "importedIds": [item["id"] for item in satellites],
        }

    def resolve_propagator(
        self,
        sat_id: str | None,
        line1: str | None,
        line2: str | None,
        propagator_name: str = "sgp4",
    ):
        sat_name = (sat_id or "").strip()
        if sat_name:
            prop = self.get_state_snapshot()[2].get(sat_name)
            if prop is None:
                raise HTTPException(status_code=404, detail=f"Satellite '{sat_name}' not found")
            return sat_name, prop
        l1, l2 = (line1 or "").strip(), (line2 or "").strip()
        if not l1 or not l2:
            raise HTTPException(status_code=400, detail="Send sat_id or line1+line2")
        try:
            prop = self._propagator_registry.create(propagator_name, l1, l2)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid TLE or propagator: {exc}") from exc
        tle_hash = hashlib.sha1(f"{l1}\n{l2}".encode("utf-8")).hexdigest()[:12]
        engine_key = str(propagator_name or "sgp4").strip().lower()
        identity_prefix = "tle" if engine_key == "sgp4" else f"{engine_key}:tle"
        return f"{identity_prefix}:{tle_hash}", prop

    def load_catalog_entries(self):
        _, data_config = load_system_config()
        return load_entries(CONFIG_DIR, data_config.get("satellites_catalog_file", "catalog.json"), load_all_tles_from_config)

    def find_catalog_entry(self, sat_id: str):
        entry = find_entry(self.load_catalog_entries(), sat_id)
        if entry:
            return entry
        with self._lock:
            for product in self._precise_products_by_id.values():
                for satellite_id in product.satellite_ids:
                    if product.runtime_id(satellite_id) == sat_id:
                        payload = product.satellite_payload(satellite_id)
                        return {
                            "name": payload["name"],
                            "id": sat_id,
                            "sourceFormat": "SP3",
                            "source_format": "SP3",
                            "preciseProduct": product.payload(),
                            "satellite_id": satellite_id,
                        }
        return None

    def build_ephemeris(
        self,
        name: str,
        prop: OrbitPropagator,
        start_time: datetime.datetime,
        end_time: datetime.datetime,
        step_seconds: float,
        include_velocity=True,
        position_only: bool = False,
    ):
        start_utc, end_utc = self.ensure_utc(start_time), self.ensure_utc(end_time)
        step = float(step_seconds)
        if step <= 0:
            raise HTTPException(status_code=400, detail="step_seconds must be greater than zero")
        points_estimate = int(((end_utc - start_utc).total_seconds() / step) + 1)
        if points_estimate > MAX_EPHEMERIS_POINTS:
            raise HTTPException(status_code=400, detail=f"Invalid ephemeris range ({points_estimate} points, max {MAX_EPHEMERIS_POINTS})")
        eop_token = (
            self._frame_transformer.cache_token_at(start_utc),
            self._frame_transformer.cache_token_at(end_utc),
        )
        cache_key = hashlib.sha1(
            f"{name}|{start_utc.isoformat()}|{end_utc.isoformat()}|{step}|{include_velocity}|{position_only}|{eop_token}".encode("utf-8")
        ).hexdigest()
        cached = self._ephemeris_cache.get(cache_key)
        if cached is not None:
            return cached
        native_samples_available = callable(getattr(prop, "native_state_at", None)) or callable(
            getattr(prop, "propagate_eme2000_datetime", None)
        ) or callable(getattr(prop, "propagate_eci_datetime", None))
        native_reference = self._native_reference_metadata_for_propagator(prop)

        def sample(moment: datetime.datetime) -> dict:
            renderer_state = (
                self.renderer_position_at(prop, moment)
                if position_only
                else self.renderer_state_at(prop, moment)
            )
            native_state = None if position_only else (
                self.native_state_at(prop, moment) if native_samples_available else None
            )
            return self.serialize_state(
                name,
                moment,
                include_velocity=False if position_only else include_velocity,
                state=renderer_state,
                native_state=native_state,
                native_reference=native_reference,
            )

        points, cursor = [], start_utc
        try:
            while cursor <= end_utc:
                points.append(sample(cursor))
                cursor += datetime.timedelta(seconds=step)
            if points and points[-1]["time"] != end_utc.isoformat():
                points.append(sample(end_utc))
        except (EphemerisFormatError, FrameTransformationError, ValueError) as exc:
            raise HTTPException(
                status_code=422,
                detail=f"La efeméride solicitada no está disponible para {name}: {exc}",
            ) from exc
        renderer_frame = points[0]["frame"] if points else {"name": "ITRF", "realization": None, "center": "EARTH"}
        renderer_reference_frame = points[0]["reference_frame"] if points else "ITRF"
        renderer_time_scale = points[0]["time_scale"] if points else "UTC"
        payload = {
            "satellite": name,
            "reference_frame": renderer_reference_frame,
            "frame": renderer_frame,
            "time_scale": renderer_time_scale,
            "transport_time_scale": "UTC",
            "native_samples_available": native_samples_available,
            # Compatibility flag used by current manual-track UI. The nested
            # ``eci`` key is now labelled EME2000 rather than generic ECI.
            "eci_samples_available": native_samples_available,
            "start_time": start_utc.isoformat(),
            "end_time": end_utc.isoformat(),
            "step_seconds": step,
            "position_only": position_only,
            "points": points,
            "count": len(points),
            "cached": False,
            "earth_orientation_cache_token": eop_token,
        }
        if native_reference is not None:
            payload["native_reference_frame"] = native_reference["reference_frame"]
            payload["native_frame"] = {
                **native_reference["frame"],
                "time_scale": native_reference["time_scale"],
            }
        if points:
            payload["renderer_reference"] = points[0]["renderer_reference"]
        self._ephemeris_cache.set(cache_key, payload)
        return payload

    def load_constellation(self) -> None:
        system_config, data_config = load_system_config()
        catalog_file = data_config.get("satellites_catalog_file", "catalog.json")
        tles = load_all_tles_from_config(CONFIG_DIR / catalog_file)
        props, by_name, invalid = [], {}, 0
        for name, line1, line2 in tles:
            try:
                prop = self._propagator_registry.create("sgp4", line1, line2)
                props.append((name, prop)); by_name[name] = prop
            except Exception as exc:
                invalid += 1
                print(f"Invalid TLE ignored: {name} ({exc})")
        precise_products, diagnostics = self._precise_product_repository.load_all(
            frame_transformer=self._frame_transformer,
        )
        for product in precise_products:
            for satellite_id in product.satellite_ids:
                runtime_id = product.runtime_id(satellite_id)
                if runtime_id in by_name:
                    diagnostics = (*diagnostics, f"{runtime_id}: ID de producto preciso duplicado")
                    continue
                provider = product.provider_for_satellite(satellite_id)
                props.append((runtime_id, provider))
                by_name[runtime_id] = provider
        with self._lock:
            self._propagators, self._propagators_by_name, self._system_config = props, by_name, system_config
            self._precise_products_by_id = {product.product_id: product for product in precise_products}
            self._precise_product_diagnostics = tuple(diagnostics)
            self._orbit_point_cache.clear(); self._orbit_cache_payload = []; self._orbit_cache_key = None
            self._orbit_cache_valid_until = datetime.datetime.min.replace(tzinfo=datetime.UTC)
            # The name of a catalogue entry is stable while its TLE is not.
            # Cached ephemerides are keyed by name, so they must be discarded
            # when a reload swaps an element set under the same identifier.
            self._ephemeris_cache.clear()
        print(
            f"Constellation ready: {len(props)} valid, {invalid} invalid, "
            f"{len(precise_products)} precise products"
        )

    def satellite_count(self) -> int:
        with self._lock:
            return len(self._propagators)

    def reload_constellation(self) -> int:
        self.load_constellation()
        return self.satellite_count()

    def catalog_satellite_ids(self) -> list[str]:
        return [name for name, _ in self.get_state_snapshot()[0]]

    def build_realtime_state(self, by_name: dict, satellite_ids: tuple[str, ...] | list[str]) -> list[dict]:
        """Serialize selected state sources without letting one SP3 break WS.

        Precise products can be historical and SP3 ``P`` files commonly have
        no velocity records.  The shared StateVector serializer preserves that
        absence instead of calling the legacy six-component ``propagate``
        adapter, and reports an unavailable source as data rather than killing
        the realtime task.
        """

        moment = utc_now()
        states: list[dict] = []
        for name in satellite_ids:
            propagator = by_name.get(name)
            if propagator is None:
                continue
            native_reference = self._native_reference_metadata_for_propagator(propagator)
            try:
                renderer_state = self.renderer_state_at(propagator, moment)
                native_state = self.native_state_at(propagator, moment)
                payload = self.serialize_state(
                    name,
                    moment,
                    include_velocity=True,
                    state=renderer_state,
                    native_state=native_state,
                    native_reference=native_reference,
                )
                payload["availability"] = "available"
                states.append(payload)
            except (EphemerisFormatError, FrameTransformationError, ValueError) as exc:
                unavailable = {
                    "satellite": name,
                    "availability": "unavailable",
                    "reason": "out-of-coverage-or-frame-unavailable",
                    "detail": str(exc),
                    "renderer_reference": self._unavailable_renderer_reference(
                        exc,
                        native_reference=native_reference,
                    ),
                }
                if native_reference is not None:
                    unavailable["native_reference_frame"] = native_reference["reference_frame"]
                    unavailable["native_frame"] = {
                        **native_reference["frame"],
                        "time_scale": native_reference["time_scale"],
                    }
                states.append(unavailable)
        return states

    def compute_auto_orbit_samples(self, horizon_hours, satellites_count=1, prop=None) -> int:
        return compute_auto_samples(horizon_hours, satellites_count, prop, AUTO_MIN_ORBIT_SAMPLES, AUTO_MAX_ORBIT_SAMPLES, MAX_TOTAL_ORBIT_POINTS_PER_BATCH)

    def _runtime_hours(self, config: dict) -> float:
        fallback = clamp_propagation_hours(config.get("propagation_hours", 12))
        try:
            mtime = SYSTEM_CONFIG_PATH.stat().st_mtime
        except OSError:
            return fallback
        if self._runtime_config_mtime != mtime:
            self._runtime_config_mtime = mtime
            try:
                payload = json.loads(SYSTEM_CONFIG_PATH.read_text(encoding="utf-8"))
                orbit_cfg = payload.get("system", {}).get("orbit", {}) if isinstance(payload, dict) else {}
                self._runtime_propagation_hours = clamp_propagation_hours(orbit_cfg.get("propagation_hours", fallback))
            except (OSError, ValueError, AttributeError):
                self._runtime_propagation_hours = fallback
        return self._runtime_propagation_hours

    def build_orbit_payload(self, props, config: dict) -> list:
        if not config.get("orbit_future_show", True):
            return []
        horizon_hours, now, payload = self._runtime_hours(config), utc_now(), []
        for name, prop in props:
            samples = self.compute_auto_orbit_samples(horizon_hours, len(props), prop)
            native_reference = self._native_reference_metadata_for_propagator(prop)
            horizon_end = now + datetime.timedelta(hours=horizon_hours)
            cache_key = (
                name,
                horizon_hours,
                samples,
                self._frame_transformer.cache_token_at(now),
                self._frame_transformer.cache_token_at(horizon_end),
            )
            with self._lock:
                cached = self._orbit_point_cache.get(cache_key)
            if cached and now < cached["valid_until"]:
                orbit = cached["orbit"]
                renderer_reference = cached.get("renderer_reference")
            else:
                orbit = []
                first_renderer_state: StateVector | None = None
                # All vertices share the same epoch.  Calling propagate_offset
                # independently makes its implicit ``now`` drift across a
                # dense path and can introduce tiny non-uniform chords.
                reference_time = now
                try:
                    for index in range(samples):
                        offset = (index / max(samples - 1, 1)) * horizon_hours * 3600
                        state = self.renderer_state_at(
                            prop,
                            reference_time + datetime.timedelta(seconds=offset),
                        )
                        if first_renderer_state is None:
                            first_renderer_state = state
                        orbit.append({"x": state.position_m[0], "y": state.position_m[1], "z": state.position_m[2]})
                except (EphemerisFormatError, FrameTransformationError, ValueError) as exc:
                    unavailable = {
                        "satellite": name,
                        "orbit": [],
                        "orbit_horizon_hours": horizon_hours,
                        "orbit_samples": samples,
                        "availability": "unavailable",
                        "reason": "out-of-coverage-or-frame-unavailable",
                        "detail": str(exc),
                        "renderer_reference": self._unavailable_renderer_reference(
                            exc,
                            native_reference=native_reference,
                        ),
                    }
                    if native_reference is not None:
                        unavailable["native_reference_frame"] = native_reference["reference_frame"]
                        unavailable["native_frame"] = {
                            **native_reference["frame"],
                            "time_scale": native_reference["time_scale"],
                        }
                    payload.append(unavailable)
                    continue
                assert first_renderer_state is not None
                renderer_reference = self._renderer_reference_metadata(
                    first_renderer_state,
                    native_reference=native_reference,
                )
                with self._lock:
                    self._orbit_point_cache[cache_key] = {
                        "orbit": orbit,
                        "renderer_reference": renderer_reference,
                        "valid_until": now + datetime.timedelta(seconds=ORBIT_CACHE_TTL_SECONDS),
                    }
            item = {
                "satellite": name,
                "orbit": orbit,
                "orbit_horizon_hours": horizon_hours,
                "orbit_samples": samples,
                "renderer_reference": renderer_reference,
            }
            if native_reference is not None:
                item["native_reference_frame"] = native_reference["reference_frame"]
                item["native_frame"] = {
                    **native_reference["frame"],
                    "time_scale": native_reference["time_scale"],
                }
            payload.append(item)
        return payload

    def _set_precise_products_locked(self, products: dict[str, PreciseProduct]) -> None:
        """Merge an imported product into the live constellation atomically."""

        catalog_entries = [
            (name, propagator)
            for name, propagator in self._propagators
            if not name.startswith("precise:")
        ]
        by_name = {name: propagator for name, propagator in catalog_entries}
        for product in products.values():
            for satellite_id in product.satellite_ids:
                runtime_id = product.runtime_id(satellite_id)
                if runtime_id in by_name:
                    raise PreciseProductImportError(
                        f"El ID de producto preciso {runtime_id} ya existe"
                    )
                provider = product.provider_for_satellite(satellite_id)
                catalog_entries.append((runtime_id, provider))
                by_name[runtime_id] = provider
        self._propagators = catalog_entries
        self._propagators_by_name = by_name
        self._precise_products_by_id = dict(products)
        self._orbit_point_cache.clear()
        self._orbit_cache_payload = []
        self._orbit_cache_key = None
        self._orbit_cache_valid_until = datetime.datetime.min.replace(tzinfo=datetime.UTC)
        self._ephemeris_cache.clear()

    def get_orbits_cached(self, props, config: dict) -> list:
        now, horizon = utc_now(), self._runtime_hours(config)
        sample_plan = tuple(self.compute_auto_orbit_samples(horizon, len(props), prop) for _, prop in props)
        cache_key = (
            tuple(name for name, _ in props),
            config.get("orbit_future_show", True),
            horizon,
            sample_plan,
            self._frame_transformer.cache_token_at(now),
            self._frame_transformer.cache_token_at(now + datetime.timedelta(hours=horizon)),
        )
        with self._lock:
            if self._orbit_cache_key == cache_key and now < self._orbit_cache_valid_until:
                return self._orbit_cache_payload
        payload = self.build_orbit_payload(props, config)
        with self._lock:
            self._orbit_cache_payload, self._orbit_cache_key = payload, cache_key
            self._orbit_cache_valid_until = now + datetime.timedelta(seconds=ORBIT_CACHE_TTL_SECONDS)
        return payload
