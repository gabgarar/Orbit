"""Sampling policy for rendering accurate orbital trajectories efficiently.

The renderer joins samples with straight WebGL segments.  Sampling only by
elapsed time makes a low orbit look faceted because it crosses much more angle
per second than a high orbit.  This policy therefore keeps a bounded angular
step per revolution, derived from the TLE mean motion and perigee altitude,
while retaining a shared point budget for large layer sets.
"""

import math


_EARTH_EQUATORIAL_RADIUS_KM = 6378.137
_EARTH_MU_KM3_S2 = 398600.4418


def _finite_number(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def orbital_geometry(propagator: object | None) -> tuple[float, float] | None:
    """Return ``(period_seconds, perigee_altitude_km)`` when TLE data exists.

    ``Satrec.no_kozai`` is the mean motion in radians/minute.  We intentionally
    derive only a sampling density from it; positions themselves remain real
    SGP4 propagations and are never spline-interpolated in the renderer.
    """
    satrec = getattr(propagator, "sat", None)
    mean_motion_rad_min = _finite_number(getattr(satrec, "no_kozai", None))
    if mean_motion_rad_min is None or mean_motion_rad_min <= 0:
        return None

    eccentricity = _finite_number(getattr(satrec, "ecco", 0.0)) or 0.0
    eccentricity = max(0.0, min(eccentricity, 0.999))
    mean_motion_rad_s = mean_motion_rad_min / 60.0
    period_seconds = (2.0 * math.pi) / mean_motion_rad_s
    semi_major_axis_km = (_EARTH_MU_KM3_S2 / (mean_motion_rad_s ** 2.0)) ** (1.0 / 3.0)
    perigee_altitude_km = (semi_major_axis_km * (1.0 - eccentricity)) - _EARTH_EQUATORIAL_RADIUS_KM

    if not (math.isfinite(period_seconds) and period_seconds > 0 and math.isfinite(perigee_altitude_km)):
        return None
    return period_seconds, perigee_altitude_km


def target_angular_step_degrees(perigee_altitude_km: float) -> float:
    """Choose a visual chord tolerance appropriate to the orbit altitude.

    Low orbits get the finest tessellation because their angular velocity is
    highest and their curvature is most apparent when the camera is close.
    Higher orbits keep a larger step to avoid spending the same vertex budget
    on arcs that are visually much less curved.
    """
    if perigee_altitude_km <= 2_000:
        return 0.42  # about 860 vertices per LEO revolution
    if perigee_altitude_km <= 20_000:
        return 0.65
    if perigee_altitude_km <= 40_000:
        return 0.9
    return 1.15


def curvature_sample_count(horizon_hours: float, propagator: object | None) -> int | None:
    """Estimate samples needed to keep each propagated chord visually smooth."""
    geometry = orbital_geometry(propagator)
    if geometry is None:
        return None

    period_seconds, perigee_altitude_km = geometry
    horizon_seconds = horizon_hours * 3600.0
    samples_per_revolution = math.ceil(360.0 / target_angular_step_degrees(perigee_altitude_km))
    revolutions = horizon_seconds / period_seconds
    return max(2, math.ceil(revolutions * samples_per_revolution) + 1)


def compute_auto_samples(
    horizon_hours: float,
    satellites_count: int,
    propagator: object | None,
    minimum_samples: int,
    maximum_samples: int,
    total_points_budget: int,
) -> int:
    """Balance real propagated detail against the shared orbit-point budget."""
    safe_hours = horizon_hours if isinstance(horizon_hours, (int, float)) and horizon_hours > 0 else 12
    seconds_per_sample = 15 if safe_hours <= 1 else (30 if safe_hours <= 6 else (60 if safe_hours <= 24 else 120))
    baseline = int((safe_hours * 3600) / seconds_per_sample) + 1
    curvature_target = curvature_sample_count(safe_hours, propagator)
    requested_samples = max(baseline, curvature_target or 0)
    bounded_baseline = max(minimum_samples, min(maximum_samples, requested_samples))
    # Do not let the nominal minimum bypass the batch budget when a user has
    # activated a very large catalogue. Two vertices are the irreducible
    # render minimum; below the configured minimum is preferable to exceeding
    # the shared memory/network budget for every active layer.
    per_satellite_budget = max(2, total_points_budget // max(1, satellites_count))
    effective_minimum = min(max(2, minimum_samples), per_satellite_budget)
    # The geometry already accounts for the faster angular motion at a low
    # perigee.  Eccentricity remains a small extra margin for the rapid part of
    # highly elliptic paths, but it must never bypass the global budget.
    density_factor = eccentricity_density_factor(propagator)
    density_adjusted = int(round(bounded_baseline * density_factor))
    return max(effective_minimum, min(maximum_samples, density_adjusted, per_satellite_budget))


def eccentricity_density_factor(propagator: object | None) -> float:
    """Allocate more samples for eccentric orbits, where motion varies most."""
    satrec = getattr(propagator, "sat", None)
    if satrec is None:
        return 1.0
    try:
        eccentricity = max(0.0, float(getattr(satrec, "ecco", 0.0) or 0.0))
    except (TypeError, ValueError):
        return 1.0

    factor = 1.0
    if eccentricity >= 0.1:
        factor += min(0.8, eccentricity * 1.2)
    if eccentricity >= 0.25:
        factor += min(1.2, (eccentricity - 0.25) * 2.0)
    if eccentricity >= 0.5:
        factor += min(1.0, (eccentricity - 0.5) * 2.0)
    return max(1.0, min(3.0, factor))
