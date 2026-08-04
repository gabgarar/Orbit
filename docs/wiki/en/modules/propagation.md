# Propagation

## Overview

Orbit separates native propagation from requested presentation. Each engine produces its scientific frame; `FrameTransformService` returns ITRF only when a consumer requests it.

## Propagators

### SGP4

SGP4 accepts a validated TLE and produces TEME. It is the TLE-model contract, not a claim of high-fidelity force modelling.

### Two-body and J2

Analytical manual engines use an EME2000 epoch state. Two-body retains the central solution; J2 applies the declared first-order secular behaviour.

### Cowell

Cowell integrates an EME2000 Cartesian state with RK4 and an explicit force composition that always includes central gravity.

```python
CowellPropagator(epoch, state, force_terms=["central", "j2", "drag"])
```

An explicit composition overrides inherited presets. Area, mass and drag coefficient are validated before integration.

## Forces and integration

Available terms include J2/J3/J4, full geopotential, third bodies, drag, SRP and relativity according to engine/configuration. Cowell cache stores integrated states by epoch displacement, starts from the closest state and does not invent interpolation; past propagation uses negative RK4 steps.

## Limits

- Accuracy depends on forces, coefficients, step size and reference data.
- Visual EOP is for the viewer, not strict products.
- Imported OEM/SP3 states are ephemerides, not re-propagated by an implicit force model.
