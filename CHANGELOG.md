# Versionado del proyecto Orbit

Este proyecto puede versionarse con la regla: 1 commit = 1 versión.

Convención propuesta:
- Versión inicial: v0.0.1
- Cada nuevo commit incrementa en +1 el último número.
- La versión actual corresponde al commit más reciente en la rama de trabajo.

Estado actual:
- Total de commits: 26
- Última versión en develop: v0.0.25
- Próxima versión en preparación: v0.1.0 (lista para commit)
- Cambios en curso: ninguno. v0.1.0 incluye todas las mejoras acumuladas desde v0.0.25 — ver entrada v0.1.0 abajo.
- Cambios en curso: preparación de primera versión estable v0.1.0. Se reorganiza el panel de configuración en pestañas para agrupar parámetros por categorías (Orbital, Objetos, Escena y Sistema) y mejorar la navegación con muchos ajustes. Se corrige la visibilidad de pestañas para que solo se muestre el contenido de la pestaña activa (evitando que aparezcan todas las secciones juntas). Se añade menú contextual con click derecho sobre satélites para abrir "Opciones de visualización" específicas de ese satélite y aplicar overrides locales en órbita/objeto (colores, grosores, propagación, estela, modelo 3D, escala y tamaño de etiqueta) sin afectar la configuración global. Se refuerza la detección en click derecho (incluyendo picks sobre órbita/estela y fallback con evento `contextmenu`) para que la opción aparezca de forma consistente, y se integra también en el menú contextual del sidebar/catálogo para garantizar acceso desde la lista de objetos ya cargados. Se corrige además la aplicación del toggle de modelo 3D por satélite para que el override individual sea más estable al activar/desactivar sin recreaciones innecesarias. En el selector del catálogo se elimina la opción contextual "Detalles del satelite", se añade acceso directo "TLE" por fila para explicar parámetros orbitales, y se restaura el icono de advertencia tras el nombre cuando la antigüedad del TLE supera la vigencia recomendada para su tipo de órbita. Se añade en el panel de configuración un botón para reiniciar parámetros a valores por defecto y, al ejecutarlo, también se limpian todos los overrides específicos por satélite para que toda la simulación vuelva a configuración global base. Además, se incorpora el botón "Aplicar global a todos" para conservar la configuración global actual y propagarla limpiando únicamente las configuraciones específicas de satélite. Se incorpora un HUD de tiempo en pantalla adaptado al estado actual de ejecución (mostrando fecha y hora real mientras no haya modo de simulación temporal activo), centrado en la parte superior para mejorar legibilidad y con opción en Sistema para mostrarlo/ocultarlo. En telemetría se añade una sección nueva "Orbita" con datos de propagación hacia delante y hacia atrás (en horas/días), junto a métricas orbitales adicionales; y todas las secciones pasan a ser plegables para ahorrar espacio. Se corrige la interacción de plegado para que las secciones realmente se abran/cierren de forma estable pese al refresco periódico de la telemetría, y se ajusta el CSS para que al estar colapsadas no se renderice la grilla de contenido. Se habilita propagación 0 para futuro/pasado (global y específica), tratándola como sin propagación efectiva; la telemetría muestra "-" en esos campos cuando vale 0 y se eliminan de Estado los indicadores redundantes de órbita futura/pasada en formato Sí/No. Se elimina además una reasignación innecesaria en el render de la estela pasada que podía provocar parpadeo visual al modificar su grosor, se evita recrear su material en cada update para estabilizar la línea durante cambios de ancho y se añade `depthFailMaterial` + umbral de actualización de grosor para reducir titileo cuando la órbita futura está desactivada. Para el caso de `Orbit Width Mode = physical`, se añade suavizado temporal del grosor de la estela pasada para minimizar jitter por variaciones continuas de distancia cámara-satélite y, cuando la órbita futura está apagada, se fija el ancho de la estela pasada al valor configurado para evitar oscilaciones físicas residuales. Como refuerzo final, la estela pasada se renderiza sin test de profundidad y con actualización geométrica estable (sin suavizado extra por frame), copiando posiciones por actualización y usando `arcType: NONE` para evitar jitter por mutaciones in-place y recalculados de arco. Se integra soporte de capa de teselas locales `earth2km_tiles` para mejorar calidad al hacer zoom sin cargar una textura gigante completa, manteniendo fallback automático a `earth8km` cuando las teselas no están generadas.

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
- Fecha: 2026-06-27
- Commit: 4dd03b1
- Cambios: cierre de la versión v0.0.24. Se consolidan mejoras en render de órbitas y fondo estelar, mezcla día/noche del globo con textura `earthnight3km.jpg`, ajustes de rendimiento/estabilidad en backend y mejoras de interacción del catálogo (scroll/virtualización).

