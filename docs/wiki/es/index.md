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

## Explorar Orbit

<div class="grid cards" markdown>

- :material-orbit: **Conceptos de ingeniería**

  Estados, elementos, marcos, tiempo y modelos terrestres.

  [Abrir conceptos →](engineering.md)

- :material-chart-timeline-variant: **Propagación**

  SGP4, dos cuerpos, Cowell, fuerzas, integración y caché.

  [Abrir propagación →](propagation.md)

- :material-satellite-variant: **Servicio orbital**

  Formatos, catálogo, análisis y fronteras de exportación.

  [Abrir servicio →](orbit-service.md)

- :material-server-network: **Gateway**

  Runtime Node, rutas, persistencia y supervisión de procesos.

  [Abrir gateway →](gateway.md)

- :material-layers-triple: **Espacio de trabajo**

  Proyectos, capas, cuerpos, modos de tiempo y visualización 3D.

  [Abrir espacio de trabajo →](workspace.md)

- :material-api: **Referencia API**

  HTTP, WebSocket y contratos de integración pública.

  [Abrir API →](api.md)

- :material-function-variant: **Internals**

  Matemáticas, datos de referencia, modo estricto y límites explícitos.

  [Abrir internals →](internals.md)

</div>

!!! note "Runtime local"

    Orbit se distribuye como una imagen Docker. Python permanece privado dentro del contenedor; Node es la frontera pública.

Los documentos temáticos previos se conservan como material técnico detallado. Esta estructura modular es la navegación canónica y no elimina sus contratos ni sus límites.
