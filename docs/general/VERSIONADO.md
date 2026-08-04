# Versionado

## 2026-07-06a

- **Fix visibilidad heat map (puntos + color bar)**
  - Los puntos del heat map se elevan por encima del círculo de cobertura para evitar que queden ocultos visualmente.
  - Se incrementa contraste/opacidad y tamaño de punto (especialmente en densidad alta).
  - Se fuerza `disableDepthTestDistance` en puntos de heat map para mejorar visibilidad sobre el globo.
  - La leyenda (`color bar`) pasa a mostrarse cuando existe al menos una estación con heat map activado.
  - Al crear estación, si el heat map ya está activado, se fuerza refresco inmediato de la capa.

## 2026-07-05m

- **Heat map: cobertura completa del círculo y mejora de densidad**
  - El muestreo del heat map se recorta ahora exactamente al radio de cobertura de estación (todo el círculo, sin margen extra externo).
  - Se ajusta el escalado de densidad para que `Alta` sea claramente más densa que `Media` y `Baja`.
  - Se incrementa la frecuencia de refresco del heat map para que la acumulación de puntos sea más visible en tiempo real.

- **Leyenda de color (color bar)**
  - La leyenda del heat map se muestra siempre que exista al menos una estación visible con heat map activado.

- **Círculo de cobertura independiente del heat map**
  - Nuevo parámetro `coverage_visible` en estación.
  - Permite ocultar el círculo de cobertura manteniendo el heat map activo.

- **Menú contextual de estación simplificado**
  - Para capas de estación, se deja solo la acción principal `Update parameters`.
  - Se ocultan opciones no deseadas en ese contexto.

- **Editor de estación por pestañas**
  - El modal `Update parameters` de estación pasa a usar pestañas para agrupar funcionalidades:
    - `General`
    - `Radio`
    - `Visual`
    - `Heat map`

## 2026-07-05l

- **Opciones de visualización: densidad de puntos en heat map**
  - Se añade selector `Densidad heat map` en editor/opciones de visualización de estación (`Baja`, `Media`, `Alta`).
  - La densidad seleccionada afecta directamente al muestreo del heat map (paso espacial dinámico) para mostrar menos o más puntos.
  - `Opciones de visualización` queda disponible también para capas de estación, abriendo su editor directamente.

- **Persistencia de parámetro**
  - Nuevo parámetro de estación `heatmap_density` en creación, edición y lectura de configuración de estación.

## 2026-07-05k

- **Heat map de estación: UX y densidad mejoradas**
  - El heat map deja de activarse por defecto al crear estaciones nuevas.
  - Nueva acción en menú contextual de estación (`click derecho`):
    - `Mostrar heat map` cuando está apagado.
    - `Ocultar heat map` cuando está encendido.
  - La malla de muestreo aumenta densidad de puntos (paso espacial más fino y radio dinámico por cobertura) para mejorar definición visual.
  - Se añade barra de color/leyenda de cobertura en pantalla, visible solo cuando hay heat map activo.

- **Sincronización de visualización**
  - Al editar parámetros de estación o cambiar visibilidad, el heat map y su leyenda se actualizan en tiempo real.

## 2026-07-05j

- **Fix crítico: conversión TEME → ECEF en propagador**
  - El propagador SGP4 devuelve posiciones en marco TEME (cuasi-inercial), pero Cesium trabaja en ECEF (fijo con la Tierra).
  - Sin esta conversión, todas las órbitas aparecen apiladas en el mismo plano longitudinal porque la rotación terrestre no se aplicaba.
  - Se añade la rotación GMST (Greenwich Mean Sidereal Time) en cada punto orbital: `R_z(GMST) × r_TEME`.
  - También se aplica la corrección de Coriolis al vector velocidad: `v_ECEF = R_z(GMST) × v_TEME − ω_tierra × r_ECEF`.
  - Validado: dos órbitas consecutivas de Sentinel-2 (~100 min) quedan separadas ~24.3° en longitud, conforme a la rotación real de la Tierra (~25°).

## 2026-07-05i

- **Fix backend para simulación range > 240h**
  - Detectado límite duro en backend (`PROPAGATION_HOURS_MAX = 240`) que truncaba órbitas al simular rangos largos (p. ej. 14 días = 336h).
  - Se amplía el máximo de propagación en backend a 1 año de referencia para evitar cortes silenciosos en modo `range`.
  - Con esto, el rango temporal elegido en UI puede propagarse completo también del lado servidor.

