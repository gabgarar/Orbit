"""Stateful application service coordinating catalogues and orbital propagation."""

from __future__ import annotations

import datetime
import hashlib
import json
import threading

from fastapi import HTTPException

from orbit_api.catalog.repository import find_entry, load_entries
from orbit_api.catalog.tle_loader import load_all_tles_from_config
from orbit_api.frames import FrameId, FrameTransformService, StateVector
from orbit_api.core.settings import (
    AUTO_MAX_ORBIT_SAMPLES, AUTO_MIN_ORBIT_SAMPLES, CONFIG_DIR,
    EPHEMERIS_CACHE_TTL_SECONDS, MAX_EPHEMERIS_CACHE_ITEMS, MAX_EPHEMERIS_POINTS,
    MAX_TOTAL_ORBIT_POINTS_PER_BATCH, ORBIT_CACHE_TTL_SECONDS, SYSTEM_CONFIG_PATH,
)
from orbit_api.core.system_config import clamp_propagation_hours, load_system_config
from orbit_api.infrastructure.ttl_cache import TtlLruCache
from orbit_api.orbits.propagators import OrbitPropagator, build_default_registry
from orbit_api.orbits.sampling import compute_auto_samples
from orbit_api.timekeeping import ensure_utc, utc_now


class OrbitRuntime:
    """Own the mutable runtime state required by API route adapters."""

    def __init__(self, frame_transformer: FrameTransformService | None = None) -> None:
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
            # Existing visual editor code reads ``point.eci``. Preserve that
            # field temporarily, but make its true EME2000 label explicit.
            if native_state.frame in {FrameId.EME2000, FrameId.GCRF, FrameId.ICRF}:
                payload["eci"] = {**native_payload, "legacy_field": True}
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
        return find_entry(self.load_catalog_entries(), sat_id)

    def build_ephemeris(self, name: str, prop: OrbitPropagator, start_time: datetime.datetime, end_time: datetime.datetime, step_seconds: float, include_velocity=True):
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
            f"{name}|{start_utc.isoformat()}|{end_utc.isoformat()}|{step}|{include_velocity}|{eop_token}".encode("utf-8")
        ).hexdigest()
        cached = self._ephemeris_cache.get(cache_key)
        if cached is not None:
            return cached
        native_samples_available = callable(getattr(prop, "native_state_at", None)) or callable(
            getattr(prop, "propagate_eme2000_datetime", None)
        ) or callable(getattr(prop, "propagate_eci_datetime", None))

        def sample(moment: datetime.datetime) -> dict:
            renderer_state = self.renderer_state_at(prop, moment)
            native_state = self.native_state_at(prop, moment) if native_samples_available else None
            return self.serialize_state(
                name,
                moment,
                include_velocity=include_velocity,
                state=renderer_state,
                native_state=native_state,
            )

        points, cursor = [], start_utc
        while cursor <= end_utc:
            points.append(sample(cursor))
            cursor += datetime.timedelta(seconds=step)
        if points and points[-1]["time"] != end_utc.isoformat():
            points.append(sample(end_utc))
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
            "points": points,
            "count": len(points),
            "cached": False,
            "earth_orientation_cache_token": eop_token,
        }
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
        with self._lock:
            self._propagators, self._propagators_by_name, self._system_config = props, by_name, system_config
            self._orbit_point_cache.clear(); self._orbit_cache_payload = []; self._orbit_cache_key = None
            self._orbit_cache_valid_until = datetime.datetime.min.replace(tzinfo=datetime.UTC)
            # The name of a catalogue entry is stable while its TLE is not.
            # Cached ephemerides are keyed by name, so they must be discarded
            # when a reload swaps an element set under the same identifier.
            self._ephemeris_cache.clear()
        print(f"Constellation ready: {len(props)} valid, {invalid} invalid")

    def satellite_count(self) -> int:
        with self._lock:
            return len(self._propagators)

    def reload_constellation(self) -> int:
        self.load_constellation()
        return self.satellite_count()

    def catalog_satellite_ids(self) -> list[str]:
        return [name for name, _ in self.get_state_snapshot()[0]]

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
            else:
                orbit = []
                # All vertices share the same epoch.  Calling propagate_offset
                # independently makes its implicit ``now`` drift across a
                # dense path and can introduce tiny non-uniform chords.
                reference_time = now
                for index in range(samples):
                    offset = (index / max(samples - 1, 1)) * horizon_hours * 3600
                    state = self.renderer_state_at(
                        prop,
                        reference_time + datetime.timedelta(seconds=offset),
                    )
                    orbit.append({"x": state.position_m[0], "y": state.position_m[1], "z": state.position_m[2]})
                with self._lock:
                    self._orbit_point_cache[cache_key] = {"orbit": orbit, "valid_until": now + datetime.timedelta(seconds=ORBIT_CACHE_TTL_SECONDS)}
            payload.append({"satellite": name, "orbit": orbit, "orbit_horizon_hours": horizon_hours, "orbit_samples": samples})
        return payload

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
