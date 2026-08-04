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

+## Implemented equations

Cowell's current composition is exactly \(\{\mathrm{central},J_2,J_3,J_4,\mathrm{drag}\}\); each run selects an explicit subset that always contains central gravity.

### Point mass and Cowell

For \(\mathbf r=(x,y,z)\), \(r=\lVert\mathbf r\rVert\), and Earth's \(\mu\):

$$
\mathbf a_{\mathrm{central}}=-\frac{\mu}{r^3}\mathbf r,\qquad
\frac{d}{dt}\begin{bmatrix}\mathbf r\\\mathbf v\end{bmatrix}
=\begin{bmatrix}\mathbf v\\\mathbf a_{\mathrm{central}}+\sum\mathbf a_i\end{bmatrix}.
$$

Cowell advances this system with fixed-step RK4, \(h\):

$$
\mathbf y_{k+1}=\mathbf y_k+
\frac{h}{6}\left(\mathbf k_1+2\mathbf k_2+2\mathbf k_3+\mathbf k_4\right),
$$

where \(\mathbf k_1=f(\mathbf y_k)\), \(\mathbf k_2=f(\mathbf y_k+h\mathbf k_1/2)\), \(\mathbf k_3=f(\mathbf y_k+h\mathbf k_2/2)\), and \(\mathbf k_4=f(\mathbf y_k+h\mathbf k_3)\).

### J2, J3 and J4 zonal harmonics

The code uses \(q=z/r\), WGS-84 zonal coefficients and:

$$
P_2(q)=\frac{3q^2-1}{2},\qquad
P_3(q)=\frac{5q^3-3q}{2},\qquad
P_4(q)=\frac{35q^4-30q^2+3}{8}.
$$

For enabled \(J_n\), \(n\in\{2,3,4\}\):

$$
T_n=(n+1)P_n(q)+qP_n'(q),\qquad
Z_n=(n+1)qP_n(q)-(1-q^2)P_n'(q),
$$

$$
\mathbf a_{J_n}=\mu J_n R_\oplus^n
\begin{bmatrix}
xT_n/r^{n+3}\\
yT_n/r^{n+3}\\
Z_n/r^{n+2}
\end{bmatrix}.
$$

### Atmospheric drag

The current atmosphere model co-rotates with Earth:

$$
\mathbf v_{\mathrm{rel}}=\mathbf v-\mathbf\omega_\oplus\times\mathbf r,\qquad
\rho(h)=\rho_0\exp\left(-\frac{h-h_0}{H}\right).
$$

With \(B=C_DA/m\), applied acceleration is:

$$
\mathbf a_{\mathrm{drag}}=-\frac{1}{2}B\,\rho(h)\,
\lVert\mathbf v_{\mathrm{rel}}\rVert\,\mathbf v_{\mathrm{rel}}.
$$

Orbit selects \((\rho_0,h_0,H)\) from local exponential layers, evaluates speed magnitude in m/s and retains the internal state vector in km and km/s.

## Planned equations

!!! warning "Equation planned for future implementation"

    **High-order geopotential.** The current model stops at \(J_4\). A degree-and-order \(N\) expansion would require:

    $$
    U(r,\phi,\lambda)=\frac{\mu}{r}\left[1+\sum_{n=2}^{N}\left(\frac{R_\oplus}{r}\right)^n
    \sum_{m=0}^{n}\bar P_{nm}(\sin\phi)
    \left(\bar C_{nm}\cos m\lambda+\bar S_{nm}\sin m\lambda\right)\right],
    \qquad \mathbf a=-\nabla U.
    $$

!!! warning "Equation planned for future implementation"

    **Multi-surface SRP.** Cowell has no active SRP force term. A face-based model could sum:

    $$
    \mathbf a_{\mathrm{SRP}}=-P_\odot\left(\frac{\mathrm{AU}}{d_\odot}\right)^2
    \frac{1}{m}\sum_i A_i\max(0,\hat{\mathbf n}_i\cdot\hat{\mathbf s})C_{R,i}\hat{\mathbf s}.
    $$

!!! warning "Equation planned for future implementation"

    **Advanced drag.** The current runtime contains neither MSIS nor solar-geomagnetic forcing:

    $$
    \rho=\rho_{\mathrm{MSIS}}(h,\phi,\lambda,t,F_{10.7},\overline{F}_{10.7},A_p).
    $$

!!! warning "Equation planned for future implementation"

    **Attitude.** Orbit does not propagate attitude:

    $$
    \dot{\mathbf q}=\frac{1}{2}\Omega(\mathbf\omega)\mathbf q,\qquad
    I\dot{\mathbf\omega}+\mathbf\omega\times(I\mathbf\omega)=\mathbf\tau.
    $$

!!! warning "Equation planned for future implementation"

    **Third bodies.** There is no third-body force in the current composition:

    $$
    \mathbf a_{3B}=\mu_b\left(
    \frac{\mathbf r_b-\mathbf r}{\lVert\mathbf r_b-\mathbf r\rVert^3}
    -\frac{\mathbf r_b}{\lVert\mathbf r_b\rVert^3}\right).
    $$

!!! warning "Equation planned for future implementation"

    **Resonances.** No resonant model exists:

    $$
    \phi=k_1\lambda+k_2\lambda_b+k_3\varpi+k_4\Omega,\qquad \dot\phi\approx0.
    $$

## Limits

- Accuracy depends on forces, coefficients, step size and reference data.
- Visual EOP is for the viewer, not strict products.
- Imported OEM/SP3 states are ephemerides, not re-propagated by an implicit force model.
