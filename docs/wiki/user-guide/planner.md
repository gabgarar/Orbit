# Planificador de eventos

[Inicio](../index.md) · [Guía de usuario](index.md) · [Línea temporal](timeline.md) · [Proyectos](projects.md)

El planificador reúne hechos temporales de la escena y, cuando prepara una
previsión de pases, usa el cálculo de acceso de estación ya definido para cada
pareja elegible. No modifica la órbita, no reserva una antena y no sustituye la
validación de los productos de entrada. Es la base de las futuras vistas de
agenda.

## Ventana de trabajo

En escritorio, la agenda es una ventana flotante de la sesión: se puede
arrastrar desde su cabecera y redimensionar por cualquiera de sus cuatro
bordes o esquinas. Orbit limita siempre su geometría al área visible. Al cerrar
la agenda descarta ese tamaño y posición; la próxima apertura vuelve al
rectángulo de trabajo predeterminado. Esta geometría no se exporta ni modifica
el proyecto.

En una pantalla compacta la agenda ocupa toda la ventana y no se puede
arrastrar ni redimensionar. Al estrechar una agenda de escritorio, sus zonas
internas se reorganizan según el ancho real de la agenda, no solo según el
ancho de la pantalla, para evitar barras horizontales accesorias.

La cabecera conserva únicamente la navegación temporal y las acciones de la
agenda. El estado de una operación se muestra en el panel global de actividad
o, si afecta a una fecha concreta, como un evento o un rango de la agenda; no
ocupa una franja fija sobre el calendario. Las confirmaciones de acciones son
avisos flotantes de unos segundos y los errores persistentes siguen siendo
alertas dentro de la ventana.

## Vistas, intervalo UTC y modos temporales

La agenda está disponible en los modos **Simulated**, **Real time** y
**Static**. Presenta los mismos eventos en vistas de **día**, **semana** y
**mes**, siempre en UTC. El selector «Ir a mes y año (UTC)» sitúa el cursor en
el mes elegido conservando el día cuando existe; los controles anterior y
siguiente avanzan el período activo. La vista publica un intervalo semiabierto
UTC `[inicio, fin)`: 24 horas para día, lunes--domingo para semana y el mes
completo para mes. Si todavía no se ha elegido un intervalo, Orbit usa una
semana UTC anclada al instante que muestra la escena. Al abrir una simulación
histórica, el cursor se ancla primero a ese dominio simulado (no al día real
actual), para no solicitar una ventana inválida antes de recibir el estado de
la escena.

El paginador del detalle recorre todos los eventos ya publicados y visibles para
la agenda, no solo los del mes, semana o día actual. Si el evento siguiente
está fuera de la vista, el cursor salta a su período sin cerrar el planificador.
Los pases se calculan bajo demanda para el intervalo que se está consultando;
no se inventan ni se precalculan pases de una ventana temporal ilimitada.

Ese intervalo visible es el dominio solicitado del pronóstico de pases; no es
una fecha de caducidad ni altera por sí mismo la escena. En **Simulated**, si
una vista de mes, semana o día solo se solapa parcialmente con el rango
simulado/MTR, Orbit calcula exclusivamente la intersección exacta publicada
por ambos límites. Si no existe solape, no envía una solicitud inválida: la
agenda vuelve al inicio del dominio temporal activo. Nunca amplía un SP3 ni
rellena fechas fuera de su cobertura para completar una cuadrícula.

| Modo | Comportamiento de la agenda y de los pases |
| --- | --- |
| **Simulated** | Calcula AOS, máximo y LOS para la intersección segura entre el intervalo UTC visible, el rango simulado y, cuando existe, el Rango Temporal Maestro (MTR). Una vista sin solape se rebasa al dominio activo y no genera una solicitud fuera de cobertura. |
| **Real time** | Calcula el intervalo UTC finito elegido como una instantánea de agenda. No lo desplaza ni lo recalcula con cada *tick* de tiempo real. Abrir o navegar la agenda no mueve la escena. |
| **Static** | Calcula el intervalo UTC finito elegido sin cambiar el instante estático de la escena. Abrir o navegar la agenda no mueve la escena. |

Al activar un evento, Orbit solo puede situar la simulación cuando el contrato
temporal del modo lo permite y el instante es válido; ante cualquier límite, la
escena permanece intacta y el estado comunica el motivo.

