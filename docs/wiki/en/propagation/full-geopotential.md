# Configurable degree-and-order geopotential

[Home](../index.md) · [Propagation](index.md) · [Force models](force-models.md) · [Gravity models](../engineering/gravity-models.md)

## Purpose and status

The available canonical term is `geopotential`. It evaluates an Earth spherical-
harmonic gravity field through configurable **degree** \(N\) and **order**
\(M\), with \(0\leq M\leq N\). Runtime enables it only when an explicit,
checksum-controlled local ICGEM field **or** an already validated NGA cache is
available, and when an EME2000↔ITRF time route exists; historical
`j2`, `j3`, and `j4` zonals remain available as separate compatibility terms.

There will be no silent downgrade to J2/J3/J4 when `geopotential` is requested.
If the gravity product or mandatory time route does not meet the contract, the
operation must reject the request. For manual orbits, absence of an automatic
EOP sample is distinct: propagation uses labelled nominal rotation, never a
rigorous SP3/ECI route.

## Field and configuration

The field is loaded either from an identified ICGEM `.gfc` file or from the
recognized coefficient member of an official NGA EGM archive. The reader
accepts **fully normalized** coefficients only and preserves:

- published model name and source URL or explicit local source;
- cryptographic archive/file digest;
- \(\mu\), reference radius \(R_\oplus\), normalization, tide system, and
  detected `maxDegree`/`maxOrder` from the validated ICGEM header or unpacked
  NGA coefficient member;
- \(\bar C_{nm}\), \(\bar S_{nm}\) coefficients and their validity interval if
  supplied by the product;
- effective selected degree and order.

Loading must reject an incomplete header, unsupported normalization, non-finite
coefficients, degree/order outside the field, or an expected digest mismatch.
It must not change normalization or invent coefficients in the background.

| Setting | Meaning | Constraint |
| --- | --- | --- |
| `degree` | Largest evaluated \(n\). | Integer \(2\leq N\leq N_{max}\), where `maxDegree` is read from the validated source. 0/1 remain inactive compatibility values only. |
| `order` | Largest \(m\) per degree. | Integer \(0\leq M\leq \min(N,M_{max})\), where `maxOrder` is read from the validated source. |
| `geopotential` | Enables the non-central harmonic sum. | Do not combine with `j2`, `j3`, or `j4`. |

Central gravity remains the separate, mandatory `central` term. This avoids
adding the \(n=0\) term twice. Runtime rejects degree below 2 with HTTP 422
when `geopotential` is active.

## Automatic NGA EGM cache

Unless an explicit `ORBIT_GRAVITY_FIELD_PATH` ICGEM field is configured, Orbit
can use a local cache of these two fixed official NGA products:

