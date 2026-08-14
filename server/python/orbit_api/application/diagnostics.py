"""Bounded backend diagnostics and health monitoring for Orbit.

This module deliberately reports what it really checked.  It does not call a
test suite in production, does not claim optional physics is available when a
strict time-data contract is absent, and never makes an HTTP request from an
orbit/transform path.  The monitor runs in a daemon thread after FastAPI has
started and all probes have finite, small workloads.
"""

from __future__ import annotations

import datetime
import json
import logging
import math
import re
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from orbit_api.formats import parse_oem_metadata, parse_sp3_metadata
from orbit_api.frames import FrameId, FrameTransformService, StateVector
from orbit_api.orbits.forces import GeopotentialConfiguration, GravityFieldModel
from orbit_api.orbits.forces.context import ForceEvaluationContext
from orbit_api.orbits.forces.geopotential import gravity_acceleration_itrf
from orbit_api.orbits.propagators.cowell import CowellPropagator
from orbit_api.orbits.propagators.j2_j3_j4 import J2J3J4Propagator
from orbit_api.orbits.propagators.two_body import TwoBodyPropagator
from orbit_api.orbits.propagators.classical import EARTH_MU_KM3_S2
from orbit_api.timekeeping import IersEopCacheService, ensure_utc, utc_now


LOGGER = logging.getLogger(__name__)

DiagnosticStatus = Literal["ok", "warning", "error", "unknown"]
_GITHUB_REPOSITORY_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
_GITHUB_WORKFLOWS = ("quality.yml", "docs-pages.yml", "release.yml")
_GITHUB_API_TIMEOUT_SECONDS = 8.0
_GITHUB_API_MAX_BYTES = 128 * 1024


def _iso(value: datetime.datetime | None) -> str | None:
    return ensure_utc(value).isoformat() if value is not None else None


def _safe_error(exc: Exception) -> str:
    message = " ".join(str(exc).strip().split())
    return message[:500] if message else type(exc).__name__


def _component(
    status: DiagnosticStatus,
    *,
    checked_at: datetime.datetime | None,
    details: Mapping[str, object] | None = None,
    error: str | None = None,
) -> dict[str, object]:
    """Build one stable component payload for the diagnostics panel."""

    return {
        "status": status,
        "lastValidation": _iso(checked_at),
        "details": dict(details or {}),
        "error": error,
    }


def _finite_state(values: tuple[float, float, float, float, float, float]) -> bool:
    return all(math.isfinite(float(value)) for value in values)


def _specific_energy(values: tuple[float, float, float, float, float, float]) -> float:
    x, y, z, vx, vy, vz = (float(value) for value in values)
    radius = math.sqrt((x * x) + (y * y) + (z * z))
    if radius <= 0.0:
        raise ValueError("La sonda de energía produjo un radio no positivo")
    return 0.5 * ((vx * vx) + (vy * vy) + (vz * vz)) - (EARTH_MU_KM3_S2 / radius)


def _fixed_epoch() -> datetime.datetime:
    """A fixed date keeps self-checks deterministic and independent of wall clock."""

    return datetime.datetime(2026, 1, 1, tzinfo=datetime.UTC)


def _probe_sp3_parser(checked_at: datetime.datetime) -> dict[str, object]:
    source = "\n".join((
        "#cP2026 07 26 13 05 35.25000000      96 ORBIT IGS20 FIT COD ",
        "## 2429 0.00000000 900.00000000 61000 0.0000000000000",
        "+    1   G01",
        "%c cc GPS ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc",
    ))
    try:
        metadata = parse_sp3_metadata(source)
        if metadata.time_scale_label != "GPS" or metadata.reference_frame.label != "IGS20":
            raise ValueError("La sonda SP3 no conservó el frame/escala declarados")
        return _component(
            "ok",
            checked_at=checked_at,
            details={"probe": "metadata parse", "format": metadata.format_name, "timeScale": metadata.time_scale_label},
        )
    except Exception as exc:
        return _component("error", checked_at=checked_at, error=_safe_error(exc))