## Eventos publicados

| Tipo | Color/capa | Origen y significado |
| --- | --- | --- |
| `pass-maximum` | Verde, encima de la línea temporal | Máxima elevación de un pase. Solo existe si el análisis devolvió `max_elevation_time`; nunca se fabrica a partir del punto medio. |
| `pass-aos` | Morado, debajo de la línea temporal | Inicio refinado de acceso de una pareja estación--satélite. |
| `pass-los` | Morado, debajo de la línea temporal | Fin refinado del mismo acceso. |
| `erp-validity-end`, `sp3-validity-end`, `oem-validity-end`, `layer-validity-end` | Evento de disponibilidad | Fin de cobertura explícitamente verificado para el recurso correspondiente. No significa caducidad editorial. |
| `iers-c01-coverage`, `finals2000a-coverage`, `erp-linear-extrapolation` | Rango de la capa **IERS ERP Time** | Intervalo verificable resuelto respectivamente con C01, `finals2000A.all` o extrapolación lineal local (máximo 30 días). Los solapes se resuelven con prioridad C01 → Finals → extrapolación, de modo que no se emiten varios «fines de cobertura» por cambios internos de calidad. C01 se presenta en verde; Finals `final`/`rapid` en amarillo; y `predicted` en rojo. |
| `erp-nominal-fallback` | Punto abierto de la capa **IERS ERP Time** | Inicio de rotación terrestre nominal (sin ERP) después del límite lineal o cuando no existen dos muestras compatibles. Tiene calidad `approximate`; no es IERS, ERP ni una caducidad. Es un punto porque la fuente no publica un final honesto para ese estado. |
| `product-erp-coverage` | Rango cian de **ERP asociado a SP3** | Cobertura UTC verificable de un fichero ERP adjunto al producto SP3. No es IERS ni una fecha deducida del nombre de fichero. |
| `*-expiry` | Evento de caducidad | Solo aparece si la fuente declara una fecha de expiración válida de forma explícita. Orbit no deduce una caducidad a partir de la cobertura. |
| `layer-imported` | Cian, asociado a la capa | Importación local registrada de una capa. Solo aparece si el servicio guardó el instante y el nombre del fichero; no se deduce de una actualización genérica del catálogo. |
| `tle-epoch` | Azul, asociado a la capa | Época escrita en un TLE/OMM con TLE. Es una propiedad del elemento y no una fecha de vencimiento ni una garantía de precisión. |
| `manual` | Color elegido por la persona usuaria | Bloque temporal escrito por la persona usuaria; no es un pase ni una reserva confirmada. |

### Cómo leer **IERS ERP Time**

El semáforo de esta capa expresa la procedencia y el nivel de atención
operativo; no es una cifra universal de error ni una certificación de misión.
Los detalles del evento conservan la fuente, la calidad y el intervalo exacto.

| Color en la agenda | Qué significa | Decisión del operador |
| --- | --- | --- |
| Verde — **IERS C01 / normal** | El producto combinado/final C01 cubre la época. Es la fuente automática preferida de Orbit mientras exista esa cobertura. | Ruta habitual. Compruebe el rango si la operación se extiende hacia su límite. |
| Amarillo — **OK: Finals `final` o `rapid`** | C01 no cubre esa época y Orbit usa `finals2000A.all`. `final` contiene una tupla Bulletin B completa (LOD sigue siendo Bulletin A u opcional); `rapid` contiene determinaciones operativas Bulletin A con banderas `I`. Ambos son datos publicados utilizables, pero el amarillo **no** afirma que tengan una precisión idéntica a C01 en todos los parámetros o usos. | Puede continuar bajo el contrato de la operación, pero revise la etiqueta concreta y la cobertura para trabajo sensible. |
| Rojo — **Bulletin A `predicted`** | Algún parámetro lleva bandera `P`: es una predicción oficial de Bulletin A, no una observación. | Planifique con precaución, confirme el intervalo y actualice/recalcule cuando haya datos observados o finales. No lo trate como ERP adjunto a un producto. |

Después de Finals, una banda roja distinta puede indicar extrapolación lineal
local: tampoco es una predicción IERS. El detalle siempre distingue ambos
casos. Para el contrato de selección por parámetro y las rutas estrictas, vea
[Tiempo, EOP e ITRF](../operations/time-eop.md).

### ERP asociado a un SP3