## 2026-07-05h

- **Fix range vs propagation_hours (simulación temporal)**
  - Corregido conflicto donde modo `range` podía seguir comportándose con el horizonte de propagación previo (ej. `25h`) en lugar del intervalo `[inicio, fin]` elegido por el usuario.
  - En render de órbita, cuando el modo activo es `range`, ya no se recorta por `propagation_hours` local de capa.
  - Al aplicar un nuevo rango, se sincroniza también `orbit.propagation_hours` en configuración persistida para alinear backend y frontend en el horizonte temporal.

## 2026-07-05g

- **Alertas condicionales en visor**
  - El centro de alertas vuelve a comportamiento flotante en esquina inferior derecha.
  - Ahora solo se muestra cuando existe al menos una alerta activa.
  - Al limpiar todas las alertas, el bloque se oculta automáticamente.

- **Simulación en range sin recorte silencioso**
  - Se elimina el recorte duro de horas al aplicar fechas de inicio/fin en modo range.
  - Si el intervalo temporal es grande, se muestra confirmación previa para evitar sobrecarga.
  - Si se pulsa cancelar, no se aplica el nuevo rango y se restauran las fechas anteriores.

- **Propagación orbital: tope ampliado en frontend**
  - Se retira el límite fijo de 240 h en lógica de propagación de cliente.
  - El panel de configuración también deja de imponer ese máximo en la entrada.

## 2026-07-05f

- **Alertas UI reubicadas**
  - Se elimina el bloque flotante de alertas en la esquina inferior derecha.
  - El centro de alertas se integra dentro del panel de Layers para no invadir el visor.

- **Simulación por rango largo**
  - Se elimina la limitación efectiva corta de horas aplicada al modo `range`.
  - Ahora el rango temporal admite ventanas largas (hasta 1 año de referencia para configuración orbital en UI) sin cortar a pocos días.

- **Estación remota + capas duplicadas**
  - La telemetría de estación ahora contabiliza capas satelitales duplicadas como instancias independientes.
  - Caso resuelto: si existen dos capas del mismo satélite (`ISS`, `ISS (2)`), al pasar por estación remota el conteo refleja `2`.

## 2026-07-05e

- **Estaciones terrestres: mejora visual y edición avanzada**
  - El círculo de cobertura de estación se eleva sobre el terreno para evitar conflicto visual con texturas/base map.
  - Nuevo `click derecho > Update parameters` en capas de estación, con ventana **movible**.
  - Edición de parámetros operativos y visuales de estación: lat/lon/alt, máscara, RF, radio de cobertura, tamaño de símbolo, forma y color.

- **AOS/LOS rediseñado**
  - La tabla de pases se muestra en tarjetas más legibles (AOS/LOS/MAX elevación) con formato temporal más claro.

- **Tooltips contextuales en telemetría/info**
  - Hover en campos de información de satélites y estaciones para mostrar descripción rápida del dato.

- **Heat map de cobertura acumulada (MVP)**
  - Se añade mapa de calor acumulado en 3D para estaciones (muestreo temporal y color por ratio de cobertura).
  - Integrado con visibilidad y estado de la estación.

- **Centro de alertas persistente**
  - Sustitución de toasts efímeros por centro de alertas desplegable, acumulable y gestionable manualmente.
  - Cierre individual o limpieza global de avisos/errores.

- **Decay configurable en runtime config**
  - Nuevo campo de configuración para `decay_alert_perigee_km`, persistido y enviado al backend para filtros/alertas de decay.

## 2026-07-05d

- **Alta de capas con desplegable en `+` (sin salto directo a catálogo):**
  - Nuevo menú de acción para elegir entre **Añadir satélite** o **Añadir estación de tierra**.
  - Opción de satélite mantiene el flujo existente de catálogo.

- **Gestor de estaciones terrestres (MVP funcional):**
  - Nuevo modal de creación de estación con parámetros: nombre, lat/lon/alt, máscara de elevación y parámetros RF básicos.
  - Alta y baja de estaciones como capas dentro del panel de Layers.
  - Render de estación en globo + huella de cobertura visual (footprint/FOV aproximado en superficie).
  - Telemetría específica de estación (no satelital): visibilidad en tiempo real, mejor elevación/rango y estimación de enlace.
  - Integración con backend `/api/aos-los` para construir tabla de pases AOS/LOS básica por estación.