def _probe_oem_parser(checked_at: datetime.datetime) -> dict[str, object]:
    source = """
CCSDS_OEM_VERS = 2.0
CREATION_DATE = 2026-01-01T00:00:00Z
ORIGINATOR = Orbit diagnostics
META_START
OBJECT_NAME = DIAGNOSTIC
OBJECT_ID = 2026-001A
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
START_TIME = 2026-01-01T00:00:00Z
STOP_TIME = 2026-01-01T00:01:00Z
INTERPOLATION = LAGRANGE
INTERPOLATION_DEGREE = 7
META_STOP
"""
    try:
        metadata = parse_oem_metadata(source)
        if len(metadata.segments) != 1 or metadata.segments[0].reference_frame.label != "EME2000":
            raise ValueError("La sonda OEM no conservó el segmento declarado")
        return _component(
            "ok",
            checked_at=checked_at,
            details={"probe": "metadata parse", "format": metadata.format_name, "segments": len(metadata.segments)},
        )
    except Exception as exc:
        return _component("error", checked_at=checked_at, error=_safe_error(exc))


def _probe_propagators(checked_at: datetime.datetime) -> tuple[dict[str, object], dict[str, object]]:
    """Run a fixed, sub-minute numerical probe without a frame conversion."""

    epoch = _fixed_epoch()
    keplerian = {
        "semi_major_axis_km": 7000.0,
        "eccentricity": 0.001,
        "inclination_deg": 51.6,
        "raan_deg": 20.0,
        "argument_of_perigee_deg": 40.0,
        "mean_anomaly_deg": 5.0,
    }
    state = {
        "position_eme2000_km": {"x": 7000.0, "y": 0.0, "z": 0.0},
        "velocity_eme2000_km_s": {"x": 0.0, "y": 7.546, "z": 1.0},
    }
    details: dict[str, object] = {}
    force_details: dict[str, object] = {}
    errors: list[str] = []
    try:
        two_body = TwoBodyPropagator(epoch, keplerian)
        first = two_body.propagate_eme2000_datetime(epoch)
        second = two_body.propagate_eme2000_datetime(epoch + datetime.timedelta(seconds=60))
        first_energy, second_energy = _specific_energy(first), _specific_energy(second)
        residual = abs(second_energy - first_energy) / max(abs(first_energy), 1.0)
        if not _finite_state(first) or not _finite_state(second) or residual > 1e-12:
            raise ValueError(f"La sonda two-body no conserva energía (residuo {residual:.3e})")
        details["twoBody"] = {"status": "ok", "energyRelativeResidual": residual}
        details["energyConservation"] = {"passed": True, "relativeResidual": residual}
    except Exception as exc:
        errors.append(f"two-body: {_safe_error(exc)}")
        details["twoBody"] = {"status": "error"}
        details["energyConservation"] = {"passed": False}
    try:
        cowell = CowellPropagator(epoch, state, force_terms=("central",))
        central = cowell.propagate_eme2000_datetime(epoch + datetime.timedelta(seconds=60))
        if not _finite_state(central):
            raise ValueError("La sonda Cowell central produjo un estado no finito")
        force_details["central"] = {"status": "ok"}
        details["cowellRk4"] = {"status": "ok", "stepSeconds": cowell.integration_step_seconds}
        details["stability"] = {"passed": True, "finiteState": True, "windowSeconds": 60}
    except Exception as exc:
        errors.append(f"cowell: {_safe_error(exc)}")
        force_details["central"] = {"status": "error"}
        details["cowellRk4"] = {"status": "error"}
        details["stability"] = {"passed": False}
    try:
        zonal = J2J3J4Propagator(epoch, state)
        result = zonal.propagate_eme2000_datetime(epoch + datetime.timedelta(seconds=60))
        if not _finite_state(result):
            raise ValueError("La sonda J2/J3/J4 produjo un estado no finito")
        force_details["j2J3J4"] = {"status": "ok"}
        details["j2J3J4"] = {"status": "ok"}
    except Exception as exc:
        errors.append(f"j2/j3/j4: {_safe_error(exc)}")
        force_details["j2J3J4"] = {"status": "error"}
        details["j2J3J4"] = {"status": "error"}
    status: DiagnosticStatus = "error" if errors else "ok"
    return (
        _component(status, checked_at=checked_at, details=details, error="; ".join(errors) or None),
        _component(status, checked_at=checked_at, details=force_details, error="; ".join(errors) or None),
    )


