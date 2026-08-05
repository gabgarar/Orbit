# SGP4

[Inicio](../index.md) · [Propagación](index.md) · [TLE](../formats/tle.md) · [Marcos de referencia](../engineering/reference-frames.md)

## Propósito

`SGP4Propagator` propaga un juego de dos líneas mediante `sgp4.api.Satrec`.
Es el motor registrado por defecto para los objetos del catálogo y conserva
que el estado nativo de SGP4 está expresado en `TEME`.

## Qué es SGP4

SGP4 es un propagador **analítico** diseñado para trabajar con TLE. Parte de
la teoría de Brouwer-Lyddane y aplica las correcciones operacionales NORAD
incorporadas en el modelo. Por ello, no calcula una nueva trayectoria a partir
de una composición de aceleraciones elegida por el usuario: interpreta y
propaga los elementos publicados en el TLE.

No es un integrador numérico y no ofrece un selector de fuerzas. Los efectos
que SGP4 considera pertenecen a su modelo NORAD fijo; `force_terms`, J2 de
Cowell, SRP o drag configurable no modifican una propagación SGP4.

## Entrada y salida

| Aspecto | Contrato |
| --- | --- |
| Entrada | Dos líneas TLE válidas para `Satrec.twoline2rv`. |
| Época de consulta | UTC; se emplea para construir la fecha juliana de SGP4. |
| Estado nativo | Posición km y velocidad km/s de SGP4, convertidas a SI en `StateVector`. |
| Marco nativo | `TEME`. |
| Salida de renderer | ITRF solicitado a través de `FrameTransformService`. |
| Procedencia | `source=TLE`, `propagator=sgp4`, `native_frame=TEME`. |

## Flujo de cálculo

```mermaid
flowchart LR
    T[TLE] --> S[Satrec.twoline2rv]
    Q[Época UTC] --> J[Julian day + fracción]
    J --> P[Satrec.sgp4]
    S --> P
    P --> N[StateVector TEME]
    N --> X[TEME → PEF → ITRF]
```

Si SGP4 devuelve un código de error, `native_state_at` falla por defecto. El
modo interno no estricto conserva una advertencia de compatibilidad, pero no
es el contrato recomendado para una aplicación científica.

## Tiempo y marco

La producción SGP4 usa la época UTC de consulta. Para la salida terrestre, la
ruta TEME usa la rotación GMST compatible con el modelo y movimiento polar.
Un valor de DUT1 legado puede inyectarse en el constructor, pero el camino
recomendado es un proveedor EOP versionado en el transformador compartido.

No debe etiquetarse un estado TEME como GCRF, EME2000 o ECI. Véase
[Marcos de referencia](../engineering/reference-frames.md).

## Uso manual

La interfaz de órbitas manuales puede seleccionar SGP4 mediante un TLE
sintético generado desde sus campos. Esa ruta es útil para comparar la salida
operativa de SGP4; no convierte los elementos manuales en un modelo físico
equivalente a dos cuerpos, J2 o Cowell.

## Régimen de validez

SGP4 está destinado a satélites en órbita terrestre representados por un TLE
reciente. Su resultado es una predicción coherente con el catálogo, no una
efeméride de precisión ilimitada.

- No es un propagador para trayectorias interplanetarias ni para cuerpos que
  no estén descritos por un TLE NORAD.
- No debe utilizarse como modelo general para órbitas muy excéntricas fuera del
  régimen operativo habitual de los TLE, especialmente si el perigeo o la
  dinámica cambian rápidamente.
- Las maniobras frecuentes, un TLE desactualizado o cambios de configuración
  degradan la predicción porque el modelo no estima esos eventos.
- No se recomienda para propagación de largo plazo; como regla operativa,
  resultados a más de aproximadamente 30 días de la época del TLE requieren
  un TLE actualizado o una fuente de efemérides validada.

## SGP4 frente a Cowell

| Aspecto | SGP4 | Cowell en Orbit |
| --- | --- | --- |
| Entrada | TLE | Estado cartesiano y época |
| Marco nativo | `TEME` | `EME2000` |
| Tipo | Analítico | Numérico: dinámica cartesiana integrada con RK4 |
| Fuerzas | Modelo NORAD fijo | Composición explícita de fuerzas disponible |
| Precisión | Buena a corto plazo si el TLE es reciente | Depende del modelo físico, el paso y el arco |
| Uso principal | Catálogo y seguimiento de objetos TLE | Simulación física y validación de fuerzas |

La elección no es una cuestión de cuál es "mejor" en abstracto: use SGP4
para continuar un TLE de catálogo y Cowell cuando necesite controlar el estado
inicial y el modelo de dinámica. Consulte también [Cowell](cowell.md).

## Precisión y limitaciones

- La fidelidad depende de la calidad, época y régimen de uso del TLE de
  origen; Orbit no reconstruye un historial de TLE ni ajusta sus parámetros.
- No hay selección de fuerzas, arrastre configurable, covarianza propagada ni
  eventos asociados a SGP4.
- El endpoint de exportación de efemérides del catálogo acepta actualmente
  solo `sgp4`.
- La transformación TEME→ITRF está condicionada por la política EOP; el
  fallback visual está marcado como aproximado.

Para el formato de entrada y sus validaciones, consulte [TLE](../formats/tle.md).
