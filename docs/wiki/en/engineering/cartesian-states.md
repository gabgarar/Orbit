# Cartesian states

[Home](../index.md) · [Engineering](index.md) · [Reference Frames](reference-frames.md) · [Temporal Systems](time-systems.md)

## Purpose

`StateVector` is the common contract between propagators, ephemeris readers
and frame transformations. It represents a geocentric Cartesian state with
SI units and sufficient metadata to preserve their physical meaning.

It is not a display tag. The position, speed and time are not
They can be interpreted correctly without their framework, time scale and center.

## Contract fields

| Field | Mandatory | Unit or form | Rule |
| --- | ---: | --- | --- |
| `epoch` | Yes | `datetime` with zone | The epoch must be zone/scale aware. |
| `time_scale` | Yes | tag `TimeScale` | It must be a recognized scale. |
| `frame` | Yes | `FrameId` or preserved label | Generic `ECI` and `ECEF` are rejected. |
| `frame_realization` | Yes, if applicable | text | Declare, for example, `ITRF2020` or `IGS20`. |
| `center` | Yes | normalized text | The transformations implemented are geocentric, with `EARTH`. |
| `position_m` | Yes | m | Three finite components. |
| `velocity_m_s` | No | m/s | Three finite components when it exists. |
| `acceleration_m_s2` | No | m/s² | Three finite components when it exists. |
| `covariance` | No | 6×6 matrix IF | It must be finite and of exact dimension. |
| `provenance` | No | immutable map | Preserves origin, transformations and interpolation. |

The `StateVector.from_kilometres` factory exists on the frontier with engines and
formats that use km and km/s. After creating the object, the internal contract always
uses meters, meters per second, and meters per second squared.

## State Convention

The six component vector is:

$$
\mathbf{x}=\begin{bmatrix}\mathbf r\\\mathbf v\end{bmatrix}
=\begin{bmatrix}x&y&z&v_x&v_y&v_z\end{bmatrix}^{T}.
$$

`components()` is only available when speed exists and is retained as
compatibility adapter for historical consumers. The new code must
use named fields or `state_at`/`native_state_at`.

## Validation and normalization

- `J2000` and `EME2K` are normalized to `EME2000`; `ITRS` is normalized to `ITRF`.
- A compact label `ITRF<época>` is expressed as family `ITRF` and
  corresponding realization.
- `IGS20`, `IGb20` and `IGc20` are preserved as family `IGS` with implementation;
  They are not renamed ITRF.
- Non-finite numbers, matrices that are not 6×6 and epochs without zone are
  rejected in construction.

!!! warning "Do not use ECI/ECEF as a contract"

    `ECI` and `ECEF` do not identify a ground reduction or inertial frame
    precise enough. Declare `TEME`, `EME2000`, `GCRF`, `CIRS`,
    `TIRS`, `PEF` or `ITRF`, as applicable.

## Position, velocity and covariance transformation

For a time-dependent rotation matrix \(R(t)\), Orbit applies:

$$
\mathbf r' = R\mathbf r,
\qquad
\mathbf v' = R\mathbf v + \dot R\mathbf r.
$$

When there is acceleration:

$$
\mathbf a' = R\mathbf a + 2\dot R\mathbf v + \ddot R\mathbf r.
$$

The service approximates \(\dot R\) and \(\ddot R\) through central differences
of matrices around the time. If covariance is given, transform
the 6x6 matrix with the kinematic Jacobian containing \(R\) and \(\dot R\).
Covariance is not propagated in time by Orbit propagators.

## Origin

A transformation adds `provenance.frame_transform` to the source frame,
destination, route, reduction model, EOP identity and origin of the
leap seconds table. Tabulated interpolators add
`provenance.tabular_interpolation` with method, grade and times used.

This allows us to distinguish a native state from a transformed or interpolated one without
infer it from its components.

## Limits

- Built-in transformations only support states with center `EARTH`.
- There is no representation of attitude, mass, maneuver or covariance of
  process within `StateVector`.
- The presence of a covariance does not make Orbit a system of
  determination or propagation of uncertainty.

See [Reference frames](reference-frames.md),
[Temporal systems](time-systems.md) and [Ephemeris formats](../formats/overview.md).