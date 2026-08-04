# TLE

[Home](../index.md) · [Formats](index.md) · [SGP4](../propagation/sgp4.md) · [OMM](omm.md)

## Purpose

The two-line set is the operational representation of the Orbit catalog.
Each persisted entry retains name, `line1`, `line2` and `sourceFormat`.
The runtime creates an `SGP4Propagator` from those two lines.

## Catalog import

The gateway recognizes TLE by extension `.tle` or `.txt`, and also as format
default when the content does not correspond to a more specific detection.
The catalog parser:

- ignore empty lines, comments `#` and `//`;
- accepts an optional name line, including the `0 ` prefix;
- associates a line starting with `1 ` with the next valid line that
  starts with `2 `;
- use `NORAD <id>` when name is missing.

Before persisting, the import validates:

| Rule | Check |
| --- | --- |
| Name | Not empty. |
| Prefixes | `line1` starts with `1 ` and `line2` starts with `2 `. |
| Size | At least 69 characters on each line. |
| Identifier | Five digits in catalog columns and match between lines. |
| Checksum | Digit 69 consistent with TLE sum. |
| Medium movement | Positive in the field of line 2. |

Invalid entries are counted and do not enter the normalized catalog.
Duplicates are resolved by NORAD identifier: an entry `CUSTOM`
prevails over one of `CATALOG` origin; for the same origin the
first persisted.

## Propagation

TLE is propagated exclusively with [SGP4](../propagation/sgp4.md). Your status
native is `TEME`; an ITRF output is a post transformation and does not change
the original frame of the model.

## Export

The gateway offers a textual export of name, line 1 and line 2.
Backend ephemeris export can generate CSV, JSON or OEM from
SGP4 samples; does not represent the TLE as an ephemeris of distinct precision.

## Limits

- A TLE history is not maintained or propagated with the historical TLE that
  corresponded to each moment.
- No adjustment of TLE, OD, covariance, maneuvers or orbital validation further
  beyond catalog rules.
- Accuracy and validity are limited to the source information of the TLE; Orbit
  it does not replace it with a high-fidelity force model.