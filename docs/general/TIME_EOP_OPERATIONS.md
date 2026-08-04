# Operación de tiempo, EOP e ITRF

Orbit nunca descarga productos de tiempo durante una propagación o una
transformación de marco. El operador monta snapshots locales, los identifica
por SHA-256 y reinicia el servicio de forma explícita. Así una efeméride puede
reproducirse con el mismo C04 y la misma tabla UTC–TAI.

## Datos que se deben montar

Guarda los ficheros fuera de la imagen, dentro de `config/eop/`. Compose monta
esa carpeta como `/app/config/eop/` en el contenedor:

| Producto | Uso | Formato admitido |
| --- | --- | --- |
| IERS EOP C04 | DUT1, `xp`, `yp`, `dX`, `dY`, LOD para TEME/ITRF y GCRF/ITRF | C04-14 (0 h) o C04-20 (0 h/12 h) ASCII, variante IAU 2000A `dX/dY` |
| leap seconds | UTC ↔ TAI ↔ TT y escalas GNSS | IERS/NTP `leap-seconds.list` ASCII |

Descarga ambos productos por el canal de datos de IERS/NTP que controle el
equipo de operación. La aplicación sólo lee los archivos ya montados; no hay
HTTP, refresco en segundo plano ni actualización implícita.

No montes un C04 histórico IAU 1980 con columnas `dPsi/dEps`: esas cantidades
no son los offsets `dX/dY` que necesita la cadena IAU 2006/2000A. Orbit lo
rechaza si el encabezado lo declara.

## Configuración estricta recomendada

En PowerShell, calcula primero los hashes de los archivos que vas a desplegar:

```powershell
New-Item -ItemType Directory -Force .\config\eop
Get-FileHash .\config\eop\eopc04.txt -Algorithm SHA256
Get-FileHash .\config\eop\leap-seconds.list -Algorithm SHA256
```

Después configura rutas **del contenedor**, no rutas `C:\...` del host:

```powershell
$env:ORBIT_EOP_C04_PATH = "/app/config/eop/eopc04.txt"
$env:ORBIT_EOP_C04_SHA256 = "<sha256-del-c04>"
$env:ORBIT_EOP_SOURCE = "IERS EOP C04"
$env:ORBIT_EOP_VERSION = "2026-08-03"
$env:ORBIT_EOP_QUALITY = "final"
$env:ORBIT_EOP_STRICT = "true"
$env:ORBIT_TERRESTRIAL_REALIZATION = "ITRF2020"

$env:ORBIT_LEAP_SECONDS_PATH = "/app/config/eop/leap-seconds.list"
$env:ORBIT_LEAP_SECONDS_SHA256 = "<sha256-de-leap-seconds-list>"
$env:ORBIT_LEAP_SECONDS_VERSION = "IERS-<fecha-publicacion>"
$env:ORBIT_LEAP_SECONDS_REQUIRED = "true"
$env:ORBIT_LEAP_SECONDS_REQUIRE_UNEXPIRED = "true"

.\.scripts\restart-orbit.cmd -SkipBuild
```

`ORBIT_EOP_STRICT=true` exige `ORBIT_EOP_C04_PATH`, su SHA-256 y una tabla
local de leap seconds vigente según su línea IERS/NTP `#@`. También impide la
extrapolación EOP y rechaza cualquier calidad distinta de `final` o `rapid`.
Para una ventana de
simulación o exportación conocida, fija además:

```powershell
$env:ORBIT_EOP_REQUIRED_START = "2026-08-03T00:00:00Z"
$env:ORBIT_EOP_REQUIRED_END = "2026-08-10T00:00:00Z"
```

El arranque falla si el C04 o la tabla de leap seconds no cubren completamente
esos límites. En modo estricto también se rechaza una transformación solicitada
fuera de esa cobertura o al alcanzar la fecha de expiración `#@` de la tabla.
No actives `ORBIT_EOP_ALLOW_EXTRAPOLATION` en una configuración estricta.

## Ciclo de actualización