### v0.0.25
- Fecha: 2026-06-27
- Commit: PENDIENTE
- Cambios: cierre de v0.0.25. Incluye conmutador de navegación de cámara centrada/libre con controles de vuelo, fix de visibilidad por capa al ocultar/mostrar objetos, mejora de edición de campos numéricos en panel runtime (decimales y borrado temporal), mejora de "Seleccionar todo" para operar sobre todas las páginas filtradas, botón de grabación de sesión con confirmación de guardado mediante modal propio, parámetros de grabación de calidad y formato de salida, fix crítico de carga por callback `onstop` async, grabación fija solo de simulación/objetos (sin menús en el video) manteniendo la UI visible durante la grabación, eliminación de opción "Include UI" y mejora de fluidez de grabación con perfiles de FPS: low 24, medium 30, high hasta 60. Además, se corrige la generación de tiles `earth2km` para imágenes muy grandes (desactivando el límite de seguridad de píxeles de Pillow) y se optimiza el algoritmo de teselado con remuestreo por filas + logs de progreso para evitar bloqueos/terminaciones durante el proceso. Se genera `earth3km.jpg` (14400×7200) redimensionando `earth2km` con Lanczos y se sustituye `earth8km` por `earth3km` como textura base del globo, mejorando la calidad de la vista general en ≈2.25×.

### v0.1.0
- Fecha: 2026-06-27
- Commit: PENDIENTE
- Cambios: primera versión estable. Consolida todas las mejoras de la rama develop desde v0.0.24:
  - **Panel de configuración por pestañas**: Orbital, Objetos, Escena y Sistema; solo muestra la pestaña activa.
  - **Personalización visual por satélite**: menú contextual (click derecho en globo o catálogo) con overrides locales de colores, grosores, propagación, estela, modelo 3D, escala y tamaño de etiqueta, sin afectar la config global.
  - **Reiniciar parámetros**: botón que restaura config global y limpia todos los overrides por satélite.
  - **Aplicar global a todos**: propaga la config global limpiando overrides individuales.
  - **HUD de fecha y hora**: widget centrado arriba con hora en tiempo real; configurable desde panel Sistema (`show_top_clock`).
  - **Secciones de telemetría plegables** en el sidebar (Telemetría y Órbita).
  - **TLE directo por fila** en el catálogo; eliminada la opción "Detalles del satélite".
  - **Warning de TLE** restaurado (icono de advertencia cuando el TLE supera la vigencia recomendada).
  - **Propagación 0 soportada**: mínimo 0 horas/segundos en todos los controles; muestra guion cuando no hay propagación activa.
  - **Navegación de cámara centrada/libre** (WASD, Q/E, flechas en modo libre).
  - **Grabación de sesión**: botón dedicado, perfiles de calidad (low/medium/high), formato webm/mp4, confirmación de guardado.
  - **Textura base earth3km.jpg** (14400×7200, generada con Lanczos desde earth2km), sustituyendo earth8km en 2.25× más detalle.
  - **Script `generate_earth2km_tiles.py`** optimizado: remuestreo por filas, desactivación de `MAX_IMAGE_PIXELS` para imágenes grandes, logs de progreso.
  - **Corrección de estelas pasadas** detrás del globo: eliminado `disableDepthTestDistance: Infinity` en `createTrailEntity`.
  - **Mezcla día/noche**: capa nocturna (`earthnight3km.jpg`) con `dayAlpha=0`/`nightAlpha=1`, sincronizada con `globe_lighting` del panel.


## Cómo mantener este documento

Tras cada commit nuevo:
1. Incrementar la versión en +1 (por ejemplo, de v0.0.22 a v0.0.23).
2. Añadir una nueva sección con fecha, hash corto y resumen de cambios.
3. Actualizar el bloque Estado actual.

Mientras existan cambios sin commit:
1. Mantener actualizado el bloque "Próxima versión en preparación".
2. Resumir en "Cambios en curso" cualquier ajuste nuevo añadido durante la tarea.