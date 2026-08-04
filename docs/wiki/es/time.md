# Tiempo, EOP e ITRF

## Visión general

Orbit trata una época como el par \`datetime + time_scale\`. Las escalas, los segundos intercalares y los EOP son entradas versionadas del cálculo: no se descargan ni se estiman silenciosamente durante una transformación.

## Escalas implementadas

Sea \(\Delta_{AT}=\mathrm{TAI}-\mathrm{UTC}\), obtenido de la tabla local de segundos intercalares, y sea \(\mathrm{DUT1}=\mathrm{UT1}-\mathrm{UTC}\), obtenido del proveedor EOP. Las conversiones que ejecuta Orbit son:

$$
\begin{aligned}
\mathrm{TAI} &= \mathrm{UTC}+\Delta_{AT},\\
\mathrm{TT} &= \mathrm{TAI}+32.184\ \mathrm{s},\\
\mathrm{UT1} &= \mathrm{UTC}+\mathrm{DUT1},\\
\mathrm{GPS} &= \mathrm{TAI}-19\ \mathrm{s},\\
\mathrm{BDT} &= \mathrm{TAI}-33\ \mathrm{s}.
\end{aligned}
$$

Las conversiones UT1 requieren DUT1 explícito. Una escala reconocida sin una correlación implementada —por ejemplo TDB, TCB, TCG, MET o SCLK— se rechaza en lugar de aproximarse a UTC.

## Tiempo sideral de TEME

La ruta TEME/SGP4 conserva GMST compatible con IAU-82. Con \(T=(JD_{UT1}-2451545.0)/36525\), el código evalúa los segundos siderales:

$$
s = 67310.54841 + (876600\cdot3600 + 8640184.812866)T
    +0.093104T^2-6.2\times10^{-6}T^3,
$$

$$
\theta_{\mathrm{GMST}}=
\operatorname{mod}_{2\pi}\!\left(\frac{\pi}{180}\frac{s}{240}\right).
$$

## Reducción de marcos

Para TEME, la matriz aplicada se expresa como:

$$
\mathbf r_{\mathrm{ITRF}}=
W(x_p,y_p)\,R_3(-\theta_{\mathrm{GMST}})\,\mathbf r_{\mathrm{TEME}},
$$

donde \(W\) es el movimiento polar tomado de EOP. Para GCRF, ICRF y EME2000, cuando \`pyerfa\` está disponible, Orbit delega la reducción IAU 2006/2000A:

$$
\mathbf r_{\mathrm{ITRF}}=
W(x_p,y_p)\,R_3(-\mathrm{ERA}(UT1))\,C(X,Y,s,TT)\,
\mathbf r_{\mathrm{celeste}}.
$$

La matriz \(C\) se obtiene de XYS IAU 2006/2000A y se corrige con \(dX,dY\) del EOP. El fallback sin SOFA/ERFA sólo sirve para visualización.

Para cualquier transformación dependiente del tiempo \(A(t)\), Orbit propaga posición, velocidad y aceleración mediante derivadas numéricas de la matriz:

$$
\begin{aligned}
\mathbf r' &= A\mathbf r,\\
\mathbf v' &= A\mathbf v+\dot A\mathbf r,\\
\mathbf a' &= A\mathbf a+2\dot A\mathbf v+\ddot A\mathbf r.
\end{aligned}
$$

La covarianza 6×6 se transforma con el jacobiano de estado:

$$
P'=J P J^\mathsf{T},\qquad
J=\begin{bmatrix}A&0\\\dot A&A\end{bmatrix}.
$$

### Variables, unidades y uso en Orbit

- Las escalas \(\mathrm{UTC}\), \(\mathrm{TAI}\), \(\mathrm{TT}\) y \(\mathrm{UT1}\) son instantes; \(\Delta_{AT}\) y \(\mathrm{DUT1}\) se expresan en segundos.
- \(JD_{UT1}\) es día juliano sin unidad, \(T\) son siglos julianos y GMST/ERA, \(X\), \(Y\), \(s\), \(x_p\) e \(y_p\) son ángulos en radianes dentro del transformador.
- \(\mathbf r\), \(\mathbf v\) y \(\mathbf a\) son SI en `StateVector`: m, m/s y m/s²; \(P\) usa las unidades cuadradas y mixtas correspondientes. Las matrices \(A\), \(W\), \(C\), \(J\) son adimensionales y \(\dot A\) tiene s⁻¹.
- El runtime toma \(\Delta_{AT}\) de `leap-seconds.list` y DUT1, \(x_p\), \(y_p\), dX y dY de EOP C04 antes de entregar una transformación ITRF. No estima esos valores en el cliente.

## Datos y límites

El modo estricto exige EOP de calidad \`final\` o \`rapid\`, cobertura de la época y una tabla local de segundos intercalares válida. \`ITRF\` sin realización no se re-etiqueta como \`ITRF2020\`; una operación de datum como IGS20→ITRF2020 debe registrarse explícitamente.

Véanse también [Sistemas temporales](../engineering/time-systems.md) y [Operación de tiempo, EOP e ITRF](../operations/time-eop.md).
