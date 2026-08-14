"""Thread-safe, non-blocking lifecycle facts for Orbit service startup.

This is deliberately a small reporting primitive rather than another startup
orchestration layer.  The ASGI lifespan and monitor own the work; this class
only records milestones so an HTTP diagnostics request can tell the browser
what has actually happened without delaying ``/health``.
"""

from __future__ import annotations

import datetime
import threading
from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass
from typing import Literal, Mapping

from orbit_api.timekeeping import ensure_utc, utc_now

StartupStepStatus = Literal["pending", "ok", "warning", "error"]
StartupReadinessState = Literal["pending", "ready", "degraded-ready", "blocked"]


_STEP_LABELS = {
    "configuration": "Comprobando configuración…",
    "erp": "Verificando parámetros de orientación terrestre (ERP)…",
    "gravity": "Comprobando modelos de gravedad locales (EGM96 / EGM2008)…",
    "gravity-download": "Descargando modelos de gravedad faltantes desde NGA…",
    "gravity-validation": "Validando modelos de gravedad…",
    "mtr": "Inicializando gestor temporal (MTR)…",
    "complete": "Inicio completado.",
}
_STEP_ORDER = tuple(_STEP_LABELS)
_VALID_STATUSES = frozenset(("pending", "ok", "warning", "error"))

# ``erp`` is deliberately terminal-but-degradable.  Manual Cowell keeps an
# explicitly-labelled nominal Earth-rotation fallback when IERS data cannot be
# obtained, as documented by the product contract.  NGA archive acquisition
# is different: both fields are mandatory startup resources and a missing,
# stale, malformed, or failed-to-download archive must keep project creation
# blocked.
_PROJECT_REQUIRED_STEPS = (
    "configuration",
    "erp",
    "gravity-download",
    "gravity-validation",
    "gravity",
)
_PROJECT_BLOCKING_STEPS = frozenset((
    "configuration",
    "gravity-download",
    "gravity-validation",
    "gravity",
))
_PROJECT_DEGRADABLE_STEPS = frozenset(("erp",))


def _iso(value: datetime.datetime | None) -> str | None:
    return ensure_utc(value).isoformat() if value is not None else None


def _normalise_status(value: object) -> StartupStepStatus:
    candidate = str(value or "pending").strip().lower()
    aliases = {
        "healthy": "ok",
        "ready": "ok",
        "passed": "ok",
        "success": "ok",
        "failed": "error",
        "failure": "error",
        "running": "pending",
        "loading": "pending",
        "unknown": "pending",
    }
    candidate = aliases.get(candidate, candidate)
    return candidate if candidate in _VALID_STATUSES else "pending"  # type: ignore[return-value]


@dataclass(frozen=True, slots=True)
class StartupStep:
    """One published fact in the service startup ledger."""

    step_id: str
    label: str
    status: StartupStepStatus
    message: str | None
    timestamp: datetime.datetime

    def payload(self) -> dict[str, object]:
        return {
            "id": self.step_id,
            "label": self.label,
            "status": self.status,
            "message": self.message,
            "timestamp": _iso(self.timestamp),
        }


