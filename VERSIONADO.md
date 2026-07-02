# Versionado

## 2026-07-02f

- **Lista de satélites con scroll visible y fila "+" para añadir:**
  - El listado de capas activas (`#objectList`) en el panel de satélites ahora muestra una **barra de desplazamiento visible** (estilizada con las variables de scrollbar del tema) cuando hay muchos satélites, en lugar de recortarse. Se añadió `padding-right` para que la barra no solape las filas.
  - Se añadió una **última fila con aspecto de satélite pero con un "+"** (`renderList` en `objectSidebar.js`) que, al pulsarla, abre el catálogo para añadir satélites (misma acción que el botón "+" del header). Estilo con borde discontinuo y color de acento en `object-sidebar.css`.

## 2026-07-02e

- **Dos paletas de UI coherentes (clara/oscura), toolbar superior simplificada y footprint de suelo corregido:**
  - **Paletas de tema completas:** se añadieron variables semánticas a `theme.css` para ambos temas (`--orbit-bg-success-soft(-hover)`, `--orbit-bg-danger-soft(-hover)`, `--orbit-text-danger-soft`, `--orbit-bg-accent-soft`, `--orbit-scrollbar-thumb(-end)`). Se reemplazaron los colores hardcodeados oscuros que rompían el **modo claro** por estas variables en:
    - `config-panel.css`: botón de confirmar diálogo, aplicar visualización, aplicar global, reset, banner de validación, estado de guardado, pestaña activa, scrollbar y overlays de modales.
    - `object-sidebar.css`: menú contextual del catálogo, modal de info TLE completo (`.tle-info-*`), chips de filtro, estado "añadido", aviso de TLE antiguo, gradiente sticky de acciones, overlays de modales y hover de botones de eliminar.
  - **Toolbar superior:** se eliminaron los botones **Futuro** y **Pasado** (su función ya está disponible con click derecho sobre el satélite → opciones de visualización, o en la configuración global) y el botón de **modo presentación** (🖥) de la esquina superior derecha, que ocultaba toda la interfaz.
  - **Footprint de suelo (Ground):** se reemplazó la elipse gigante (`ellipse` con semieje geodésico enorme) por un **polígono de círculo pequeño (small-circle)** muestreado sobre la esfera (`computeFootprintCirclePositions` + `PolygonHierarchy`, `arcType: GEODESIC`). Esto elimina los artefactos triangulares y el desbordamiento de la huella cerca de los polos. Además se subió la altura de dibujo de la huella (`FOOTPRINT_SURFACE_HEIGHT` a 30 km) para evitar el z-fighting/colapso con la textura de la Tierra.
  - **Color de órbita fiable:** al cambiar el color pasado (estela) ahora se refresca de inmediato el material de la estela en `setSatelliteVisualizationConfig` y `setOrbitConfig`, sin esperar al siguiente mensaje del servidor.

## 2026-07-02d

- **Restauración de estilos del menú contextual y del modal de información/explicación TLE:**
  - Se recuperaron de `object-sidebar.css` los estilos `.catalog-context-action` (botones del menú de click derecho) y toda la familia `.tle-info-*` (`.tle-info-panel`, `.tle-info-header`, `.tle-info-content`, `.tle-info-section`, `.tle-info-grid`, `.tle-info-title`, `.tle-info-empty`, `.tle-info-paragraph`, `.tle-info-link`). Se habían perdido en la edición de z-index, por lo que el menú de click derecho salía sin estilo ("feo") y el modal de "explicar parámetros orbitales" se confundía con el fondo por falta de panel/contraste.

## 2026-07-02c

- **Corrección de modales rotos (filtros, menú contextual, info TLE) y órbitas que no se mostraban:**
  - Se restauraron las reglas base de posición/visualización de `#catalogFilterModal`, `#catalogLoadingModal`, `#tleInfoModal` y `#catalogContextMenu` en `object-sidebar.css`. Durante una edición previa de z-index estas reglas se habían sustituido por solo el `z-index`, dejando los modales sin `position`/`display`, por lo que el botón **Filtros** y el **menú contextual** (click derecho → cambiar parámetros / ver info TLE) no aparecían. Se conservan los z-index elevados (10130/10150) para que queden por encima de las toolbars.
  - Se reactivaron las órbitas en `config/system_config.json` (`future_show` y `past_show` a `true`); la configuración persistida las había dejado en `false`, por lo que no se dibujaba ninguna órbita.

## 2026-07-02b

