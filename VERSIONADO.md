# Versionado del proyecto Orbit

Este proyecto puede versionarse con la regla: 1 commit = 1 versión.

Convención propuesta:
- Versión inicial: v0.0.1
- Cada nuevo commit incrementa en +1 el último número.
- La versión actual corresponde al commit más reciente en la rama de trabajo.

Estado actual:
- Total de commits: 23
- Última versión en develop: v0.0.23
- Próxima versión en preparación: v0.0.24
- Cambios en curso: siguiente commit reservado para v0.0.24; incluye mejoras visuales de órbitas (HEO/GEO), skydome de estrellas estable en zoom y mezcla día/noche del globo con textura nocturna fija `earthnight3km.jpg`.

## Historial de versiones (1 commit = 1 versión)

### v0.0.1
- Fecha: 2026-06-23
- Commit: 316a41d
- Cambios: Initial commit.

### v0.0.2
- Fecha: 2026-06-23
- Commit: ac617de
- Cambios: contenido inicial de README.

### v0.0.3
- Fecha: 2026-06-23
- Commit: 326bbe5
- Cambios: primer commit funcional.

### v0.0.4
- Fecha: 2026-06-23
- Commit: 8de12ac
- Cambios: funcionamiento con imagen de 2km/pixel.

### v0.0.5
- Fecha: 2026-06-23
- Commit: bd1017d
- Cambios: nuevo favicon.

### v0.0.6
- Fecha: 2026-06-23
- Commit: fa9ef4b
- Cambios: estructura del proyecto en formato Node.js.

### v0.0.7
- Fecha: 2026-06-24
- Commit: c455c4e
- Cambios: procesos de run/stop y actualización de README.

### v0.0.8
- Fecha: 2026-06-24
- Commit: b9255a6
- Cambios: correcciones de ejecución.

### v0.0.9
- Fecha: 2026-06-24
- Commit: 687e016
- Cambios: merge de PR #1 (restart).

### v0.0.10
- Fecha: 2026-06-24
- Commit: da1d984
- Cambios: escalas y modelo 3D de satélite.

### v0.0.11
- Fecha: 2026-06-24
- Commit: 6814363
- Cambios: merge de PR #2 (satellite icon).

### v0.0.12
- Fecha: 2026-06-24
- Commit: d4d777f
- Cambios: propagación de órbitas y lectura de TLE en texto plano.

### v0.0.13
- Fecha: 2026-06-24
- Commit: 7ef49c9
- Cambios: requirements.txt, .gitignore y más satélites.

### v0.0.14
- Fecha: 2026-06-24
- Commit: dba261f
- Cambios: merge de PR #3 (orbit propagation websockets).

### v0.0.15
- Fecha: 2026-06-24
- Commit: b975913
- Cambios: optimizaciones y puntos orbit_hide_near_satellite.

### v0.0.16
- Fecha: 2026-06-24
- Commit: 1752b29
- Cambios: antialiasing.

### v0.0.17
- Fecha: 2026-06-24
- Commit: db2e4d2
- Cambios: panel de configuración.

### v0.0.18
- Fecha: 2026-06-24
- Commit: 431e5cb
- Cambios: parámetros physical/visual y escala en config.

### v0.0.19
- Fecha: 2026-06-24
- Commit: af8b90d
- Cambios: estilo de panel para incluir nuevas capas.

### v0.0.20
- Fecha: 2026-06-24
- Commit: aec9a4d
- Cambios: información TLE.

### v0.0.21
- Fecha: 2026-06-25
- Commit: 7b9ed24
- Cambios: corrección de órbitas en modo selección.

### v0.0.22
- Fecha: 2026-06-25
- Commit: 655f893
- Cambios: clasificaciones y mejora del filtro.

### v0.0.23
- Fecha: 2026-06-26
- Commit: dab0dd9
- Cambios: catálogo con virtualización basada en la posición real del scroll (elimina los huecos en blanco y las recargas bruscas al pasar de página), altura de fila medida una sola vez y fijada para evitar la oscilación que provocaba scroll descontrolado, y throttle del manejador de scroll con `requestAnimationFrame`. Además, el botón de configuración (`#configToggleBtn`) se reubica a la esquina superior izquierda para no solaparse con la barra de herramientas de Cesium (botón de ayuda/home/sceneModePicker).

### v0.0.24
- Fecha: 2026-06-26
- Commit: PENDIENTE
- Cambios: render de órbitas con `depthFailMaterial` para que no desaparezcan detrás del globo, opacidad forzada a 1.0 y grosor por defecto aumentado para que las estelas naranjas no se vean lavadas; además, mitigación anti-OOM en backend con muestreo adaptativo por número de satélites para limitar puntos de órbita por lote, con presupuesto ampliado para no degradar 200 satélites, y densidad extra para órbitas de alta excentricidad (HEO); el fondo estelar pasa de skybox cúbico a skydome esférico con textura high-res, actualización en `preRender` para evitar jitter al zoom, domo mucho más lejano para evitar oclusiones del globo, trazas naranjas ocultas detrás de la Tierra, zoom mínimo reducido para acercar más la cámara, zoom máximo ampliado para alejar mucho más, y mezcla dinámica día/noche del globo con capa nocturna dedicada (`dayAlpha/nightAlpha`) y ruta fija `earthnight3km.jpg`; y validación con banner visible para entradas numéricas fuera de rango. corrección de scroll del catálogo ante rueda con deltas grandes (toque único que desplazaba sin control), añadiendo límite de delta por evento en `wheel` y estabilización visual de filas (`min-height` + `text-overflow`) para evitar saltos de layout durante la virtualización. Ajustes adicionales: modo estricto de rueda con paso fijo y control por ráfaga; último ajuste en modo "primer evento por ráfaga" con pausa idle para eliminar acumulación al bajar rápido.


## Cómo mantener este documento

Tras cada commit nuevo:
1. Incrementar la versión en +1 (por ejemplo, de v0.0.22 a v0.0.23).
2. Añadir una nueva sección con fecha, hash corto y resumen de cambios.
3. Actualizar el bloque Estado actual.

Mientras existan cambios sin commit:
1. Mantener actualizado el bloque "Próxima versión en preparación".
2. Resumir en "Cambios en curso" cualquier ajuste nuevo añadido durante la tarea.