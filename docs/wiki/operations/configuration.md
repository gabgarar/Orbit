# Configuración

[Inicio](../index.md) · [Operación](index.md) · [Rendimiento](performance.md) · [Tiempo y EOP](time-eop.md)

Orbit conserva la configuración de aplicación, el catálogo editable y los
productos GNSS precisos importados dentro de config/. En el despliegue Compose
estándar, esa ruta se monta en el contenedor como /app/config para que sobreviva
a una recreación de la imagen.

## Archivo de configuración

El archivo principal es config/system_config.json. Su forma pública agrupa
valores bajo system y data.

~~~json
{
  "system": {
    "orbit": {},
    "satellites": {},
    "realtime": {},
    "logging": {},
    "rendering": {},
    "recording": {},
    "ui": {}
  },
  "data": {
    "satellites_catalog_file": "catalog.json"
  }
}
~~~

La interfaz carga este archivo y guarda cambios a través de la ruta interna
/api/system-config. El runtime acepta también varias claves planas históricas
al normalizar la configuración, pero las nuevas configuraciones deben usar la
forma agrupada.

## Secciones de interfaz

| Sección | Parámetros expuestos |
| --- | --- |
| Órbitas | Horizonte de propagación, traza futura, track de suelo, ancho y colores. |
| Satélites | Etiquetas, escala de modelo, uso de modelo 3D, modo de tamaño y alerta de perigeo. |
| Tiempo real | Intervalos de actualización de estado y órbita. |
| Logs | Activación, nivel y visibilidad del reloj superior. |
| Renderizado | Antialiasing, fondo, atmósfera, iluminación, estrellas y mapa base. |
| Grabación | Calidad y formato solicitado para MediaRecorder. |
| Interfaz | Idioma y tema. |

Los valores seleccionables de renderizado incluyen antialiasing off, fxaa y
msaa; y los mapas Natural Earth local, Earth 2 km local, OpenStreetMap y World
Imagery de Esri.

## Catálogo persistente

El campo data.satellites_catalog_file indica el nombre del archivo de catálogo
dentro de config/. El backend normaliza el nombre para impedir rutas fuera de
ese directorio y rechaza nombres reservados de Windows, separadores de ruta,
caracteres de control y system_config.json.

!!! warning "Edición manual"

    Mantenga JSON válido y haga una copia de seguridad antes de editar
    config/system_config.json fuera de la interfaz. Un archivo ilegible hace
    que el backend use valores seguros por defecto para la configuración que
    pueda cargar, y puede ocultar el error operativo hasta revisar los logs.

## Productos GNSS precisos persistentes

Cada importación GNSS, con SP3 obligatorio y CLK/ERP/SUM/ATT/OSB asociados si
se aportan, se guarda bajo `config/precise-products/<product_id>/`. El directorio contiene las fuentes
lógicas ya descomprimidas y un `manifest.json` con proveedor, clase, nombre
original, compresión, miembro ZIP si aplica y checksums SHA-256. El runtime
verifica los checksums y vuelve a analizar las fuentes al iniciar; una entrada
corrupta se informa como diagnóstico y no debe sustituirse a mano mientras el
servicio está activo.

Incluya `config/precise-products/` en la copia de seguridad de la instancia.
Un proyecto puede contener referencias estables a estos productos, pero no
incluye por sí mismo sus archivos fuente. Si se restaura un proyecto sin su
directorio de productos, la capa no puede rehidratarse.

Consulte [Productos GNSS precisos](../formats/precise-products.md) para el
contrato de importación y procedencia.

## Variables de ejecución

