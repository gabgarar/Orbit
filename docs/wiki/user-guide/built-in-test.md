# Built-In Test

[Inicio](../index.md) · [Guía de usuario](index.md) · [Validación](../operations/validation.md)

El icono **Built-In Test (BIT)**, situado a la derecha de **Help**, abre un
panel de diagnóstico de solo lectura. No inicia propagaciones largas ni cambia
una órbita: presenta el resultado del **IBIT** (la comprobación inicial de
arranque) y el estado continuo actual de Orbit y de la escena.

## Estados y actualización

El BIT consulta `/api/system/diagnostics` continuamente desde que se abre
Orbit, también con el panel cerrado. El punto del icono resume el estado de
los componentes visibles; **Actualizar** solo solicita una consulta inmediata
sin bloquear la interfaz. Cada tarjeta muestra **Healthy**, **Warning** o
**Error** y su última hora de validación publicada. Si se ejecuta contra una
versión anterior del backend, intenta `/api/diagnostics` y deja claro que los
datos remotos no están disponibles en vez de inventar un estado saludable.

## Qué comprueba

| Tarjeta | Información publicada |
| --- | --- |
| Monitor del runtime | Si el ciclo de comprobación continuo del servicio sigue activo; un fallo aquí nunca queda oculto por la ausencia de productos de escena. |
| ERP / EOP loader | Si se cargó C01/C04, fecha de actualización, URL de procedencia, cobertura y estado de caché. |
| IBIT inicial | Resultado del arranque, decisión explícita `ready`/`projectReady`, pasos publicados, avisos, errores, tiempos y progreso conocido. Solo se marca **Superado** cuando el ledger terminal y `ready` son explícitos. |
| SP3, OEM y MTR | Se muestran solo si la escena contiene el producto o rango correspondiente. Para SP3 incluye el número de productos y el solape/local EOP conocido por la escena. |
| Propagadores y fuerzas | Sondas deterministas de energía two-body, Cowell/RK4, J2/J3/J4 y disponibilidad de geopotencial, arrastre y SRP bajo el contrato temporal actual. |
| Caché de gravedad | Fuente EGM96/EGM2008 por modelo, estado de caché y fichero de coeficientes local, huella, `maxDegree`/`maxOrder` detectados y perfil de cobertura, frescura/fallback y cualquier error de validación. |
| Time manager (MTR) | Rango temporal maestro, estado del clamp y capas SP3/OEM activas de la escena. |
| Marcos de referencia | Sonda ITRF a EME2000, residual de norma y calidad EOP de la ruta disponible. |
El BIT no muestra CI/CD: una entrega descargable debe proceder de una revisión
de CI/CD ya aprobada. Las comprobaciones operacionales en ejecución no deben
confundirse con la aprobación de una release.

## Interpretar el IBIT inicial

El bloque **IBIT inicial** es la fuente de verdad para saber si Orbit
puede aceptar trabajo de proyecto bloqueado. Exige `ready: true` /
`projectReady: true`; el estado normalmente es `ready`, o `degraded-ready` con
su advertencia visible. Un healthcheck del contenedor, una tarjeta Healthy o un
aviso terminal no sustituyen esa decisión. Si está en `pending` o `blocked`,
revise `requiredSteps` y `blockers` en lugar de adivinar qué datos faltan.

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

!!! warning "No es una certificación de misión"

    El panel usa sondas pequeñas y acotadas. Un estado Healthy indica que la
    ruta comprobada y sus datos publicados son coherentes; no sustituye una
    validación de misión, un ERP adjunto al producto, ni la política ECI
    estricta descrita en [Tiempo, EOP e ITRF](../operations/time-eop.md).

## Lectura de una advertencia EOP

Una advertencia puede significar que la copia C01 tiene más de siete días,
que su cobertura no alcanza la fecha actual o que IERS no respondió y Orbit
conserva la última copia válida. Si no existe copia válida, la vista puede usar
una rotación terrestre nominal. Esa ruta no convierte automáticamente un SP3
en **ITRF (con ERP aplicado)** ni habilita ECI estricto.

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
