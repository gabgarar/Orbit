# Validación

[Inicio](../index.md) · [Operación](index.md) · [Instalación](../getting-started/installation.md) · [Configuración](configuration.md) · [Tiempo y EOP](time-eop.md)

La validación de Orbit combina un healthcheck del runtime, pruebas automáticas
por capa y validación de contratos de entrada. Una comprobación de estado
saludable confirma que el servicio responde; no certifica por sí sola la
exactitud de una efeméride ni la idoneidad de los datos de origen.

## Healthcheck del servicio

El contenedor expone un healthcheck HTTP contra la ruta /health del gateway.
Después de un arranque o reinicio, compruebe el estado:

~~~powershell
docker compose ps
./.scripts/orbit-status.cmd
~~~

El estado esperado es healthy. Si no se alcanza dentro del tiempo de espera del
script de reinicio, revise los registros:

~~~powershell
docker compose logs -f orbit
./.scripts/orbit-logs.cmd
~~~

`healthy` es **liveness**: el gateway y la aplicación pueden responder. No es
**readiness** y no espera de forma intencionada a la renovación en segundo
plano de C01 de IERS ni de la caché de gravedad NGA. Una caché automática puede
seguir cargándose, estar obsoleta o no estar disponible después del arranque.
Revise Built-In Test y el panel de arranque antes de habilitar una operación
dependiente; un healthcheck por sí solo no es un certificado de precisión ni de
modelo de fuerzas.

## Readiness y progreso de arranque

El registro de arranque autoritativo es el componente `startup` que devuelve
`GET /api/system/diagnostics`. Sus booleanos `ready` y `projectReady` solo pasan
a verdadero después de que el servicio complete explícitamente los pasos de
validación obligatorios. `readiness` hace el bloqueo inspeccionable, sin tratar
cualquier estado terminal o aviso como si fuese utilizable:

| Campo | Significado |
| --- | --- |
| `readiness.state` | `pending`, `ready`, `degraded-ready` o `blocked`. El trabajo bloqueado exige el booleano explícito `ready`/`projectReady`. |
| `readiness.requiredSteps` | Comprobaciones necesarias en este arranque; no se deben inferir de una secuencia fija de UI. |
| `readiness.blockers` | Cada requisito pendiente o fallido, con identificador, estado y mensaje para el operador. |
| `readiness.degradations` | Degradaciones completadas pero no bloqueantes, como la ruta de rotación terrestre nominal etiquetada explícitamente cuando falta ERP. |
| `details.progress` | Fase de arranque, modelo de gravedad activo, número de modelos completados/totales y hechos de descarga/validación por modelo. |

`details.progress.percent` se muestra como 0–100 solo cuando el servidor conoce
el tamaño total. Si la respuesta ascendente no aporta un `Content-Length`
fiable, vale `null` y la UI presenta una descarga indeterminada en vez de
inventar un porcentaje. Cada modelo publica estado/etapa, bytes descargados y
totales cuando se conocen, última actualización y mensaje. Los estados de
progreso son `pending`, `downloading`, `validating`, `ready` y `error`.

### Primer arranque, arranque con caché y acciones bloqueadas

En un primer arranque sin archivos NGA locales válidos, la descarga y
validación de los archivos de gravedad puede tardar de forma apreciable. El
panel de arranque muestra el modelo actual y su progreso mientras ocurre. Los
siguientes arranques suelen validar localmente la caché persistente y son mucho
más rápidos; una entrada ausente, corrupta u obsoleta puede seguir provocando
una renovación controlada.

Si un fallo NGA bloquea el arranque, Orbit reintenta la operación en segundo
plano hasta cinco veces, con esperas de 30, 60, 120, 240 y 300 segundos. No
reinicia el contenedor ni hace que falle `/health` solo porque ese trabajo esté
pendiente. Tras esos intentos, el error permanece visible y el monitor vuelve a
su intervalo normal. Una descarga y validación posterior correctas trasladan el
mismo runtime del error/blocker visible a `ready` (o a `degraded-ready` si queda
una degradación independiente no bloqueante); esta política no implica una
promesa de reintento manual.

Hasta que `ready`/`projectReady` sea explícitamente verdadero, Orbit conserva
disponibles la escena, el panel Startup y Built-In Test, pero bloquea acciones
que crearían, sustituirían o restaurarían estado de proyecto. El control de
proyecto no habilita **Nuevo proyecto** ni **Abrir/Importar proyecto**. Una
previsualización o creación forzada de órbita manual y los cálculos de
parámetros orbitales son rechazados por el servicio con HTTP 503 y la razón de
readiness publicada. No salte este bloqueo llamando a un endpoint o reintentando
a ciegas: resuelva el blocker informado o espere a que termine la validación.