Cuando **todos** los SP3 activos que aportan cobertura temporal a la escena
tienen un ERP adjunto, validado y que cubre por completo su propio intervalo
publicado, la agenda sustituye por defecto la capa automática **IERS ERP Time**
por **ERP asociado a SP3**. Cada banda cian muestra exactamente el inicio y fin
UTC publicados por ese producto y el detalle conserva fichero, *snapshot* y
procedencia cuando existen. Para un pronóstico compuesto solo se anuncia ese
ERP como fuente temporal si los satélites participantes son SP3 y su cobertura
adjunta cubre toda la ventana efectiva.

La sustitución es deliberadamente estricta: un segundo SP3 sin ERP, un ERP
parcial, un fichero sin rango UTC verificable **o un satélite activo que no es
SP3** mantiene visible **IERS ERP Time**. En una escena mixta, las bandas cian
siguen mostrando el ERP exacto del SP3, pero no se presentan como la fuente de
los demás satélites. Orbit no infiere cobertura a partir del nombre, de la
fecha de importación ni de un `erp_file`; así no se oculta una fuente automática
que todavía pueda ser necesaria.

Los pases se incorporan desde el agregado de estaciones terrestres: sus hitos
de origen `aos`, `max` y `los` se adaptan respectivamente a `pass-aos`,
`pass-maximum` y `pass-los`. En los tres modos temporales, Orbit prepara su
propio pronóstico para **todos** los pares elegibles de estación visible ×
satélite activo y visible dentro del intervalo UTC que muestra la agenda. El
cálculo es progresivo y usa como máximo dos solicitudes simultáneas; se
aprovechan los resultados ya validados de la caché de pases, pero no se modifica
la línea temporal de la selección actual.

Cerrar el planificador, cambiar de proyecto o modificar el intervalo/rango/modo
cancela el trabajo pendiente y descarta su resultado parcial. Ocultar o eliminar
cualquiera de los extremos de una pareja en la **escena** retira sus hitos
inmediatamente de la agenda; una nueva capa o estación visible actualiza el
conjunto de pares. El detalle de errores conserva los resultados correctos que
ya se hayan calculado.

## Filtros de la agenda y visibilidad de escena

La barra lateral **Capas de la agenda** permite ocultar una capa solo dentro del
planificador. Este filtro no cambia el ojo de Capas, no oculta ninguna entidad
3D, no desactiva el satélite y no inicia una propagación nueva. Es, por tanto,
distinto de ocultar una capa en la escena: el ojo de escena sí cambia la
visibilidad física y determina si una estación/satélite puede participar en un
pronóstico de pases.

Las capas filtradas desaparecen de los eventos derivados y de sus avisos de
recursos, pero siguen existiendo en la escena. **IERS ERP Time** es una capa
sintética de agenda: permite ocultar solo sus intervalos de C01, Finals,
extrapolación y fallback nominal sin cambiar el diagnóstico, la escena ni el
proveedor temporal. Cuando una escena SP3 cumple el contrato de ERP adjunto,
esa capa se sustituye por la capa sintética **ERP asociado a SP3**, que filtra
solo sus bandas verificadas. Los eventos manuales pertenecen
al proyecto y permanecen visibles: una capa no es todavía su propietaria
explícita. El pronóstico y su caché subyacentes se conservan: al volver a
mostrar una capa, sus eventos ya calculados reaparecen inmediatamente sin tocar
la escena ni lanzar trabajo nuevo solo por el filtro. La preferencia se guarda por proyecto como
`plannerHiddenLayerIds`; al restaurar una estación, sus identificadores se
remapean antes de aplicar el filtro.

## Datos de calidad y disponibilidad

El estado canónico `orbit:planner-state` contiene `loading`, `ready` o `error`,
los eventos, su `updatedAt` y los errores conocidos. También conserva hechos de
las fuentes activas para que una vista pueda explicarlos:

Para integraciones, `layers[].visible` describe el ojo de la escena y
`layers[].plannerVisible` el filtro exclusivo de la agenda. La lista
`plannerHiddenLayerIds` y `context.passes` (vista, modo, límites y progreso)
permiten explicar por qué un intervalo se calcula, queda pendiente o se rechaza.

