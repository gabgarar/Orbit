# Inicio rápido

[Inicio](../index.md) · [Instalación](installation.md) · [Requisitos](requirements.md)

Este procedimiento crea un proyecto local, incorpora un objeto de catálogo y
prepara una sesión visual. No configura productos EOP de precisión ni publica
datos fuera del equipo local.

## Secuencia operativa

~~~mermaid
flowchart LR
    A[Iniciar Orbit] --> B[Crear proyecto]
    B --> C[Buscar o importar catálogo]
    C --> D[Activar una capa]
    D --> E[Inspeccionar en 3D]
    E --> F[Guardar o exportar proyecto]
~~~

1. Inicie Orbit siguiendo [Instalación](installation.md) y abra la URL local.
2. En la bienvenida del proyecto, seleccione **Nuevo proyecto** y asigne un
   nombre. El proyecto comienza vacío y la Tierra queda como cuerpo de
   referencia permanente.
3. Abra el catálogo, busque un objeto e incorpórelo al espacio de trabajo. La
   fuente estándar del catálogo es TLE, que se propaga con SGP4.
4. Utilice el árbol de capas para mostrar, ocultar, organizar o seleccionar el
   objeto. Consulte [Capas](../user-guide/layers.md).
5. Ajuste la cámara y las opciones visuales desde el espacio de trabajo. La
   vista y sus límites se documentan en [Vista 3D](../user-guide/three-d-view.md).
6. Guarde el documento del proyecto o descargue una copia JSON desde las
   acciones de proyecto.

## Elegir el modo temporal

El selector temporal ofrece tres modos:

| Modo | Comportamiento |
| --- | --- |
| Static | Mantiene fija la época de trabajo. |
| Real time | Sigue el reloj de pared mientras está en reproducción; puede pausarse. |
| Simulated | Usa un rango definido por inicio, fin, velocidad y cursor de la línea temporal. |

La barra de simulación completa sólo se muestra en **Simulated**. En tiempo
real pausado se conserva la última época muestreada. El uso de la barra,
velocidades y restricciones de OEM se describe en
[Línea temporal](../user-guide/timeline.md).

## Guardar el resultado

El documento de proyecto es un JSON con formato orbit-project, versión 1.
Guarda el nombre, las capas de catálogo activas, las órbitas manuales
autorizadas, cuerpos celestes, carpetas, estaciones de tierra y estado
temporal. Consulte [Proyectos](../user-guide/projects.md).

!!! warning "Trayectorias OEM locales"

    Las muestras OEM cargadas localmente no se restauran de forma fiable al
    reabrir un proyecto. Conserve el OEM original junto al JSON del proyecto y
    vuelva a cargarlo cuando sea necesario.

## Próximas operaciones

- [Espacio de trabajo](../user-guide/workspace.md) para paneles, selección y
  acciones de proyecto.
- [Importar datos](../user-guide/import.md) para TLE, OMM y las limitaciones
  de OEM.
- [Exportar datos](../user-guide/export.md) para documentos, elementos y
  efemérides.
- [Estaciones de tierra](../user-guide/ground-stations.md) para crear una
  estación y revisar visibilidad muestreada.

