"""Validated request contracts shared by HTTP endpoint handlers."""

import datetime
import math
from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator

from orbit_api.core.settings import (
    AUTO_MAX_ORBIT_SAMPLES,
    PROPAGATION_HOURS_MAX,
    PROPAGATION_HOURS_MIN,
)


class TleSourceRequest(BaseModel):
    """Request base that accepts either a known satellite or explicit TLE lines."""

    sat_id: str | None = None
    line1: str | None = None
    line2: str | None = None

    @model_validator(mode="after")
    def validate_source(self):
        has_satellite = bool(self.sat_id and self.sat_id.strip())
        has_tle = bool(self.line1 and self.line2 and self.line1.strip() and self.line2.strip())
        if not has_satellite and not has_tle:
            raise ValueError("Debes enviar sat_id o line1+line2")
        return self


class PropagationRequest(TleSourceRequest):
    at: datetime.datetime | None = None


class OrbitRequest(TleSourceRequest):
    horizon_hours: float = Field(
        default=12.0,
        ge=PROPAGATION_HOURS_MIN,
        le=PROPAGATION_HOURS_MAX,
    )
    samples: int | None = Field(default=None, ge=2, le=AUTO_MAX_ORBIT_SAMPLES)


class StationInput(BaseModel):
    lat_deg: float = Field(ge=-90, le=90)
    lon_deg: float = Field(ge=-180, le=180)
    min_elevation_deg: float = Field(default=10.0, ge=0, le=90)


class EphemerisRequest(TleSourceRequest):
    start_time: datetime.datetime
    end_time: datetime.datetime
    step_seconds: float = Field(default=30.0, gt=0, le=3600)
    include_velocity: bool = True

    @model_validator(mode="after")
    def validate_time_range(self):
        if self.end_time <= self.start_time:
            raise ValueError("end_time debe ser mayor que start_time")
        return self


class AosLosRequest(TleSourceRequest):
    station: StationInput
    start_time: datetime.datetime
    end_time: datetime.datetime
    step_seconds: float = Field(default=10.0, gt=0, le=600)

    @model_validator(mode="after")
    def validate_time_range(self):
        if self.end_time <= self.start_time:
            raise ValueError("end_time debe ser mayor que start_time")
        return self


