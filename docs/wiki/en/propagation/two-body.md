# Two-body propagation

[Home](../index.md) · [Propagation](index.md) · [Propagators](overview.md)

## Overview

`TwoBodyPropagator` is Orbit's analytical Kepler propagator for a manual
Earth orbit. It starts with Keplerian elements at an epoch, advances mean
anomaly, and solves Kepler's equation to obtain a native Cartesian state in
`EME2000`.

It is the simplest model for understanding a bound orbit: central gravity is
the only acceleration. It does not use RK4, retain a step cache, or include
J2, drag, manoeuvres, or any other effect.

$$
\ddot{\mathbf r}=-\mu\frac{\mathbf r}{\lVert\mathbf r\rVert^3}.
$$

Here \(\mathbf r\) is position from Earth's centre in km,
\(\mu=398600.4418\ \mathrm{km^3\,s^{-2}}\) is Earth's gravitational
parameter, and acceleration is in \(\mathrm{km\,s^{-2}}\).

## Why use two-body

- It is deterministic, fast, and easy to interpret.
- It is a baseline for comparing SGP4 and Cowell.
- It helps validate Keplerian elements, frames, and state conversions before
  additional physics is introduced.
- For one epoch and one set of elements, it does not depend on a step size or
  numerical tolerances.

## Module guide

| Topic | What you will learn |
| --- | --- |
| [Keplerian elements and motion](two-body/keplerian-motion.md) | How Orbit advances an elliptic orbit and the unit of each variable. |
| [Time and frames](two-body/time-and-frames.md) | How UTC, TT, UT1, and EOP participate in the EME2000-to-ITRF route. |
| [Output and frames](two-body/frames-output.md) | Which state is published, which methods provide it, and what provenance means. |
| [Recommended use and limits](two-body/recommended-use.md) | When the model is a useful approximation and when to choose Cowell or another source. |

## Key idea

Two-body describes an ideal ellipse whose orientation and shape do not change.
It is excellent as a reference model, but should not be read as an operational
prediction of a real satellite over long arcs.

See [Cowell](cowell.md) when you need Cartesian dynamics with Orbit's
available force terms.