Durante un pronóstico global pueden aparecer ya los pares completados mientras
otros siguen cargando. Un fallo de un par se publica como error parcial y no
borra los pases válidos de los demás pares; si no se obtiene ningún resultado
válido, el estado pasa a error. Un intervalo fuera del rango simulado/MTR, una
cancelación o una fuente no apta tampoco se convierte en un evento positivo.

- un ERP manual se identifica por su *snapshot* validado, procedencia y rango
  de cobertura, cuando esos campos fueron publicados por el servicio;
- SP3 y OEM aportan únicamente sus rangos finitos validados en la escena;
- `diagnostics.erp.coverageTimeline` publica, cuando existen, los tramos
  verificados de C01 y `finals2000A.all`, `linear-extrapolation` con inicio,
  fin y máximo de 30 días, y `nominal-fallback` sin final finito. Cada hecho
  conserva `coverageStart`/`coverageEnd` o `start`/`end`, `source`, `quality`
  y una descripción; la agenda no inventa una frontera si el diagnóstico no la
  declara;
- las capas activas exponen tipo, visibilidad, procedencia y estado verificable
  disponible, sin convertir una capa visual en una garantía científica. Para un
  TLE/OMM importado localmente, Orbit puede además publicar el fichero y el
  instante de importación registrados y la época leída del propio elemento.

Un TLE recién importado puede por tanto aparecer aunque todavía no haya una
estación de tierra ni pases calculados: la agenda muestra su importación y su
época cuando ambas fechas existen. Estos detalles son de procedencia y son de
solo lectura; una capa TLE no publica por ello un final de cobertura. Las capas
importadas antes de que su catálogo registrase la fecha conservan, como mínimo,
la época TLE si el elemento está disponible.

Una cobertura terminada es un límite de disponibilidad (`validity-end`), no una
fecha de vencimiento. Si una fuente carece de fecha verificable, no se muestra
un evento ficticio. Un error de fuente, una validación pendiente o una hora
incorrecta permanece visible como estado/error, no como una disponibilidad
positiva.

La capa de orientación terrestre muestra rangos, no una colección de avisos
fijos: C01 es preferente mientras cubre la época; después puede entrar
`finals2000A.all` con calidad `final`, `rapid` o `predicted`; tras su última
época utilizable aparece el rango de extrapolación lineal local, limitado a 30
días. Después no queda EOP automático: un punto `erp-nominal-fallback` marca la
rotación nominal con calidad `approximate` y una ruta estricta se rechaza. Las
fechas proceden del snapshot instalado y no son un calendario IERS fijo. Si una
operación atraviesa uno de esos límites, el preflight muestra los subintervalos
y el aviso correspondiente antes de lanzar el trabajo; una ventana parcialmente
dentro de C01 no queda marcada como íntegramente precisa. Los ERP explícitos de
SP3 o de una órbita manual no se rellenan con esa cadena automática: mantienen
su propia cobertura estricta.

Una banda EOP es un único hecho temporal: se dibuja continua dentro de cada
fila semanal, en vez de clonar un chip por día. Si Finals cambia de `final` a
`rapid` sin cambiar la señal operativa amarilla, Orbit agrupa la presentación;
el detalle conserva los subtramos y sus calidades exactas. No agrupa una
predicción roja con una extrapolación roja degradada, porque representan rutas
operativas distintas.

## Eventos manuales, preferencias y proyecto

El planificador acepta eventos `manual` con título, inicio, fin y un color de
la paleta permitida. Las fechas se validan antes de aceptarlas: deben ser UTC o
instantes inequívocos, y el fin debe ser posterior al inicio. Solo esos eventos
creados por la persona usuaria se guardan en `plannerEvents` dentro del proyecto
v1. Junto con ellos, solo se guardan las preferencias de capas ocultas de la
agenda (`plannerHiddenLayerIds`). Los eventos derivados de pases, ERP, SP3, OEM,
diagnósticos o capas se recalcularán al abrir el proyecto y **no** se serializan
como si fueran datos autoritativos. La vista temporal actual no se guarda como
una reserva de antena, y el filtro del planificador no sustituye el estado de
visibilidad de la escena.

## Límites actuales

El planificador no es todavía un calendario operativo: no exporta ICS, no se
sincroniza con calendarios externos, no detecta conflictos de antena ni crea
reservas. Esas funciones requerirán su propio contrato de disponibilidad y
autorización; los eventos actuales solo ofrecen una base trazable para ello.