def _probe_reference_frames(
    transformer: FrameTransformService,
    checked_at: datetime.datetime,
) -> dict[str, object]:
    """Check a real ITRF->EME2000 transform and its norm invariant."""

    instant = _fixed_epoch()
    native = StateVector(
        epoch=instant,
        time_scale="UTC",
        frame=FrameId.ITRF,
        frame_realization=None,
        center="EARTH",
        position_m=(7_000_000.0, 200_000.0, -300_000.0),
        velocity_m_s=(0.0, 7_500.0, 50.0),
    )
    try:
        transformed = transformer.transform(native, target_frame=FrameId.EME2000)
        source_norm = math.hypot(*native.position_m)
        target_norm = math.hypot(*transformed.position_m)
        relative = abs(target_norm - source_norm) / source_norm
        orientation = transformer.earth_orientation_at(instant)
        if not all(math.isfinite(value) for value in transformed.components()) or relative > 1e-12:
            raise ValueError("La sonda ITRF/ECI no conserva un estado finito o su norma")
        if orientation.quality in {"approximate", "extrapolated"}:
            return _component(
                "warning",
                checked_at=checked_at,
                details={
                    "probe": "ITRF to EME2000 norm invariant",
                    "route": "ITRF→EME2000",
                    "positionNormRelativeResidual": relative,
                    "eopQuality": orientation.quality,
                },
                error="La ruta de referencia usa EOP nominal o fuera de cobertura.",
            )
        return _component(
            "ok",
            checked_at=checked_at,
            details={
                "probe": "ITRF to EME2000 norm invariant",
                "route": "ITRF→EME2000",
                "positionNormRelativeResidual": relative,
                "eopQuality": orientation.quality,
                "iau2006_2000a": transformer.has_iau2006_2000a,
            },
        )
    except Exception as exc:
        # Coverage/configuration absence is an operational warning: the
        # monitor must not label a renderer fallback as a broken backend.
        return _component(
            "warning",
            checked_at=checked_at,
            details={"probe": "ITRF to EME2000 norm invariant", "route": "ITRF→EME2000"},
            error=_safe_error(exc),
        )