- **Buscador de satélites en la toolbar superior (estilo VS Code) y header de satélites simplificado:**
  - El buscador de objetos se movió a la **toolbar superior**, centrado con icono de lupa (`.toolbar-search`), y se eliminó del panel de satélites.
  - `objectSidebar.js` ya no renderiza el input de búsqueda ni el header de acciones compacto en modo contenedor; ahora resuelve `#objectSearch` y los botones de acción con fallback a `document.getElementById`, de modo que pueden vivir en la toolbar y en el header del panel.
  - **Header del panel de satélites unificado en una sola fila:** título "SATÉLITES" a la izquierda y a la derecha los botones ✕ (quitar todas las capas), 👁 (ocultar/mostrar todas), + (añadir desde catálogo) y ‹ (plegar el panel).
  - Nuevos estilos: `.toolbar-search-wrap`/`.toolbar-search`/`.toolbar-search-icon` en la toolbar y `.sidebar-panel-actions` para los botones del header del panel.

## 2026-07-02

- **Pestaña de telemetría independiente y mejora visual del panel izquierdo:**
  - La telemetría en tiempo real ahora se muestra en una **pestaña separada** (#leftInfoPanel, "TELEMETRÍA"), ya no comparte panel con la lista de selecciones de satélites (#leftSatellitesPanel, "SATÉLITES").
  - `setupObjectSidebar()` acepta un nuevo parámetro opcional `infoContainerElement`:
    - Cuando se proporciona, el bloque `#objectInfo` se omite del cuerpo del panel de satélites y se renderiza como `.object-info-standalone` dentro del contenedor de telemetría.
    - `renderInfo()` escribe en el `infoRoot` resuelto desde `infoContainerElement`.
  - La sidebar izquierda gestiona ambos paneles con comportamiento acordeón (solo uno abierto a la vez); el icono ℹ ("Telemetría") abre el panel de telemetría.
  - **Mejoras estéticas del panel izquierdo:**
    - Filas de la lista de satélites rediseñadas: tarjetas con borde redondeado (6px), estados `hover` y `active` con color de acento, botones de acción con opacidad progresiva al pasar el cursor.
    - Botón "+" de añadir resaltado con el color de acento.
    - Campo de búsqueda con esquinas redondeadas, placeholder atenuado y borde de foco.
    - Headers de panel unificados (`.sidebar-panel`): fondo secundario, título en mayúsculas con mayor tracking, botón de cierre con hover.
    - Sombra del panel más marcada para separarlo del visor.
    - Selectores CSS generalizados a la clase `.sidebar-panel` para aplicar el mismo estilo a ambas pestañas.

## 2026-07-01

- **Nueva interfaz de usuario tipo VS Code:**
  - Se implementó una toolbar horizontal superior (#topToolbar) que contiene:
    - **Marca "ORBIT"** a la izquierda
    - **Botón de Configuración** (⚙ Config) - abre el panel de configuración del sistema
    - **Botón de Modo de Cámara** (🎥 Camera) - alterna entre modo centrado y libre
    - **Separador vertical**
    - **Botones de órbitas**: Futuro, Pasado, Ground - controlan la visibilidad de las órbitas
    - **Separador vertical**
    - **Botón de Grabación** (● Grabar) - inicia/detiene la grabación de sesión
    - **Espaciador flexible**
    - **Información de fecha y hora** en tiempo real (se actualiza cada segundo)
    - **Separador vertical**
    - **Botón de Modo Presentación** (🖥) - oculta todos los controles para presentaciones
    - Diseño similar a la barra de menú de Visual Studio Code
  - Se implementó una sidebar vertical izquierda (#leftSidebar) desplegable con iconos para:
    - 🛰 **Panel de satélites** - abre el panel integrado con la lista de objetos en simulación
    - ℹ Panel de información (próximamente)
    - 👁 Panel de vista (próximamente)
    - ⚙ Configuración del sistema (en la parte inferior)
  - **Panel de satélites integrado en la sidebar izquierda:**
    - El menú de objetos de simulación (objectSidebar) ahora está completamente integrado en la sidebar izquierda
    - Se muestra como un panel desplegable (#leftSatellitesPanel) de 300px de ancho que sale desde la izquierda
    - Animación suave de apertura/cierre con transform translateX y transición de 0.2s
    - Versión compacta del objectSidebar renderizada directamente en #leftSatellitesPanelContent
    - Mantiene toda la funcionalidad: búsqueda, lista de satélites, telemetría, catálogo, filtros
    - Header simplificado sin título (ya que el panel tiene su propio header "SATÉLITES")
    - Botones de acción: ✕ (quitar todas las capas), 👁 (ocultar/mostrar todas), + (añadir desde catálogo)
    - El antiguo #objectSidebar flotante se oculta automáticamente con `display: none` cuando las toolbars están activas
  - setupObjectSidebar() modificado para soportar renderizado en contenedor:
    - Nuevo parámetro opcional `containerElement` en la firma de la función
    - Si se proporciona containerElement, renderiza la versión compacta dentro de ese elemento
    - Si no se proporciona, crea el aside legacy #objectSidebar (retrocompatibilidad)
    - Funciones openSidebar/closeSidebar/toggleSidebar solo operan en modo legacy
  - El visor Cesium (#cesiumContainer) ahora se ajusta automáticamente dejando espacio para:
    - 40px de altura para la toolbar superior
    - 48px de ancho para la sidebar izquierda
  - **Se eliminaron todos los botones flotantes antiguos** cuando las nuevas toolbars están activas:
    - ❌ #configToggleBtn (botón flotante de configuración superior izquierdo) - **ahora solo en la toolbar superior**
    - ❌ #cameraModeToggleBtn (botón flotante de modo de cámara)
    - ❌ #sessionRecordBtn (botón flotante de grabación)
    - ❌ #timeHudWidget (widget de reloj flotante)
    - ❌ #quickToolbar (toolbar de abajo a la derecha)
    - ❌ #objectSidebar (panel flotante de objetos) - **ahora integrado en la sidebar izquierda**
  - Todas las funciones de cambio de estado ahora actualizan la nueva topToolbar:
    - Cambios en visibilidad de órbitas (futuro, pasado, ground)
    - Inicio/detención de grabación de sesión
    - Cambio de modo de cámara (libre/centrado)
    - Activación/desactivación de modo presentación
- **Corrección del bug de inicialización del botón de configuración:**
  - Se movió la llamada a `ensureTopToolbar()` y `ensureLeftSidebar()` para que se ejecuten DESPUÉS de `setupRuntimeConfigPanel()`
  - Esto asegura que `runtimeConfigPanelApi` esté definido antes de que los event handlers de la toolbar intenten usarlo
  - El botón de configuración ahora funciona correctamente al primer clic
- Se arregló la persistencia del idioma usando localStorage para mantener la preferencia entre sesiones (similar al tema).
- Se rediseñó el panel de satélites (objectSidebar) con un estilo totalmente plano similar a Visual Studio Code:
  - Eliminación de bordes redondeados (border-radius: 0)
  - Reducción de sombras para un aspecto más minimalista
  - Botones de acción más pequeños y sin bordes circulares
  - Título del panel con texto en mayúsculas y mayor espaciado de letras
  - Bordes y separadores más sutiles
- Se mejoró el botón de plegar/desplegar del panel izquierdo con un icono de chevron más claro (◂) que rota 90° al abrir.

## 2026-06-28

- Se implemento la vista 2D de ground track para satelites con capa activa usando la orbita futura proyectada sobre la superficie.
- Se anadio footprint dinamico en 2D (elipse de cobertura aproximada por horizonte geometrico) para cada satelite visible.
- Al cambiar entre modos 3D/2D, los overlays se refrescan automaticamente para mostrarse/ocultarse sin esperar un nuevo payload de orbitas.
- Se ajusto la visualizacion en 2D para ocultar la orbita en altura, dejar solo la traza de suelo y remarcar el footprint sobre el mapa.
- Se anadio una toolbar plegable abajo a la derecha con acciones rapidas: mostrar/ocultar orbitas futuras y pasadas por satelite seleccionado o globalmente, modo presentacion, cambio 2D/3D, tema y grabacion.
- El boton de grabacion se movio a la toolbar y ahora usa icono de punto rojo para iniciar y pausa para detener.
- Se anadio configuracion `system.ui` con `language` (es/en) y `theme` (dark/light), editable desde Configuracion > Sistema.
- Se marcaron como implementados el modo presentacion, tema oscuro/claro y soporte multiidioma basico.
- El control rapido 2D/3D se sustituyo por un toggle de `Ground`, que muestra/oculta ground track y footprint como capa independiente visible tanto en 2D como sobre la esfera 3D.
- Los botones de la toolbar ahora reflejan estado: verde cuando la capa/accion esta activa y rojo cuando esta desactivada, tanto en modo global como sobre satelite seleccionado.
- Se anadio `orbit.ground_track_show` a la configuracion global y como override por satelite.

## 2026-06-27

- Se hizo configurable el limite maximo de capas activas con `system.satellites.max_visible` en la configuracion runtime.
- El panel de configuracion ahora permite editar ese maximo y la seleccion masiva del catalogo muestra un error cuando se alcanza el limite.
- El backend Python ya no registra SIGHUP a traves de `asyncio.add_signal_handler`, evitando el warning deprecado en Python 3.16.
- El servidor Node ahora reutiliza un backend Python ya activo en el puerto 8765 y detiene el que arranca al cerrar, evitando conflictos de puerto al reiniciar.