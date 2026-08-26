# Built-In Test

[Inicio](../index.md) · [Guía de usuario](index.md) · [Validación](../operations/validation.md)

El icono **Built-In Test (BIT)**, situado a la derecha de **Help**, abre el
panel continuo de diagnóstico de solo lectura. No inicia propagaciones largas
ni cambia una órbita. Sus pestañas separan la disponibilidad de los servicios,
el **PBIT de inicio**, los datos de tiempo, las validaciones operativas y la
auditoría para que un aviso de calidad no parezca un fallo del servicio.

## Estados y actualización

BIT consulta continuamente `/api/system/diagnostics` desde que se abre Orbit,
también con el panel cerrado, y usa `/api/diagnostics` como compatibilidad con
backends anteriores. En paralelo lee `GET /health`: es la comprobación de vida
del **gateway web** y de su **backend Python**. Un `200` indica que el gateway
puede alcanzar al backend; un `503` puede indicar que el gateway respondió pero
el backend todavía no está disponible. Ninguno de los dos resultados decide la
readiness del proyecto.

El punto del icono resume los componentes visibles; **Actualizar** solicita
una consulta inmediata sin bloquear la interfaz. Cada fila muestra
**Healthy**, **Warning** o **Error** y la última validación publicada. Si el
canal de diagnósticos no responde, el panel lo indica en vez de inventar un
estado saludable.

## Pestañas del panel

| Pestaña | Qué significa |
| --- | --- |
| **Resumen** | Estado general, readiness del proyecto y las incidencias que requieren atención. Cada incidencia abre la pestaña correspondiente. |
| **Servicios** | Gateway web, backend Python, canal de diagnósticos y monitor continuo. Describe disponibilidad; no autoriza crear proyectos. |
| **Validación** | El ledger del **PBIT de inicio**, sus pasos, avisos, errores y progreso, además de tiempo/referencia, modelos de gravedad, propagadores, fuerzas y datos de escena. Estas son sondas en ejecución; no son CI/CD ni una certificación de release o misión. |
| **Auditoría** | Resultado y pasos del PBIT actual, más las propagaciones del proyecto. Permite exportar CSV o JSON locales. |

El MTR también es contextual: solo se publica cuando la escena tiene un rango
temporal maestro activo. Sus hechos locales (rango y clamp) no se fabrican a
partir de una tarjeta remota.

## Auditoría exportable

La pestaña **Auditoría** conserva el resultado de la última ejecución del PBIT
publicada por el servicio y el historial de propagaciones perteneciente al
proyecto abierto. Una propagación registra solo su objetivo, fuente,
propagador, rango UTC, cadencia, número resumido de muestras, marcos y estado;
no guarda muestras, archivos fuente ni respuestas crudas. El historial viaja
en la biblioteca local cifrada y en el documento `.orbit`, con un máximo de
**200 ejecuciones** por proyecto.

Los botones **CSV** y **JSON** descargan una fotografía local de esa auditoría.
Incluyen el estado del sistema consultado, el PBIT y las filas de propagación;
no sustituyen el indicador de tareas, que sigue mostrando exclusivamente el
trabajo que está en curso. Exportar no borra el registro ni repropaga una
órbita.

## PBIT de inicio y readiness

El bloque **PBIT de inicio** (ledger `startup`, también llamado IBIT inicial)
es la fuente de verdad para saber si Orbit puede aceptar trabajo de proyecto
bloqueado. Exige `ready: true` / `projectReady: true`; el estado normalmente
es `ready`, o `degraded-ready` con su advertencia visible. Un `/health`
saludable, una tarjeta Healthy o un aviso terminal no sustituyen esa decisión.
Si está en `pending` o `blocked`, revise `requiredSteps` y `blockers` en lugar
de adivinar qué datos faltan.

Los detalles de progreso muestran el modelo de gravedad actual, modelos
completados/totales y una entrada por modelo. El porcentaje de descarga es
deliberadamente opcional: si el servidor no puede establecer un total fiable,
`percent` vale `null` y la interfaz muestra actividad indeterminada.
**Actualizar** lee el snapshot publicado; no reinicia el servicio ni inventa
progreso.

