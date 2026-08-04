# Versionado del proyecto Orbit

Este proyecto puede versionarse con la regla: 1 commit = 1 versión.

Convención propuesta:
- Versión inicial: v0.0.1
- Cada nuevo commit incrementa en +1 el último número.
- La versión actual corresponde al commit más reciente en la rama de trabajo.

Estado actual:
- Total de commits: 26
- Última versión en develop: v0.1.0
- Próxima versión en preparación: v0.1.2 (lista para commit)
- Cambios en curso: ninguno. v0.1.2 corrige el z-fighting de la traza de suelo, elimina duplicados en la configuración Orbital y arregla el scroll de la lista de satélites — ver entrada v0.1.2 abajo.ción temporal activo), centrado en la parte superior para mejorar legibilidad y con opción en Sistema para mostrarlo/ocultarlo. En telemetría se añade una sección nueva "Orbita" con datos de propagación hacia delante y hacia atrás (en horas/días), junto a métricas orbitales adicionales; y todas las secciones pasan a ser plegables para ahorrar espacio. Se corrige la interacción de plegado para que las secciones realmente se abran/cierren de forma estable pese al refresco periódico de la telemetría, y se ajusta el CSS para que al estar colapsadas no se renderice la grilla de contenido. Se habilita propagación 0 para futuro/pasado (global y específica), tratándola como sin propagación efectiva; la telemetría muestra "-" en esos campos cuando vale 0 y se eliminan de Estado los indicadores redundantes de órbita futura/pasada en formato Sí/No. Se elimina además una reasignación innecesaria en el render de la estela pasada que podía provocar parpadeo visual al modificar su grosor, se evita recrear su material en cada update para estabilizar la línea durante cambios de ancho y se añade `depthFailMaterial` + umbral de actualización de grosor para reducir titileo cuando la órbita futura está desactivada. Para el caso de `Orbit Width Mode = physical`, se añade suavizado temporal del grosor de la estela pasada para minimizar jitter por variaciones continuas de distancia cámara-satélite y, cuando la órbita futura está apagada, se fija el ancho de la estela pasada al valor configurado para evitar oscilaciones físicas residuales. Como refuerzo final, la estela pasada se renderiza sin test de profundidad y con actualización geométrica estable (sin suavizado extra por frame), copiando posiciones por actualización y usando `arcType: NONE` para evitar jitter por mutaciones in-place y recalculados de arco. Se integra soporte de capa de teselas locales `earth2km_tiles` para mejorar calidad al hacer zoom sin cargar una textura gigante completa, manteniendo fallback automático a `earth8km` cuando las teselas no están generadas.

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

### v0.1.1
  - **Interfaz tipo VS Code**: toolbar superior, sidebar izquierda con pestañas de Satélites y Telemetría, buscador de satélites integrado en la toolbar.
  - **Dos paletas coherentes (clara/oscura)**: variables semánticas nuevas en `theme.css` y sustitución de colores oscuros hardcodeados en `config-panel.css` y `object-sidebar.css`, de modo que el modo claro deja de mostrar botones/zonas oscuras (diálogos, botones aplicar/reset, banner, menú de catálogo, modal TLE, chips, overlays).
  - **Toolbar superior simplificada**: eliminados los botones Futuro/Pasado (su función sigue en click derecho → visualización o en config global) y el botón de modo presentación que ocultaba la interfaz.
  - **Footprint de suelo corregido**: se sustituye la elipse por un polígono de círculo pequeño (small-circle) muestreado sobre la esfera, eliminando los artefactos triangulares y el desbordamiento cerca de los polos; altura de dibujo a 30 km para evitar el z-fighting con la textura terrestre.
  - **Color de órbita fiable**: el color de la estela pasada se refresca de inmediato al cambiarlo, sin esperar al siguiente mensaje del servidor.
  - **Lista de satélites**: barra de desplazamiento visible cuando hay muchos satélites y nueva fila final "+" (con aspecto de satélite) que abre el catálogo para añadir más.
  - **Telemetría en pestaña independiente** y rediseño estético del panel izquierdo (tarjetas de satélite, cabeceras unificadas, foco de búsqueda).

  - **Fix de simulación temporal aplicada al movimiento**: el muestreo orbital para modos no realtime se mantiene activo aunque la órbita visual esté oculta, evitando que el satélite siga moviéndose solo con el stream WS en tiempo real mientras la hora de la UI cambia.
