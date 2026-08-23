# Rango temporal maestro (MTR)

[Inicio](../index.md) · [Guía de usuario](index.md) · [Línea temporal](timeline.md) · [Importar](import.md) · [Proyectos](projects.md)

El **rango temporal maestro** (*Master Time Range*, MTR) es el único intervalo
UTC que gobierna la simulación de una escena con datos de cobertura finita. Se
representa como el intervalo inclusivo `[t_min, t_max]`. La línea temporal, las
capas, los importadores y los generadores consultan el mismo MTR; ninguno debe
crear un rango paralelo ni evaluar fuera de él.

El MTR es una política de disponibilidad de datos. No cambia la escala de
tiempo ni el marco de referencia de un producto. Para UTC, UT1, ERP y marcos,
consulte [Tiempo, EOP e ITRF](../operations/time-eop.md).

## Cómo se establece

El primer objeto con cobertura finita válida define el MTR de la sesión. Por
ejemplo, puede ser un OEM, un SP3 o una órbita importada/generada con inicio y
fin explícitos.

| Operación | Regla del MTR |
| --- | --- |
| Primer OEM, SP3 u otra efeméride finita | El MTR toma exactamente su inicio y fin publicados. La escena pasa a simulación de rango. |
| Objeto cuya cobertura está contenida | Se acepta sin modificar el MTR. |
| Objeto que sobresale del MTR | Orbit solicita confirmación antes de cambiar el rango. |
| Generación de una órbita fuera del MTR | Orbit informa del conflicto y ofrece la misma ampliación explícita. |
| Proyecto nuevo | El MTR se reinicia; el siguiente objeto finito válido vuelve a inicializarlo. |

La ampliación de una importación nunca reduce el intervalo. Si se confirma, el resultado es:

\[
  [\min(t_\min, r_0),\; \max(t_\max, r_1)]
\]

donde `[r_0, r_1]` es la cobertura del objeto que se quiere añadir.

Al desactivar o eliminar una capa, Orbit vuelve a construir el contexto
temporal exclusivamente con las capas que siguen activas. Por tanto, retirar
un SP3 ya no deja su intervalo histórico fijado en la escena: si quedan otras
efemérides finitas se usa su envolvente activa; si sólo quedan TLE/OMM se pasa
a una ventana operativa de TLE; y si no queda ningún satélite se limpia el MTR
y se vuelve a **Real time**, con un aviso al operador.

## Confirmar una ampliación

Cuando un objeto no cabe por completo, Orbit muestra el diálogo:

> Este objeto está fuera del rango de simulación. ¿Desea ampliar el rango temporal maestro?

Las acciones son **Ampliar** y **Cancelar**. **Ampliar** aplica la unión de los
dos intervalos y sólo entonces permite cargar o generar el objeto. **Cancelar**
no modifica el MTR y el objeto no se incorpora. No hay ampliación implícita ni
recorte silencioso de la cobertura.

Esto evita que una capa se acepte con un extremo sin datos y hace visible la
decisión que cambia el contexto temporal de la escena.

## Cobertura propia de cada objeto

El MTR no sustituye la cobertura intrínseca de cada objeto. Un OEM, SP3 o una
órbita tabulada conserva su propio intervalo `R = [r_0, r_1]`. En la época
actual `t` sólo se evalúa si:

\[
  r_0 \leq t \leq r_1
\]

Fuera de `R`, Orbit marca el objeto como **Inactivo (fuera de rango)** y muestra
**«Este objeto no tiene datos para la época actual.»**. Su estado es nulo y no
se interpola, propaga, solicita efemérides ni genera geometría para ese objeto.
En particular, Orbit no extrapola un OEM, SP3 o una órbita de referencia más
allá de sus muestras publicadas.

Todo fichero `.oem` se importa como una efeméride OEM nativa, incluso si el
proveedor incluye comentarios `TLE_LINE1` y `TLE_LINE2`. Esos comentarios no
convierten las muestras OEM en una capa de catálogo: se conserva su cobertura
finita y se aplica la misma decisión del MTR.

Una cobertura ausente, mal formada o con el fin anterior al inicio también se
considera inválida. No se interpreta como una licencia para extrapolar.

Los análisis de AOS/LOS siguen la misma regla: la ventana solicitada debe estar
completamente contenida en la cobertura propia de la efeméride. Orbit no la
recorta para devolver pases parciales; si un extremo queda fuera, devuelve el
estado **Inactivo (fuera de rango)**, sin pases ni muestras, y explica que no
se generó el análisis. Una OEM local tampoco se sustituye por un TLE para ese
cálculo: mientras no exista un proveedor de AOS/LOS para ella, el resultado
queda explícitamente no disponible.

