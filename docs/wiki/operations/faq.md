# Preguntas frecuentes de operación

[Inicio](../index.md) · [Operación](index.md) · [Instalación](../getting-started/installation.md) · [Configuración](configuration.md) · [Validación](validation.md)

## ¿Por qué un reinicio muestra tanta salida?

El comando ./.scripts/restart-orbit.cmd reconstruye la imagen por defecto.
Durante el build se instalan dependencias, se ejecutan pruebas de Node,
frontend y Python, y se compila React. La salida corresponde a esas fases,
además de la recreación del contenedor y el healthcheck. Si la imagen actual ya
contiene el código deseado, use:

~~~powershell
./.scripts/restart-orbit.cmd -SkipBuild
~~~

No combine -SkipBuild con -NoCache.

## ¿Dónde se conservan la configuración y el catálogo?

Se conservan en config/ del repositorio. Compose monta esa carpeta como
/app/config, por lo que la recreación normal de un contenedor no la borra. Los
productos GNSS precisos importados se guardan además en
config/precise-products/ con sus checksums y manifest. Consulte
[Configuración](configuration.md) antes de editar config/system_config.json o
archivos de producto manualmente.

## ¿Por qué Orbit sólo abre en mi equipo?

Compose publica por defecto el gateway en 127.0.0.1. Esa decisión evita
exponer por defecto una aplicación sin autenticación ni autorización. Para
exponerla deliberadamente, establezca ORBIT_HTTP_BIND=0.0.0.0 y aplique un
firewall o proxy con control de acceso externo. La configuración del puerto se
describe en [Instalación](../getting-started/installation.md).

## ¿Por qué no aparece la barra de simulación?

La barra completa aparece sólo en el modo Simulated. Static y Real time usan el
selector compacto de fecha, hora y modo; Real time puede pausarse sin mostrar
un rango simulado. Consulte [Línea temporal](../user-guide/timeline.md).

## ¿Por qué no puedo editar el rango cuando hay un OEM?

Una trayectoria OEM local puede activar su dominio temporal. El editor de
rango se deshabilita para no pedir posiciones fuera de las muestras OEM. Al
mezclar OEM con TLE u OMM, revise el rango antes de interpretar la comparación.
Consulte [Importar](../user-guide/import.md).

## ¿Por qué un OEM puro no entra en el catálogo?

La ruta de catálogo necesita un TLE embebido, identificado por TLE_LINE1 y
TLE_LINE2, para crear un objeto propagable. Un OEM puro no se convierte de
forma implícita en ese objeto. El visor dispone de una ruta separada para
trayectorias OEM locales tabuladas, con sus propias limitaciones de
persistencia.

## ¿Por qué un OEM local no se restaura al abrir un proyecto?

El documento de proyecto conserva una composición serializable, no las
muestras completas de una trayectoria OEM local. Archive el OEM original junto
al JSON de proyecto y vuelva a cargarlo. Véase [Proyectos](../user-guide/projects.md).

## ¿Puedo importar SP3, OPM, CPF o RINEX desde la interfaz?

Sí para productos GNSS precisos SP3 locales, con CLK RINEX opcional asociado.
La ruta de producto admite las series IGS/CDDIS, MGEX y ESA NSO cuando el
contenido SP3/CLK es válido; conserva el proveedor, marco y escala temporal y
registra una efeméride tabulada. No inicia sesión ni descarga archivos desde el
proveedor.

OPM, CPF y RINEX de observaciones siguen sin estar disponibles. Un CLK RINEX
por sí solo tampoco es una órbita. Consulte [Importar](../user-guide/import.md)
y [Productos GNSS precisos](../formats/precise-products.md).

## ¿El modo visual sirve para exportación terrestre de precisión?

No por sí solo. Sin C04 local, Orbit usa una aproximación visual UTC≈UT1; sin
tabla local de segundos intercalares usa una programación histórica incluida.
Para una operación reproducible, configure C04, hashes, leap-seconds.list,
ventana de cobertura y realización explícita siguiendo
[Tiempo y EOP](time-eop.md).

## ¿ITRF e IRTF son la misma sigla?

No. El acrónimo correcto es ITRF, International Terrestrial Reference Frame.
Además, ITRF representa una familia de realizaciones. Orbit no reetiqueta
implícitamente IGS20, IGb20 o IGc20 como ITRF. La alineación global publicada
de esas tres realizaciones a ITRF2020 requiere una activación explícita de
`ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT=true` junto con
`ORBIT_TERRESTRIAL_REALIZATION=ITRF2020`; IGS14 necesita una operación propia.

## ¿Orbit incluye usuarios, colaboración, API pública estable, SDK o CLI?

No. El gateway y el backend exponen interfaces de runtime, pero no existe una
versión pública formal de API, SDK distribuido, CLI de producto, sistema de
usuarios, control de acceso ni colaboración en tiempo real.

## ¿Cómo sé si el runtime está sano?

Compruebe docker compose ps o ejecute ./.scripts/orbit-status.cmd. Para
comprobar el código y contratos cubiertos, ejecute las suites descritas en
[Validación](validation.md). Un healthcheck correcto no sustituye la revisión
de los datos de entrada ni de la configuración EOP.
