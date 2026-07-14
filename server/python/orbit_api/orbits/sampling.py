"""Sampling policy for rendering accurate orbital trajectories efficiently."""


def compute_auto_samples(
    horizon_hours: float,
    satellites_count: int,
    propagator: object | None,
    minimum_samples: int,
    maximum_samples: int,
    total_points_budget: int,
) -> int:
    """Balance temporal detail against the shared orbit-point budget."""
    safe_hours = horizon_hours if isinstance(horizon_hours, (int, float)) and horizon_hours > 0 else 12
    seconds_per_sample = 15 if safe_hours <= 1 else (30 if safe_hours <= 6 else (60 if safe_hours <= 24 else 120))
    baseline = int((safe_hours * 3600) / seconds_per_sample) + 1
    bounded_baseline = max(minimum_samples, min(maximum_samples, baseline))
    per_satellite_budget = max(minimum_samples, total_points_budget // max(1, satellites_count))
    density_adjusted = int(round(bounded_baseline * eccentricity_density_factor(propagator)))
    return max(minimum_samples, min(density_adjusted, per_satellite_budget))


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
