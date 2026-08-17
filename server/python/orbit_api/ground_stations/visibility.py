"""ITRF/WGS-84 geometry helpers used by the ground-station AOS/LOS service."""

import math
from collections.abc import Callable

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


def azimuth_degrees(
    station_latitude_deg: float,
    station_longitude_deg: float,
    satellite_itrf_m: tuple[float, float, float],
    station_height_m: float = 0.0,
) -> float:
    """Return local azimuth clockwise from geodetic north in [-180, 180)."""
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
    east = -math.sin(longitude) * delta_x + math.cos(longitude) * delta_y
    north = (
        -math.sin(latitude) * math.cos(longitude) * delta_x
        - math.sin(latitude) * math.sin(longitude) * delta_y
        + math.cos(latitude) * delta_z
    )
    return ((math.degrees(math.atan2(east, north)) + 180.0) % 360.0) - 180.0


def azimuth_within_limits(azimuth_deg: float, minimum_deg: float, maximum_deg: float) -> bool:
    """Check a wrapped mechanical azimuth interval in [-180, 180)."""
    azimuth = ((float(azimuth_deg) + 180.0) % 360.0) - 180.0
    minimum = ((float(minimum_deg) + 180.0) % 360.0) - 180.0
    maximum = ((float(maximum_deg) + 180.0) % 360.0) - 180.0
    if math.isclose(minimum, maximum, abs_tol=1e-12):
        return True
    return minimum <= azimuth <= maximum if minimum <= maximum else azimuth >= minimum or azimuth <= maximum


def azimuth_is_defined(elevation_deg: float) -> bool:
    """Return whether a horizon azimuth has a physical direction.

    At zenith all azimuth labels describe the same ENU vector.  Mechanical
    azimuth limits must therefore not reject an otherwise reachable zenith
    target merely because ``atan2(0, 0)`` happened to return a display value.
    """

    return abs(math.cos(math.radians(float(elevation_deg)))) > 1e-10


def local_horizon_direction(
    azimuth_deg: float,
    elevation_deg: float,
) -> tuple[float, float, float]:
    """Return an ENU unit vector for a local horizon direction.

    The components are ``(east, north, up)``.  Keeping this conversion in the
    visibility module avoids treating azimuth/elevation coordinate differences
    as physical angles.  In particular, azimuth is undefined at zenith, while
    this vector remains perfectly well defined there.
    """

    azimuth = math.radians(float(azimuth_deg))
    elevation = math.radians(float(elevation_deg))
    horizontal = math.cos(elevation)
    return (
        horizontal * math.sin(azimuth),
        horizontal * math.cos(azimuth),
        math.sin(elevation),
    )


def _dot_product(
    left: tuple[float, float, float],
    right: tuple[float, float, float],
) -> float:
    return (left[0] * right[0]) + (left[1] * right[1]) + (left[2] * right[2])


def _boresight_tangent_axes(
    azimuth_deg: float,
    elevation_deg: float,
) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    """Return the azimuth/elevation tangent axes at an authored boresight.

    The usual ``delta_azimuth / cos(elevation)`` style approximation is
    singular at zenith.  The tangent frame below is built directly in ENU;
    the authored azimuth supplies a meaningful roll reference at zenith for
    an asymmetric (different azimuth/elevation HPBW) antenna pattern.
    """

    azimuth = math.radians(float(azimuth_deg))
    elevation = math.radians(float(elevation_deg))
    # b x elevation_axis. Both vectors are unit length and perpendicular to
    # the boresight for every elevation, including +/- 90 degrees.
    azimuth_axis = (math.cos(azimuth), -math.sin(azimuth), 0.0)
    elevation_axis = (
        -math.sin(elevation) * math.sin(azimuth),
        -math.sin(elevation) * math.cos(azimuth),
        math.cos(elevation),
    )
    return azimuth_axis, elevation_axis


def angular_separation_degrees(
    azimuth_a_deg: float,
    elevation_a_deg: float,
    azimuth_b_deg: float,
    elevation_b_deg: float,
) -> float:
    """Great-circle separation of two ENU horizon directions in degrees."""

    direction_a = local_horizon_direction(azimuth_a_deg, elevation_a_deg)
    direction_b = local_horizon_direction(azimuth_b_deg, elevation_b_deg)
    return math.degrees(math.acos(max(-1.0, min(1.0, _dot_product(direction_a, direction_b)))))


