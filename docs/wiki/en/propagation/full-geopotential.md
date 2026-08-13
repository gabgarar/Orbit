# Configurable degree-and-order geopotential

[Home](../index.md) · [Propagation](index.md) · [Force models](force-models.md) · [Gravity models](../engineering/gravity-models.md)

## Purpose and status

The available canonical term is `geopotential`. It evaluates an Earth spherical-
harmonic gravity field through configurable **degree** \(N\) and **order**
\(M\), with \(0\leq M\leq N\). Runtime enables it only when a valid local
field and strict frame route exist; historical `j2`, `j3`, and `j4` zonals
remain available as separate compatibility terms.

There will be no silent downgrade to J2/J3/J4 when `geopotential` is requested.
If the gravity product or frame route does not meet the contract, the operation
must reject the request.

## Field and configuration

The field is loaded from an identified ICGEM `.gfc` file. The reader accepts
**fully normalized** coefficients only and preserves:

- published model name and source;
- cryptographic file digest;
- header \(\mu\), reference radius \(R_\oplus\), normalization, and maximum
  degree;
- \(\bar C_{nm}\), \(\bar S_{nm}\) coefficients and their validity interval if
  supplied by the product;
- effective selected degree and order.

Loading must reject an incomplete header, unsupported normalization, non-finite
coefficients, degree/order outside the field, or an expected digest mismatch.
It must not change normalization or invent coefficients in the background.

| Setting | Meaning | Constraint |
| --- | --- | --- |
| `degree` | Largest evaluated \(n\). | Integer \(2\leq N\leq \min(N_{field},2159)\). `2159` is the semantic model/API/UI maximum, aligned with a complete EGM2008 field; 0/1 remain inactive compatibility values only. |
| `order` | Largest \(m\) per degree. | Integer \(0\leq M\leq \min(N,M_{field},2159)\). |
| `geopotential` | Enables the non-central harmonic sum. | Do not combine with `j2`, `j3`, or `j4`. |

Central gravity remains the separate, mandatory `central` term. This avoids
adding the \(n=0\) term twice. Runtime rejects degree below 2 with HTTP 422
when `geopotential` is active.

!!! warning "Semantic limit and execution budget are different"

    `2159 × 2159` is the largest field/configuration/provenance contract that
    Orbit accepts; it does not mean that the current RK4 automatically runs
    that complete field. The fixed-step Python evaluator has an explicit guard
    of **2,555 non-central harmonic coefficients per stage**. A configuration
    above it is rejected before propagation: it is neither silently truncated
    nor replaced by a lower model.

    A dense `70 × 70` is an example that fits the current profile. A zonal or
    low-order configuration can reach higher degree if it remains within budget.
    A complete `2159 × 2159` requires an optimized evaluator and adaptive
    integrator before it can be offered as a mission calculation.

## Choosing degree and order \(N\times M\)

Choose the value through convergence against the mission tolerance, not by
selecting the largest number available. Practical starting points are:

| Case | Initial selection | Rationale and limit |
| --- | ---: | --- |
| Quick test or preliminary design | **20 × 20** | Low cost; useful to check geometry and configuration. |
| General LEO engineering analysis | **40 × 40** | Recommended starting point for sensitivity comparison. |
| LEO, short arc, or sensitivity study | **60 × 60** | Adds detail without normally exhausting the current profile. |
| Current dense RK4 profile maximum | **70 × 70** | Example within the 2,555-term guard; not the model's semantic maximum. |
| MEO/GNSS | **20 × 20** | High harmonics attenuate with altitude; always validate against the selected reference. |
| GEO | **12 × 12 to 20 × 20** | Starting point; other perturbations may dominate the error budget. |
| Future mission study | **120 × 120** initially; **180 × 180 to 360 × 360** after convergence | Requires the future optimized engine and adaptive integration. |
| Complete EGM2008 field | **2159 × 2159** | Maximum accepted data/configuration; not executable by the current Python RK4. |

To justify a selection, propagate the same arc with `20 × 20`, `40 × 40`, and
`60 × 60`; compare final position and RMS against the reference product—for
example an SP3—and choose the smallest model whose difference from the next
one meets the mission threshold. This test does not replace tides, drag, SRP,
attitude, or an integration-step test.

