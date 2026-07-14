"""Validated request contracts shared by HTTP endpoint handlers."""

import datetime

from pydantic import BaseModel, Field, model_validator

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
