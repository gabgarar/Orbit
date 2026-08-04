# Espacio de trabajo y visualización

## Visión general

El espacio de trabajo gestiona proyectos, capas, cuerpos, cámara y línea temporal. Presenta resultados orbitales sin redefinir su marco o dinámica fuente.

## Proyectos y capas

El proyecto es la carpeta raíz. Las carpetas organizan objetos, conservan su contador de cuerpos y ofrecen acciones de visibilidad, borrado y menú contextual. La sección de cuerpos queda separada al final del árbol; Earth y Moon son cuerpos de visualización, no capas orbitales importadas.

## Tiempo

| Modo | Comportamiento |
| --- | --- |
| Estático | Mantiene la época seleccionada. |
| Tiempo real | Sigue UTC actual. |
| Simulado | Avanza, pausa, busca y escala una época elegida. |

La barra de simulación solo aparece en modo simulado. Las etiquetas de interfaz no cambian la escala fuente almacenada en el estado.

## Vista 3D

Cesium renderiza Tierra, cuerpos, capas, trazas y cámara. La grabación es una función de interfaz, no una exportación de efemérides ni un producto científico.

## Límites

- WebGL es obligatorio para el visor 3D.
- El visor puede usar EOP visual etiquetado; análisis/exportación estrictos requieren datos fijados.
- No hay proyecto compartido ni colaboración en tiempo real.

## Siguientes destinos

<div class="grid cards" markdown>

- :material-satellite-variant: **Preparar datos orbitales**

  Importación, formatos y análisis del servicio Python.

  [Ir al servicio orbital →](orbit-service.md)

- :material-api: **Automatizar el flujo**

  Integración HTTP y snapshots WebSocket.

  [Ir a la API →](api.md)

</div>
