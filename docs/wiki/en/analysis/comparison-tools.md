# Propagator comparison

[Analysis](index.md){ .md-button } [Propagation](../propagation/overview.md){ .md-button }

Orbit has an **internal, UI-free** calculation foundation for a future
propagator-comparison tool. There is not yet a public HTTP endpoint, table, or
screen: the contract is currently available only through the Python service
`compare_trajectories(...)`. This keeps scientific results independent from a
renderer or hidden coordinate conversion.

## Safe contract

Each input is a sequence of `StateVector` objects. A `StateVector` already
declares SI Cartesian components, an aware epoch, time scale, centre, and a
non-ambiguous frame. Before computing an error, the comparator requires:

| Field | Rule |
| --- | --- |
| Units | Position in **m** and velocity in **m/s**; renderer tuples and untyped km values are not accepted. |
| Epochs | The same sample count, strictly increasing order, and exact equal epochs in both series. |
| Frame | The same frame **and realization** (for example, it cannot mix ITRF and ITRF2020). |
| Time | The same declared time scale; GPS, UTC, and UT1 are never converted inside the comparison. |
| Centre | The same centre, normally `EARTH`. |
| Velocity | Both series supply it for every sample, or both are position-only. Missing components are never silently omitted. |

The comparator does not transform frames, interpolate samples, or download ERP,
EOP, or leap-second data. An ITRF→ECI route must have already been completed
and validated with its ERP, realization route, and temporal data; otherwise the
operation is rejected.
It also rejects a vector subtraction that overflows the numerical range rather
than publishing an infinite metric as though it were a physical result.

Reference and candidate display names are required for traceability. Optional
`reference_model_id` and `candidate_model_id` fields only describe provenance;
they do not make different mathematical models equivalent.

!!! warning "Models are not automatically equivalent"

    A TLE interpreted by SGP4 is not the same mathematical object as a manual
    osculating state integrated by Cowell. A difference between them is not,
    on its own, a propagation error.

## Metrics and thresholds

At every common epoch the service computes the Euclidean norm of position error
in m and, when supplied, velocity error in m/s. It separately returns:

- arithmetic mean error;
- RMS: `sqrt(mean(error²))`;
- maximum;
- p50, p95, and p99 using linear interpolation at rank `(n - 1) × p / 100`;
- per-sample error and the first threshold breach.

A threshold is breached only when `error > threshold`; an exactly equal value
remains in bounds. Thresholds must be finite and non-negative, and a velocity
threshold cannot be supplied for position-only trajectories.

## Future service use

A future UI/API must sample its propagators on a common, already validated
frame/time grid before invoking the service:

```python
from orbit_api.application.propagator_comparison import compare_trajectories

result = compare_trajectories(
    reference_states,
    candidate_states,
    reference_name="IGS Final SP3",
    candidate_name="Cowell RK4",
    reference_model_id="sp3",
    candidate_model_id="cowell-rk4",
    position_threshold_m=100.0,
    velocity_threshold_m_s=0.1,
)
```

The future presentation may render `result.samples`, `result.position`, and
`result.velocity`, but must not change their units, alignment, or contract.
Source selection, an explicit time grid, an authorized common-frame transform,
configuration persistence, and truth/uncertainty presentation remain future
work.

## Related references

- [SGP4](../propagation/sgp4.md)
- [Two bodies](../propagation/two-body.md)
- [Cowell](../propagation/cowell.md)
- [Coordinate systems](../engineering/coordinate-systems.md)
