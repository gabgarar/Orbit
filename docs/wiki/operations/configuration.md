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
| ORBIT_LEAP_SECONDS_* | Política de la tabla UTC–TAI local. |
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