def _probe_optional_forces(
    transformer: FrameTransformService,
    gravity_field: GravityFieldModel | None,
    checked_at: datetime.datetime,
) -> dict[str, object]:
    """Report optional physics honestly, with bounded checks where configured."""

    details: dict[str, object] = {}
    warnings: list[str] = []
    epoch = _fixed_epoch()
    state = {
        "position_eme2000_km": {"x": 7000.0, "y": 0.0, "z": 0.0},
        "velocity_eme2000_km_s": {"x": 0.0, "y": 7.546, "z": 1.0},
    }
    if gravity_field is None:
        details["fullGeopotential"] = {"status": "warning", "available": False}
        warnings.append("No hay un campo ICGEM local configurado para full geopotential.")
    else:
        try:
            degree = min(2, gravity_field.max_degree)
            if degree < 2:
                raise ValueError("El campo configurado no contiene grado 2")
            acceleration = gravity_acceleration_itrf(
                (7000.0, 0.0, 0.0),
                gravity_field,
                GeopotentialConfiguration(degree=degree, order=0),
            )
            if not all(math.isfinite(value) for value in acceleration):
                raise ValueError("La aceleración geopotencial no es finita")
            details["fullGeopotential"] = {"status": "ok", "available": True, "probeDegree": degree}
        except Exception as exc:
            details["fullGeopotential"] = {"status": "warning", "available": True}
            warnings.append(f"Full geopotential no superó la sonda: {_safe_error(exc)}")
    try:
        context = ForceEvaluationContext(epoch, transformer)
        context.require_terrestrial_route()
        drag = CowellPropagator(epoch, state, force_terms=("central", "drag"), frame_transformer=transformer)
        result = drag.propagate_eme2000_datetime(epoch + datetime.timedelta(seconds=1))
        if not _finite_state(result):
            raise ValueError("La sonda de arrastre produjo un estado no finito")
        details["drag"] = {"status": "ok", "available": True}
    except Exception as exc:
        details["drag"] = {"status": "warning", "available": False}
        warnings.append(f"Arrastre no disponible con el contrato temporal actual: {_safe_error(exc)}")
    try:
        context = ForceEvaluationContext(epoch, transformer)
        context.require_inertial_time_route()
        srp = CowellPropagator(
            epoch,
            state,
            force_terms=("central", "solar-radiation-pressure"),
            frame_transformer=transformer,
        )
        result = srp.propagate_eme2000_datetime(epoch + datetime.timedelta(seconds=1))
        if not _finite_state(result):
            raise ValueError("La sonda SRP produjo un estado no finito")
        details["solarRadiationPressure"] = {"status": "ok", "available": True}
    except Exception as exc:
        details["solarRadiationPressure"] = {"status": "warning", "available": False}
        warnings.append(f"SRP no disponible con el contrato temporal actual: {_safe_error(exc)}")
    return _component(
        "warning" if warnings else "ok",
        checked_at=checked_at,
        details=details,
        error="; ".join(warnings) or None,
    )


