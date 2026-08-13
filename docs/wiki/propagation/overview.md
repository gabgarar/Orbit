# Visión general de propagación

[Inicio](../index.md) · [Propagación](index.md) · [Estados cartesianos](../engineering/cartesian-states.md) · [Marcos](../engineering/reference-frames.md)

## Contrato común

Los propagadores modernos exponen primero `native_state_at(instant)` y después
`state_at(instant, target_frame=...)`. El primer método conserva el marco y la
escala propios del modelo; el segundo delega el cambio de marco en el servicio
común de transformación.

Los métodos que devuelven seis números (`propagate_datetime`, `propagate` y
`propagate_offset`) permanecen como adaptadores del renderer y devuelven el
estado ITRF en unidades SI. No deben usarse para deducir el marco nativo.

```mermaid
flowchart LR
    D[Definición de órbita] --> P[Propagador o lector]
    P --> N[Estado nativo]
    N --> F[FrameTransformService]
    F --> V[Estado solicitado / ITRF]
    E[EOP + tabla UTC-TAI] --> F
```

## Propagadores disponibles

Un propagador define cómo evoluciona el estado. Los términos como zonales,
arrastre, geopotencial, terceros cuerpos, SRP y relatividad son
[modelos de fuerza](force-models.md), no propagadores: Cowell los compone y el
integrador [RK4](rk4.md) resuelve el sistema numérico.

| Propagador | Origen | Estado nativo | Dinámica | Disponibilidad operativa |
| --- | --- | --- | --- | --- |
| [SGP4](sgp4.md) | TLE | TEME, UTC | Implementación SGP4 de `sgp4.api.Satrec`. | Sólo catálogo TLE. |
| [Dos cuerpos](two-body.md) | Elementos manuales | EME2000, UTC | Kepler elíptico analítico. | Órbita manual. |
| [Cowell](cowell.md) | Estado manual | EME2000, UTC | RK4 fijo con composición de fuerzas validada; incluye ICGEM, Sol/Luna, SRP y Schwarzschild cuando se seleccionan. | Órbita manual. |
| J2+J3+J4 | Estado manual | EME2000, UTC | Preset RK4 fijo sin drag. | Compatibilidad manual. |

El registro de propagadores usado por el catálogo contiene solo `sgp4`. No hay
selector de Cowell, dos cuerpos ni J2 para un objeto de catálogo TLE.

## Consulta de estado, no interpolación de modelo

Los propagadores de esta sección calculan un estado para la época solicitada;
no consultan una tabla de posiciones intermedia.

| Ruta | Método al pedir un instante arbitrario |
| --- | --- |
| SGP4 / TLE | Llamada directa al modelo `Satrec.sgp4` en la época UTC. |
| Dos cuerpos | Avance analítico de la anomalía media y solución de Kepler en esa época. |
| Cowell/RK4 | Integración RK4 de paso máximo fijo de 60 s desde el estado cacheado más cercano; si el objetivo no coincide con el paso nominal, se integra un último paso reducido. |
| J2+J3+J4 | Preset de compatibilidad que usa el mismo núcleo RK4 de paso fijo de Cowell. |

Por tanto, el caché de Cowell no se interpola y ni SGP4 ni dos cuerpos usan
RK4. Las órbitas dibujadas sí se obtienen solicitando varias épocas y Cesium
une esos puntos; el movimiento de un marcador entre vértices puede ser lineal
para una visualización continua. Eso no es una evaluación adicional del
propagador.

Para la matriz que también cubre SP3, OEM, ERP y la diferencia entre la ruta
Python y la carga OEM local del visor, consulte
[Efemérides e interpolación](../orbit-service.md).

## Marcos y unidades

| Origen | Marco nativo | Unidades internas | Salida de contrato |
| --- | --- | --- | --- |
| SGP4 | TEME | km, km/s | `StateVector` SI. |
| Dos cuerpos | EME2000 | km, km/s | `StateVector` SI. |
| Cowell/J2+J3+J4 | EME2000 | km, km/s | `StateVector` SI. |

La transformación a ITRF depende de los datos de orientación terrestre. Una
configuración visual sin EOP local deja la procedencia marcada como aproximada;
el modo estricto se describe en [Marcos de referencia](../engineering/reference-frames.md).

## Selección manual

Las rutas manuales aceptan elementos keplerianos para dos cuerpos, un estado
cartesiano para Cowell y el preset J2+J3+J4 de compatibilidad. La entrada y la
dinámica de esos modelos se definen en `EME2000`; si la vista o una efeméride
de salida necesita un marco terrestre, se transforma después a `ITRF`.

SGP4 no participa en esta selección. Consume un TLE de catálogo y mantiene
`TEME` como su marco nativo; reutilizar elementos manuales EME2000 como si
fueran elementos medios NORAD no es una conversión de marco válida.

!!! warning "No disponible: ajuste de TLE sintético"

    Exportar un TLE a partir de una órbita manual requerirá una operación
    explícita de ajuste: muestrear una efeméride de referencia, expresarla en
    TEME y ajustar el modelo SGP4/TLE sobre un intervalo, declarando residuos
    y procedencia. No forma parte de la propagación manual actual.

## Límites globales

- No hay determinación de órbita, estimación de parámetros, maniobras ni
  propagación de covarianza.
- No hay integrador adaptativo, eventos de precisión, STM/covarianza, maniobras,
  mareas, albedo/IR, atmósfera de alta fidelidad ni SRP dependiente de actitud.
- Las fuerzas disponibles no convierten el RK4 fijo de 60 s en una efeméride de
  misión; requieren sus datos auxiliares y una validación frente a referencia.
- El lector OEM/SP3 es una fuente tabulada Python; no es un propagador
  registrado en `OrbitRuntime` ni una carga de producto UI/API.

Consulte [Formatos](../formats/index.md) para fuentes de datos,
[Integradores numéricos](numerical-integrators.md) para RK4 y
[Modelos de fuerza](force-models.md) para las fuerzas disponibles.
