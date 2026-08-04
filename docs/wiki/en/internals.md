# Internals

## Overview

Internals make time and coordinate assumptions explicit so each result is reproducible with its reference data and model path.

## Frame reduction

TEME uses GMST→PEF→ITRF with polar motion. Modern celestial frames use IAU 2006/2000A and IERS when `pyerfa` is available.

```text
UTC + DUT1 → UT1 → Earth rotation → PEF/TIRS + xp, yp → ITRF
UTC + (TAI−UTC) + 32.184 s → TT
GCRF/EME2000 → CIRS → TIRS → ITRF
```

Matrix derivatives transform velocity and acceleration; covariance uses the corresponding state-transition form.

## Data, realizations and strict mode

EOP providers are local and versioned: DUT1, polar motion, CIP corrections, source, version, quality and snapshot identity. They never download data during a calculation.

Strict mode accepts final/rapid quality, rejects extrapolation and requires a valid leap-second table. An ITRF realization is not inferred from EOP; IGS20↔ITRF2020 is optional, records datum authority and excludes station/antenna corrections.

## Numerical model and tests

Cowell integrates \(\ddot{\mathbf r}=\mathbf a_{central}+\sum_i\mathbf a_i\) with fixed-step RK4 and an exact-state cache. Docker tests cover Node/frontend/Python contracts before creating the image.

## Explicit limits

- Visual fallback is not a precision transform.
- Only Earth-centred frames are in scope.
- No implicit datum alignment exists for high-fidelity SP3/OEM.
