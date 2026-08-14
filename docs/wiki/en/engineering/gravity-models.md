# Gravity models

[Home](../index.md) · [Engineering](index.md) · [Earth models](earth-models.md) · [Force models](../propagation/force-models.md)

## Gravity layers in Orbit

Gravity models are used only by manual propagation. A TLE object uses SGP4 and
does not accept this composition as an operational selector.

| Model | Identifier | Status | Use |
| --- | --- | --- | --- |
| Point mass | `central` | Available. | Two body and mandatory Cowell term. |
| J2/J3/J4 zonals | `j2`, `j3`, `j4` | Available for compatibility. | Legacy manual studies. |
| Spherical harmonics | `geopotential` | Available with an explicit local ICGEM field or a validated automatic NGA cache. | Configurable ITRF field; manual orbit uses automatic IERS or labelled nominal rotation. |

## Legacy zonals

Cowell retains independent zonal terms with internal WGS-84 coefficients:

| Coefficient | Value |
| --- | ---: |
| \(J_2\) | \(1.08262668355315\times10^{-3}\) |
| \(J_3\) | \(-2.53265648533224\times10^{-6}\) |
| \(J_4\) | \(-1.61962159136700\times10^{-6}\) |

They are evaluated as a compatibility implementation in `EME2000`, treating
its \(Z\) axis as a fixed terrestrial axis. They are useful for preserving
results and first-order studies, but they do not equal rotating an Earth-bound
field at every integration stage.

## Configurable harmonic field

The model is defined by an explicit ICGEM `.gfc` file or by a validated
automatic NGA `EGM96`/`EGM2008` cache, plus degree \(N\), order \(M\)
selection. Fully normalized coefficients only are accepted. The zonal
relationship is:

$$
J_n=-\sqrt{2n+1}\;\bar C_{n0}.
$$

This explains why J2, J3, and J4 are already included when the field contains
those degrees. J1 is not exposed: in a center-of-mass geocentric system it
represents an origin displacement, not a physical perturbation to enable.

The harmonic term contributes the non-central part of acceleration. `central`
remains mandatory, and `geopotential` is mutually exclusive with J2/J3/J4
switches to avoid double counting.

The selected model becomes numerically selectable only after its unpacked
coefficient source has validated. The registry then reports `maxDegree`,
`maxOrder`, a per-degree coverage summary, `completeThroughDegree`, and
`tailMaxOrder`; the UI bounds degree/order to those detected facts and returns
an explicit `clamped` effective selection when necessary. Before validation,
the numeric limits are `null` and the selector fails closed.

The EGM2008 archive is handled within a protective/advisory 2190 × 2190
envelope, but that is not an effective scientific limit or a claim of a dense
matrix. The actual unpacked archive controls. This must not be confused with
the current evaluator budget: Python RK4 explicitly rejects a stage with more
than 2,555 non-central harmonic coefficients. A dense `70 × 70` field fits the
current profile; a zonal/low-order selection may reach higher degree when it
stays within that budget. There is no silent truncation. The LEO, MEO/GNSS,
GEO, and mission selection table is maintained in
[Configurable geopotential](../propagation/full-geopotential.md).

## Automatic NGA cache

The registry may refresh official EGM96 or EGM2008 archives into
`data/geopotential` after the API is healthy. It validates a local cache before
use, refreshes it after the configured age (30 days by default), accepts only
the fixed HTTPS NGA URLs without redirects, validates the expected ZIP member
and all coefficient coverage, and atomically installs the result with its
digest. It does not download inside a propagation step.

Built-In Test publishes the detected limits and coverage profile after that
validation. The parser's `hardMaxDegree`/`hardMaxOrder` are protective input
ceilings only; they are not offered as unverified model capability.

An explicit `ORBIT_GRAVITY_FIELD_PATH` field remains the reproducible,
higher-priority choice. If the automatic refresh cannot complete, a previous
valid cache remains available with **Warning**; if none exists, `geopotential`
is unavailable rather than falling back to J2/J3/J4. The NGA cache itself does
not provide ERP or a strict ECI route.

## Correct evaluation frame

\(\bar C_{nm},\bar S_{nm}\) coefficients describe mass distribution relative
to Earth. The latitude and longitude used to evaluate them must belong to
instantaneous ITRF. At every RK4 stage Orbit must:

1. transform the state from `EME2000` to ITRF using appropriate EOP, UT1, and
   TT;
2. calculate the analytic harmonic gradient in ITRF;
3. rotate free acceleration back to `EME2000`.

Dynamics must not be integrated in ITRF unless rotating-frame fictitious forces
are explicitly implemented. See [Configurable geopotential](../propagation/full-geopotential.md).

## Traceability requirements

A result using a harmonic field must record field, source URL or local source,
archive/file digest, cache validation time, normalization, tide system,
\(\mu\), reference radius, detected limits and coverage profile, requested and
effective degree/order, EOP, leap seconds, terrestrial realization, and
transformation method. If the time route is missing (for example leap seconds
or ERFA/SOFA), the model must remain disabled. If only automatic EOP is missing,
the manual orbit is labelled nominal rotation and can never be presented as
rigorous ITRF/ECI.

## Current limits and next increments

The static field does not cover tides, temporal variation, atmospheric loading,
or seasonal corrections. It also does not replace an adaptive integrator or
validation against a reference ephemeris. Those items remain explicitly
deferred in [Tides](../propagation/tides.md) and
[Numerical integrators](../propagation/numerical-integrators.md).
