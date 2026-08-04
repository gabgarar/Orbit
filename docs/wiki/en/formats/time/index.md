# Time formats

[Home](../../index.md) · [Formats](../index.md) · [Time, EOP and ITRF](../../time.md)

## Overview

Time products provide Earth-orientation data and the UTC–TAI relationship.
Orbit treats them as versioned local inputs: they are never downloaded or
silently estimated during a transformation.

| Product | Status | Use |
| --- | --- | --- |
| [IERS EOP C04](iers-c04.md) | Available. | DUT1, polar motion, dX, dY and LOD. |
| [leap-seconds.list](leap-seconds.md) | Available. | UTC, TAI, TT and GNSS scales. |
| [IERS Bulletins A and B](bulletins.md) | No direct reader. | Must be converted or integrated explicitly. |
