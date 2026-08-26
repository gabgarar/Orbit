# Capas y carpetas

[Inicio](../index.md) · [Guía de usuario](index.md) · [Espacio de trabajo](workspace.md) · [Proyectos](projects.md) · [Visualización](visualization.md)

Las capas representan los objetos visuales activos del espacio de trabajo. El
árbol admite carpetas anidadas y guarda únicamente estructura de presentación:
una carpeta no modifica el propagador ni los datos de origen de una capa.

## Operaciones disponibles

| Elemento | Operaciones de organización | Operaciones visuales |
| --- | --- | --- |
| Proyecto raíz | Nuevo, abrir, guardar y exportar proyecto mediante menú o control de proyecto | Expandir o contraer el árbol. |
| Carpeta | Crear carpeta hija, renombrar, mover, contraer o eliminar mediante acciones aplicables | Mostrar u ocultar las capas que representa. |
| Capa | Mover entre carpetas, renombrar cuando la capa lo permite y eliminar | Seleccionar, mostrar u ocultar; el menú añade acciones propias de su tipo. |
| Cuerpos | Sol y Luna son capas opcionales; Tierra es persistente | Mostrar u ocultar. |

El árbol mantiene carpetas vacías fuera de un filtro de búsqueda para que puedan
usarse como estructura o destinos de arrastre. Durante una búsqueda se muestran
las carpetas coincidentes, sus ancestros y los padres de capas coincidentes.

## Eliminación de carpetas

Eliminar una carpeta **no elimina su contenido operativo**. Sus capas directas
y carpetas hijas se devuelven a la raíz del proyecto; las ramas más profundas
se conservan bajo la carpeta hija reubicada. Esta regla evita que una acción
organizativa borre objetos del espacio de trabajo.

!!! warning "Eliminar una capa"

    Eliminar una capa sí la retira del espacio de trabajo actual. Si su
    definición procede de un archivo local u OEM, conserve la fuente antes de
    eliminarla. El árbol no sustituye una copia de seguridad del proyecto.

## Visibilidad

La visibilidad controla la representación en el visor. Ocultar una capa no
cambia sus datos de catálogo, el estado de una estación ni los parámetros de
una órbita manual. Los controles globales de mostrar u ocultar se habilitan
cuando existen capas de usuario activas; la Tierra no cuenta como capa de
misión para esa condición.

## Menú contextual de una órbita

Un clic derecho sobre una órbita, ya sea en el globo o en el árbol de
**Layers**, abre la misma jerarquía de acciones. Las opciones se agrupan para
que una operación visual no se confunda con una acción sobre los datos:

| Grupo | Acciones | Efecto |
| --- | --- | --- |
| **Vista** | Centrar vista, mostrar u ocultar capa, mostrar u ocultar *Ground track*, opciones de visualización | Cambia solo la cámara o la representación de la capa. Ocultar no elimina sus datos ni altera el rango temporal. |
| **Efemérides** | Propagación, explicar parámetros orbitales | Abre la inspección propagada de la capa o una explicación de sus elementos, marco y procedencia. |
| **Exportar** | Exportar… | Conserva el diálogo de exportación compatible con la fuente de la capa. |
| **Eliminar capa** | Eliminar capa | Retira la capa del espacio de trabajo actual. |

Las entradas de **Vista** y **Efemérides** son submenús: se abren hacia el lado
que tenga espacio en pantalla y se pueden recorrer con teclado. Una acción
recibida desde el globo conserva el identificador de la capa pulsada; nunca se
aplica a la última capa que hubiera abierto un menú en el árbol.

## Búsqueda y contadores

La búsqueda del panel admite opciones de coincidencia como mayúsculas,
palabra completa y expresión regular. Los contadores de carpeta incluyen las
capas ubicadas en todos sus descendientes. Esta convención permite conocer el
alcance de una rama incluso si está contraída.

## Relación con el proyecto

La estructura de carpetas, los nombres de presentación y las relaciones
padre-hijo se incluyen en una exportación de [Proyecto](projects.md). Los
objetos se mantienen por su identificador y origen; moverlos de carpeta no
duplica el objeto ni crea una nueva propagación.
