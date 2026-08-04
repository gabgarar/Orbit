# Orbit service

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

+## Ephemeris equations

Orbit does not re-integrate a tabulated OEM or SP3: it evaluates the segment's declared interpolation. For two consecutive samples and \(\alpha=(t-t_0)/(t_1-t_0)\), the linear route uses:

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

## Limits

- High-fidelity SP3 and OEM are not reduced to TLE semantics.
- No precision, datum or force model is claimed unless the source establishes it.
- Unsupported formats remain explicit limits.