### v0.1.2
- Fecha: 2026-07-02
- Commit: PENDIENTE
- Cambios: mejoras de búsqueda, simulación temporal y estabilidad visual:
  - **Búsqueda global profesional tipo VS Code** en la barra superior: desplegable incremental con sugerencias, navegación por teclado (↑/↓/Enter/Esc), y selección directa del objeto para activarlo/enfocarlo.
  - **Búsqueda por nombre y NORAD ID**: el backend de `/api/catalog/page` ahora filtra por ambos campos y expone `noradId` en la respuesta de catálogo paginado.
  - **Control temporal completo en UI** (dock inferior): modo Tiempo real, modo Rango y modo Histórico; rango inicio/fin editable, play/pause, rewind y velocidades x1/x10/x100/x1000.
  - **Timeline visual scrubable**: barra para navegar como vídeo por el rango temporal simulado.
  - **Modo histórico/replay por epoch TLE**: botón para centrar la simulación en la epoch del TLE del satélite seleccionado.
  - **HUD de delta epoch**: indicador en la barra superior con la diferencia entre epoch TLE y tiempo mostrado en simulación.
  - **Usabilidad del panel temporal corregida**: ahora se despliega/oculta desde botón propio en la toolbar (⏱), se recoloca automáticamente cuando se abre el panel izquierdo para evitar solape, y muestra únicamente los controles válidos según modo (realtime/range/historical).
  - **Hotfix de controles por modo**: en `Realtime` ya no se muestran `Start/End`, acciones de reproducción ni timeline; se añadieron salvaguardas JS+CSS para evitar que vuelvan a aparecer por reglas de estilo o DOM legado.
  - **Corrección de cinemática en simulación**: cuando el modo no es `Realtime`, la posición renderizada del satélite se calcula según la hora simulada del timeline (en lugar de seguir únicamente el stream realtime), alineando movimiento 3D con la hora mostrada en UI.
  - **Selección desde buscador más clara**: al seleccionar un satélite desde búsqueda global se abre automáticamente el panel izquierdo de satélites (si estaba plegado) y se limpia el texto del buscador para evitar filtrado residual de la lista activa.
  - **Modo Histórico retirado**: el control temporal queda simplificado a `Realtime` y `Range`, eliminando acciones y lógica del modo histórico para un flujo más directo.
  - **Órbita en modo Range enfocada al intervalo**: en simulación entre fechas se oculta la órbita pasada y la órbita visible se recorta al rango temporal seleccionado siempre que exista cobertura de muestras.
  - **Epoch reference ocultado en toolbar**: se elimina la línea secundaria de delta epoch en la barra superior para simplificar lectura durante simulación.
  - **Controles de reproducción centrados con iconos**: el dock temporal usa botones compactos `play/pause`, `stop` y `volver al inicio` (⏮) centrados visualmente en la barra.
  - **Fix de congelación a mitad de timeline**: en modo `Range`, el muestreo de posición 3D usa el ratio del propio intervalo seleccionado (start-end), evitando que el satélite llegue “al final” antes de que termine la barra temporal.
  - **Autoajuste de horizonte al aplicar rango**: al definir `Start/End`, la propagación futura se ajusta al tamaño del rango para mejorar cobertura orbital en ese intervalo.
  - **API de propagación ampliada**: nuevos endpoints REST en backend Python (`/propagate`, `/propagate/{sat_id}`, `/orbits`, `/orbits/{sat_id}`, `/aos-los`, `/ephemeris`) con soporte por `sat_id` o por TLE directo.
  - **Swagger disponible desde la app web**: se habilita acceso a documentación interactiva en `/docs` (proxy Node -> FastAPI) más `/openapi.json` y `/redoc`.
  - **Caché de efemérides pre-calculadas**: la API de `/ephemeris` y `/aos-los` reutiliza resultados en memoria con TTL y LRU para acelerar reproducciones repetidas del mismo rango temporal.
  - **Backend propagation API desacoplada de render**: `/ephemeris` acepta `line1/line2 + start_time/end_time + step_seconds` y devuelve serie temporal de posición/velocidad lista para consumo en frontend o herramientas externas.
  - **Modo offline en runtime**: al activar `data.offline_mode` se evita refresco remoto de catálogo y el visor cae a terreno elipsoidal local si no hay conectividad o se arranca explícitamente offline.
  - **Traza de suelo (ground track) sin z-fighting**: la línea se eleva 20 km sobre el elipsoide (`GROUND_TRACK_SURFACE_HEIGHT`) para dejar de solaparse/parpadear con la textura del mapa, igual que ya se hizo con el círculo/footprint.
  - **Duplicados en configuración eliminados**: "Ground Track Show" y "Selected Orbit Color" aparecían dos veces en la sección Orbital; se excluyen los campos ya renderizados para que salgan una sola vez.
  - **Lista de satélites con scroll real**: con muchos satélites (p. ej. 500) las filas ya no se encogen ni se apelotonan; se fija `flex: 0 0 auto` y una altura mínima por fila para que el panel muestre una barra de desplazamiento vertical.


## Cómo mantener este documento

Tras cada commit nuevo:
1. Incrementar la versión en +1 (por ejemplo, de v0.0.22 a v0.0.23).
2. Añadir una nueva sección con fecha, hash corto y resumen de cambios.
3. Actualizar el bloque Estado actual.

Mientras existan cambios sin commit:
1. Mantener actualizado el bloque "Próxima versión en preparación".
2. Resumir en "Cambios en curso" cualquier ajuste nuevo añadido durante la tarea.