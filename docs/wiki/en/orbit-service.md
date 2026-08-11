# Ephemerides and interpolation

## Overview

The Python service validates the orbital domain, adapts formats, propagates, transforms frames and provides analysis primitives. It is reached through the gateway, never as an independent public server.

## Formats

| Format | Contract |
| --- | --- |
| TLE | SGP4 input; TEME native frame. |
| OMM / OPM | Orbital-element and parameter interchange. |
| OEM | Cartesian ephemerides with per-segment frame, scale and covariance. |
| SP3 | Prepared for precise ingestion; terrestrial realization remains explicit. |
| CPF / RINEX | Coverage is declared as supported, partial or unsupported. |

An OEM segment retains its scale and frame. Covariance must be transformable to state frame; otherwise import fails before unsafe data relabelling occurs.

## Catalogue, analysis and export

The service inspects records, creates manual orbits, analyses and produces format-aware outputs. Propagator comparison, plots, statistics, events, measures, tracking and OD scope retain state identity, epoch and applied transforms.

## Evaluation, interpolation, and visualisation

In Orbit, “interpolation” can mean three different things. They must not be
confused:

1. **Physical/source evaluation**: how the backend obtains a state at a
   requested epoch.
2. **Ephemeris sampling**: the discrete epochs requested from the backend for
   an export, drawn orbit, or range simulation.
3. **Visual playback**: how the browser moves a marker between two already
   computed vertices. It does not alter the physical model or turn a polyline
   into a new precise source.

The following matrix describes the contract implemented today.

| Source or engine | Backend state evaluation | Outside coverage / between samples | Current UI playback |
| --- | --- | --- | --- |
| [TLE](formats/tle.md) and [OMM with TLE](formats/omm.md) | `SGP4Propagator` calls `Satrec.sgp4` directly at each requested UTC epoch. It neither interpolates a table nor integrates RK4. | Validity is that of SGP4/TLE; there is no tabulated ephemeris to extrapolate. | The line is a polyline joining independently evaluated SGP4 samples. The brief real-time marker smoothing between messages is linear and visual only. |
| [SP3](formats/sp3.md) | `Sp3StateProvider` enforces bounded local Lagrange: degree `min(9, n-1)`, with up to ten samples. It does not use a file-declared interpolation policy. | One sample allows only an exact-epoch lookup. With two or more, the window is adjusted at coverage edges and never extrapolates. | The already sampled range received by the browser is replayed linearly between vertices; JavaScript does not run Lagrange again. |
| [OEM](formats/oem.md), Python `OemStateProvider` reader | It honours segment `INTERPOLATION`: no declaration uses linear; `LINEAR` requires degree 1; `LAGRANGE` uses `degree + 1` records; `HERMITE` uses position and velocity, an odd degree, and `(degree + 1)/2` records. | It neither interpolates across segments nor extrapolates. Covariance is attached only at its exact epoch. | The viewer's OEM import is a separate local route: it retains points and replays them linearly. It does not currently interpret OEM `INTERPOLATION` or `INTERPOLATION_DEGREE`. |
| Manual [two-body](propagation/two-body.md) orbit | Direct analytical solution: advances mean anomaly and solves Kepler at the requested epoch. There is no state mesh or interpolation. | No tabulated coverage applies. | The manual response is drawn from backend-computed points; the marker uses linear visual interpolation between those points. |
| Manual [Cowell/RK4](propagation/cowell.md) orbit | Integrates to the requested epoch from the nearest cached state, using fixed-step RK4 with a 60 s maximum step and a final shortened step when needed. | Cached states are not interpolated; the remaining interval is integrated, including backwards. | As for two-body: the received path is a polyline and its marker replays vertices linearly. |
| Manual J2+J3+J4 preset | Compatibility preset; delegates to Cowell's same fixed-step RK4 core, without drag. | It does not interpolate the cache. | Same as Cowell. |
| [OPM](formats/opm.md) | No parser, state provider, or propagator is implemented. | Not applicable. | Not applicable. |

!!! warning "Visual interpolation is not propagation"

    The browser joins a trajectory's points with straight segments and, on a
    timeline, linearly interpolates position between two samples with valid
    timestamps. This is smooth playback of already computed data. For SP3 or
    OEM it does not replace backend interpolation; for TLE, two-body, or
    Cowell it does not replace direct model evaluation. Outside a valid track
    range, the object is marked out of time rather than visually extending the
    trajectory.

### GNSS ancillary products

Precise-product companions do not provide a second orbital interpolation:

| File | Method used today |
| --- | --- |
| SP3 | It is the only source of position and optional `V` velocity. A velocity is interpolated only when every selected Lagrange node carries it; Orbit does not derive it from SP3 positions or manufacture acceleration. |
| ERP | `IgsErpEarthOrientationProvider` linearly interpolates in coverage `UT1-UTC`, `xp`, `yp`, and LOD when it is present at both endpoints. ERP v2 does not publish `dX`/`dY`; Orbit fixes them to zero rather than inferring them from that file. It does not extrapolate by default. It supplies Earth orientation for the enabled inertial route. |
| CLK | Satellite clock samples are parsed and retained; there is no `at()` method or clock interpolation that changes the orbit. |
| SUM, ATT/OBX, and OSB/BIA | They are retained as provenance and ancillary files. Today they do not feed a temporal evaluation, interpolation, or orbit geometry. |

See [Precise GNSS products](formats/precise-products.md) for each file's
fields and [SP3](formats/sp3.md) for the per-satellite Lagrange window.

## Ephemeris equations

The following equations describe tabulated providers. In particular, OEM can
declare its segment method; SP3 uses Orbit's local Lagrange policy above, not
an SP3 `INTERPOLATION` declaration. For two consecutive samples and
\(\alpha=(t-t_0)/(t_1-t_0)\), the linear route uses:

$$
\mathbf x(t)=(1-\alpha)\mathbf x_0+\alpha\mathbf x_1.
$$

For a Lagrange window, every vector component is evaluated as:

$$
\mathbf x(t)=\sum_{i=0}^{n}\mathbf x_i
\prod_{\substack{j=0\\j\ne i}}^{n}
\frac{t-t_j}{t_i-t_j}.
$$

The Hermite route constructs a polynomial satisfying the declared position and velocity constraints:

$$
H(t_i)=\mathbf r_i,\qquad \dot H(t_i)=\mathbf v_i.
$$

Hermite acceleration is derived from the polynomial, \(\mathbf a(t)=\ddot H(t)\). Orbit does not interpolate covariance: an interpolated result explicitly declares a null covariance.

### Variables, units and Orbit use

Samples \(\mathbf r_i\), \(\mathbf v_i\), and output \(\mathbf r(t)\) are normalised to m and m/s in `StateVector`; \(t\), \(t_i\), and \(\Delta t\) are seconds from the query epoch. Lagrange and Hermite weights are dimensionless, and derived acceleration is m/s². `TabularStateProvider` applies these equations only between samples in the selected segment; it neither interpolates covariance nor invents absent frame, scale, or units.

## Limits

- High-fidelity SP3 and OEM are not reduced to TLE semantics.
- No precision, datum or force model is claimed unless the source establishes it.
- Unsupported formats remain explicit limits.
