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

Un valor de DUT1 en el constructor solo se conserva por compatibilidad. El
camino recomendado es suministrar EOP versionados al transformador compartido,
de modo que la calidad y procedencia de la orientación terrestre sean
auditables.
