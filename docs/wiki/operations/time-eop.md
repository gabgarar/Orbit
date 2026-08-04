# Operación de tiempo, EOP e ITRF

[Inicio](../index.md) · [Operación](index.md) · [Configuración](configuration.md) · [Línea temporal](../user-guide/timeline.md) · [Exportar](../user-guide/export.md)

Orbit trata tiempo, orientación terrestre y realización como contratos
explícitos. No descarga productos de tiempo durante una propagación ni una
transformación: el operador monta snapshots locales, los identifica por
contenido y reinicia el servicio para adoptar una revisión.

## Cadena temporal y de marcos

La interfaz muestra UTC. El backend distingue las escalas necesarias para una
reducción terrestre.

~~~mermaid
flowchart LR
    UTC[UTC] -->|DUT1| UT1[UT1]
    UTC -->|segundos intercalares| TAI[TAI]
    TAI -->|+ 32.184 s| TT[TT]

    I[GCRF / ICRF / EME2000] --> C[CIRS]
    C --> T[TIRS]
    T --> R[ITRF]

    M[TEME] --> P[PEF]
    P --> R
~~~

- UT1 se obtiene de UTC aplicando DUT1 del producto EOP.
- TT se obtiene mediante UTC → TAI → TT y se utiliza en la parte celeste de
  las transformaciones.
- La ruta GCRF, ICRF o EME2000 usa CIRS y TIRS antes de ITRF.
- La ruta TEME usa PEF antes de ITRF.
- Las etiquetas ECI y ECEF genéricas se rechazan porque no describen una
  transformación suficiente.

El acrónimo correcto del marco terrestre es **ITRF**, no IRTF. ITRF designa
una familia de realizaciones; una salida terrestre debe declarar la realización
cuando ésta sea relevante.

## Archivos locales requeridos

| Producto | Función | Formato aceptado |
| --- | --- | --- |
| IERS EOP C04 | DUT1, movimiento polar, dX, dY y LOD para la transformación terrestre | ASCII C04-14 o C04-20 con variante IAU 2000A dX/dY. |
| leap-seconds.list | UTC ↔ TAI ↔ TT y escalas GNSS | Archivo ASCII IERS/NTP con identidad y fecha de expiración. |

No use un C04 IAU 1980 que declara dPsi/dEps en lugar de dX/dY. Orbit lo
rechaza cuando el encabezado lo identifica.

## Configuración estricta

Guarde los archivos bajo config/eop/ y calcule sus hashes:

~~~powershell
New-Item -ItemType Directory -Force .\config\eop
Get-FileHash .\config\eop\eopc04.txt -Algorithm SHA256
Get-FileHash .\config\eop\leap-seconds.list -Algorithm SHA256
~~~

Defina rutas **del contenedor**, no rutas del host:

~~~powershell
$env:ORBIT_EOP_C04_PATH = "/app/config/eop/eopc04.txt"
$env:ORBIT_EOP_C04_SHA256 = "<sha256-del-c04>"
$env:ORBIT_EOP_SOURCE = "IERS EOP C04"
$env:ORBIT_EOP_VERSION = "revision-controlada"
$env:ORBIT_EOP_QUALITY = "final"
$env:ORBIT_EOP_STRICT = "true"
$env:ORBIT_TERRESTRIAL_REALIZATION = "ITRF2020"

$env:ORBIT_LEAP_SECONDS_PATH = "/app/config/eop/leap-seconds.list"
$env:ORBIT_LEAP_SECONDS_SHA256 = "<sha256-de-leap-seconds-list>"
$env:ORBIT_LEAP_SECONDS_VERSION = "revision-controlada"
$env:ORBIT_LEAP_SECONDS_REQUIRED = "true"
$env:ORBIT_LEAP_SECONDS_REQUIRE_UNEXPIRED = "true"

./.scripts/restart-orbit.cmd -SkipBuild
~~~

