# Cowell: time and frames

[Propagation](../index.md) · [Cowell](../cowell.md) · [Time, EOP, and ITRF](../../operations/time-eop.md) · [Reference frames](../../engineering/reference-frames.md)

## Epoch and integration time

Cowell receives an initial `UTC` epoch and `EME2000` initial state. For a
query, it calculates \(\Delta t=t-t_0\) in seconds and RK4 integrates
Cartesian dynamics over that interval. UTC identifies the instant and
published state; the fixed 60 s integration step is a numerical choice, not a
different reference time scale.

## EME2000 is the dynamics frame

Cowell evaluates its state, central gravity, and current force terms in the
`EME2000` inertial contract. It does not use TEME or rotate the state into an
Earth-fixed frame inside each RK4 stage. This separation avoids mixing
propagator dynamics with a consumer's required transformation.

The terrestrial models that are present have the simplifications declared in
[Input and forces](input-and-forces.md); they must not be read as a full,
high-fidelity ITRF→EME2000 transformation during integration.

## From EME2000 to ITRF

After integration, `state_at` can request
`EME2000 → CIRS → TIRS → ITRF` through `FrameTransformService`. This is an
IAU 2006/2000A route when `pyerfa` is available and must not be confused with
`TEME → PEF → ITRF`, which is specific to SGP4.

UTC names the requested epoch. TT enters celestial reduction and UT1 enters
Earth rotation; the EOP provider obtains UT1 from
\(\mathrm{DUT1}=\mathrm{UT1}-\mathrm{UTC}\) and supplies polar motion. The
complete operational explanation is in [Time, EOP, and ITRF](../../operations/time-eop.md).

## Velocity, precision, and provenance

Output transformation does not rotate position alone: velocity includes the
time derivative of the rotation matrix, whose leading term is
\(\omega\times\mathbf r\). Derivatives are also used for
acceleration and covariance when present. See the equations in
[Cartesian states](../../engineering/cartesian-states.md).

Final fidelity combines two independent limits: Cowell's model/RK4 and the
quality of EOP, UT1, and frame transformation. State provenance shows which
transformation was used; it does not turn low-fidelity dynamics into a precise
ephemeris.