class GitHubActionsDiagnostics:
    """Optional, bounded public GitHub Actions reader for the diagnostics panel."""

    def __init__(
        self,
        *,
        repository: str = "gabgarar/Orbit",
        enabled: bool = False,
        timeout_seconds: float = _GITHUB_API_TIMEOUT_SECONDS,
        fetcher: Callable[[str, float, int], bytes] | None = None,
    ) -> None:
        candidate = str(repository or "").strip()
        if not _GITHUB_REPOSITORY_PATTERN.fullmatch(candidate):
            raise ValueError("ORBIT_GITHUB_REPOSITORY debe tener formato propietario/repositorio")
        self.repository = candidate
        self.enabled = bool(enabled)
        self.timeout_seconds = float(timeout_seconds)
        self._fetcher = fetcher or self._fetch_https_json_bytes

    def probe(self, checked_at: datetime.datetime) -> dict[str, object]:
        if not self.enabled:
            return _component(
                "unknown",
                checked_at=checked_at,
                details={"repository": self.repository, "enabled": False, "workflows": list(_GITHUB_WORKFLOWS)},
                error="El monitor público de GitHub Actions no está configurado.",
            )
        workflows: dict[str, object] = {}
        statuses: list[DiagnosticStatus] = []
        errors: list[str] = []
        for workflow in _GITHUB_WORKFLOWS:
            url = f"https://api.github.com/repos/{self.repository}/actions/workflows/{workflow}/runs?per_page=1"
            try:
                raw = self._fetcher(url, self.timeout_seconds, _GITHUB_API_MAX_BYTES)
                payload = json.loads(raw.decode("utf-8"))
                runs = payload.get("workflow_runs") if isinstance(payload, Mapping) else None
                if not isinstance(runs, list) or not runs:
                    workflows[workflow] = {"status": "unknown", "available": False}
                    statuses.append("unknown")
                    continue
                run = runs[0]
                if not isinstance(run, Mapping):
                    raise ValueError("La respuesta de GitHub no contiene un workflow run válido")
                conclusion = str(run.get("conclusion") or "").lower()
                state = str(run.get("status") or "").lower()
                if state != "completed":
                    item_status: DiagnosticStatus = "warning"
                elif conclusion == "success":
                    item_status = "ok"
                elif conclusion:
                    item_status = "error"
                else:
                    item_status = "unknown"
                workflows[workflow] = {
                    "status": item_status,
                    "available": True,
                    "runStatus": state or None,
                    "conclusion": conclusion or None,
                    "updatedAt": run.get("updated_at"),
                    "url": run.get("html_url"),
                }
                statuses.append(item_status)
            except Exception as exc:
                workflows[workflow] = {"status": "warning", "available": False}
                statuses.append("warning")
                errors.append(f"{workflow}: {_safe_error(exc)}")
        status: DiagnosticStatus
        if "error" in statuses:
            status = "error"
        elif "warning" in statuses:
            status = "warning"
        elif statuses and all(item == "ok" for item in statuses):
            status = "ok"
        else:
            status = "unknown"
        return _component(
            status,
            checked_at=checked_at,
            details={"repository": self.repository, "enabled": True, "workflows": workflows},
            error="; ".join(errors) or None,
        )

    @staticmethod
    def _fetch_https_json_bytes(url: str, timeout_seconds: float, max_bytes: int) -> bytes:
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != "api.github.com":
            raise ValueError("El monitor CI solo admite HTTPS api.github.com")
        request = Request(
            url,
            headers={"Accept": "application/vnd.github+json", "User-Agent": "Orbit-Tracker-Diagnostics/1"},
            method="GET",
        )
        with urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310 - host is checked above
            status = int(getattr(response, "status", response.getcode()))
            if status != 200:
                raise OSError(f"GitHub respondió HTTP {status}")
            chunks: list[bytes] = []
            total = 0
            while True:
                block = response.read(min(64 * 1024, max_bytes + 1 - total))
                if not block:
                    break
                total += len(block)
                if total > max_bytes:
                    raise OSError("La respuesta de GitHub supera el tamaño máximo permitido")
                chunks.append(block)
            return b"".join(chunks)


class PinnedEopDiagnostics:
    """Expose an explicit C04 deployment without opting it into auto-refresh."""

    def __init__(
        self,
        provider: object,
        path: str | Path,
        *,
        source: str,
        now: Callable[[], datetime.datetime] = utc_now,
    ) -> None:
        self._provider = provider
        self._path = Path(path)
        self._source = str(source or "IERS EOP C04").strip() or "IERS EOP C04"
        self._validated_at = ensure_utc(now())

    def payload(self) -> dict[str, object]:
        identity = getattr(self._provider, "snapshot_identity", None)
        if identity is None:
            return {
                "status": "warning",
                "loaded": False,
                "source": self._source,
                "sourceUrl": None,
                "cacheFile": self._path.name,
                "lastUpdate": None,
                "lastValidation": _iso(self._validated_at),
                "coverage": None,
                "recordCount": 0,
                "error": "El proveedor EOP explícito no declara identidad/coverage de snapshot.",
                "refreshDue": False,
                "usingCachedFallback": False,
                "automatic": False,
                "details": {"format": "configured EOP snapshot", "automatic": False},
            }
        try:
            update = datetime.datetime.fromtimestamp(self._path.stat().st_mtime, tz=datetime.UTC)
        except OSError:
            update = None
        return {
            "status": "ok",
            "loaded": True,
            "source": self._source,
            "sourceUrl": None,
            "cacheFile": identity.filename,
            "lastUpdate": _iso(update),
            "lastValidation": _iso(self._validated_at),
            "coverage": {"start": _iso(identity.coverage_start), "end": _iso(identity.coverage_end)},
            "recordCount": identity.record_count,
            "error": None,
            "refreshDue": False,
            "usingCachedFallback": False,
            "automatic": False,
            "details": {"format": "configured C04 snapshot", "automatic": False},
        }


