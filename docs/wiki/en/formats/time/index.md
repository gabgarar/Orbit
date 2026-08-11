# Time formats

[Home](../../index.md) · [Formats](../index.md) · [Time, EOP and ITRF](../../time.md)

## Overview

Time products provide Earth-orientation data and the UTC–TAI relationship.
Orbit treats them as versioned local inputs: they are never downloaded or
silently estimated during a transformation.

| Product | Status | Use |
| --- | --- | --- |
| [IERS EOP 20u24 C04](iers-c04.md) | Available; recommended source. | DUT1, polar motion, dX, dY and LOD. |
| [leap-seconds.list](leap-seconds.md) | Available. | UTC, TAI, TT and GNSS scales. |
| [IERS Bulletins A/B and IGS ERP](bulletins.md) | ERP available as a GNSS-import ancillary product; no direct Bulletin A/B importer. | An associated local ERP permits ITRF-to-ECI; rapid remote sources still require a snapshot and explicit provenance. |