Mientras readiness está pendiente, la escena y este panel permanecen
disponibles. Orbit bloquea Nuevo/Abrir/Importar proyecto en la interfaz y
rechaza una previsualización/creación forzada de órbita manual y trabajo de
parámetros orbitales con la razón de readiness HTTP 503 publicada. La primera
descarga puede tardar más; un arranque posterior con caché válida normalmente
solo valida ficheros locales y termina antes.

## Aviso del PBIT al abrir Orbit

Cuando el ledger terminal del **PBIT de inicio** (también llamado IBIT inicial)
publica uno o más avisos pero no un error bloqueante, Orbit muestra una tarjeta
compacta y no modal al abrir la aplicación. Resume
hasta tres motivos accionables y ofrece
**Revisar BIT** para abrir el diagnóstico completo. No cambia `ready`,
`projectReady` ni la decisión de creación de proyecto: un aviso degradable
puede seguir permitiendo trabajar bajo el contrato indicado por el servicio.

La tarjeta se puede cerrar con **Entendido** o su botón de cierre. Una vez
reconocida no reaparece en cada actualización del BIT durante esa sesión de la
aplicación; al recargar Orbit puede presentarse de nuevo el resultado de
arranque vigente. Los fallos y bloqueos de readiness no se disfrazan como esta
tarjeta: permanecen en la superficie de arranque y en el BIT como condición que
requiere corrección.

!!! warning "No es una certificación de misión"

    El panel usa sondas pequeñas y acotadas. Un estado Healthy indica que la
    ruta comprobada y sus datos publicados son coherentes; no sustituye una
    validación de misión, un ERP adjunto al producto, ni la política ECI
    estricta descrita en [Tiempo, EOP e ITRF](../operations/time-eop.md).

## Lectura de una advertencia EOP

Una advertencia puede significar que la copia C01 tiene más de siete días,
que su cobertura no alcanza la fecha actual o que IERS no respondió y Orbit
conserva la última copia válida. Es un aviso sobre tiempo y referencia, no un
fallo automático de disponibilidad de servicio. Si no existe copia válida, la
vista puede usar una rotación terrestre nominal. Esa ruta no convierte
automáticamente un SP3 en **ITRF (con ERP aplicado)** ni habilita ECI estricto.

## Interpretar una tarjeta de caché de gravedad

La tarjeta **Caché de gravedad** informa exactamente de lo que ha validado el
runtime; no deduce un modelo de gravedad a partir del grado seleccionado.
`Healthy` significa que el archivo publicado EGM96 o EGM2008, su miembro de
coeficientes esperado y su procedencia local superaron la validación acotada.
Entonces muestra `maxDegree`, `maxOrder`, `coverage`,
`completeThroughDegree` y `tailMaxOrder` detectados de la fuente
descomprimida. Esos valores—no el nombre del modelo—limitan el selector. Antes
de validar son `null` y el selector falla cerrado en vez de ofrecer un límite
numérico inventado.

El parser EGM2008 usa un sobre de entrada protector/informativo de 2190 ×
2190. No afirma que el archivo contenga un campo completo 2190 × 2190: el
perfil de coeficientes validado es la autoridad.

`Warning` puede significar que se conserva un archivo local antes válido
mientras no está disponible la renovación NGA programada. `Error` o un modelo
no disponible significa que no hay una caché validada utilizable; **Full
geopotential** permanece entonces no disponible y nunca se sustituye
silenciosamente por J2/J3/J4. Un campo ICGEM explícito y controlado por checksum
tiene prioridad sobre la caché automática.

El servicio puede estar saludable antes de que termine la comprobación de
gravedad en segundo plano. Use **Actualizar** o espere al siguiente ciclo del
monitor en vez de reiniciar solo para esperar una descarga. Una tarjeta de
gravedad saludable demuestra integridad de caché y una sonda pequeña de fuerza,
no que el RK4 Python pueda ejecutar una propagación de misión completa de
un campo denso ni que se cumplan los requisitos estrictos ERP/ECI.
