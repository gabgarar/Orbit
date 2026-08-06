# Vista 3D y cámara

[Inicio](../index.md) · [Guía de usuario](index.md) · [Visualización](visualization.md) · [Espacio de trabajo](workspace.md) · [Línea temporal](timeline.md)

El visor orbital está construido sobre Cesium. Representa las capas activas en
la época seleccionada por el control temporal y ofrece proyecciones y modos de
navegación explícitos.

## Proyecciones

El menú de cámara permite seleccionar las proyecciones siguientes:

| Opción | Uso |
| --- | --- |
| Vista 3D | Vista tridimensional del globo y las capas orbitales. |
| Vista 2D | Proyección bidimensional de Cesium. |
| Columbus | Vista oblicua de Cesium. |
| Restablecer vista | Recupera la vista definida por el runtime. |

Las transiciones entre proyecciones son animadas por Cesium. Cambiar de
proyección altera la navegación y la apariencia de la escena, no el marco,
escala temporal ni datos de las capas.

### Órbitas en vista 2D

En **Vista 2D**, Orbit no dibuja la trayectoria espacial elevada. La opción
**Mostrar futuro** se representa como la trayectoria reproyectada sobre la
Tierra a partir de las muestras ITRF/ECEF de la efeméride. Por tanto, la línea
del mapa conserva el movimiento relativo a la Tierra y no es una elipse ECI
aplanada por el visor.

**Ground Track** controla en 2D el círculo de visibilidad geométrica del
satélite. Con el control activado, Orbit dibuja el horizonte de elevación cero
en torno al punto subsatelital; con el control desactivado, la trayectoria
reproyectada puede seguir visible, pero no se muestra ese círculo. La huella
no representa una máscara de estación, un enlace de radio ni la cobertura de
un sensor.

En Vista 3D y Columbus, **Mostrar futuro** recupera la trayectoria espacial;
Ground Track conserva su función de mostrar u ocultar la traza de suelo y la
huella. Esta misma regla se aplica al editor de órbitas manuales: aunque se
inspeccione el diseño en ECI, la proyección 2D usa las muestras ITRF
propagadas.

## Navegación

| Modo | Comportamiento |
| --- | --- |
| Cámara centrada | Conserva el modelo de navegación centrado en el cuerpo de referencia. |
| Cámara libre | Habilita la navegación libre del visor. |

La selección de un cuerpo puede activar una cámara centrada en su posición
translacional. Esta cámara mantiene la interacción local sin inferir una
orientación física adicional del cuerpo.

## Selección y seguimiento

El clic sobre una entidad del visor puede seleccionarla y sincronizar sus
controles con el panel lateral. La selección es una interacción de interfaz:
no implica que el objeto quede determinado, filtrado ni seguido por una
estación de tierra.

Use la [Línea temporal](timeline.md) para fijar la época antes de interpretar
la posición seleccionada. En tiempo real, un objeto puede cambiar mientras se
consulta si la reproducción continúa activa.

## Grabación local

El botón de grabación de la barra lateral inicia o detiene una captura de la
sesión del canvas en el navegador. La configuración ofrece calidad y formato
de salida solicitados.

!!! warning "Límites de grabación"

    La grabación depende de MediaRecorder y de los códecs que el navegador
    expone. Orbit no incorpora renderizado de vídeo en servidor, cola de
    codificación ni almacenamiento remoto. Verifique el archivo generado en
    el navegador destino antes de usarlo en un flujo operativo.

## Prácticas recomendadas

1. Ajuste la proyección antes de capturar o comparar una escena.
2. Congele la época en Static o pause Real time para una inspección visual.
3. No utilice la cámara o la grabación como mecanismo de exportación de datos;
   use [Exportar](export.md) para elementos y efemérides.
4. Mantenga habilitada la visualización sólo de las capas relevantes para
   reducir ruido y coste gráfico.