ORBIT_EOP_STRICT=true exige el C04 local, su SHA-256 y una tabla local de
segundos intercalares vigente según su línea #@. También impide extrapolar EOP
y limita la calidad a final o rapid.

Para una ventana conocida de simulación o exportación:

~~~powershell
$env:ORBIT_EOP_REQUIRED_START = "2026-08-03T00:00:00Z"
$env:ORBIT_EOP_REQUIRED_END = "2026-08-10T00:00:00Z"
~~~

El inicio falla si el C04 o la tabla UTC–TAI no cubren completamente los
límites. En modo estricto, una consulta que requiera datos fuera de cobertura
se rechaza durante la operación. Si se configura un SHA-256 para la tabla
UTC–TAI, cada consulta también verifica que su fecha no sea posterior a `#@`.

## Variables

| Variable | Efecto |
| --- | --- |
| ORBIT_EOP_C04_PATH | Ruta local del C04 dentro del proceso. |
| ORBIT_EOP_C04_SHA256 | Hash esperado del archivo C04. |
| ORBIT_EOP_C04_REQUIRE_SHA256 | Exige hash incluso fuera de modo estricto. |
| ORBIT_EOP_SOURCE, ORBIT_EOP_VERSION, ORBIT_EOP_QUALITY | Procedencia registrada con la transformación. |
| ORBIT_EOP_STRICT | Exige C04 identificado y tabla de leap seconds vigente; rechaza aproximación y extrapolación. |
| ORBIT_EOP_ALLOW_EXTRAPOLATION | Permite extrapolación sólo fuera de la política estricta. |
| ORBIT_EOP_REQUIRED_START, ORBIT_EOP_REQUIRED_END | Ventana mínima comprobada al iniciar contra C04 y UTC–TAI. |
| ORBIT_LEAP_SECONDS_PATH, ORBIT_LEAP_SECONDS_SHA256 | Tabla local y hash esperado. |
| ORBIT_LEAP_SECONDS_REQUIRED | Impide usar la tabla histórica incluida. |
| ORBIT_LEAP_SECONDS_REQUIRE_UNEXPIRED | Requiere una fecha #@ futura. |
| ORBIT_TERRESTRIAL_REALIZATION | Realización terrestre de salida explícita. |
| ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT | Habilita de forma opt-in la operación global IGS20 ↔ ITRF2020 para estados orbitales. |

## Realizaciones GNSS

Por defecto, un estado que declara IGS20 conserva esa realización y no se
reescribe a ITRF. La operación global IGS20 ↔ ITRF2020 se habilita sólo con:

~~~powershell
$env:ORBIT_TERRESTRIAL_REALIZATION = "ITRF2020"
$env:ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT = "true"
~~~

Esta excepción usa parámetros globales publicados para estados orbitales. No
aplica correcciones de estación o antena. Las realizaciones IGb20 e IGc20 se
conservan sin conversión implícita hasta que exista y se registre una operación
publicada específica.

## Modo visual

Sin ORBIT_EOP_C04_PATH, Orbit conserva una aproximación visual UTC≈UT1 y la
marca como approximate en la procedencia. Sin una tabla local de segundos
intercalares usa una programación histórica incluida cuyo último registro es
2017-01-01 con TAI−UTC = 37 s. Este modo sirve para visualización, no para
análisis preciso ni exportación terrestre reproducible.

## Actualización controlada

1. Descargue y revise las nuevas fuentes fuera de Orbit.
2. Sustituya los archivos de config/eop/ de manera controlada.
3. Calcule sus hashes y actualice las variables de entorno y revisiones.
4. Reinicie el runtime.
5. Compruebe docker compose ps y los logs.

La identidad de los bytes de C04 y de leap-seconds.list forma parte de la
clave de caché. Un cambio de cualquiera de ambos invalida resultados previos
aunque la etiqueta de versión no cambie.
