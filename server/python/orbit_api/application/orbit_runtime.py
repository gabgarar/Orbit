"""Stateful application service coordinating catalogues and orbital propagation."""

from __future__ import annotations

import datetime
import hashlib
import json
import threading

from fastapi import HTTPException

from orbit_api.catalog.repository import find_entry, load_entries
from orbit_api.catalog.tle_loader import load_all_tles_from_config
from orbit_api.core.settings import (
    AUTO_MAX_ORBIT_SAMPLES, AUTO_MIN_ORBIT_SAMPLES, CONFIG_DIR,
    EPHEMERIS_CACHE_TTL_SECONDS, MAX_EPHEMERIS_CACHE_ITEMS, MAX_EPHEMERIS_POINTS,
    MAX_TOTAL_ORBIT_POINTS_PER_BATCH, ORBIT_CACHE_TTL_SECONDS, SYSTEM_CONFIG_PATH,
)
from orbit_api.core.system_config import clamp_propagation_hours, load_system_config
from orbit_api.infrastructure.ttl_cache import TtlLruCache
from orbit_api.orbits.propagators import OrbitPropagator, build_default_registry
from orbit_api.orbits.sampling import compute_auto_samples


class OrbitRuntime:
    """Own the mutable runtime state required by API route adapters."""

    def __init__(self) -> None:
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
        self._propagator_registry = build_default_registry()

    @staticmethod
    def ensure_utc(value: datetime.datetime) -> datetime.datetime:
        """Convert a datetime to an aware UTC value."""
        return value.replace(tzinfo=datetime.UTC) if value.tzinfo is None else value.astimezone(datetime.UTC)

    def serialize_state(self, name: str, moment: datetime.datetime, x, y, z, vx, vy, vz, include_velocity=True) -> dict:
        payload = {"satellite": name, "time": self.ensure_utc(moment).isoformat(), "position": {"x": x, "y": y, "z": z}}
        if include_velocity:
            payload["velocity"] = {"x": vx, "y": vy, "z": vz}
        return payload

    def get_state_snapshot(self) -> tuple[list, dict, dict]:
        with self._lock:
            return list(self._propagators), dict(self._system_config), dict(self._propagators_by_name)

    def resolve_propagator(self, sat_id: str | None, line1: str | None, line2: str | None):
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
            prop = self._propagator_registry.create("sgp4", l1, l2)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid TLE: {exc}") from exc
        tle_hash = hashlib.sha1(f"{l1}\n{l2}".encode("utf-8")).hexdigest()[:12]
        return f"tle:{tle_hash}", prop

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
        cache_key = hashlib.sha1(f"{name}|{start_utc.isoformat()}|{end_utc.isoformat()}|{step}|{include_velocity}".encode("utf-8")).hexdigest()
        cached = self._ephemeris_cache.get(cache_key)
        if cached is not None:
            return cached
        points, cursor = [], start_utc
        while cursor <= end_utc:
            x, y, z, vx, vy, vz = prop.propagate_datetime(cursor.replace(tzinfo=None))
            points.append(self.serialize_state(name, cursor, x, y, z, vx, vy, vz, include_velocity))
            cursor += datetime.timedelta(seconds=step)
        if points and points[-1]["time"] != end_utc.isoformat():
            x, y, z, vx, vy, vz = prop.propagate_datetime(end_utc.replace(tzinfo=None))
            points.append(self.serialize_state(name, end_utc, x, y, z, vx, vy, vz, include_velocity))
        payload = {"satellite": name, "start_time": start_utc.isoformat(), "end_time": end_utc.isoformat(), "step_seconds": step, "points": points, "count": len(points), "cached": False}
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
        horizon_hours, now, payload = self._runtime_hours(config), datetime.datetime.now(datetime.UTC), []
        for name, prop in props:
            samples = self.compute_auto_orbit_samples(horizon_hours, len(props), prop)
            cache_key = (name, horizon_hours, samples)
            with self._lock:
                cached = self._orbit_point_cache.get(cache_key)
            if cached and now < cached["valid_until"]:
                orbit = cached["orbit"]
            else:
                orbit = []
                for index in range(samples):
                    offset = (index / max(samples - 1, 1)) * horizon_hours * 3600
                    x, y, z, _, _, _ = prop.propagate_offset(offset)
                    orbit.append({"x": x, "y": y, "z": z})
                with self._lock:
                    self._orbit_point_cache[cache_key] = {"orbit": orbit, "valid_until": now + datetime.timedelta(seconds=ORBIT_CACHE_TTL_SECONDS)}
            payload.append({"satellite": name, "orbit": orbit, "orbit_horizon_hours": horizon_hours, "orbit_samples": samples})
        return payload

    def get_orbits_cached(self, props, config: dict) -> list:
        now, horizon = datetime.datetime.now(datetime.UTC), self._runtime_hours(config)
        sample_plan = tuple(self.compute_auto_orbit_samples(horizon, len(props), prop) for _, prop in props)
        cache_key = (tuple(name for name, _ in props), config.get("orbit_future_show", True), horizon, sample_plan)
        with self._lock:
            if self._orbit_cache_key == cache_key and now < self._orbit_cache_valid_until:
                return self._orbit_cache_payload
        payload = self.build_orbit_payload(props, config)
        with self._lock:
            self._orbit_cache_payload, self._orbit_cache_key = payload, cache_key
            self._orbit_cache_valid_until = now + datetime.timedelta(seconds=ORBIT_CACHE_TTL_SECONDS)
        return payload
