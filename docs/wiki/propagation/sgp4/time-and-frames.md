# SGP4: tiempo y marcos

[Propagación](../index.md) · [SGP4](../sgp4.md) · [Tiempo y EOP](../../operations/time-eop.md) · [Marcos de referencia](../../engineering/reference-frames.md)

## UTC para consultar el modelo

La API de Orbit recibe un instante y lo normaliza a `UTC`. Ese instante se
convierte al día juliano y fracción que consume SGP4. UTC es la escala de la
consulta y de la metainformación del `StateVector`; no convierte por sí sola el
estado nativo a un marco terrestre.

## TEME es el marco nativo

La salida directa de SGP4 se etiqueta `TEME`. No debe renombrarse como GCRF,
`EME2000` o «ECI»: aunque todos son marcos usados en contexto orbital, no son
intercambiables como contrato de datos.

### Por qué existe TEME

`TEME` significa *True Equator, Mean Equinox*. Es una convención histórica de
NORAD asociada al modelo SGP4 y a la manera en que sus correcciones analíticas
fueron definidas. No es un marco astronómico celeste moderno de la IAU ni un
sustituto de GCRF/EME2000; existe en Orbit porque es el marco que entrega SGP4
y preservarlo evita alterar silenciosamente el significado de un TLE.

| Operación | Marco resultante |
| --- | --- |
| `native_state_at` | `TEME`. |
| `state_at(..., target_frame=ITRF)` | `ITRF` solicitado explícitamente. |
| `propagate_teme_datetime` | Adaptador histórico TEME en km y km/s. |
| `propagate_datetime` | Adaptador histórico ITRF en SI. |

## De TEME a ITRF

Para mostrar una traza terrestre o evaluar una estación se solicita `ITRF`
al `FrameTransformService`. La ruta común aplica la rotación compatible con el
modelo y usa la política EOP para UT1 y movimiento polar. El propagador no
oculta esta conversión ni vuelve a etiquetar un estado TEME antes de hacerla.

### UTC, UT1 y DUT1

SGP4 se consulta con una época UTC, pero la rotación de la Tierra se evalúa en
UT1. El proveedor EOP aporta \(\mathrm{DUT1}=\mathrm{UT1}-\mathrm{UTC}\): esa
diferencia permite pasar de la hora civil de la consulta a la escala que marca
el ángulo de rotación terrestre. La cadena completa está documentada en
[Tiempo, EOP e ITRF](../../operations/time-eop.md).

### Rotación TEME → PEF

Orbit sigue la ruta clásica `TEME → PEF → ITRF`. El primer tramo gira alrededor
del eje terrestre con GMST82 evaluado en UT1, la convención de tiempo sideral
media compatible con el contexto SGP4/Vallado; no es la rotación IAU 2000/2006
que se usa en la ruta GCRF/EME2000. El segundo tramo aplica movimiento polar
para llegar a ITRF. Véase también [Marcos de referencia](../../engineering/reference-frames.md).

### Posición, velocidad y aceleración

La posición se rota con la matriz de la ruta anterior. La velocidad no puede
rotarse como un vector estático: Orbit incluye la derivada temporal de la
matriz de rotación, cuyo término dominante corresponde a la velocidad de
rotación terrestre \(\omega\times\mathbf r\). Cuando hay
aceleración o covarianza, el servicio incorpora también las derivadas que
corresponden. La explicación general y las ecuaciones están en
[Estados cartesianos](../../engineering/cartesian-states.md).

Un valor de DUT1 en el constructor solo se conserva por compatibilidad. El
camino recomendado es suministrar EOP versionados al transformador compartido,
de modo que la calidad y procedencia de la orientación terrestre sean
auditables.

La precisión final de un estado ITRF depende tanto de la calidad y antigüedad
del TLE como de los EOP —en particular UT1/DUT1 y movimiento polar— usados en
la transformación. La procedencia del estado registra esta información para
que el resultado pueda revisarse después.