def pattern_offsets_degrees(
    target_azimuth_deg: float,
    target_elevation_deg: float,
    boresight_azimuth_deg: float,
    boresight_elevation_deg: float,
) -> tuple[float, float, float]:
    """Return physical tangent-plane pattern offsets and angular separation.

    The first two values are signed azimuth/elevation offsets in the tangent
    frame of the *boresight*, followed by their great-circle separation.  This
    is the appropriate input for an elliptical Gaussian/cosine pattern.  It
    keeps azimuth from becoming an artificial 180-degree error at zenith.
    """

    target = local_horizon_direction(target_azimuth_deg, target_elevation_deg)
    boresight = local_horizon_direction(boresight_azimuth_deg, boresight_elevation_deg)
    dot = max(-1.0, min(1.0, _dot_product(target, boresight)))
    separation_rad = math.acos(dot)
    separation_deg = math.degrees(separation_rad)
    if separation_rad <= 1e-12:
        return 0.0, 0.0, 0.0

    azimuth_axis, elevation_axis = _boresight_tangent_axes(
        boresight_azimuth_deg,
        boresight_elevation_deg,
    )
    # ``atan2(tangent, axial)`` gives signed angular coordinates in the
    # boresight tangent frame. Unlike a raw delta azimuth it remains finite
    # at zenith, and it is the same ENU-vector convention used by the station
    # designer. At the antipode the pattern will reach its conservative
    # side-lobe floor regardless of the arbitrary tangent orientation.
    tangent_azimuth = math.degrees(math.atan2(_dot_product(target, azimuth_axis), dot))
    tangent_elevation = math.degrees(math.atan2(_dot_product(target, elevation_axis), dot))
    return (
        tangent_azimuth,
        tangent_elevation,
        separation_deg,
    )


def directional_pattern_loss_db(
    pattern_type: str,
    hpbw_azimuth_deg: float,
    hpbw_elevation_deg: float,
    side_lobe_level_db: float,
    azimuth_offset_deg: float,
    elevation_offset_deg: float,
) -> float:
    """Return the directional loss relative to boresight, in dB.

    This is intentionally the same compact Gaussian/cosine model used by the
    station designer. It is not a measured antenna pattern; its purpose is to
    make AOS/LOS apply the same link-budget range reduction as the live scene.
    """
    hpbw_azimuth = max(float(hpbw_azimuth_deg), 1e-6)
    hpbw_elevation = max(float(hpbw_elevation_deg), 1e-6)
    normalized_offset = math.hypot(
        float(azimuth_offset_deg) / (hpbw_azimuth / 2.0),
        float(elevation_offset_deg) / (hpbw_elevation / 2.0),
    )
    if pattern_type == "cosine":
        half_power_deg = math.sqrt(hpbw_azimuth * hpbw_elevation) / 2.0
        cosine_at_half_power = math.cos(math.radians(half_power_deg))
        exponent = math.log(0.5) / math.log(cosine_at_half_power) if cosine_at_half_power > 0 else 1.0
        cosine = max(0.0, math.cos(math.radians(normalized_offset * half_power_deg)))
        main_lobe_loss = 10.0 * math.log10(cosine**exponent) if cosine > 0 else -math.inf
    else:
        main_lobe_loss = -3.0 * (normalized_offset**2)
    return max(main_lobe_loss, -max(0.0, float(side_lobe_level_db)))


def directional_pattern_loss_for_directions_db(
    pattern_type: str,
    hpbw_azimuth_deg: float,
    hpbw_elevation_deg: float,
    side_lobe_level_db: float,
    target_azimuth_deg: float,
    target_elevation_deg: float,
    boresight_azimuth_deg: float,
    boresight_elevation_deg: float,
) -> tuple[float, float]:
    """Return pattern loss and physical boresight separation for a target.

    ``directional_pattern_loss_db`` remains available for consumers that
    already own local tangent offsets.  AOS/LOS must use this direction-based
    adapter so it never derives a gain error from the undefined azimuth at
    zenith.
    """

    azimuth_offset, elevation_offset, separation = pattern_offsets_degrees(
        target_azimuth_deg,
        target_elevation_deg,
        boresight_azimuth_deg,
        boresight_elevation_deg,
    )
    return (
        directional_pattern_loss_db(
            pattern_type,
            hpbw_azimuth_deg,
            hpbw_elevation_deg,
            side_lobe_level_db,
            azimuth_offset,
            elevation_offset,
        ),
        separation,
    )


def directional_range_km(boresight_range_km: float | None, gain_loss_db: float) -> float | None:
    """Scale a boresight range using the free-space ``20 log10(R)`` law."""
    if boresight_range_km is None:
        return None
    return float(boresight_range_km) * (10.0 ** (float(gain_loss_db) / 20.0))