class CartesianVectorInput(BaseModel):
    """A finite three-component vector used by the manual-orbit API."""

    x: float
    y: float
    z: float

    @field_validator("x", "y", "z")
    @classmethod
    def validate_finite_component(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("Los componentes del vector deben ser finitos")
        return value


class ManualKeplerianInput(BaseModel):
    """Classical elliptic elements accepted by the manual-orbit editor.

    The public API accepts its snake_case fields as well as the camelCase
    names emitted by the React editor.  Angles are expressed in degrees and
    the semi-major axis is expressed in kilometres.
    """

    model_config = ConfigDict(populate_by_name=True)

    semi_major_axis_km: float = Field(
        validation_alias=AliasChoices("semi_major_axis_km", "semiMajorAxisKm"),
        gt=0,
        le=500_000,
    )
    eccentricity: float = Field(ge=0, lt=1)
    inclination_deg: float = Field(
        validation_alias=AliasChoices("inclination_deg", "inclinationDeg"),
        ge=0,
        le=180,
    )
    raan_deg: float = Field(
        validation_alias=AliasChoices("raan_deg", "raanDeg"),
    )
    argument_of_perigee_deg: float = Field(
        validation_alias=AliasChoices(
            "argument_of_perigee_deg",
            "argumentOfPerigeeDeg",
            "argument_of_periapsis_deg",
            "argumentOfPeriapsisDeg",
        ),
    )
    true_anomaly_deg: float | None = Field(
        default=None,
        validation_alias=AliasChoices("true_anomaly_deg", "trueAnomalyDeg"),
    )
    mean_anomaly_deg: float | None = Field(
        default=None,
        validation_alias=AliasChoices("mean_anomaly_deg", "meanAnomalyDeg"),
    )

    @field_validator(
        "semi_major_axis_km",
        "eccentricity",
        "inclination_deg",
        "raan_deg",
        "argument_of_perigee_deg",
        "true_anomaly_deg",
        "mean_anomaly_deg",
    )
    @classmethod
    def validate_finite_value(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("Los elementos keplerianos deben ser finitos")
        return value

    @model_validator(mode="after")
    def validate_anomaly(self):
        if self.true_anomaly_deg is None and self.mean_anomaly_deg is None:
            raise ValueError("Debes enviar true_anomaly_deg o mean_anomaly_deg")
        return self


class ManualStateVectorInput(BaseModel):
    """ECI Cartesian state in km and km/s for a manual orbit.

    Besides the canonical nested shape, this model accepts the six flat
    camelCase fields used by the editor.  Keeping the compatibility here
    leaves the HTTP boundary stable while the editor evolves.
    """

    model_config = ConfigDict(populate_by_name=True)

    position_eci_km: CartesianVectorInput = Field(
        validation_alias=AliasChoices(
            "position_eci_km", "positionEciKm", "position_km", "positionKm"
        ),
    )
    velocity_eci_km_s: CartesianVectorInput = Field(
        validation_alias=AliasChoices(
            "velocity_eci_km_s", "velocityEciKmS", "velocity_km_s", "velocityKmS"
        ),
    )

    @model_validator(mode="before")
    @classmethod
    def accept_flat_editor_fields(cls, value):
        if not isinstance(value, dict):
            return value
        payload = dict(value)
        if not any(key in payload for key in ("position_eci_km", "positionEciKm", "position_km", "positionKm")):
            keys = ("positionXKm", "positionYKm", "positionZKm")
            if any(key in payload for key in keys):
                payload["positionEciKm"] = {
                    "x": payload.get("positionXKm"),
                    "y": payload.get("positionYKm"),
                    "z": payload.get("positionZKm"),
                }
        if not any(key in payload for key in ("velocity_eci_km_s", "velocityEciKmS", "velocity_km_s", "velocityKmS")):
            keys = ("velocityXKmS", "velocityYKmS", "velocityZKmS")
            if any(key in payload for key in keys):
                payload["velocityEciKmS"] = {
                    "x": payload.get("velocityXKmS"),
                    "y": payload.get("velocityYKmS"),
                    "z": payload.get("velocityZKmS"),
                }
        return payload


class ManualOrbitRequest(BaseModel):
    """Validated request for a transient, synthetic-TLE manual orbit.

    The selected representation is authoritative.  When both representations
    are included (the normal UI synchronization case), ``definition_source``
    picks one; Keplerian elements are used by default for backwards-compatible
    direct API clients.
    """

    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(default="Manual orbit", min_length=1, max_length=120)
    epoch: datetime.datetime = Field(
        validation_alias=AliasChoices("epoch", "epoch_utc", "epochUtc"),
    )
    propagator: str = Field(default="sgp4", min_length=1, max_length=40)
    definition_source: Literal["keplerian", "state_vector"] | None = Field(
        default=None,
        validation_alias=AliasChoices("definition_source", "definitionSource", "source"),
    )
    keplerian: ManualKeplerianInput | None = None
    state_vector: ManualStateVectorInput | None = Field(
        default=None,
        validation_alias=AliasChoices("state_vector", "stateVector"),
    )
    start_time: datetime.datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("start_time", "startTime"),
    )
    end_time: datetime.datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("end_time", "endTime"),
    )
    horizon_hours: float | None = Field(
        default=None,
        validation_alias=AliasChoices("horizon_hours", "horizonHours"),
        gt=0,
        le=24.0 * 365.0,
    )
    step_seconds: float = Field(
        default=30.0,
        validation_alias=AliasChoices("step_seconds", "stepSeconds"),
        gt=0,
        le=3600,
    )
    include_velocity: bool = Field(
        default=True,
        validation_alias=AliasChoices("include_velocity", "includeVelocity"),
    )

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("El nombre de la órbita no puede estar vacío")
        if "\n" in cleaned or "\r" in cleaned:
            raise ValueError("El nombre de la órbita no puede contener saltos de línea")
        return cleaned

    @field_validator("epoch", "start_time", "end_time")
    @classmethod
    def normalize_utc(cls, value: datetime.datetime | None) -> datetime.datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=datetime.UTC) if value.tzinfo is None else value.astimezone(datetime.UTC)

    @field_validator("propagator")
    @classmethod
    def normalize_propagator(cls, value: str) -> str:
        cleaned = value.strip().lower()
        if not cleaned:
            raise ValueError("Debes seleccionar un propagador")
        return cleaned

    @field_validator("definition_source", mode="before")
    @classmethod
    def normalize_definition_source(cls, value):
        if value is None:
            return None
        normalized = str(value).strip().replace("-", "_")
        if normalized.lower() == "statevector":
            return "state_vector"
        return normalized.lower()

    @model_validator(mode="after")
    def validate_definition_and_range(self):
        if self.keplerian is None and self.state_vector is None:
            raise ValueError("Debes enviar keplerian o state_vector")
        if self.definition_source == "keplerian" and self.keplerian is None:
            raise ValueError("definition_source keplerian requiere elementos keplerianos")
        if self.definition_source == "state_vector" and self.state_vector is None:
            raise ValueError("definition_source state_vector requiere un vector de estado")
        if self.end_time is not None and self.start_time is not None and self.end_time <= self.start_time:
            raise ValueError("end_time debe ser mayor que start_time")
        return self
