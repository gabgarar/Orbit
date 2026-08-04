# Proyectos

[Inicio](../index.md) · [Guía de usuario](index.md) · [Espacio de trabajo](workspace.md) · [Importar](import.md) · [Exportar](export.md)

Un proyecto de Orbit es un documento JSON local. Representa la composición del
espacio de trabajo, no un catálogo remoto ni una sesión multiusuario.

## Ciclo de vida

~~~mermaid
flowchart LR
    N[Nuevo proyecto] --> W[Espacio de trabajo]
    O[Abrir JSON Orbit] --> W
    W --> S[Guardar en el archivo elegido]
    W --> E[Descargar copia JSON]
    E --> A[Archivo de proyecto]
~~~

Las acciones del proyecto se encuentran en el control de proyecto y en su menú
contextual:

| Acción | Resultado |
| --- | --- |
| Nuevo proyecto | Limpia las capas de usuario y crea un documento vacío con nombre. |
| Importar proyecto | Abre un archivo JSON de proyecto Orbit. Si existe otro proyecto abierto, solicita confirmación antes de reemplazarlo. |
| Guardar proyecto | Escribe en el archivo elegido cuando el navegador proporciona acceso de escritura. |
| Exportar proyecto | Descarga una copia JSON independiente del archivo abierto. |

Cuando el navegador no admite el selector de archivos moderno, Orbit utiliza
un selector de archivo de lectura y permite descargar la exportación. La
capacidad de sobrescribir directamente un archivo depende de la API de archivo
del navegador.

## Contrato del documento

La versión actual del documento declara format orbit-project y version 1.
Conserva datos serializables, no objetos vivos de Cesium ni suscripciones de
red.

| Campo | Contenido conservado |
| --- | --- |
| name | Nombre visible del proyecto. |
| satellites | Identificadores de capas de catálogo activas. |
| manualOrbits | Definiciones de órbitas manuales para regenerarlas al abrir. |
| celestialBodies | Capas optativas de Sol y Luna, incluida su visibilidad. |
| layerNames y layerTree | Nombres de presentación, carpetas y pertenencia de capas. |
| groundStations | Parámetros de estaciones de tierra. |
| simulation | Modo, rango, época actual, reproducción y velocidad. |

## Restauración

Al abrir un documento, Orbit restaura primero el nombre, las capas de catálogo
y el estado temporal; después restaura cuerpos, órbitas manuales, estaciones y
árbol de capas. Una órbita manual que resulte inválida o cuyo propagador no
esté disponible no impide abrir el resto del documento: la aplicación informa
de la restauración incompleta.

!!! warning "Datos no restaurables"

    Una trayectoria OEM tabulada cargada localmente no se conserva de forma
    fiable dentro del proyecto. Archive el OEM fuente junto al JSON y vuelva a
    importarlo cuando reabra el trabajo.

## Buenas prácticas

1. Exporte una copia antes de sustituir un proyecto abierto.
2. Mantenga juntos el JSON, los OEM locales y los archivos de entrada que
   justifican las capas del catálogo.
3. Use nombres de carpeta y capa estables antes de compartir el archivo con
   otro operador.
4. Verifique el modo y la época temporal guardados antes de comparar una vista
   reproducida con una sesión anterior.

La estructura visual del documento se gestiona en [Capas](layers.md); el
contenido de los formatos se incorpora mediante [Importar](import.md).

