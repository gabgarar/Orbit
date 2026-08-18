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

El resumen operativo queda en una sola línea cuando está preparado. **Detalles**
despliega su explicación sin ocultar información; mientras se calcula, conserva
el progreso visible. Las confirmaciones de acciones son avisos flotantes de
unos segundos: no reducen la altura del calendario. Los errores persistentes
continúan apareciendo como alertas dentro de la ventana.

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

Ese intervalo visible es el dominio del pronóstico de pases; no es una fecha de
caducidad ni altera por sí mismo la escena.

| Modo | Comportamiento de la agenda y de los pases |
| --- | --- |
| **Simulated** | Calcula AOS, máximo y LOS del intervalo UTC visible solo si todo el intervalo queda dentro del rango simulado y, cuando existe, del Rango Temporal Maestro (MTR). Si no cabe íntegramente, falla de forma segura y explica el límite. |
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
| `*-expiry` | Evento de caducidad | Solo aparece si la fuente declara una fecha de expiración válida de forma explícita. Orbit no deduce una caducidad a partir de la cobertura. |
| `manual` | Color elegido por la persona usuaria | Bloque temporal escrito por la persona usuaria; no es un pase ni una reserva confirmada. |

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
recursos, pero siguen existiendo en la escena. Los eventos manuales pertenecen
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
- las capas activas exponen tipo, visibilidad, procedencia y estado verificable
  disponible, sin convertir una capa visual en una garantía científica.

Una cobertura terminada es un límite de disponibilidad (`validity-end`), no una
fecha de vencimiento. Si una fuente carece de fecha verificable, no se muestra
un evento ficticio. Un error de fuente, una validación pendiente o una hora
incorrecta permanece visible como estado/error, no como una disponibilidad
positiva.

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