1. Descarga y revisa el nuevo C04 y/o `leap-seconds.list` fuera de Orbit.
2. Sustituye los archivos en `config/eop/` de manera controlada y calcula sus
   nuevos SHA-256.
3. Actualiza hash y versión en el entorno de despliegue.
4. Reinicia Orbit. Los snapshots se cargan una vez al iniciar; no hay hot
   reload porque mezclar datos de tiempo en una misma sesión rompe la
   reproducibilidad.
5. Verifica `docker compose ps` y los logs. Un hash erróneo, una fila C04 mal
   formada, un MJD que no coincide con la fecha o una tabla leap seconds
   caducada detienen el arranque cuando está activada la política estricta.

La identidad de los bytes C04 y la identidad de la tabla leap seconds entran
en la clave de caché de efemérides. Cambiar uno de los dos invalida cálculos
anteriores aunque la etiqueta humana de versión sea la misma.

## Realizaciones terrestres de productos GNSS

El acrónimo correcto del marco terrestre es **ITRF**. Si un SP3/OEM declara
`IGS20`, Orbit conserva esa realización y, por defecto, rechaza convertirla a
ITRF: la etiqueta no se reescribe de forma implícita.

La única excepción incluida es una operación global para **estados orbitales**
IGS20↔ITRF2020. IGS publica sus parámetros de datum globales como cero; puede
habilitarse explícitamente así:

```powershell
$env:ORBIT_TERRESTRIAL_REALIZATION = "ITRF2020"
$env:ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT = "true"
```

No la uses para coordenadas de estaciones o antenas: sus correcciones de
calibración son específicas del sitio y no forman parte de un Helmert global.
El parser también conserva `IGb20` e `IGc20`, pero no inventa una equivalencia
para ellos; requieren su propia operación publicada y registrada. Consulta
[la publicación IGS20](https://lists.igs.org/pipermail/igsmail/2022/008234.html)
y [la transición a IGc20](https://lists.igs.org/pipermail/igsmail/2025/008630.html).

## Modo visual de desarrollo

Sin `ORBIT_EOP_C04_PATH`, Orbit conserva el comportamiento de interfaz:
`UTC≈UT1 visual fallback`, marcado como `approximate` en la procedencia. Sin
una tabla local de leap seconds usa la programación histórica incluida en
Orbit, cuya última entrada es 2017-01-01 (`TAI-UTC = 37 s`). Ese modo es útil
para visualizar, pero no debe emplearse como configuración de análisis o
exportación precisa.

## Variables disponibles

| Variable | Efecto |
| --- | --- |
| `ORBIT_EOP_C04_PATH` | Ruta local del C04 dentro del proceso/contenedor. |
| `ORBIT_EOP_C04_SHA256` | Hash esperado del C04. |
| `ORBIT_EOP_C04_REQUIRE_SHA256` | Exige hash incluso sin activar modo estricto. |
| `ORBIT_EOP_SOURCE`, `ORBIT_EOP_VERSION`, `ORBIT_EOP_QUALITY` | Provenencia que acompaña cada transformación. |
| `ORBIT_EOP_STRICT` | Requiere C04/hash y leap seconds local vigente; rechaza EOP aproximado o extrapolado. |
| `ORBIT_EOP_REQUIRED_START`, `ORBIT_EOP_REQUIRED_END` | Cobertura mínima exigida al iniciar para C04 y UTC-TAI. |
| `ORBIT_LEAP_SECONDS_PATH` | Ruta de un `leap-seconds.list` local. |
| `ORBIT_LEAP_SECONDS_SHA256` | Hash esperado de ese archivo. |
| `ORBIT_LEAP_SECONDS_REQUIRED` | No permite usar la tabla histórica incluida. |
| `ORBIT_LEAP_SECONDS_REQUIRE_UNEXPIRED` | Exige una fecha `#@` futura en la tabla IERS/NTP. |
| `ORBIT_TERRESTRIAL_REALIZATION` | Realización de salida ITRF elegida explícitamente. |
| `ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT` | Activa sólo la operación global IGS20↔ITRF2020 para estados orbitales; requiere `ORBIT_TERRESTRIAL_REALIZATION=ITRF2020`. |
