# Two-body: Keplerian elements and motion

[Propagation](../index.md) · [Two-body](../two-body.md) · [Keplerian elements](../../engineering/keplerian-elements.md)

## Input

Orbit receives a UTC epoch and the six classical elements of an Earth-centred
elliptic orbit.

| Field | UI unit | Use |
| --- | --- | --- |
| `semi_major_axis_km` | km | Size of the ellipse. |
| `eccentricity` | dimensionless | Shape of the ellipse. Only \(0\le e<1\). |
| `inclination_deg` | degrees | Inclination of the orbital plane. |
| `raan_deg` | degrees | Orientation of the ascending node. |
| `argument_of_perigee_deg` | degrees | Perigee orientation in the plane. |
| `mean_anomaly_deg` | degrees | Mean orbital position at the epoch. |

The semimajor axis must be positive, inclination must be between 0° and 180°,
and perigee radius \(a(1-e)\) must remain above Earth's equatorial radius.
Orbit converts angles to radians for internal calculations.

## Analytical advance

In the two-body problem, mean motion depends only on \(a\):

$$
n=\sqrt{\frac{\mu}{a^3}}, \qquad M(t)=M_0+n\,(t-t_0).
$$

\(n\) is in rad/s, \(a\) in km, \(t-t_0\) in s, and \(M\) in rad. Orbit
therefore does not simulate the path minute by minute: it calculates the mean
anomaly directly for the requested epoch.

For an ellipse, position does not move uniformly through space. Orbit solves
the elliptic Kepler equation with a bounded Newton iteration:

$$
M=E-e\sin E.
$$

\(E\) is eccentric anomaly in rad and \(e\) is dimensionless eccentricity.
From \(E\), Orbit creates position and velocity in the perifocal plane, then
rotates them with \(\Omega\), \(i\), and \(\omega\) into `EME2000`.

## What remains constant

Because only central gravity exists, \(a\), \(e\), \(i\), RAAN, and argument
of perigee do not change. Only mean anomaly advances. If you observe nodal
precession, decay, plane changes, or secular variation, those effects come
from another propagator or an output transformation, not from this model.

## Conceptual example

Two queries with the same elements, one at \(t_0\) and another an hour later,
describe the same ellipse. Only the satellite position on that ellipse changes.
This makes the model a useful baseline for locating whether a later difference
comes from J2, drag, or the numerical method itself.