def channel_bandwidth_compatible(
    transmit_frequency_hz: float | None,
    transmit_bandwidth_hz: float | None,
    receive_frequency_hz: float | None,
    receive_bandwidth_hz: float | None,
) -> bool | None:
    """Return whether a transmit channel fits inside a receiver passband.

    A real link profile must provide both centres and both occupied/noise
    bandwidths.  Returning ``None`` for incomplete metadata prevents the
    planner from inventing a compatible channel.  Where all values exist, the
    interval test is ``|f_tx - f_rx| + B_tx / 2 <= B_rx / 2``.
    """

    values = (
        transmit_frequency_hz,
        transmit_bandwidth_hz,
        receive_frequency_hz,
        receive_bandwidth_hz,
    )
    if any(value is None for value in values):
        return None
    try:
        transmit_frequency, transmit_bandwidth, receive_frequency, receive_bandwidth = (
            float(value) for value in values
        )
    except (TypeError, ValueError):
        return None
    if not all(math.isfinite(value) and value > 0 for value in (
        transmit_frequency,
        transmit_bandwidth,
        receive_frequency,
        receive_bandwidth,
    )):
        return None
    return abs(transmit_frequency - receive_frequency) + (transmit_bandwidth / 2.0) <= (receive_bandwidth / 2.0)


def slant_range_km(
    station_latitude_deg: float,
    station_longitude_deg: float,
    satellite_itrf_m: tuple[float, float, float],
    station_height_m: float = 0.0,
) -> float:
    """Return geometric station-to-satellite range in kilometres."""
    station_x, station_y, station_z = _itrf_from_geodetic(
        station_latitude_deg,
        station_longitude_deg,
        station_height_m,
    )
    delta_x = satellite_itrf_m[0] - station_x
    delta_y = satellite_itrf_m[1] - station_y
    delta_z = satellite_itrf_m[2] - station_z
    return math.sqrt((delta_x * delta_x) + (delta_y * delta_y) + (delta_z * delta_z)) / 1_000.0


def extract_passes(
    samples: list[dict],
    minimum_elevation_deg: float,
    *,
    refine_transition: Callable[[dict, dict], str | None] | None = None,
) -> list[dict]:
    """Convert visibility samples into AOS/LOS windows.

    ``refine_transition`` may provide the physical mask/RF crossing between
    two adjacent samples.  Keeping the coarse samples in the response makes
    plots inexpensive, while the pass table is no longer displaced to the
    next 30-second sample merely because the transition happened in between.
    """
    extractor = PassExtractor(
        minimum_elevation_deg,
        refine_transition=refine_transition,
    )
    for sample in samples:
        extractor.push(sample)
    return extractor.finish()


class PassExtractor:
    """Incrementally extract AOS/LOS windows from ordered visibility samples.

    The HTTP route may scan a long design window in bounded ephemeris chunks.
    Retaining only the previous sample and the currently-open pass lets that
    route keep the exact same transition/refinement semantics as
    :func:`extract_passes`, without materialising a potentially large chart
    sequence for an event-only client. A chunk boundary is deliberately not a
    pass boundary: callers feed every non-duplicate sample into one instance.
    """

    def __init__(
        self,
        minimum_elevation_deg: float,
        *,
        refine_transition: Callable[[dict, dict], str | None] | None = None,
    ) -> None:
        self.minimum_elevation_deg = float(minimum_elevation_deg)
        self.refine_transition = refine_transition
        self.passes: list[dict] = []
        self.active_pass: dict | None = None
        self.previous_sample: dict | None = None

    def push(self, sample: dict) -> None:
        """Consume the next ordered visibility sample."""

        elevation = float(sample.get("elevation_deg") or -90.0)
        sample_time = sample.get("time")
        is_visible = bool(sample.get("visible")) if "visible" in sample else elevation >= self.minimum_elevation_deg
        if is_visible:
            if self.active_pass is None:
                previous_visible = (
                    bool(self.previous_sample.get("visible"))
                    if self.previous_sample and "visible" in self.previous_sample
                    else False
                )
                aos = (
                    self.refine_transition(self.previous_sample, sample)
                    if self.refine_transition and self.previous_sample and not previous_visible
                    else None
                )
                self.active_pass = {
                    "aos": aos or sample_time,
                    "los": sample_time,
                    "max_elevation_deg": elevation,
                    "max_elevation_time": sample_time,
                }
            elif elevation > self.active_pass["max_elevation_deg"]:
                self.active_pass["max_elevation_deg"] = elevation
                self.active_pass["max_elevation_time"] = sample_time
            self.active_pass["los"] = sample_time
        elif self.active_pass is not None:
            los = (
                self.refine_transition(self.previous_sample, sample)
                if self.refine_transition and self.previous_sample
                else None
            )
            # The previous visible vertex is a conservative fallback.  Never
            # publish the first *invisible* sample as LOS.
            self.active_pass["los"] = (
                los
                or self.previous_sample.get("time")
                or self.active_pass["los"]
            )
            self.passes.append(self.active_pass)
            self.active_pass = None
        self.previous_sample = sample

    def finish(self) -> list[dict]:
        """Close an access window that remains visible at the final sample."""

        if self.active_pass is not None:
            self.passes.append(self.active_pass)
            self.active_pass = None
        return list(self.passes)


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