class StartupStatusReporter:
    """Accumulate service startup steps without performing any work itself."""

    def __init__(self, *, now: Callable[[], datetime.datetime] = utc_now) -> None:
        self._now = now
        self._lock = threading.RLock()
        self._started_at = ensure_utc(now())
        self._completed_at: datetime.datetime | None = None
        self._steps: dict[str, StartupStep] = {}
        self._warnings: list[str] = []
        self._errors: list[str] = []
        # The gravity registry updates this through a lock-protected,
        # immutable-on-read snapshot.  It is deliberately diagnostics only:
        # recording progress must never become a second download scheduler.
        self._progress: dict[str, object] | None = None

    def record(
        self,
        step_id: str,
        status: object,
        *,
        message: str | None = None,
        label: str | None = None,
    ) -> StartupStep:
        """Record or replace a named milestone using a bounded public shape."""

        identifier = str(step_id or "").strip().lower()
        if not identifier:
            raise ValueError("El identificador del paso de arranque es obligatorio")
        checked_at = ensure_utc(self._now())
        normalised_status = _normalise_status(status)
        safe_message = " ".join(str(message or "").split())[:500] or None
        step = StartupStep(
            step_id=identifier,
            label=str(label or _STEP_LABELS.get(identifier) or identifier).strip()[:200],
            status=normalised_status,
            message=safe_message,
            timestamp=checked_at,
        )
        with self._lock:
            self._steps[identifier] = step
            if normalised_status == "warning" and safe_message and safe_message not in self._warnings:
                self._warnings.append(safe_message)
            if normalised_status == "error" and safe_message and safe_message not in self._errors:
                self._errors.append(safe_message)
        return step

    def complete(self, status: object, *, message: str | None = None) -> StartupStep:
        """Close the first service-startup cycle; later monitor checks remain valid."""

        step = self.record("complete", status, message=message)
        with self._lock:
            self._completed_at = step.timestamp
        return step

    def reopen(self) -> None:
        """Start a bounded retry cycle after a terminal startup failure.

        The monitor calls this only after its retry backoff.  It keeps the
        same reporter instance and current resource progress, but removes the
        old terminal result so a later successful validation is not masked by
        a stale error in the public diagnostics response.
        """

        with self._lock:
            self._completed_at = None
            self._steps.pop("complete", None)
            self._warnings.clear()
            self._errors.clear()

    def set_progress(self, progress: Mapping[str, object] | None) -> None:
        """Publish a bounded startup-progress snapshot from a worker.

        The caller owns the underlying I/O.  A deep copy prevents a polling
        diagnostics client from observing a mutable registry dictionary while
        its download thread is updating it.
        """

        snapshot = deepcopy(dict(progress)) if isinstance(progress, Mapping) else None
        with self._lock:
            self._progress = snapshot

    @property
    def completed(self) -> bool:
        with self._lock:
            return self._completed_at is not None

    def step_status(self, step_id: str) -> StartupStepStatus | None:
        with self._lock:
            step = self._steps.get(str(step_id or "").strip().lower())
            return step.status if step is not None else None

    def readiness_payload(self) -> dict[str, object]:
        """Return whether a new project may safely use startup resources.

        Liveness is intentionally separate from this result: ``/health`` can
        remain OK while cache downloads are running so the UI can show their
        real progress.  ``projectReady`` is false until the monitor closes its
        first cycle and every mandatory NGA/configuration step is successful.
        ERP failures are visible but degrade to the documented nominal-
        rotation path instead of making manual Cowell permanently unusable.
        """

        with self._lock:
            return self._readiness_payload_locked()

    def _readiness_payload_locked(self) -> dict[str, object]:
        steps = self._steps
        pending: list[dict[str, object]] = []
        blockers: list[dict[str, object]] = []
        degradations: list[dict[str, object]] = []

        def item(step_id: str, step: StartupStep | None, *, fallback_status: str) -> dict[str, object]:
            return {
                "id": step_id,
                "status": step.status if step is not None else fallback_status,
                "message": step.message if step is not None else None,
            }

        for step_id in _PROJECT_REQUIRED_STEPS:
            step = steps.get(step_id)
            if step is None or step.status == "pending":
                pending.append(item(step_id, step, fallback_status="pending"))
                continue
            if step_id in _PROJECT_BLOCKING_STEPS and step.status != "ok":
                blockers.append(item(step_id, step, fallback_status="error"))
            elif step_id in _PROJECT_DEGRADABLE_STEPS and step.status != "ok":
                degradations.append(item(step_id, step, fallback_status="warning"))

        completion = steps.get("complete")
        if completion is None:
            pending.append(item("complete", None, fallback_status="pending"))
        elif completion.status == "pending":
            pending.append(item("complete", completion, fallback_status="pending"))
        elif completion.status == "error":
            blockers.append(item("complete", completion, fallback_status="error"))
        elif completion.status == "warning" and not degradations:
            # A warning produced by an optional monitor probe is still
            # observable in BIT, but should not hide that project readiness is
            # operationally degraded rather than pristine.
            degradations.append(item("complete", completion, fallback_status="warning"))

        if blockers:
            state: StartupReadinessState = "blocked"
            message = (
                "Orbit no esta listo para crear proyectos: corrige los recursos de inicio "
                "indicados y reinicia o vuelve a comprobar el servicio."
            )
        elif pending:
            state = "pending"
            message = "Orbit esta preparando y validando sus recursos; aun no se pueden crear proyectos."
        elif degradations:
            state = "degraded-ready"
            message = (
                "Orbit esta listo para crear proyectos con una degradacion visible; "
                "la rotacion terrestre nominal se usara cuando no haya ERP IERS valido."
            )
        else:
            state = "ready"
            message = "Los recursos de inicio requeridos estan descargados y validados."
        project_ready = state in {"ready", "degraded-ready"}
        return {
            "state": state,
            "ready": project_ready,
            "projectReady": project_ready,
            "completed": self._completed_at is not None,
            "requiredSteps": list(_PROJECT_REQUIRED_STEPS),
            "blockingSteps": sorted(_PROJECT_BLOCKING_STEPS),
            "degradableSteps": sorted(_PROJECT_DEGRADABLE_STEPS),
            "pending": pending,
            "blockers": blockers,
            "degradations": degradations,
            "message": message,
        }

    def payload(self) -> dict[str, object]:
        """Return an API-safe component consumed by the startup overlay and BIT."""

        with self._lock:
            steps = sorted(
                self._steps.values(),
                key=lambda item: (_STEP_ORDER.index(item.step_id) if item.step_id in _STEP_ORDER else len(_STEP_ORDER), item.timestamp),
            )
            statuses = [step.status for step in steps]
            if "error" in statuses:
                status = "error"
            elif "warning" in statuses:
                status = "warning"
            elif self._completed_at is not None:
                status = "ok"
            else:
                status = "pending"
            last_update = max((step.timestamp for step in steps), default=self._started_at)
            errors = list(self._errors)
            warnings = list(self._warnings)
            completed_at = self._completed_at
            started_at = self._started_at
            readiness = self._readiness_payload_locked()
            progress = deepcopy(self._progress)
        return {
            "status": status,
            "ready": readiness["ready"],
            "projectReady": readiness["projectReady"],
            "readiness": readiness,
            "progress": progress,
            "lastValidation": _iso(last_update),
            "details": {
                "startedAt": _iso(started_at),
                "completedAt": _iso(completed_at),
                "steps": [step.payload() for step in steps],
                "warnings": warnings,
                "errors": errors,
                "readiness": readiness,
                "progress": progress,
            },
            "error": errors[0] if errors else None,
        }


__all__ = [
    "StartupReadinessState",
    "StartupStatusReporter",
    "StartupStep",
    "StartupStepStatus",
]
