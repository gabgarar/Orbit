# Planificador de eventos

[Inicio](../index.md) · [Guía de usuario](index.md) · [Línea temporal](timeline.md) · [Proyectos](projects.md)

El planificador reúne hechos temporales ya disponibles en la escena; no vuelve a
propagar una órbita, no reserva una antena y no sustituye la validación de los
productos de entrada. Es la base de las futuras vistas de agenda.

## Vistas y navegación

La superficie del planificador presenta los mismos eventos en vistas de
**día**, **semana** y **mes**. Cambiar de vista no cambia ni recalcula los
datos: solamente agrupa los instantes UTC publicados por la escena. Al activar
un evento con hora válida, Orbit intenta situar la simulación en ese instante
exacto. Si cae fuera del rango de simulación o del Rango Temporal Maestro (MTR),
la escena no se mueve y el estado comunica el motivo.

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
`pass-maximum` y `pass-los`. Al abrir el planificador en modo **Simulated**,
Orbit prepara su propio pronóstico para **todos** los pares elegibles de
estación visible × satélite activo y visible. El cálculo es progresivo y usa
como máximo dos solicitudes simultáneas; se aprovechan los resultados ya
validados de la caché de pases, pero no se modifica la línea temporal de la
selección actual. Cerrar el planificador, cambiar de proyecto o modificar el
rango/modo cancela el trabajo pendiente. En tiempo real o estático no se inventa
una agenda móvil. Ocultar o eliminar cualquiera de los extremos retira sus
hitos inmediatamente de la vista; una nueva capa o estación visible actualiza
el conjunto de pares.

## Datos de calidad y disponibilidad

El estado canónico `orbit:planner-state` contiene `loading`, `ready` o `error`,
los eventos, su `updatedAt` y los errores conocidos. También conserva hechos de
las fuentes activas para que una vista pueda explicarlos:

Durante un pronóstico global pueden aparecer ya los pares completados mientras
otros siguen cargando. Un fallo de un par se publica como error parcial y no
borra los pases válidos de los demás pares; si no se obtiene ningún resultado
válido, el estado pasa a error.

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

## Eventos manuales y proyecto

El planificador acepta eventos `manual` con título, inicio, fin y un color de
la paleta permitida. Las fechas se validan antes de aceptarlas: deben ser UTC o
instantes inequívocos, y el fin debe ser posterior al inicio. Solo esos eventos
creados por la persona usuaria se guardan en `plannerEvents` dentro del proyecto
v1. Los eventos derivados de pases, ERP, SP3, OEM, diagnósticos o capas se
recalcularán al abrir el proyecto y **no** se serializan como si fueran datos
autoritativos.

## Límites actuales

El planificador no es todavía un calendario operativo: no exporta ICS, no se
sincroniza con calendarios externos, no detecta conflictos de antena ni crea
reservas. Esas funciones requerirán su propio contrato de disponibilidad y
autorización; los eventos actuales solo ofrecen una base trazable para ello.