## Línea temporal y tiempo real

La barra y el cursor de la [línea temporal](timeline.md) se limitan al MTR. Un
intento de posicionarse antes de `t_min` o después de `t_max` queda fijado en el
extremo correspondiente; la reproducción no puede salir de ese intervalo.

Con un MTR establecido, el modo **Real time** sólo está disponible cuando el
instante actual del reloj de pared pertenece al intervalo. Si no pertenece, las
capas de tiempo real se desactivan y la escena se mantiene en simulación de
rango. Así, un SP3 histórico no se presenta como si tuviera estado válido en
el presente.

## Persistencia de proyecto

El documento de proyecto conserva la configuración temporal serializable:
modo, MTR, época actual, reproducción y velocidad. Al reabrirlo, Orbit vuelve a
validar el intervalo frente a las capas que puedan restaurarse y vuelve a
limitar el cursor al MTR. Guardar un proyecto no incrusta por sí mismo los
binarios de entrada.

En especial, un OEM local o un producto preciso cuya fuente ya no esté
disponible no recupera muestras por el mero hecho de que su antiguo MTR figure
en el JSON. Conserve los archivos fuente e impórtelos de nuevo; mientras no
haya cobertura válida, no se crea un estado ni se extrapola una trayectoria.

## TLE, OMM y la limitación de cobertura

Un TLE/OMM propagado con SGP4 no publica, en este flujo, un intervalo tabulado
de cobertura equivalente a OEM o SP3. Por ello añadir una capa TLE por sí sola
a una escena limpia no inicializa ni amplía el MTR y conserva **Real time**.
Su época y sus límites de uso siguen siendo importantes para evaluar la calidad
de SGP4, pero no se convierten en una cobertura finita inventada.

La época del TLE sí es un límite operativo inferior: antes de ella Orbit marca
la capa como **fuera de rango** y no conserva un marcador ni una traza de una
actualización posterior. Es una política de uso de Orbit; no afirma que SGP4
sea matemáticamente incapaz de evaluar hacia atrás ni certifica precisión a
partir de la época.

Si se retira el último OEM/SP3/track finito mientras quedan TLE/OMM activos,
Orbit conserva la simulación en una ventana operativa corta: empieza en
`max(ahora, epoch del TLE)` y termina tras el horizonte de propagación
configurado. Esa ventana permite continuar la operación sin inventar cobertura
tabulada ni arrastrar días, meses u horas de una simulación SP3 anterior. El
horizonte `propagation_hours` es una preferencia de visualización/planificación
de los TLE; aplicar un rango de simulación no lo reescribe ni lo guarda con la
duración del SP3/OEM.

En una escena que ya tiene MTR por un OEM/SP3 u otra efeméride finita, la
ventana operativa del TLE puede formar parte de la envolvente temporal de la
escena, pero cada fuente conserva su propio contrato: el SP3/OEM no se evalúa
fuera de sus muestras y el TLE no se evalúa antes de su epoch. Esto ordena la
visualización y la comparación temporal, pero no convierte un TLE en una
efeméride de referencia ni certifica su precisión fuera de la época de sus
elementos.

Una envolvente puede contener un hueco real entre el último SP3/OEM y la época
del TLE. Para que ese hueco no se dibuje como una órbita ficticia, Orbit pide
al propagador únicamente un tramo local posterior al cursor (entre un minuto y
24 horas, según el horizonte configurado), nunca toda la envolvente. Al mover
el cursor se renueva ese tramo; la navegación por el MTR completo sigue siendo
libre y el hueco permanece visible como falta de datos de esa capa.

Para que el avance no tenga que esperar al llegar al borde de un tramo, Orbit
puede precargar en segundo plano únicamente el tramo TLE adyacente. Esa
precarga es opcional, se limita a una solicitud global, no cambia la escena
hasta que el cursor entre en su intervalo y las solicitudes visibles mantienen
siempre la prioridad.

## Contrato técnico

El runtime centraliza estas operaciones para que importadores, generadores y
la línea temporal apliquen la misma regla:

```js
setMasterTimeRange(tMin, tMax)
expandMasterTimeRange(newMin, newMax)
getMasterTimeRange()
isInsideMasterRange(time)
clampToMasterRange(time)
validateObjectRange(range)
validateObjectFitsMTR(range)
isInsideObjectRange(object, time)
```

`validateObjectFitsMTR` distingue entre una inicialización válida, una entrada
contenida y una entrada que requiere confirmación de ampliación. Las
validaciones fallan de forma segura: un rango inválido no modifica el MTR ni
permite cargar el objeto.