| Variable | Efecto |
| --- | --- |
| ORBIT_HTTP_PORT | Puerto publicado en el host; no cambia el puerto interno 8100. |
| ORBIT_HTTP_BIND | Interfaz de escucha. El valor predeterminado 127.0.0.1 mantiene el acceso local. |
| PYTHON_BACKEND_URL | URL interna usada por el gateway para el backend Python. |
| ORBIT_PYTHON_STARTUP_TIMEOUT_MS | Presupuesto de arranque del backend Python: `180000` ms por defecto; solo acepta enteros entre `10000` y `600000`. Dé margen suficiente para rehidratar localmente productos GNSS estrictos (SP3/ERP) antes de declarar el servicio disponible. |
| ORBIT_EOP_* | Política y procedencia del snapshot C04 local. |
| ORBIT_EOP_C01_CACHE_PATH | Caché mutable del C01 automático; por defecto `/app/data/erp/EOP_C01_IAU2000_1846-now.txt`. Solo se usa si no se configuró `ORBIT_EOP_C04_PATH`. |
| ORBIT_LEAP_SECONDS_* | Política de la tabla UTC–TAI local. |
| ORBIT_DIAGNOSTICS_MONITOR_INTERVAL_SECONDS | Intervalo del monitor de salud; por defecto `21600` (6 h), aceptado entre 30 s y 24 h. |
| ORBIT_GITHUB_ACTIONS_MONITOR | `true` habilita una consulta pública, acotada y sin token de los últimos workflows para Built-In Test; el valor predeterminado es `false`. |
| ORBIT_GITHUB_REPOSITORY | Repositorio público `propietario/repositorio` que consulta el monitor CI; por defecto `gabgarar/Orbit`. |
| ORBIT_GRAVITY_CACHE_DIR | Directorio persistente de caché NGA automática; por defecto `data/geopotential` (`/app/data/geopotential` en el contenedor estándar). |
| ORBIT_GRAVITY_MODEL | Selección automática del modelo: `EGM96` o `EGM2008`; por defecto `EGM2008`. |
| ORBIT_GRAVITY_REFRESH_DAYS | Antigüedad a partir de la que el monitor renueva la caché automática; por defecto `30`, rango permitido `1`–`3650`. |
| ORBIT_GRAVITY_AUTO_DOWNLOAD | Habilita la renovación oficial NGA en segundo plano; por defecto `true`. Use `false` para utilizar únicamente copias locales ya validadas. |
| ORBIT_GRAVITY_DOWNLOAD_TIMEOUT_SECONDS | Tiempo de espera acotado de la descarga automática; por defecto `45` segundos. |
| ORBIT_GRAVITY_FIELD_PATH | Ruta opcional dentro del contenedor a un campo ICGEM estático `.gfc` explícito. Tiene prioridad sobre la caché automática. |
| ORBIT_GRAVITY_FIELD_SHA256 | SHA-256 obligatorio cuando se configura un campo ICGEM explícito; el arranque falla si no coincide. |
| ORBIT_GRAVITY_FIELD_SOURCE | Procedencia humana/publicada opcional del campo ICGEM explícito; si falta se deriva como procedencia local controlada. |
| ORBIT_GRAVITY_FIELD_VERSION | Versión o identificador de publicación opcional del campo ICGEM explícito; si falta se usa `modelname` del encabezado ICGEM. |
| ORBIT_TERRESTRIAL_REALIZATION | Realización terrestre de salida; Compose usa `ITRF2020` por defecto. |
| ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT | Activa, junto a `ORBIT_TERRESTRIAL_REALIZATION=ITRF2020`, la operación publicada IGS20/IGb20/IGc20→ITRF2020 para estados orbitales de satélite; Compose usa `true` por defecto. |

La política de familia conserva la realización fuente y no corrige estaciones
ni antenas. Defina la variable como `false` para deshabilitarla. No la active
junto a la variable
histórica exacta `ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT`; ambas políticas son
mutuamente excluyentes. Consulte [Realizaciones y modo visual](time-eop/realizations.md)
antes de habilitarla.

Las variables temporales y de realización no pertenecen al JSON de interfaz.
Se inyectan en Compose al iniciar el proceso; su contrato se documenta en
[Tiempo y EOP](time-eop.md).

### Caché NGA automática y campo local explícito

Sin `ORBIT_GRAVITY_FIELD_PATH`, `geopotential` puede usar el registro NGA
automático. Después de que FastAPI esté saludable, el monitor valida la copia
local de `ORBIT_GRAVITY_CACHE_DIR` y, cuando está habilitado, renueva una
entrada ausente u obsoleta desde la URL fija oficial de EGM96/EGM2008. La caché
no es una dependencia del arranque y nunca se descarga durante una etapa de
propagación. Conserve este directorio en el volumen persistente `./data`.

