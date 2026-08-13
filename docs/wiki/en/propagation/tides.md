# Tides and time-varying field

[Home](../index.md) · [Propagation](index.md) · [Force models](force-models.md) · [Third bodies](third-bodies.md)

## Status

Tides are not part of this delivery. Configurable static degree/order
geopotential and direct Sun/Moon perturbations must not be interpreted as
support for solid-Earth tides, ocean tides, or time-varying gravity field.

## What is needed before enabling them

A tide model must update harmonic coefficients with coherent conventions and
data:

$$
\Delta \bar C_{nm}(t),\ \Delta \bar S_{nm}(t)
=f_{nm}\bigl(\mathbf r_\odot(t),\mathbf r_{\mathrm{Moon}}(t),k_n,\mathrm{IERS}\bigr).
$$

| Deferred component | Reason |
| --- | --- |
| Solid-Earth tides | Love numbers, Sun/Moon, and applicable IERS conventions. |
| Ocean tides | Verifiable constituent set, ocean model, and normalization. |
| Atmospheric and polar loading | Geophysical products and their reference convention. |
| Secular and seasonal terms | Explicit policy for \(\dot C_{nm},\dot S_{nm}\) and reference epoch. |
| External validation | Reference cases and tolerances against an independent implementation. |

These terms would be evaluated in ITRF at every RK4 stage and returned as free
acceleration to <code>EME2000</code>. Having EOP is not enough: EOP orients
Earth, but does not itself supply tidal coefficients.

## Operational rule

Until they are implemented, Orbit must publish that the field is static with
respect to tides. Mission accuracy must not be inferred from enabling Sun, Moon,
or geopotential.
