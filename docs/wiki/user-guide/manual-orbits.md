# Órbitas manuales

[Inicio](../index.md) · [Guía de usuario](index.md) · [Propagación](../propagation/index.md) · [Espacio de trabajo](workspace.md)

## Visión general

El botón **Crear órbita manual** abre un modo de diseño aislado para definir y
previsualizar una órbita geocéntrica. La Tierra es el cuerpo central fijo del
flujo actual: no existe un selector de cuerpo ni se puede diseñar todavía una
órbita manual alrededor de la Luna, el Sol u otro objeto.

## Escena de diseño

Al entrar, Orbit conserva el estado visual de las capas existentes y las oculta
temporalmente. El panel y el botón de **Layers** también desaparecen para que
el formulario y la vista 3D no compitan con el árbol del proyecto. La Tierra
se muestra siempre como referencia visual del diseño, aunque estuviera oculta
antes de abrir el editor.

La pestaña **Overview** identifica explícitamente el cuerpo central como
**Earth / WGS-84**. Al abrir el editor, la cámara vuelve a la vista Home de
la Tierra; al cancelar, también se recupera la vista anterior del espacio de
trabajo.

Al cancelar o confirmar la órbita, Orbit restaura exactamente la visibilidad
que tenían las capas y la Tierra antes de entrar. El diseño no borra capas ni
modifica el proyecto hasta que se confirma la creación.

## Qué se define

1. Nombre y metadatos de la órbita.
2. Intervalo UTC para la previsualización.
3. Elementos keplerianos o estado cartesiano inicial.
4. Propagador: dos cuerpos, SGP4 sintético o Cowell/RK4.
5. Términos de fuerza de Cowell cuando corresponda.

La previsualización se dibuja sobre la Tierra y no es todavía una capa del
proyecto. Al confirmar, se crea una órbita manual y vuelve a aparecer en
**Layers**.

## Límites importantes

- Todas las órbitas manuales actuales están centradas en `EARTH`.
- Dos cuerpos y Cowell generan estados nativos en `EME2000`; SGP4 genera
  `TEME`. Consulte [Propagadores](../propagation/overview.md).
- El modo de diseño cambia temporalmente a un rango de simulación y pausa la
  reproducción; sus controles temporales propios evitan confundir el diseño
  con el reloj habitual del espacio de trabajo.
- Ocultar Layers en este modo es una decisión de interfaz, no una eliminación
  de datos ni una desactivación permanente de las capas.
