# Propagación

## Visión general

Orbit separa propagación nativa y presentación solicitada. Cada motor produce su marco científico; `FrameTransformService` entrega ITRF solo cuando un consumidor lo pide.

## Propagadores

### SGP4

Acepta TLE validado y produce TEME. Es el contrato del modelo TLE, no una afirmación de fuerzas de alta fidelidad.

### Dos cuerpos y J2

Los motores manuales analíticos usan un estado de época EME2000. Dos cuerpos conserva la solución central; J2 aplica el comportamiento secular de primer orden declarado.

### Cowell

Cowell integra un estado cartesiano EME2000 con RK4 y una composición explícita de fuerzas que incluye siempre la gravedad central.

```python
CowellPropagator(epoch, state, force_terms=["central", "j2", "drag"])
```

Una composición explícita prevalece sobre presets heredados. Área, masa y coeficiente de arrastre se validan antes de integrar.

## Fuerzas e integración

Los términos disponibles incluyen J2/J3/J4, geopotencial completo, terceros cuerpos, arrastre, SRP y relatividad según el motor/configuración. La caché de Cowell guarda estados integrados por desplazamiento de época, parte del estado más cercano y no inventa interpolación; hacia el pasado usa pasos RK4 negativos.

+## Ecuaciones implementadas

La composición actual de Cowell es exactamente \(\{\mathrm{central},J_2,J_3,J_4,\mathrm{drag}\}\); cada ejecución selecciona un subconjunto explícito que siempre contiene gravedad central.

### Punto masa y Cowell

Con \(\mathbf r=(x,y,z)\), \(r=\lVert\mathbf r\rVert\) y \(\mu\) terrestre:

$$
\mathbf a_{\mathrm{central}}=-\frac{\mu}{r^3}\mathbf r,\qquad
\frac{d}{dt}\begin{bmatrix}\mathbf r\\\mathbf v\end{bmatrix}
=\begin{bmatrix}\mathbf v\\\mathbf a_{\mathrm{central}}+\sum\mathbf a_i\end{bmatrix}.
$$

Cowell avanza ese sistema con RK4 de paso fijo \(h\):

$$
\mathbf y_{k+1}=\mathbf y_k+
\frac{h}{6}\left(\mathbf k_1+2\mathbf k_2+2\mathbf k_3+\mathbf k_4\right),
$$

donde \(\mathbf k_1=f(\mathbf y_k)\), \(\mathbf k_2=f(\mathbf y_k+h\mathbf k_1/2)\), \(\mathbf k_3=f(\mathbf y_k+h\mathbf k_2/2)\) y \(\mathbf k_4=f(\mathbf y_k+h\mathbf k_3)\).

### Armónicos zonales J2, J3 y J4

El código usa \(q=z/r\), los coeficientes zonales WGS-84 y:

$$
P_2(q)=\frac{3q^2-1}{2},\qquad
P_3(q)=\frac{5q^3-3q}{2},\qquad
P_4(q)=\frac{35q^4-30q^2+3}{8}.
$$

Para \(n\in\{2,3,4\}\), con \(J_n\) habilitado:

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

### Arrastre atmosférico

La atmósfera del modelo actual corrota con la Tierra:

$$
\mathbf v_{\mathrm{rel}}=\mathbf v-\mathbf\omega_\oplus\times\mathbf r,\qquad
\rho(h)=\rho_0\exp\left(-\frac{h-h_0}{H}\right).
$$

Con \(B=C_DA/m\), la aceleración aplicada es:

$$
\mathbf a_{\mathrm{drag}}=-\frac{1}{2}B\,\rho(h)\,
\lVert\mathbf v_{\mathrm{rel}}\rVert\,\mathbf v_{\mathrm{rel}}.
$$

Orbit selecciona \((\rho_0,h_0,H)\) de capas exponenciales locales, evalúa la norma de velocidad en m/s y conserva el vector interno en km y km/s.

## Ecuaciones previstas

!!! warning "Ecuación prevista para implementación futura"

    **Geopotencial de orden alto.** El modelo actual termina en \(J_4\). Una expansión hasta grado y orden \(N\) requeriría:

    $$
    U(r,\phi,\lambda)=\frac{\mu}{r}\left[1+\sum_{n=2}^{N}\left(\frac{R_\oplus}{r}\right)^n
    \sum_{m=0}^{n}\bar P_{nm}(\sin\phi)
    \left(\bar C_{nm}\cos m\lambda+\bar S_{nm}\sin m\lambda\right)\right],
    \qquad \mathbf a=-\nabla U.
    $$

!!! warning "Ecuación prevista para implementación futura"

    **SRP de múltiples superficies.** No existe un término SRP activo en Cowell. Un modelo por caras podría sumar:

    $$
    \mathbf a_{\mathrm{SRP}}=-P_\odot\left(\frac{\mathrm{AU}}{d_\odot}\right)^2
    \frac{1}{m}\sum_i A_i\max(0,\hat{\mathbf n}_i\cdot\hat{\mathbf s})C_{R,i}\hat{\mathbf s}.
    $$

!!! warning "Ecuación prevista para implementación futura"

    **Arrastre avanzado.** No hay MSIS ni forzamientos solar-geomagnéticos en el runtime actual:

    $$
    \rho=\rho_{\mathrm{MSIS}}(h,\phi,\lambda,t,F_{10.7},\overline{F}_{10.7},A_p).
    $$

!!! warning "Ecuación prevista para implementación futura"

    **Actitud.** Orbit no propaga actitud:

    $$
    \dot{\mathbf q}=\frac{1}{2}\Omega(\mathbf\omega)\mathbf q,\qquad
    I\dot{\mathbf\omega}+\mathbf\omega\times(I\mathbf\omega)=\mathbf\tau.
    $$

!!! warning "Ecuación prevista para implementación futura"

    **Terceros cuerpos.** No hay fuerza de terceros cuerpos en la composición actual:

    $$
    \mathbf a_{3B}=\mu_b\left(
    \frac{\mathbf r_b-\mathbf r}{\lVert\mathbf r_b-\mathbf r\rVert^3}
    -\frac{\mathbf r_b}{\lVert\mathbf r_b\rVert^3}\right).
    $$

!!! warning "Ecuación prevista para implementación futura"

    **Resonancias.** No existe modelo resonante:

    $$
    \phi=k_1\lambda+k_2\lambda_b+k_3\varpi+k_4\Omega,\qquad \dot\phi\approx0.
    $$

## Límites

- La precisión depende de fuerzas, coeficientes, paso y datos de referencia.
- El EOP visual sirve para el visor, no para productos estrictos.
- OEM/SP3 importados son efemérides; no se reproporcionan por una fuerza implícita.