- **Capas renombrables por clic derecho:**
  - Nueva acción `Renombrar capa` en menú contextual para cualquier layer activo.

- **Duplicados de capas satelitales:**
  - Si una capa ya existe y se vuelve a añadir desde catálogo, se ofrece popup para **duplicar**.
  - Las copias se añaden como capas independientes de UI con sufijo por defecto (`ISS (2)`, `ISS (3)`, ...), permitiendo además renombrado libre.

- **Arquitectura de layers compuesta:**
  - El sidebar opera ahora con capas compuestas (satélites base, duplicados y estaciones terrestres) manteniendo compatibilidad con el núcleo orbital existente.

## 2026-07-05a

- **Diagnóstico y fix: "no se pudo descargar ningún TLE válido"**
  - Causa raíz: CelesTrak bloquea IPs de GitHub Codespaces y entornos cloud (HTTP:000, timeout puro).
  - Se añade pre-check de conectividad rápido (8s) antes de lanzar todas las descargas.
  - Si CelesTrak no es alcanzable, se devuelve error inmediato accionable en lugar de esperar 30+ timeouts.
  - El frontend detecta `networkBlocked` y muestra instrucciones claras: importar TLE/OMM manualmente.

## 2026-07-02ae

- **Fix CelesTrak: “No se pudo descargar ningun TLE valido”**
  - Se incrementa timeout remoto de descarga para evitar abortos prematuros en redes lentas.
  - Se limita concurrencia de descargas (grupos/fuentes) para reducir bloqueos y respuestas de rate-limit del proveedor.
  - Si no se obtiene catálogo válido, el error incluye contexto del primer fallo remoto para diagnóstico más claro.

## 2026-07-02ad

- **Fix crítico telemetría (panel vacío):**
  - Se corrige una referencia runtime a función inexistente en el cálculo orbital desde telemetría (`inferMissionCategory`), reemplazada por la función válida (`inferMissionInfo`).
  - Esto evitaba que `renderInfo` se actualizara correctamente en casos OEM/TLE y dejaba la telemetría en estado de error.

## 2026-07-02ac

- **Fix adicional modal de visualización en dominio OEM:**
  - Se fuerza ocultación por `hidden` y por `style.display` de campos no válidos (pasado/propagación), y además se deshabilitan inputs para evitar incoherencias.
  - Se endurece la detección de dominio OEM usando tanto tracks OEM como bounds e indicador de dominio.

- **Fix estabilidad panel de telemetría:**
  - `renderInfo` se protege con `try/catch` para evitar que una excepción puntual deje el panel en blanco.

- **Fix robustez refresh catálogo ante 504:**
  - Descarga de grupos/fuentes en paralelo y timeouts remotos activos.
  - Discovery de grupos queda opcional en refresh manual (`discover=true`) para reducir latencia por defecto.

## 2026-07-02ab

- **Fix update catalog (HTTP 504 / bloqueo):**
  - Se añade timeout de red en descargas remotas de CelesTrak para evitar requests colgadas.
  - Descarga de grupos y fuentes en paralelo durante refresh para reducir duración total.
  - La discovery automática de grupos pasa a ser opcional (`discover=true`) en refresco manual para evitar latencias excesivas por defecto.

- **Fix opciones de visualización en dominio OEM:**
  - Endurecida la detección de dominio OEM (estado de tracks + indicador visual del dock).
  - Los campos no válidos (pasado/propagación) se ocultan y además se deshabilitan de forma forzada, incluyendo fallback por `closest(.config-field)`.
  - La lógica de `Apply` usa el mismo criterio de dominio OEM para evitar incoherencias visuales/funcionales.

## 2026-07-02aa

- **Telemetría orbital más consistente (LEO/GEO/MEO/HEO):**
  - Se mejora la clasificación de tipo de órbita con fallback dinámico por altitud de telemetría cuando no hay resumen TLE fiable (o en OEM).

- **Modo OEM: limpieza de información/controles no relevantes para TLE/OMM:**
  - En telemetría, cuando el dominio temporal OEM está activo, se ocultan filas de propagación futura/pasada que no aportan en ese contexto y se muestra estado de dominio OEM.
  - En `click derecho > opciones de visualización`, si el dominio OEM está activo (o el objeto es OEM), se ocultan/desactivan opciones de pasado y propagación no aplicables.
  - Al salir del dominio OEM, los controles vuelven a mostrarse con normalidad.

