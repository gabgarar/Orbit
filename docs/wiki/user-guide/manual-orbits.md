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
3. Elementos keplerianos o estado cartesiano inicial en `EME2000`.
4. Propagador físico: dos cuerpos o Cowell/RK4.
5. Términos de fuerza de Cowell cuando corresponda.

La previsualización se dibuja sobre la Tierra y no es todavía una capa del
proyecto. Al confirmar, se crea una órbita manual y vuelve a aparecer en
**Layers**.

## Marcos de la previsualización

La definición manual y su propagación física usan el marco inercial
`EME2000`. La vista ofrece dos formas explícitas de inspeccionar la misma
efeméride:

- **EME2000 — trayectoria inercial** muestra la trayectoria que genera el
  propagador.
- **ITRF — ruta terrestre** muestra esa efeméride después de transformarla al
  marco fijo a Tierra. Es la vista usada para la proyección 2D y para la traza
  sobre el globo.

Cambiar a ITRF no vuelve a propagar la órbita ni cambia las fuerzas: es una
transformación posterior del estado calculado en EME2000. La interfaz no usa
las etiquetas genéricas `ECI` o `ECEF`; el nombre visible siempre identifica
el marco que se está mostrando.

## SGP4 y TLE sintético

SGP4 no es un propagador seleccionable para una órbita manual. Está reservado
para un TLE de catálogo, cuyos estados nativos son `TEME`. Un estado o unos
elementos manuales en EME2000 no se convierten en un TLE con una simple
rotación de marcos.

En el futuro, Orbit podrá ofrecer **Exportar/Ajustar TLE sintético** como una
operación explícita: partirá de una efeméride manual de referencia, la llevará
a TEME y ajustará un modelo SGP4/TLE sobre un intervalo. El producto deberá
declarar el intervalo, las muestras, los residuos y la procedencia. No forma
parte de la propagación manual actual.

## Tablas AOS/LOS

Después de confirmar la capa, puede seleccionarla en
[Ground Stations](ground-stations.md) para calcular sus pases contra una
estación. La tabla usa la definición manual autorada —época, estado o
elementos, propagador y opciones de fuerza— y el intervalo UTC de diseño que
se guardó al propagarla. Para cambiar el intervalo hay que editar y propagar la
órbita de nuevo; así el perfil de elevación no consulta estados fuera de la
efeméride diseñada.

La dinámica se resuelve en `EME2000` y cada posición se transforma a `ITRF`
antes de la geometría WGS-84/ENU de la estación. La respuesta de pases declara
`ITRF` y UTC, pero no crea una entrada de catálogo ni convierte la capa en un
TLE: su nombre manual se utiliza únicamente para etiquetar el resultado.

## Límites importantes

- Todas las órbitas manuales actuales están centradas en `EARTH`.
- La entrada y la dinámica manuales se mantienen en `EME2000`; una vista o
  efeméride terrestre se obtiene después en `ITRF`. SGP4 genera `TEME` sólo
  para fuentes TLE de catálogo. Consulte
  [Propagadores](../propagation/overview.md).
- El modo de diseño cambia temporalmente a un rango de simulación y pausa la
  reproducción; sus controles temporales propios evitan confundir el diseño
  con el reloj habitual del espacio de trabajo.
- Ocultar Layers en este modo es una decisión de interfaz, no una eliminación
  de datos ni una desactivación permanente de las capas.
