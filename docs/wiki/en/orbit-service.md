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

## Limits

- High-fidelity SP3 and OEM are not reduced to TLE semantics.
- No precision, datum or force model is claimed unless the source establishes it.
- Unsupported formats remain explicit limits.
