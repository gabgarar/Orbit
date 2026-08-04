# Time, EOP and ITRF

## Overview

Orbit treats an epoch as the pair \`datetime + time_scale\`. Time scales, leap seconds and EOP are versioned inputs to a computation: they are never downloaded or silently estimated while transforming a state.

## Implemented scales

Let \(\Delta_{AT}=\mathrm{TAI}-\mathrm{UTC}\) come from the local leap-second table, and let \(\mathrm{DUT1}=\mathrm{UT1}-\mathrm{UTC}\) come from the EOP provider. Orbit executes these conversions:

$$
\begin{aligned}
\mathrm{TAI} &= \mathrm{UTC}+\Delta_{AT},\\
\mathrm{TT} &= \mathrm{TAI}+32.184\ \mathrm{s},\\
\mathrm{UT1} &= \mathrm{UTC}+\mathrm{DUT1},\\
\mathrm{GPS} &= \mathrm{TAI}-19\ \mathrm{s},\\
\mathrm{BDT} &= \mathrm{TAI}-33\ \mathrm{s}.
\end{aligned}
$$

UT1 conversion requires explicit DUT1. A recognised scale without an implemented correlation — for example TDB, TCB, TCG, MET or SCLK — is rejected instead of being approximated as UTC.

## TEME sidereal time

The TEME/SGP4 path retains IAU-82-compatible GMST. With \(T=(JD_{UT1}-2451545.0)/36525\), the code evaluates sidereal seconds as:

$$
s = 67310.54841 + (876600\cdot3600 + 8640184.812866)T
    +0.093104T^2-6.2\times10^{-6}T^3,
$$

$$
\theta_{\mathrm{GMST}}=
\operatorname{mod}_{2\pi}\!\left(\frac{\pi}{180}\frac{s}{240}\right).
$$

## Frame reduction

For TEME, the applied matrix is:

$$
\mathbf r_{\mathrm{ITRF}}=
W(x_p,y_p)\,R_3(-\theta_{\mathrm{GMST}})\,\mathbf r_{\mathrm{TEME}},
$$

where \(W\) is polar motion from EOP. For GCRF, ICRF and EME2000, when \`pyerfa\` is available, Orbit delegates to IAU 2006/2000A reduction:

$$
\mathbf r_{\mathrm{ITRF}}=
W(x_p,y_p)\,R_3(-\mathrm{ERA}(UT1))\,C(X,Y,s,TT)\,
\mathbf r_{\mathrm{celestial}}.
$$

Matrix \(C\) comes from IAU 2006/2000A XYS and receives EOP \(dX,dY\) corrections. The no-SOFA/ERFA fallback is visual only.

For each time-dependent transform \(A(t)\), Orbit carries position, velocity and acceleration through numerical matrix derivatives:

$$
\begin{aligned}
\mathbf r' &= A\mathbf r,\\
\mathbf v' &= A\mathbf v+\dot A\mathbf r,\\
\mathbf a' &= A\mathbf a+2\dot A\mathbf v+\ddot A\mathbf r.
\end{aligned}
$$

The 6×6 covariance uses the state Jacobian:

$$
P'=J P J^\mathsf{T},\qquad
J=\begin{bmatrix}A&0\\\dot A&A\end{bmatrix}.
$$

## Data and limits

Strict mode requires \`final\` or \`rapid\` EOP quality, epoch coverage and a valid local leap-second table. \`ITRF\` without a realization is not relabelled as \`ITRF2020\`; an operation such as IGS20→ITRF2020 must be registered explicitly.

See [Time systems](../engineering/time-systems.md) and [Time, EOP and ITRF operations](../operations/time-eop.md).
