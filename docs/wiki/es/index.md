# Orbit

## Visión general

Orbit es un entorno local para importar, propagar, analizar y visualizar estados orbitales geocéntricos. Une un gateway Node.js, un servicio orbital Python privado y un espacio de trabajo Cesium.

Cada estado conserva época, escala temporal, marco, centro, unidades SI y procedencia. Una conversión de presentación nunca modifica silenciosamente el estado nativo.

## Por qué Orbit

- Conserva datos nativos al entregar estados preparados para el visor.
- Comparte un único límite de transformación entre TLE, propagación analítica, Cowell, OEM y futuros productos SP3.
- Usa EOP y segundos intercalares locales, versionados y reproducibles.
- Ofrece proyectos, capas, cuerpos y línea temporal persistentes en local.

## Ejemplo rápido

```text
TLE / OEM / definición manual → StateVector nativo → transformación solicitada
                                           → visor, análisis o exportación
```

## Módulos

| Módulo | Propósito |
| --- | --- |
| [Conceptos de ingeniería](modules/engineering.md) | Estados, elementos, marcos, tiempo y modelos terrestres. |
| [Tiempo, EOP e ITRF](time.md) | Escalas, UT1, GMST, reducción terrestre y covarianzas. |
| [Propagación](propagation/index.md) | Propagadores, fuerzas, integración y caché. |
| [Servicio orbital](orbit-service.md) | Formatos, catálogo, análisis y exportación. |
| [Gateway](gateway.md) | Runtime Node, rutas, persistencia y supervisión. |
| [Espacio de trabajo](workspace.md) | Proyectos, capas, cuerpos, tiempo y vista 3D. |
| [Referencia API](api.md) | HTTP, WebSocket y contratos de integración. |
| [Internals](internals.md) | Matemáticas, procedencia, modo estricto y límites. |

!!! note "Runtime local"

    Orbit se distribuye como una imagen Docker. Python permanece privado dentro del contenedor; Node es la frontera pública.

Los documentos temáticos previos se conservan como material técnico detallado. Esta estructura modular es la navegación canónica y no elimina sus contratos ni sus límites.
