# Third bodies: Sun and Moon

[Home](../index.md) · [Propagation](index.md) · [Force models](force-models.md) · [Cowell](cowell.md)

## Scope and status

The available canonical terms are `third-body-sun` and
`third-body-moon`. They model the differential Sun and Moon acceleration on a
geocentric satellite; they do not apply absolute gravity in a way that would
artificially shift Earth's origin.

The local provider uses ERFA: `eraEpv00` for the Sun (negated Earth
heliocentric vector, a GCRS-compatible geometric approximation) and `eraMoon98`
for the Moon (approximate geocentric GCRS vector). It declares coverage and
provenance, does not download ephemerides in the background, and does not
substitute for a mission-precision planetary ephemeris.

## Differential equation

For a perturbing body \(b\), with satellite geocentric position \(\mathbf r\)
and body geocentric position \(\mathbf r_b\), Orbit adds:

$$
\mathbf a_{3B}=\mu_b\left(
\frac{\mathbf r_b-\mathbf r}{\lVert\mathbf r_b-\mathbf r\rVert^3}
-\frac{\mathbf r_b}{\lVert\mathbf r_b\rVert^3}\right).
$$

| Symbol | Meaning | Unit |
| --- | --- | --- |
| \(\mathbf r\) | Satellite geocentric position. | km. |
| \(\mathbf r_b\) | Sun or Moon geocentric position, same origin and epoch. | km. |
| \(\mu_b\) | Body gravitational parameter. | km³/s². |
| \(\mathbf a_{3B}\) | Differential acceleration added to Cowell. | km/s². |

The second term is essential: it subtracts Earth's acceleration by the same
body. Without it, absolute heliocentric or lunar dynamics would be mixed with a
geocentric state.

## Epoch, frame, and coverage

Sun or Moon position is obtained at every RK4 stage and expressed in a
geocentric celestial frame coherent with the `EME2000` state. Implementation
applies this contract:

- rejects epochs outside declared coverage: Sun 1900–2100 with `eraEpv00` and
  Moon 1950–2100 with `eraMoon98`;
- converts UTC to TT explicitly using the local versioned leap-second table;
  for these approximate ERFA models it declares TT substitution for TDB where
  ERFA permits it;
- declare provider, library version, model, constants, and coverage in
  provenance;
- reject non-finite vectors or singular geometry before forming acceleration.

The local model is suitable for force-composition and sensitivity studies. For
OD, precise navigation, long arcs, or mission validation, choose a versioned
external planetary ephemeris and compare against a known reference.

## What it does not do

- It does not integrate a complete barycentric n-body system.
- It does not include planets, asteroids, downloaded JPL ephemerides, or
  relativistic ephemeris corrections.
- It does not include Sun/Moon-induced tides in geopotential; those are a
  separate term, still deferred in [Tides](tides.md).
- It does not resolve eclipses: eclipse affects SRP, not third-body gravity.