@dataclass(frozen=True, slots=True)
class _MonitorState:
    running: bool = False
    last_check: datetime.datetime | None = None
    error: str | None = None


class SystemDiagnostics:
    """Collect bounded real probes and provide the public diagnostics payload."""

    def __init__(
        self,
        *,
        frame_transformer: FrameTransformService,
        eop_cache: IersEopCacheService | None = None,
        eop_payload: Callable[[], dict[str, object]] | None = None,
        gravity_field: GravityFieldModel | None = None,
        precise_products_payload: Callable[[], Mapping[str, object]] | None = None,
        github_actions: GitHubActionsDiagnostics | None = None,
        now: Callable[[], datetime.datetime] = utc_now,
    ) -> None:
        self._frame_transformer = frame_transformer
        self._eop_cache = eop_cache
        self._eop_payload = eop_payload
        self._gravity_field = gravity_field
        self._precise_products_payload = precise_products_payload
        self._github_actions = github_actions or GitHubActionsDiagnostics()
        self._now = now
        self._lock = threading.RLock()
        self._components: dict[str, dict[str, object]] = {
            "sp3": _component("unknown", checked_at=None, error="La sonda aún no se ha ejecutado."),
            "oem": _component("unknown", checked_at=None, error="La sonda aún no se ha ejecutado."),
            "propagators": _component("unknown", checked_at=None, error="La sonda aún no se ha ejecutado."),
            "forces": _component("unknown", checked_at=None, error="La sonda aún no se ha ejecutado."),
            "frames": _component("unknown", checked_at=None, error="La sonda aún no se ha ejecutado."),
            "cicd": _component("unknown", checked_at=None, error="La sonda aún no se ha ejecutado."),
        }
        self._monitor = _MonitorState()

    def run_checks(self) -> None:
        """Run small deterministic checks; caller owns scheduling/network refresh."""

        checked_at = ensure_utc(self._now())
        propagators, core_forces = _probe_propagators(checked_at)
        optional_forces = _probe_optional_forces(self._frame_transformer, self._gravity_field, checked_at)
        merged_force_details = dict(core_forces.get("details", {}))
        merged_force_details.update(dict(optional_forces.get("details", {})))
        force_statuses = {str(core_forces["status"]), str(optional_forces["status"])}
        force_status: DiagnosticStatus = "error" if "error" in force_statuses else (
            "warning" if "warning" in force_statuses else "ok"
        )
        force_errors = [value for value in (core_forces.get("error"), optional_forces.get("error")) if value]
        sp3 = _probe_sp3_parser(checked_at)
        if self._precise_products_payload is not None:
            try:
                products = self._precise_products_payload()
                persisted_errors = products.get("diagnostics", []) if isinstance(products, Mapping) else []
                item_count = len(products.get("items", [])) if isinstance(products, Mapping) else 0
                sp3_details = dict(sp3.get("details", {}))
                sp3_details["loadedProducts"] = item_count
                if persisted_errors:
                    sp3 = _component(
                        "warning",
                        checked_at=checked_at,
                        details=sp3_details,
                        error="; ".join(str(value) for value in persisted_errors),
                    )
                else:
                    sp3 = _component(str(sp3["status"]), checked_at=checked_at, details=sp3_details, error=sp3.get("error"))  # type: ignore[arg-type]
            except Exception as exc:
                sp3 = _component("warning", checked_at=checked_at, details=dict(sp3.get("details", {})), error=_safe_error(exc))
        components = {
            "sp3": sp3,
            "oem": _probe_oem_parser(checked_at),
            "propagators": propagators,
            "forces": _component(
                force_status,
                checked_at=checked_at,
                details=merged_force_details,
                error="; ".join(str(value) for value in force_errors) or None,
            ),
            "frames": _probe_reference_frames(self._frame_transformer, checked_at),
            "cicd": self._github_actions.probe(checked_at),
        }
        with self._lock:
            self._components = components

    def set_monitor_state(
        self,
        *,
        running: bool,
        last_check: datetime.datetime | None = None,
        error: str | None = None,
    ) -> None:
        with self._lock:
            self._monitor = _MonitorState(
                running=bool(running),
                last_check=ensure_utc(last_check) if last_check is not None else self._monitor.last_check,
                error=error,
            )

    def payload(self) -> dict[str, object]:
        """Return a JSON-safe snapshot for ``GET /system/diagnostics``."""

        generated_at = ensure_utc(self._now())
        with self._lock:
            components = {name: dict(value) for name, value in self._components.items()}
            monitor = self._monitor
        if self._eop_cache is not None:
            components["erp"] = self._eop_cache.diagnostics_payload()
        elif self._eop_payload is not None:
            components["erp"] = self._eop_payload()
        else:
            components["erp"] = _component(
                "unknown",
                checked_at=None,
                details={"automatic": False},
                error="El servicio EOP automático está desactivado por una configuración reproducible explícita.",
            )
        components["monitor"] = _component(
            "ok" if monitor.running and monitor.error is None else ("warning" if monitor.error is None else "error"),
            checked_at=monitor.last_check,
            details={"running": monitor.running},
            error=monitor.error,
        )
        statuses = [str(component.get("status", "unknown")) for component in components.values()]
        overall: DiagnosticStatus
        if "error" in statuses:
            overall = "error"
        elif "warning" in statuses:
            overall = "warning"
        elif statuses and all(status == "ok" for status in statuses):
            overall = "ok"
        else:
            overall = "unknown"
        return {
            "status": overall,
            "generatedAt": _iso(generated_at),
            "updatedAt": _iso(generated_at),
            "components": components,
        }