- **Sincronización de catálogo ampliada (TLE + OMM + OEM):**
  - La actualización desde CelesTrak incluye siempre fuentes por defecto OMM/OEM además de las configuradas por usuario.
  - Se deduplican fuentes por `formato+url` para evitar descargas redundantes.

## 2026-07-02z

- **Indicador fijo de dominio temporal en panel de simulación:**
  - Se añade una etiqueta visible en el dock temporal mostrando el dominio activo (`General` u `OEM`).
  - Cuando hay OEM cargado, el indicador se resalta visualmente para dejar claro que la simulación está en dominio OEM.

## 2026-07-02y

- **Mezcla OEM + TLE/OMM con alineación automática de dominio temporal:**
  - Al importar ficheros TLE/OMM mientras exista dominio OEM activo, la simulación se alinea automáticamente al rango temporal OEM.
  - Al importar OEM (ephemeris nativa) con TLE/OMM activos, se informa que la propagación no OEM pasa al dominio temporal OEM.
  - Mientras haya OEM cargado, el rango efectivo de simulación se fuerza al dominio temporal OEM para evitar desalineaciones.

- **Warnings de incompatibilidad temporal orbital:**
  - Se añade comprobación de compatibilidad temporal de TLE/OMM frente al rango OEM activo (usando epoch y ventana recomendada por tipo orbital).
  - Si hay incompatibilidades o no se puede validar epoch, se avisa explícitamente al usuario.

## 2026-07-02x

- **OEM fuera de ventana temporal: ocultación estricta**
  - Se fuerza que un OEM fuera de su ventana propia no se represente (ni satélite ni overlays de órbita/ground track/footprint).
  - La visibilidad global ahora también respeta el estado "fuera de tiempo" para evitar reapariciones por refrescos de render.

- **Simulación temporal sin botón Apply**
  - Al editar `Inicio` y `Fin` en modo rango, el cambio se aplica automáticamente en cuanto el par de fechas es válido.
  - Se elimina la dependencia de pulsar `Apply`.

- **Opciones de visualización contextual para OEM**
  - En `click derecho > opciones de visualización`, los OEM ya no muestran controles innecesarios de pasado ni propagación por horas.

- **Explain orbital parameters y telemetría por formato real**
  - La explicación orbital deja de asumir TLE en todos los casos y diferencia OEM/OMM/TLE.
  - Para OEM se prioriza información del propio fichero importado (ventana temporal, frame, time system, muestras, etc.).
  - La telemetría ahora incluye `source_format`, `source_origin` y bloque OEM específico, preparada para futuras operaciones OEM.

## 2026-07-02w

- **OEM fuera de ventana temporal ahora se oculta claramente:**
  - Si en simulación `range` un OEM está fuera de su ventana propia de tiempo, se oculta completamente para evitar que parezca activo sin datos.
  - Al reingresar en su ventana temporal, recupera su visualización normal automáticamente.
- **Apertura automática del panel temporal al importar OEM:**
  - Al cargar un OEM, además de pasar a modo `range` y ajustar el rango global, se abre directamente el panel de simulación temporal.

## 2026-07-02v

- **Estado visual fuera de tiempo para OEM en simulación range:**
  - Cuando un satélite OEM está fuera de su ventana temporal (`start/end` propio), se mantiene visible en **gris claro** para indicar que no hay datos en ese instante.
  - Mientras está fuera de tiempo, se ocultan su órbita/traza/ground-track/footprint para evitar interpretación incorrecta.
  - Al volver a entrar en su ventana temporal, recupera automáticamente su estilo visual normal.

## 2026-07-02u

- **Fix OEM múltiple en simulación range (ventana temporal por satélite):**
  - Cada OEM importado usa ahora su propio `start/end` para muestrear posición durante la simulación.
  - Un OEM no avanza antes de su hora de inicio, aunque el rango global ya haya comenzado por otro OEM.
  - Se mantiene el rango global como `min(start)` y `max(end)` entre todos los OEM cargados.

## 2026-07-02t

