# Two-body propagation

[Start](../index.md) · [Propagation](index.md) · [Keplerian elements](../engineering/keplerian-elements.md) · [Point mass](point-mass.md)

## Model

`TwoBodyPropagator` evolves an elliptical manual orbit under central gravity
ideal. The model solves the Kepler equation and generates the Cartesian state
native in `EME2000`.

$$
\ddot{\mathbf r}=-\mu\frac{\mathbf r}{\lVert\mathbf r\rVert^3}.
$$

It does not integrate the movement numerically. The cost per epoch is that of advancing
elements and solve Kepler's equation, without history of force steps.

## Entries

| Field | Requirement |
| --- | --- |
| Period | UTC instant of manual design. |
| Elements | `semi_major_axis_km`, `eccentricity`, `inclination_deg`, `raan_deg`, `argument_of_perigee_deg`, `mean_anomaly_deg`. |
| Eccentricity | \(0\le e<1\) only. |
| Perigee | It must be above the Earth's equatorial radius. |

The complete specification of the elements is in
[Keplerian elements](../engineering/keplerian-elements.md).

## Output

| Method | Result |
| --- | --- |
| `native_state_at` | State IF `EME2000`, UTC, center `EARTH`. |
| `state_at` | Native state transformed to the requested framework. |
| Legacy Adapters | Six ITRF SI components for renderer. |

Historical `propagate_eci_datetime` method names are preserved as
`propagate_eme2000_datetime` alias; do not authorize the use of `ECI` as a framework
of the contract.

## Hypotheses and limits

- Only terrestrial, elliptical and linked orbits.
- Without oblateness, drag, third bodies, SRP, relativity or maneuvers.
- No covariance propagation, event detection or adaptive integration.
- ITRF output requires frame transformation and its EOP policy.

Use [Cowell](cowell.md) when it is necessary to compose force terms
available; do not interpret that route as a high fidelity model.