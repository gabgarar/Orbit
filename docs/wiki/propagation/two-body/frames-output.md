# Dos cuerpos: salida y marcos

[Propagación](../index.md) · [Dos cuerpos](../two-body.md) · [Marcos de referencia](../../engineering/reference-frames.md)

## Estado nativo

El cálculo analítico produce un estado cartesiano geocéntrico en `EME2000`.
Antes de cruzar una frontera de API se publica como `StateVector` en unidades
SI, con época `UTC`, centro `EARTH` y procedencia `source=manual`,
`propagator=two-body`, `native_frame=EME2000`.

| Método | Resultado |
| --- | --- |
| `native_state_at` | Estado `EME2000`/UTC/SI sin transformación adicional. |
| `state_at` | El mismo estado convertido de forma explícita al marco pedido. |
| `propagate_datetime` | Adaptador histórico de seis componentes ITRF/SI para el renderer. |

## Pedir una salida terrestre

Una estación, un mapa o el renderer necesitan normalmente un marco ligado a la
Tierra. `state_at(..., target_frame=ITRF)` solicita esa transformación al
`FrameTransformService`. La propagación no pasa a ser terrestre: el estado se
calcula primero en `EME2000` y solo después se transforma.

La explicación de UTC, TT, UT1, EOP y velocidad está en
[Tiempo y marcos](time-and-frames.md). Esos conceptos pertenecen a la
transformación de marcos, no a la ecuación kepleriana.

## Compatibilidad histórica

Algunas rutas antiguas se llaman `propagate_eci_datetime` o aceptan el rótulo
genérico «ECI». Son alias de compatibilidad: el contrato actual interpreta esos
estados manuales como `EME2000`. No use `ECI` como identificador de marco en
nuevas integraciones.

## Cómo leer el resultado

La salida responde «dónde estaría el objeto si solo actuara la gravedad central
ideal». No valida que el satélite real siga allí. El modelo de dos cuerpos y
la transformación a ITRF son dos responsabilidades distintas: una calcula la
dinámica ideal; la otra expresa el resultado en el sistema que necesita el
consumidor.