Con una caché fría, este trabajo asíncrono puede hacer que el primer arranque
utilizable tarde más que uno posterior con caché. `/health` puede estar ya
saludable mientras el registro de descarga y validación NGA sigue pendiente.
La aplicación expone progreso de descarga/validación por modelo mediante
diagnósticos y mantiene las acciones de proyecto bloqueadas hasta publicar
readiness explícito. Una caché persistente válida evita la descarga de red en
arranques posteriores, aunque se vuelve a validar localmente. Si el servidor
ascendente no anuncia un tamaño total fiable, el progreso es indeterminado en
vez de informar un porcentaje fabricado.

El registro valida URL y política de redirecciones, tamaño y rutas del ZIP,
miembro de coeficientes exacto, continuidad y plausibilidad de coeficientes, y
SHA-256 antes de activar una entrada de caché atómicamente. Si NGA no está
disponible, puede conservarse una copia válida obsoleta con **Warning**. Si no
hay caché válida, `geopotential` queda no disponible; no se sustituye por
J2/J3/J4.

`ORBIT_GRAVITY_FIELD_PATH` conserva la alternativa explícita reproducible y
tiene prioridad sobre la caché automática. Debe nombrar un campo ICGEM `.gfc`
estático con convención `fully_normalized`; se validan encabezado, completitud
de coeficientes y huella obligatoria. Monte su directorio en `/app/config` u
otra ruta visible para el contenedor y use esa ruta interna. Un campo ICGEM
explícito nunca se sobrescribe ni cambia silenciosamente por el monitor NGA.

Después de descomprimir y validar el archivo, Orbit deriva y publica
`maxDegree`, `maxOrder` y el perfil de cobertura; la UI usa esos valores
detectados como únicos límites efectivos. Antes de esa validación son `null`,
por lo que el selector sigue no disponible en vez de adivinar un tope. El
archivo EGM2008 se maneja dentro de un sobre protector/informativo de parser de
2190 × 2190, pero controla lo seleccionable el fichero de coeficientes real y
validado, no ese sobre.

Esos límites derivados de la fuente son distintos del guard actual de RK4
Python de 2.555 términos no centrales por etapa. Una selección cuya
materialización supera el guard se rechaza; un campo denso completo de escala
de misión sigue siendo una tarea futura de un motor optimizado.

Para órbitas manuales, `geopotential` y `drag` consumen el proveedor automático
IERS C01 común. Con cobertura válida aplican sus EOP; sin ella conservan una
rotación terrestre nominal etiquetada con **Warning**, sin exigir un ERP manual.
La ruta EME2000↔ITRF sigue necesitando tabla local de segundos intercalares y
ERFA/SOFA. `ORBIT_EOP_STRICT=true` permanece disponible para rutas reproducibles
estrictas y no se relaja la política fail-closed de ECI para productos SP3.

`restart-orbit` espera el presupuesto configurado, redondeado a segundos, más
60 s para el gateway y la cadencia del healthcheck. Por ejemplo, el valor
predeterminado espera hasta 240 s. Si se necesita más tiempo por la
rehidratación estricta de una colección GNSS, ajuste la variable dentro de su
rango válido y reinicie el runtime.

## Aplicación de cambios

Los cambios de la interfaz se persisten en el archivo de configuración. Los
cambios que afecten a la imagen, al puerto publicado, a datos EOP, a variables
de entorno o a dependencias requieren recrear o reiniciar el runtime. En
Windows, use:

~~~powershell
./.scripts/restart-orbit.cmd
~~~

Para reiniciar sin reconstruir la imagen actual:

~~~powershell
./.scripts/restart-orbit.cmd -SkipBuild
~~~

No use un reinicio para sustituir una política de precisión sin actualizar
también los hashes y versiones de los archivos locales; consulte
[Tiempo y EOP](time-eop.md).