`Warning`, `healthy` o una barra de progreso aparentemente terminada no bastan
por sí solos. La aplicación habilita estas acciones únicamente con los
booleanos explícitos de readiness. `degraded-ready` puede tener esos booleanos
verdaderos tras pasar los controles bloqueantes, pero conserva visible la
degradación y no certifica una ruta ERP/ECI estricta. `blocked` sigue siendo
una acción visible para el operador, no un fallback oculto.

## Suites automatizadas

El repositorio separa las pruebas por responsabilidad.

| Script | Cobertura ejecutada |
| --- | --- |
| ./.scripts/test-node.cmd | Pruebas unitarias del gateway Node.js. |
| ./.scripts/test-frontend.cmd | Pruebas unitarias de los módulos de front/. |
| ./.scripts/test-react-build.cmd | Compilación del frontend React y validación de activos del runtime. |
| ./.scripts/test-backend.cmd | Pruebas Python bajo server/python/ dentro de Docker. |
| ./.scripts/test-ui.cmd | Reinicio del runtime y pruebas de navegador. |
| ./.scripts/test-all.cmd | Ejecución ordenada de frontend, backend e integración. |

La imagen Docker también ejecuta las suites de Node, frontend y Python antes
de compilar el frontend final. Un fallo de esas pruebas impide que se complete
el build de la imagen.

!!! note "Ámbito de una suite"

    Una suite que termina correctamente demuestra los contratos cubiertos por
    sus casos. No implica una validación independiente de una fuente TLE,
    OEM, C04 o leap-seconds.list que el operador haya montado posteriormente.

## Validación de datos de operación

| Datos | Validación aplicada |
| --- | --- |
| Configuración del sistema | Normalización de valores y nombre de catálogo contenido dentro de config/. |
| Proyecto | El importador exige el formato orbit-project y versión 1. |
| Catálogo | Los formatos TLE, OMM y OEM se analizan antes de incorporarse; OEM puro no se convierte en objeto de catálogo. |
| Producto GNSS preciso | Se validan SP3 obligatorio; CLK, ERP, SUM, ATT y OSB por campo; extensiones, checksums, marco, escala temporal y duplicados por época. El proveedor y la clase se derivan del SP3. `require_eci` es un guard interno para una futura comparación, no un control de importación. El manifest se vuelve a verificar al arrancar. |
| C04 local | Se valida lectura, codificación, orden temporal, coherencia MJD/fecha, columnas y hash si se exige. |
| leap-seconds.list | Se valida la identidad, cobertura y, cuando se configura, la expiración #@. |
| Ventana EOP | En modo estricto, los límites declarados deben estar cubiertos por C04 y UTC–TAI. |

La política de C04 requiere el producto IAU 2000A con dX/dY; un encabezado que
declara dPsi/dEps se rechaza. Consulte [Tiempo y EOP](time-eop.md) para la
configuración de hashes y cobertura.

## Validación antes de una operación reproducible

1. Conserve el archivo fuente de cada TLE, OMM, OEM o producto GNSS SP3/CLK/ERP/SUM/ATT/OSB y su SHA-256.
2. Ejecute la suite adecuada tras actualizar código o configuración.
3. Compruebe el healthcheck y los logs del runtime iniciado.
4. Registre rango temporal, paso, propagador, marco y escala de cualquier
   efeméride exportada.
5. Registre la versión y SHA-256 de C04 y leap-seconds.list cuando intervenga
   una transformación terrestre de precisión.

## Límites

- No existe una certificación de precisión de misión, validación de
  determinación de órbita ni comparación automática contra una verdad de
  referencia externa.
- La detección AOS/LOS explora por muestreo. Refina por bisección los cambios
  de visibilidad ya encerrados hasta aproximadamente 0,5 s, pero no es un
  solver general de raíces ni garantiza detectar un pase entero entre dos
  muestras de exploración.
- El modo visual sin snapshots locales EOP sigue siendo aproximado aunque el
  servicio pase el healthcheck.
- No existe CI hospedada ni un informe de conformidad de estándar expuesto
  por el producto.

Los controles de presentación y coste se describen en
[Rendimiento](performance.md).
