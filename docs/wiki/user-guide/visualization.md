# Visualización

[Inicio](../index.md) · [Guía de usuario](index.md) · [Vista 3D](three-d-view.md) · [Capas](layers.md) · [Configuración](../operations/configuration.md)

La visualización de Orbit se configura desde el panel de configuración y se
aplica al visor Cesium y a las capas activas. Estos ajustes determinan la
presentación; no cambian la fuente orbital ni convierten el marco de referencia
de los datos.

## Opciones de escena

| Grupo | Ajustes disponibles |
| --- | --- |
| Órbitas | Horizonte de propagación visual, línea futura, track de suelo, ancho y colores. |
| Satélites | Tamaño de etiquetas, escala de modelo, uso de modelo 3D, modo de tamaño y umbral de alerta de perigeo. |
| Renderizado | Antialiasing, color de fondo, atmósfera, iluminación del globo, estrellas y mapa base. |
| Grabación | Calidad y formato de salida solicitados por la grabación local. |
| Interfaz y logs | Idioma, tema, nivel de registro y reloj superior. |

Los mapas base disponibles son Natural Earth local, Earth 2 km local cuando
se han generado sus teselas, OpenStreetMap y World Imagery de Esri. Los dos
últimos dependen del servicio de mapas remoto correspondiente.

## Objetos y trazas

La visualización puede mostrar objetos de catálogo propagados con SGP4, órbitas
manuales, estaciones de tierra y cuerpos celestes. El origen sigue siendo
parte del contrato: un TLE se propaga de forma nativa en TEME, mientras que una
órbita manual analítica o Cowell usa su propio modelo. Una apariencia similar
en pantalla no hace equivalentes esos resultados.

Las capas de Sol y Luna son opcionales. La Tierra permanece como cuerpo de
referencia y las opciones de iluminación, atmósfera o mapa base se aplican a
la escena, no al documento científico de una órbita.

## Calidad de renderizado

Orbit admite modos de antialiasing off, FXAA y MSAA. Cuando se selecciona
antialiasing, el runtime conserva una escala de resolución completa para
preservar líneas finas; sin antialiasing puede aplicar una reducción adaptativa
de resolución en viewports pequeños.

!!! warning "Uso analítico"

    El visor es una herramienta de inspección. No use el grosor de una traza,
    el color, la proyección o la densidad del mapa de calor como evidencia de
    precisión orbital, disponibilidad de enlace o incertidumbre estadística.

## Mapas locales Earth 2 km

Las teselas locales pueden generarse desde la carpeta server:

~~~powershell
npm run tiles:earth2km
~~~

El proceso crea una pirámide bajo front/assets/earth2km_tiles/. Si no existe
la tesela inicial, Orbit conserva su mapa local base. La generación incrementa
uso de disco y tiempo de preparación.

La navegación y proyecciones se describen en [Vista 3D](three-d-view.md); el
guardado de estos ajustes se explica en [Configuración](../operations/configuration.md).

