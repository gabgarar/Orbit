# SGP4: TLE y contrato de estado

[Propagación](../index.md) · [SGP4](../sgp4.md) · [TLE](../../formats/tle.md)

## El TLE es la entrada

SGP4 recibe las dos líneas completas de un TLE y Orbit las construye mediante
`Satrec.twoline2rv`. Un TLE no es una lista de fuerzas configurables ni una
efeméride de alta fidelidad: es un conjunto de elementos medios codificados
para el modelo SGP4 de NORAD.

La época escrita en el TLE importa. A medida que una consulta se aleja de ella,
la predicción suele degradarse por cambios reales del satélite y por las
limitaciones del propio modelo.

## Consulta

Para cada época solicitada, Orbit normaliza el instante a UTC, forma el día
juliano y su fracción, y consulta `Satrec.sgp4`. La biblioteca devuelve
posición en km y velocidad en km/s; Orbit las convierte a SI al publicar el
estado común.

| Aspecto | Contrato de Orbit |
| --- | --- |
| Entrada | Dos líneas TLE válidas. |
| Época de consulta | UTC. |
| Estado nativo | Posición y velocidad del modelo SGP4. |
| Unidades publicadas | m y m/s dentro de `StateVector`. |
| Centro | `EARTH`. |
| Procedencia | `source=TLE`, `propagator=sgp4`, `native_frame=TEME`. |

## Resultado y errores

`native_state_at` devuelve un `StateVector` `TEME`/UTC/SI. Por defecto, un
código de error de SGP4 detiene la consulta y se comunica al llamador. Existe
un modo interno no estricto de compatibilidad que conserva una advertencia,
pero no es el contrato recomendado para un resultado científico.

El error no significa automáticamente que el software esté roto. Puede indicar
que el TLE, la época solicitada o el régimen orbital han llevado al modelo
fuera de una evaluación válida. Revise siempre la antigüedad y procedencia del
TLE antes de interpretar un resultado.