class SystemHealthMonitor:
    """Own the non-blocking startup refresh and low-rate health polling loop."""

    def __init__(
        self,
        diagnostics: SystemDiagnostics,
        *,
        eop_cache: IersEopCacheService | None = None,
        interval_seconds: float = 6 * 60 * 60,
        now: Callable[[], datetime.datetime] = utc_now,
    ) -> None:
        if not math.isfinite(interval_seconds) or not 30.0 <= float(interval_seconds) <= 24 * 60 * 60:
            raise ValueError("interval_seconds debe estar entre 30 segundos y 24 horas")
        self._diagnostics = diagnostics
        self._eop_cache = eop_cache
        self.interval_seconds = float(interval_seconds)
        self._now = now
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._thread_lock = threading.Lock()

    @property
    def running(self) -> bool:
        thread = self._thread
        return bool(thread and thread.is_alive() and not self._stop.is_set())

    def start(self) -> None:
        with self._thread_lock:
            if self.running:
                return
            self._stop.clear()
            self._thread = threading.Thread(
                target=self._run,
                name="orbit-system-health-monitor",
                daemon=True,
            )
            self._thread.start()
            self._diagnostics.set_monitor_state(running=True)

    def stop(self, *, timeout_seconds: float = 2.0) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=max(0.0, float(timeout_seconds)))
        self._diagnostics.set_monitor_state(running=False)

    def run_once(self) -> None:
        """Run one cycle synchronously; useful for deterministic tests."""

        checked_at = ensure_utc(self._now())
        try:
            if self._eop_cache is not None:
                self._eop_cache.refresh_if_needed()
            self._diagnostics.run_checks()
            self._diagnostics.set_monitor_state(running=self.running, last_check=checked_at)
        except Exception as exc:  # defensive: monitor must not kill ASGI runtime
            message = _safe_error(exc)
            LOGGER.exception("System health monitor check failed: %s", message)
            self._diagnostics.set_monitor_state(running=self.running, last_check=checked_at, error=message)

    def _run(self) -> None:
        while not self._stop.is_set():
            self.run_once()
            self._stop.wait(self.interval_seconds)
