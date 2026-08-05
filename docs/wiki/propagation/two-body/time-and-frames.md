# Dos cuerpos: tiempo y marcos

[Propagación](../index.md) · [Dos cuerpos](../two-body.md) · [Tiempo, EOP e ITRF](../../operations/time-eop.md) · [Marcos de referencia](../../engineering/reference-frames.md)

## Época y avance temporal

Dos cuerpos recibe una época de diseño y cada consulta se normaliza a `UTC`.
El propagador calcula el intervalo \(\Delta t=t-t_0\) en segundos y avanza la
anomalía media con ese intervalo. UTC define el instante de la órbita y la
metainformación publicada; no cambia la dinámica kepleriana ni convierte por
sí sola la salida a un marco terrestre.

## EME2000 es el marco nativo

El estado que genera `TwoBodyPropagator` es geocéntrico e inercial en
`EME2000`. No es TEME y no debe etiquetarse de forma genérica como «ECI».
La dinámica ideal se calcula por completo en ese marco; pedir ITRF es una
operación posterior de transformación, no una nueva propagación.

## De EME2000 a ITRF

Para un mapa, una estación o el renderer, `state_at` solicita la ruta
`EME2000 → CIRS → TIRS → ITRF` al `FrameTransformService`. Esta es distinta de
la ruta clásica `TEME → PEF → ITRF` de SGP4: usa la reducción celeste-terrestre
IAU 2006/2000A cuando `pyerfa` está disponible.

La transformación usa varias escalas por razones distintas:

- UTC identifica la época que entrega la API.
- TT interviene en las cantidades celestes de la reducción IAU.
- UT1 fija el ángulo de rotación de la Tierra.
- \(\mathrm{DUT1}=\mathrm{UT1}-\mathrm{UTC}\), el movimiento polar y las
  correcciones EOP completan la orientación terrestre.

La cadena y la política de datos se detallan en [Tiempo, EOP e ITRF](../../operations/time-eop.md).

## Velocidad, precisión y procedencia

La posición se transforma con la matriz de marcos. La velocidad incorpora la
derivada temporal de esa matriz; en particular, recoge el término cinemático
dominante de la rotación terrestre \(\boldsymbol\omega\times\mathbf r\). Las
derivadas también se usan al transportar aceleración o covarianza. Consulte
[Estados cartesianos](../../engineering/cartesian-states.md) para el detalle.

La precisión de una salida ITRF depende de los EOP y de la disponibilidad de
la reducción de marcos, además de las simplificaciones propias de dos cuerpos.
Orbit conserva la procedencia de la transformación para distinguir una salida
con EOP versionados de la aproximación visual UTC≈UT1.
