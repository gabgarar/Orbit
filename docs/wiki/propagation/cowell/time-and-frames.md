# Cowell: tiempo y marcos

[Propagación](../index.md) · [Cowell](../cowell.md) · [Tiempo, EOP e ITRF](../../operations/time-eop.md) · [Marcos de referencia](../../engineering/reference-frames.md)

## Época y tiempo de integración

Cowell recibe una época inicial `UTC` y un estado inicial `EME2000`. Para una
consulta, calcula el intervalo \(\Delta t=t-t_0\) en segundos y RK4 integra
la dinámica cartesiana en ese intervalo. UTC identifica el instante y el
estado publicado; el paso de integración fijo de 60 s es una decisión numérica,
no una escala de tiempo de referencia distinta.

## EME2000 es el marco de la dinámica

Cowell evalúa el estado, la gravedad central y los términos de fuerza actuales
en el contrato inercial `EME2000`. No usa TEME ni rota el estado a un marco
terrestre dentro de cada etapa RK4. Esta separación evita mezclar la dinámica
del propagador con la transformación que requiere un consumidor.

Los modelos terrestres presentes tienen las simplificaciones declaradas en
[Entrada y fuerzas](input-and-forces.md); no deben interpretarse como una
transformación completa ITRF→EME2000 de alta fidelidad durante la integración.

## De EME2000 a ITRF

Después de integrar, `state_at` puede pedir la ruta
`EME2000 → CIRS → TIRS → ITRF` al `FrameTransformService`. Es una ruta IAU
2006/2000A cuando `pyerfa` está disponible y no debe confundirse con
`TEME → PEF → ITRF`, que es específica de SGP4.

UTC nombra la época solicitada. TT interviene en la reducción celeste y UT1
en la rotación terrestre; el proveedor EOP obtiene UT1 a partir de
\(\mathrm{DUT1}=\mathrm{UT1}-\mathrm{UTC}\) y aporta movimiento polar. La
explicación operativa completa está en [Tiempo, EOP e ITRF](../../operations/time-eop.md).

## Velocidad, precisión y procedencia

La transformación de salida no rota solo la posición: la velocidad incluye la
derivada de la matriz de rotación, cuyo término principal corresponde a
\(\boldsymbol\omega\times\mathbf r\). Las derivadas también se emplean para
aceleración y covarianza cuando están presentes. Véanse las ecuaciones de
[Estados cartesianos](../../engineering/cartesian-states.md).

La fidelidad final combina dos límites independientes: el modelo/RK4 de Cowell
y la calidad de los EOP, UT1 y la transformación de marcos. La procedencia del
estado permite saber qué transformación se aplicó; no convierte una dinámica
de baja fidelidad en una efeméride precisa.
