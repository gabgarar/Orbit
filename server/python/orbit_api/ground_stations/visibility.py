"""Pure geometry helpers used by the ground-station AOS/LOS service."""

import math


def elevation_degrees(
    station_latitude_deg: float,
    station_longitude_deg: float,
    satellite_ecef_m: tuple[float, float, float],
) -> float:
    """Return the satellite elevation above a station's local horizon."""
    station_x, station_y, station_z = _ecef_from_latlon(station_latitude_deg, station_longitude_deg)
    delta_x = satellite_ecef_m[0] - station_x
    delta_y = satellite_ecef_m[1] - station_y
    delta_z = satellite_ecef_m[2] - station_z

    latitude = math.radians(station_latitude_deg)
    longitude = math.radians(station_longitude_deg)
    sin_latitude, cos_latitude = math.sin(latitude), math.cos(latitude)
    sin_longitude, cos_longitude = math.sin(longitude), math.cos(longitude)

    east = -sin_longitude * delta_x + cos_longitude * delta_y
    north = -sin_latitude * cos_longitude * delta_x - sin_latitude * sin_longitude * delta_y + cos_latitude * delta_z
    up = cos_latitude * cos_longitude * delta_x + cos_latitude * sin_longitude * delta_y + sin_latitude * delta_z
    horizontal = math.sqrt(max(0.0, east * east + north * north))
    return math.degrees(math.atan2(up, horizontal))


def extract_passes(samples: list[dict], minimum_elevation_deg: float) -> list[dict]:
    """Convert elevation samples into AOS/LOS windows."""
    passes: list[dict] = []
    active_pass: dict | None = None

    for sample in samples:
        elevation = float(sample.get("elevation_deg") or -90.0)
        sample_time = sample.get("time")
        if elevation >= minimum_elevation_deg:
            if active_pass is None:
                active_pass = {
                    "aos": sample_time,
                    "los": sample_time,
                    "max_elevation_deg": elevation,
                    "max_elevation_time": sample_time,
                }
            elif elevation > active_pass["max_elevation_deg"]:
                active_pass["max_elevation_deg"] = elevation
                active_pass["max_elevation_time"] = sample_time
            active_pass["los"] = sample_time
        elif active_pass is not None:
            active_pass["los"] = sample_time
            passes.append(active_pass)
            active_pass = None

    if active_pass is not None:
        passes.append(active_pass)
    return passes


def _ecef_from_latlon(latitude_deg: float, longitude_deg: float, radius_m: float = 6_378_137.0) -> tuple[float, float, float]:
    latitude = math.radians(latitude_deg)
    longitude = math.radians(longitude_deg)
    cos_latitude = math.cos(latitude)
    return (
        radius_m * cos_latitude * math.cos(longitude),
        radius_m * cos_latitude * math.sin(longitude),
        radius_m * math.sin(latitude),
    )