## J1, J2, and J3

Zonal harmonics are naturally included whenever the field and selected degree
contain them. For fully normalized coefficients, the conventional zonal
relationship is:

$$
J_n=-\sqrt{2n+1}\;\bar C_{n0}.
$$

Therefore J2 and J3 will not be additional switches when `geopotential` is
used. J1 is not offered as a selectable force either: for an Earth model whose
origin is its center of mass, degree one represents an origin displacement and
must vanish apart from documented rounding. Enabling J1 on an already centered
origin would add a spurious acceleration, not fidelity.

## Physical evaluation and frames

Earth gravity coefficients are Earth-bound. They are therefore not evaluated
with the longitude of an `EME2000` vector as if the rotation axis were fixed.
For **every** RK4 evaluation \(f(t,\mathbf y)\):

1. Orbit transforms \((\mathbf r,\mathbf v)\) from `EME2000` to `ITRF` at the
   stage epoch.
2. It evaluates the non-central acceleration \(\mathbf a_{ITRF}\) in
   instantaneous ITRF.
3. It rotates the free acceleration to `EME2000`:

   $$
   \mathbf a_{EME2000}=R_{ITRF\rightarrow EME2000}(t)\mathbf a_{ITRF}.
   $$

4. It adds \(\mathbf a_{EME2000}\) to the integrated derivative.

The state is not integrated in ITRF; doing so would require Coriolis,
centrifugal, and Euler fictitious terms. The rotation above applies only to the
geopotential's physical acceleration and retains Cowell's inertial equation of
motion.

The transformation must use EOP, UT1−UTC, polar motion, a valid leap-second
table, and ERFA/SOFA with IAU 2006/2000A reduction. If the product uses a
terrestrial realization other than ITRF, a declared realization-alignment route
must also exist. Without these data, the correct frame is approximate and
`geopotential` must not be enabled.

## Equation and units

The complete potential is:

$$
U(r,\phi,\lambda)=\frac{\mu}{r}\left[1+
\sum_{n=2}^{N}\left(\frac{R_\oplus}{r}\right)^n
\sum_{m=0}^{\min(n,M)}\bar P_{nm}(\sin\phi)
\left(\bar C_{nm}\cos m\lambda+\bar S_{nm}\sin m\lambda\right)\right],
\qquad \mathbf a=-\nabla U.
$$

| Symbol | Meaning | Unit |
| --- | --- | --- |
| \(U\) | Gravitational potential. | km²/s². |
| \(r,\phi,\lambda\) | Geocentric radius, latitude, and longitude in ITRF. | km, rad, rad. |
| \(N,M\) | Applied degree and order. | Integers. |
| \(\bar P_{nm}\), \(\bar C_{nm}\), \(\bar S_{nm}\) | Fully normalized Legendre functions and coefficients. | Dimensionless. |
| \(\mathbf a\) | Non-central acceleration returned to Cowell. | km/s². |

The implementation must compute the gradient analytically, not by finite
differences. It is checked against J2/J3/J4 zonal terms at non-polar points and
must reject every non-finite result.

## Mandatory numerical validations

- The rotation matrix must be orthonormal within numerical tolerance:
  \(R^TR\simeq I\).
- A free-vector norm must be preserved by rotation:
  \(\lVert\mathbf a_{ITRF}\rVert\simeq\lVert\mathbf a_{EME2000}\rVert\).
- Degree/order configuration must belong to the loaded field.
- The order-zero zonal test field must reproduce historical J2/J3/J4 terms at
  documented points and test tolerances.
- Each RK4 stage must use its own epoch, including both half stages.

## What is still excluded

This static geopotential does not include solid-Earth tides, ocean tides,
atmospheric loading, temporal terms \(\dot C_{nm},\dot S_{nm}\), or seasonal
coefficients. Those corrections require IERS conventions, consistent Sun/Moon
ephemerides, and an explicit product policy; they are covered in
[Tides](tides.md).

It also does not turn 60 s fixed-step RK4 into a mission-accuracy solution.
Long arcs, fast perigees, or high degree will require adaptive error control and
comparison against a reference.
