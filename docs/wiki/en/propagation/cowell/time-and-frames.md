# Cowell: time and frames

[Propagation](../index.md) · [Cowell](../cowell.md) · [Time, EOP, and ITRF](../../operations/time-eop.md) · [Reference frames](../../engineering/reference-frames.md)

## Integration epoch

Cowell receives an initial `UTC` epoch and an `EME2000` initial state. For a
query it computes \(\Delta t=t-t_0\) in seconds. UTC identifies input and
published instants; the RK4 step is a numerical decision, not a new time scale.

Each RK4 stage has its own epoch: \(t_n\), \(t_n+h/2\), \(t_n+h/2\), and
\(t_n+h\). A model dependent on Earth or Sun/Moon geometry must be evaluated
at each stage epoch; it must never reuse initial-epoch data across a full step.

## Strict terrestrial-force path

`EME2000` is the integrated-equation frame. For degree-and-order geopotential
and every future Earth-bound model, the force is evaluated in `ITRF` and
returned as a free vector to the inertial frame:

$$
\begin{aligned}
(\mathbf r,\mathbf v)_{ITRF} &= T_{EME2000\rightarrow ITRF}(t)
(\mathbf r,\mathbf v)_{EME2000},\\
\mathbf a_{EME2000} &= R_{ITRF\rightarrow EME2000}(t)\mathbf a_{ITRF}.
\end{aligned}
$$

The first transformation treats velocity correctly and includes the time
derivative of the matrix. The second rotates a **free acceleration**; it does
not transform another state derivative or add rotating-frame terms. This is
deliberate: integrating in ITRF without Coriolis, centrifugal, and Euler terms
would be inconsistent.

The path requires:

| Data or capability | Why it is needed |
| --- | --- |
| EOP covering the epoch | Polar motion and DUT1/UT1−UTC. |
| Local leap-second table | Traceable UTC→TAI→TT conversion without hidden jumps. |
| ERFA/SOFA | IAU 2006/2000A precession-nutation and frame transformation. |
| Declared realization | Do not treat IGS20/IGB20 or another realization as ITRF without an alignment path. |
| Matrix validation | Check \(R^TR\simeq I\) and free-vector norm preservation. |

If any item is absent, Orbit must reject `geopotential` and every term that
declares this contract. Labeling a result as `ITRF` without applying these data
would be incorrect; an informal visualization should instead say “Approximate
terrestrial frame (no ECI route)”.

## Celestial-frame terms

Solar/lunar perturbations, SRP, and the Schwarzschild correction use the same
epoch as the state. Their vectors must use an origin and celestial frame
consistent with `EME2000`; provider and coverage must be part of provenance.
Barycentric, geocentric, TEME, and ITRF coordinates must not be mixed directly.

## Output transformation

After integration, `state_at` can request
`EME2000 → CIRS → TIRS → ITRF` from `FrameTransformService`. TT enters
celestial reduction and UT1 Earth rotation. This output conversion does not
replace the stage-wise evaluation above: a terrestrial force must have used
correct data during integration, not merely during display.

## Precision limit

Final fidelity is limited by the weakest of force quality, Earth orientation,
auxiliary data, and integrator. Exact EOP cannot compensate for a simplified
atmosphere, and a correct geopotential cannot compensate for a coarse
integration step. Provenance distinguishes those error sources; it does not
eliminate them.
