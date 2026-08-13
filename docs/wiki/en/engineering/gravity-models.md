# Gravity models

[Home](../index.md) · [Engineering](index.md) · [Earth models](earth-models.md) · [Force models](../propagation/force-models.md)

## Gravity layers in Orbit

Gravity models are used only by manual propagation. A TLE object uses SGP4 and
does not accept this composition as an operational selector.

| Model | Identifier | Status | Use |
| --- | --- | --- | --- |
| Point mass | `central` | Available. | Two body and mandatory Cowell term. |
| J2/J3/J4 zonals | `j2`, `j3`, `j4` | Available for compatibility. | Legacy manual studies. |
| ICGEM spherical harmonics | `geopotential` | Available with configured local field. | Configurable degree/order field with strict ITRF path. |

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

The new model is defined by an ICGEM `.gfc` file and degree \(N\), order \(M\)
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

A result using a harmonic field must record field, source, digest,
normalization, \(\mu\), reference radius, degree, order, EOP, leap seconds,
terrestrial realization, and transformation method. If any requirement is
missing, the model must remain disabled and the result cannot be presented as
rigorous ITRF/ECI.

## Current limits and next increments

The static field does not cover tides, temporal variation, atmospheric loading,
or seasonal corrections. It also does not replace an adaptive integrator or
validation against a reference ephemeris. Those items remain explicitly
deferred in [Tides](../propagation/tides.md) and
[Numerical integrators](../propagation/numerical-integrators.md).
