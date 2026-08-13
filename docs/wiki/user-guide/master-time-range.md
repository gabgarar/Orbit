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

La ampliación nunca reduce el intervalo. Si se confirma, el resultado es:

\[
  [\min(t_\min, r_0),\; \max(t_\max, r_1)]
\]

donde `[r_0, r_1]` es la cobertura del objeto que se quiere añadir.

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
de cobertura equivalente a OEM o SP3. Por ello una capa de catálogo TLE por sí
sola no inicializa ni amplía el MTR. Su época y sus límites de uso siguen siendo
importantes para evaluar la calidad de SGP4, pero no se convierten en una
cobertura finita inventada.

En una escena que ya tiene MTR por un OEM/SP3 u otra efeméride finita, la
capa TLE se evalúa únicamente en las épocas permitidas por el MTR. Esto ordena
la visualización y la comparación temporal, pero no convierte un TLE en una
efeméride de referencia ni certifica su precisión fuera de la época de sus
elementos.

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
