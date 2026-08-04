"""ITRF/WGS-84 geometry helpers used by the ground-station AOS/LOS service."""

import math


WGS84_SEMI_MAJOR_AXIS_M = 6_378_137.0
WGS84_FLATTENING = 1.0 / 298.257223563
WGS84_ECCENTRICITY_SQUARED = WGS84_FLATTENING * (2.0 - WGS84_FLATTENING)


def elevation_degrees(
    station_latitude_deg: float,
    station_longitude_deg: float,
    satellite_itrf_m: tuple[float, float, float],
    station_height_m: float = 0.0,
) -> float:
    """Return the satellite elevation above a station's local horizon."""
    station_x, station_y, station_z = _itrf_from_geodetic(
        station_latitude_deg,
        station_longitude_deg,
        station_height_m,
    )
    delta_x = satellite_itrf_m[0] - station_x
    delta_y = satellite_itrf_m[1] - station_y
    delta_z = satellite_itrf_m[2] - station_z

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


def _itrf_from_geodetic(
    latitude_deg: float,
    longitude_deg: float,
    height_m: float = 0.0,
) -> tuple[float, float, float]:
    """Return WGS-84 geodetic coordinates in Orbit's terrestrial frame.

    The former spherical approximation displaced high-latitude stations by
    kilometres. WGS-84 is sufficiently aligned with ITRF for the app's ground
    station metadata; an explicitly realized station catalogue can replace
    this adapter later without changing visibility consumers.
    """

    latitude = math.radians(latitude_deg)
    longitude = math.radians(longitude_deg)
    sine_latitude, cosine_latitude = math.sin(latitude), math.cos(latitude)
    radius = WGS84_SEMI_MAJOR_AXIS_M / math.sqrt(1.0 - (WGS84_ECCENTRICITY_SQUARED * sine_latitude * sine_latitude))
    return (
        (radius + height_m) * cosine_latitude * math.cos(longitude),
        (radius + height_m) * cosine_latitude * math.sin(longitude),
        ((radius * (1.0 - WGS84_ECCENTRICITY_SQUARED)) + height_m) * sine_latitude,
    )