- **OEM ephemeris: nombres limpios, política temporal y simplificación de filtros:**
  - Se elimina el sufijo visual `[OEM]` en el nombre importado; para duplicados se usa formato limpio `Nombre (2)`, `Nombre (3)`, etc.
  - Con OEM ephemeris cargados, se bloquea el cambio a modo **Tiempo real** y se muestra aviso explícito.
  - Al importar OEM ephemeris, la simulación pasa a modo **Rango** automáticamente.
  - El rango temporal se ajusta con los límites globales de todos los OEM cargados (`min(start)` y `max(end)`).
  - Al quitar una capa OEM ephemeris, se descarga también su track temporal del estado runtime.
  - Se elimina de la UI el selector de filtro por origen `custom/catalog` (se mantiene filtro por formato).

## 2026-07-02s

- **Soporte OEM ephemeris puro como órbita temporal nativa (sin TLE embebido):**
  - Si un `.oem` no contiene `TLE_LINE1/TLE_LINE2`, el frontend ya no falla: lo importa como trayectoria temporal nativa (track OEM) en Cesium.
  - Se parsean muestras de estado del OEM (`time x y z`) y se crea una capa activa custom con `sourceFormat=OEM` y `sourceOrigin=CUSTOM`.
  - La órbita se muestra directamente en la vista como polilínea temporal, seleccionable desde el panel de satélites.
  - Se mantiene el flujo anterior para OEM con TLE embebido (importación a catálogo normal por backend).

## 2026-07-02r

- **Importación: warning por NORAD existente con otro nombre + error OEM ephemeris sin TLE embebido:**
  - Al importar, si una entrada trae un NORAD que ya existe bajo otro nombre en catálogo, se devuelve y muestra un aviso explícito de conflicto (se mantiene el nombre ya presente en catálogo).
  - Si se intenta importar un OEM sin `TLE_LINE1/TLE_LINE2` (OEM ephemeris puro), se devuelve error explícito indicando que ese caso aún no se importa como órbita nativa.

## 2026-07-02q

- **UX drag&drop: resaltado visual de zona de suelta global:**
  - Se añade overlay visual de alto contraste al arrastrar ficheros sobre la aplicación (mensaje “Soltar para importar”).
  - El overlay se muestra/oculta de forma estable usando contador de profundidad de drag para evitar parpadeos.
  - Se evita doble importación cuando se suelta dentro del modal de catálogo (el drop global cede paso al drop local).

## 2026-07-02p

- **Fix importación por arrastre global + autoalta en vista de satélites:**
  - El drag&drop global de archivos ahora captura correctamente eventos (`dragenter/dragover/drop` en captura) y evita silencios de importación.
  - Si el arrastre no contiene archivos o falla la importación, se muestra mensaje de error explícito.
  - La API de import devuelve `importedNames` para identificar satélites realmente importados.
  - Al arrastrar un fichero directamente sobre la pantalla, además de guardarse en catálogo, los satélites importados se añaden automáticamente a la vista (respetando límite de capas activas) y se muestra resumen de añadidos/omitidos.

## 2026-07-02o

- **Catálogo: importación por arrastre global + origen custom/catalog + limpieza visual de filas:**
  - Se habilita importar fichero de catálogo arrastrando y soltando en cualquier parte de la pantalla (no solo dentro del modal), con intento de carga directa y apertura del catálogo tras importación.
  - Se elimina la duplicidad visual de la etiqueta **TLE** en cada fila del catálogo: el botón lateral pasa a **Info** para no repetir el formato.
  - Nuevo concepto de origen de entrada en catálogo (`sourceOrigin`):
    - `CUSTOM` para objetos importados manualmente.
    - `CATALOG` para objetos provenientes de refresco remoto/fuentes de catálogo.
  - Nuevo filtro en UI/API por origen (**Todos / Catalogo / Custom**), combinado con el filtro de formato (TLE/OMM/OEM).
  - Al actualizar catálogo remoto, las entradas `CUSTOM` se preservan y no se eliminan.

## 2026-07-02n

- **Fix edición de fechas en simulación por rango:**
  - Se evita que el refresco periódico del panel temporal (cada 120 ms) sobrescriba los campos `Inicio` y `Fin` mientras el usuario los está editando.
  - Los campos vuelven a sincronizarse automáticamente con el estado interno al pulsar **Aplicar**.
  - Resultado: ya se puede seleccionar días futuros (por ejemplo, del 02 al 07) sin que el input vuelva al valor anterior.

## 2026-07-02m

