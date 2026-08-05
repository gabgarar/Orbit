# Guía de usuario

[Inicio](../index.md) · [Inicio rápido](../getting-started/quick-start.md)

La guía de usuario describe el espacio de trabajo local de Orbit. Cada página
se limita a las interacciones implementadas en el runtime actual y declara los
límites que afectan a la conservación de datos y a la interpretación técnica.

## Mapa de uso

| Área | Propósito |
| --- | --- |
| [Proyectos](projects.md) | Crear, abrir, guardar y descargar documentos de proyecto locales. |
| [Espacio de trabajo](workspace.md) | Identificar paneles, selección y acciones del entorno de trabajo. |
| [Capas](layers.md) | Organizar capas y carpetas, y controlar su visibilidad. |
| [Órbitas manuales](manual-orbits.md) | Diseñar, previsualizar y confirmar una órbita geocéntrica. |
| [Visualización](visualization.md) | Configurar el aspecto de objetos, órbitas, mapa y escena. |
| [Vista 3D](three-d-view.md) | Cambiar proyección, navegación, cámara y grabación local. |
| [Línea temporal](timeline.md) | Trabajar en modo estático, tiempo real o simulación de rango. |
| [Estaciones de tierra](ground-stations.md) | Configurar estaciones y consultar visibilidad muestreada. |
| [Importar](import.md) | Incorporar datos TLE, OMM y OEM dentro de los límites disponibles. |
| [Exportar](export.md) | Descargar proyectos, elementos y efemérides. |

## Principios de uso

- El espacio de trabajo y los proyectos son locales al navegador y al archivo
  que el operador guarda. No existe sincronización remota ni colaboración.
- Una capa visual no sustituye a su contrato orbital: TLE/SGP4, OEM y órbitas
  manuales tienen orígenes y límites distintos.
- Las etiquetas genéricas ECI y ECEF no identifican un marco suficiente para
  resultados de precisión. La configuración de tiempo y marcos se administra
  fuera de la interfaz en [Operación de tiempo y EOP](../operations/time-eop.md).
- Las acciones disponibles dependen del tipo de elemento. El menú contextual
  de un proyecto, carpeta, capa o estación muestra sólo operaciones aplicables.

!!! warning "Alcance no disponible"

    Orbit no incorpora usuarios, roles, colaboración, almacenamiento remoto,
    determinación de órbita, ingestión de medidas ni un sistema de plugins
    instalables. No utilice la persistencia local como sustituto de un sistema
    de control documental de misión.

Use el [inicio rápido](../getting-started/quick-start.md) para iniciar una
sesión nueva.