| Model | Official source | Selectable field | Archive detail retained as provenance |
| --- | --- | --- | --- |
| `EGM96` | [NGA EGM96 spherical harmonics](https://earth-info.nga.mil/php/download.php?file=egm-96spherical) | Detected `maxDegree` / `maxOrder` after validation. | Archive and coefficient coverage are recorded, not assumed from the model name. |
| `EGM2008` | [NGA EGM2008 spherical harmonics](https://earth-info.nga.mil/php/download.php?file=egm-08spherical) | Detected `maxDegree` / `maxOrder` after validation. | `2190 × 2190` is an advertised/protective archive envelope, not a promise of a dense complete rectangle or an effective selection. |

The default cache directory is `data/geopotential`; it should be kept on the
persistent `./data` volume. `ORBIT_GRAVITY_MODEL` selects `EGM96` or
`EGM2008` (the default). The health monitor, after FastAPI has become healthy,
first validates a local copy and refreshes a missing or stale one after the
configured interval (30 days by default). A Cowell/RK4 stage never waits for a
download or performs disk/network refresh work.

Before a cache entry becomes active, Orbit accepts only the fixed HTTPS NGA
URL without redirects, applies archive/extraction size limits, requires the
expected ZIP member, validates safe member paths, complete coefficient
continuity and physically plausible finite values, records SHA-256, and swaps
the validated archive and coefficient file atomically. An explicit ICGEM field
keeps priority and is never silently replaced by this cache.

The registry reads maximum degree and maximum order from that validated,
unpacked source and publishes them to the UI and Built-In Test. These are the
only bounds offered for selection. A model label or published baseline is not a
substitute for the actual coefficient coverage; in particular, a maximum degree
and a maximum order do not by themselves imply a complete square matrix.
Before first validation, those values are `null` and the selector fails closed
rather than presenting an unverified numerical limit.

If the validated member declares and contains every coefficient continuously
through \(N=M=2190\), Orbit publishes that **coverage** as **2190 × 2190**.
This is not execution authorization: current RK4 rejects that selection because
it exceeds its 2,555 terms-per-stage budget. For example, a zonal selection
\(N=2190, M=0\) can run if the validated rows cover it; a selection above the
budget is explicitly rejected. If its header and rows disagree, Orbit never
invents terms: loading is rejected or the validated profile limits each degree
to the last order actually present.

If a refresh fails while an older valid cache exists, the older copy remains
usable with **Warning**. With no valid local copy (or when automatic download
is disabled), full geopotential is unavailable and the panel reports a
recoverable warning/error; Orbit never substitutes J2/J3/J4. The cache gives
gravity coefficients only: it does not provide ERP, a datum route, or approval
for strict ECI.

!!! warning "Archive-derived model limits and execution budget are different"

    The UI/API selection ceiling is the validated source's published
    `maxDegree` and `maxOrder`, not a hard-coded EGM2008 rectangle. The
    advertised/protective EGM2008 envelope may be described as 2190 × 2190,
    but Orbit does not claim that every validated archive contains a complete
    dense field at that envelope.

    This provenance/selection limit does not mean that the current RK4 can run
    the full detected field. The fixed-step Python evaluator has an explicit
    guard of **2,555 non-central harmonic coefficients per stage**. A
    configuration above it is rejected before propagation: it is neither
    silently truncated nor replaced by a lower model.

    A dense `70 × 70` is an example that fits the current profile. A zonal or
    low-order configuration can reach higher degree if it remains within
    budget. Mission-scale complete fields require an optimized evaluator and
    adaptive integrator before they can be offered as a mission calculation.

For the automatic registry, a request above the selected validated source's
coverage is returned with its effective degree/order and an explicit `clamped`
indication. This traceable model clamp is distinct from the RK4 stage budget,
which rejects an over-budget force evaluation instead of silently reducing it.

!!! info "Explicit local ICGEM loading bound"

    A `.gfc` supplied through `ORBIT_GRAVITY_FIELD_PATH` is checked and fully
    materialised at startup; the loader cannot assume that a later N×M request
    makes it safe to discard rows from that file. To bound startup memory and
    time, this route accepts at most **16 MiB** and **2,556 complete
    coefficients** (a dense `70 × 70` field, including C00). A degree-71-or-
    higher header is rejected before coefficients are retained, with an
    actionable error directing the operator to the validated NGA cache or an
    optimized mission engine.

    Excess rows are neither truncated nor turned into zeroes. The NGA registry
    retains and validates the large archive on disk but materialises only the
    selected N×M in memory within the RK4 budget; that is the appropriate route
    for EGM96/EGM2008 and low-order studies at higher degree.

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
| Highest validated EGM2008 selection | Published `maxDegree` / `maxOrder` | Read the actual values in the UI/Built-In Test; full dense execution is not available in the current Python RK4. |

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

For a manual orbit, the transformation uses the process-wide automatic IERS C01
provider for EOP, UT1–UTC, polar motion, and LOD; the same provider is used by
`drag`. If no valid C01 sample covers a stage, manual propagation retains a
**nominal** Earth rotation and publishes it as a provenance warning instead of
requiring a manual ERP. A local ERP snapshot remains an optional reproducible
override that must cover its complete design.

The EME2000↔ITRF route also requires a valid leap-second table and ERFA/SOFA
with IAU 2006/2000A reduction. If a precise product uses a terrestrial
realization other than ITRF, a declared realization-alignment route must also
exist. Rigorous SP3 ECI conversion is a separate fail-closed contract: neither
the NGA cache, global C01, nor nominal rotation enables it.

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