- **Fix simulación por rango (órbita completa entre fechas):**
  - Se corrige el mapeo temporal de la órbita en modo `range` para usar como referencia el inicio real del rango y su duración total.
  - Resultado: la órbita mostrada en simulación cubre correctamente todo el tramo entre `inicio` y `fin`, evitando recortes parciales cuando el rango incluye pasado/futuro respecto al instante actual.

## 2026-07-02l

- **Exportación condicionada por origen + metadatos en efemérides:**
  - El modal de exportación ahora respeta el formato de origen del catálogo:
    - **TLE**: solo permite exportar TLE.
    - **OMM**: solo permite exportar OMM (JSON/XML).
    - **OEM**: solo permite exportar OEM.
  - Se añade indicador visual del **source** en el modal de exportación.
  - Backend Node valida también estas reglas para evitar exportaciones cruzadas por URL directa.
  - Nuevo endpoint `GET /api/export/oem/:satId` para exportación de origen OEM.
  - En exportación de efemérides por rango (`/export/ephemeris`), las salidas JSON/CSV/OEM incluyen ahora:
    - `source_format` (TLE/OMM/OEM)
    - `propagator` (actualmente SGP4)

## 2026-07-02k

- **Filtro por formato y exportaciones orbitales desde menú contextual:**
  - Nuevo filtro de catálogo por formato de origen (**Todos / TLE / OMM / OEM**), integrado en paginado, selección masiva y chips de resumen.
  - Menú contextual con opción **Exportar...** que abre un modal de exportación con dos bloques:
    - Exportar **TLE**, **OMM (JSON)**, **OMM (XML)** y **OCM** del satélite activo.
    - Exportar **efemérides entre fechas** (inicio, fin, intervalo, formato CSV/JSON/OEM y propagador SGP4).
  - Nuevos endpoints de export en backend Node/FastAPI para descarga directa de ficheros (`/api/export/tle/:satId`, `/api/export/omm/:satId`, `/api/export/ocm/:satId`, `/api/export/ephemeris/:satId`).
  - FastAPI añade rutas de exportación equivalentes en `/export/*` con generación de contenido en texto/JSON/XML/OEM.

## 2026-07-02j

- **Limpieza documental de presets retirados:**
  - Se elimina en `CHANGELOG.md` la mención residual a la API de presets de configuración, para dejar la documentación alineada con la retirada funcional ya aplicada en backend/UI.

## 2026-07-02i

- **Retirada completa de presets:**
  - Se eliminan del backend los endpoints de presets de catálogo y de presets de configuración del sistema.
  - Se eliminan utilidades y rutas asociadas para evitar código muerto.
  - Se borra `config/system_config_presets.json`.
  - Se elimina `data.catalog_preset` de `config/system_config.json`.

## 2026-07-02h

- **Ajustes de UX de catálogo y configuración por feedback de uso:**
  - Se elimina la opción **Presets** del modal de catálogo.
  - Se eliminan los filtros de **Operador** y **Propietario** del modal de filtros de catálogo.
  - El filtro **Solo decay** mantiene la funcionalidad pero ahora muestra el checkbox a la derecha de su etiqueta para una lectura más natural.
  - El botón **Actualizar catálogo** amplía la ingesta para incluir también fuentes remotas en formato **OMM/OEM** (además de TLE), con resumen de resultados por fuentes y advertencias unificadas.
  - En el panel de configuración se eliminan los iconos "i" de ayuda y la descripción de cada parámetro pasa a mostrarse como tooltip al pasar el ratón por encima del propio label.

## 2026-07-02g

- **Catálogo avanzado con formatos, importación local y filtros de operador/propietario:**
  - En el modal de catálogo se añaden acciones de **Presets** e **Importar**, con soporte de importación de fichero local por selector y por **drag & drop** hacia el modal.
  - Se integran presets desde backend (`/api/catalog/presets` y `/api/catalog/use-preset`) para cambiar de catálogo predefinido sin salir del panel.
  - Se añaden filtros de **operador**, **propietario** y **solo decay** (perigeo bajo), conectados al paginado remoto del catálogo.
  - Las filas del catálogo y la lista activa de satélites muestran una etiqueta pequeña con el formato de origen (**TLE / OMM / OEM**).
  - Se añaden estilos específicos para la insignia de formato (`.catalog-format-badge`) manteniendo la paleta del tema.

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