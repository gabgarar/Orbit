# Espacio de trabajo

[Inicio](../index.md) · [Guía de usuario](index.md) · [Proyectos](projects.md) · [Capas](layers.md) · [Vista 3D](three-d-view.md)

El espacio de trabajo reúne el visor Cesium, la barra lateral de capas, los
paneles de objeto y los controles temporales. El árbol de proyecto es la
referencia de organización de la sesión; no es un catálogo de misión ni una
base de datos remota.

## Componentes

| Zona | Responsabilidad |
| --- | --- |
| Barra lateral vertical | Acceso a paneles de capas, cámara y grabación de la sesión. |
| Panel de Layers | Proyecto, carpetas, capas, cuerpos y sus acciones contextuales. |
| Área central | Visor orbital 3D, selección y representación de capas activas. |
| Paneles de objeto | Información, parámetros propagados y acciones específicas del elemento seleccionado. |
| Pie del panel de Layers | Fecha y hora UTC visibles y selector de modo temporal. |
| Barra de simulación | Controles de reproducción y línea temporal, sólo para un rango simulado. |

## Trabajo con el árbol

El proyecto actúa como carpeta raíz. Las carpetas pueden contener otras
carpetas y capas; los cuerpos aparecen en una sección propia al final del
panel. El contador de cada carpeta incluye sus capas descendientes, mientras
que el contador de cuerpos pertenece a su propia sección.

Un clic selecciona la capa o el elemento correspondiente. Un clic derecho abre
el menú contextual del tipo de elemento. Las acciones de visibilidad y borrado
se aplican al elemento elegido; las operaciones masivas del panel se reservan
para las capas de usuario activas.

!!! note "Tierra"

    La Tierra es el cuerpo de referencia persistente del espacio de trabajo.
    Puede ocultarse desde el control de visibilidad, pero la operación de
    borrado genérica no la elimina.

## Flujo de trabajo recomendado

1. Cree o abra un [proyecto](projects.md).
2. Incorpore objetos mediante el catálogo, una órbita manual o una importación
   compatible.
3. Agrupe las capas en carpetas y confirme su visibilidad.
4. Seleccione un objeto para consultar los controles aplicables.
5. Elija el modo temporal antes de comparar posiciones o pases.
6. Guarde o exporte el proyecto.

## Paneles y estado

Cerrar el panel de capas no elimina su contenido. El runtime conserva el árbol
y puede volver a abrirse desde la barra lateral. El estado de la sesión se
guarda en el documento del proyecto sólo cuando se ejecuta una acción de
guardar o exportar.

No existe un modo de edición concurrente, bloqueo de capas ni historial
compartido de cambios. Para auditar cambios, conserve versiones exportadas del
JSON de proyecto fuera de Orbit.

