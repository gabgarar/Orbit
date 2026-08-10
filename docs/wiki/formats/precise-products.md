# Productos GNSS precisos

[Satélite](../satellite/index.md) · [Formatos espaciales](index.md) · [SP3](sp3.md) · [Importar](../user-guide/import.md)

## Visión general

Orbit importa productos GNSS precisos **descargados previamente por el
operador**. Una importación puede contener una efeméride SP3 y, de forma
opcional, su producto RINEX CLK asociado. El resultado es una fuente de estado
tabulada con marco, realización terrestre, escala temporal y procedencia
explícitos.

Esta ruta sirve para inspeccionar y visualizar órbitas precisas publicadas; no
convierte el producto en un TLE ni ejecuta SGP4. La posición procede de SP3 y
el reloj no modifica la geometría de la órbita.

!!! note "Descarga externa, importación local"

    Orbit no inicia sesión, no conserva credenciales ni descarga productos de
    CDDIS, IGS o ESA por cuenta del usuario. Descargue el archivo desde su
    proveedor, verifique su fecha y después cárguelo localmente en Orbit.

## Productos que se pueden importar

El lector interpreta el contenido del producto, no una marca concreta. Por
ello la misma ruta local admite los perfiles SP3/CLK publicados por los
proveedores siguientes cuando sus cabeceras y registros cumplen el contrato
del formato.

| Distribuidor / serie | Órbita | Reloj | Uso y procedencia que conserva Orbit |
| --- | --- | --- | --- |
| [NASA CDDIS — IGS](https://cddis.nasa.gov/Data_and_Derived_Products/GNSS/orbit_and_clock_products.html) | IGS Final, Rapid y Ultra-Rapid SP3. | CLK IGS asociado cuando se aporta. | ID de proveedor `cddis_igs`, familia IGS y clase detectada o declarada. |
| [IGS MGEX](https://igs.org/mgex/data-products/) | SP3 multi-GNSS. | CLK multi-GNSS asociado. | ID `igs_mgex`; se conservan los identificadores de constelación del archivo. |
| [ESA Navigation Support Office](https://navigation-office.esa.int/GNSS_based_products.html) | Series operacionales y MGEX, por ejemplo Final, Rapid y Ultra-Rapid. | Productos CLK correspondientes cuando se aportan. | ID `esa_nso`, serie y clase indicadas por el nombre o por el operador. |

Los identificadores de satélite permanecen en la forma del producto, por
ejemplo `G01`, `E11`, `C19` o `R05`. Una entrada multi-GNSS no se reduce a GPS
ni se reasigna a un NORAD.

El selector de proveedor y clase permite conservar una procedencia declarada
por el operador. En modo automático, Orbit usa patrones de nombre de archivo
para proponer IGS/CDDIS, MGEX, ESA NSO y Final/Rapid/Ultra-Rapid; si no hay una
coincidencia, registra `custom` y/o `unknown` en vez de afirmar una calidad no
demostrada. La cabecera SP3 sigue siendo la autoridad para marco y escala
temporal.

### Calidad y latencia

Las etiquetas Final, Rapid y Ultra-Rapid describen el proceso y la latencia de
producción, no una precisión que Orbit pueda garantizar después de leer el
archivo.

| Clase | Significado operacional | Interpretación en Orbit |
| --- | --- | --- |
| Final | Producto consolidado, normalmente el de mayor calidad de la serie. | Preferible para análisis retrospectivo y reproducible, junto al archivo exacto importado. |
| Rapid | Producto disponible antes que el final. | Adecuado para operación reciente cuando el final todavía no existe. |
| Ultra-Rapid | Producto de disponibilidad muy baja; puede combinar tramo observado y tramo predicho. | Orbit conserva la procedencia del producto; el operador debe tratar el tramo predicho como tal. |

CDDIS e IGS publican la descripción y la disponibilidad de estas clases en sus
páginas de [productos de órbita y reloj](https://cddis.nasa.gov/Data_and_Derived_Products/GNSS/orbit_and_clock_products.html)
y [productos IGS](https://www.igs.org/products/). En Ultra-Rapid, el hecho de
que una muestra esté dentro de la cobertura del archivo no implica que sea una
observación: consulte la marca y documentación del producto fuente.

## Archivos y empaquetado

La importación local admite los archivos de órbita SP3 y, opcionalmente, los
archivos de reloj RINEX CLK. Los nombres pueden pertenecer al esquema largo
actual de IGS/ESA o a la nomenclatura histórica semanal de CDDIS; el nombre se
usa como ayuda de clasificación y se conserva como procedencia, pero no
sustituye a la cabecera.

| Archivo | Papel | Puede crear una capa orbital |
| --- | --- | --- |
| `*.sp3`, `*.sp3c` o `*.sp3d` (o variante reconocida por cabecera) | Posición, y velocidad cuando el producto la contiene, por época y satélite. | Sí. |
| `*.clk`, `*.clk_30s` o `*.clk_05s` | Sesgo de reloj y, si existe, tasa/precisión del reloj por época y satélite. | No; se asocia al producto SP3 de la misma importación. |
| `*.erp` | Parámetros de orientación terrestre publicados junto a algunos productos GNSS. | No; ERP no se importa ni se empareja con SP3 actualmente. |
| Cualquiera de esas extensiones con `.gz` | Variante comprimida GNU gzip. | Sí, una vez descomprimida localmente. |
| `*.zip` | Contenedor local de uno o varios SP3/CLK. | Sí, si contiene un SP3 válido. |
| `*.Z` | Compresión UNIX histórica usada por ficheros CDDIS legados. | Sí, si su contenido se descomprime y valida correctamente. |

Un CLK sin SP3 no crea una trayectoria: no contiene posiciones. Cada producto
admite exactamente **un** SP3 y, como máximo, **un** CLK lógico después de
descomprimir. Un ZIP puede transportarlos juntos, pero un ZIP que contenga dos
SP3 o dos CLK no forma una pareja ambigua: Orbit lo rechaza.

### Límites de carga y seguridad

La ruta limita la carga a ocho archivos subidos, 32 MiB por archivo y 64 MiB
en total antes de descomprimir. El conjunto descomprimido no puede superar 256
MiB. Un ZIP admite hasta 16 miembros no cifrados; no se aceptan ZIP anidados ni
rutas de archivo que salgan del archivo. Estos límites protegen el servicio de
archivos malformados o bombas de descompresión, no son una indicación de la
calidad científica del producto.

!!! warning "No confundir el reloj con la escala temporal"

    Un producto CLK describe correcciones de reloj de satélite. `TIME_SYSTEM`
    de SP3/CLK describe cómo interpretar las épocas. El reloj no convierte GPS
    en UTC ni reemplaza la tabla local de segundos intercalares o los EOP.

## Qué conserva Orbit

Por cada producto importado Orbit conserva, como mínimo, el nombre de archivo,
la clasificación de proveedor/producto, los satélites incluidos y los
metadatos publicados por el formato:

- sistema de coordenadas, realización terrestre y centro declarados por SP3;
- escala temporal y época de cada muestra;
- agencia, tipo orbital y cobertura de épocas cuando están disponibles;
- identificador del satélite fuente y la presencia de posiciones, velocidades
  y muestras de reloj;
- nombre/origen seleccionado por el operador, clase de calidad declarada o
  inferida del nombre, y nombres de miembro de archivo comprimido si aplica;
- SHA-256 del archivo subido y de cada fuente lógica descomprimida.

La procedencia acompaña a la capa y a las respuestas de importación. Orbit
guarda las fuentes verificadas y un manifest bajo `config/precise-products/`,
en un directorio direccionado por contenido; en el arranque vuelve a verificar
sus checksums antes de rehidratar el producto. Mantenga además el archivo
original y su suma de comprobación en el repositorio de datos de la misión: la
etiqueta `Final` o `Rapid` no identifica por sí sola una revisión concreta del
producto.

Los archivos fuente persistidos no se publican mediante la ruta estática
`/config/`; Orbit rechaza expresamente `config/precise-products/`. La
procedencia visible se expone por el contrato de API, no como una descarga
accidental de los binarios cargados.

## Tiempo, marcos y realización

SP3 define su propio sistema de coordenadas y escala temporal. Orbit mantiene
esas etiquetas al registrar la serie y sólo transforma un estado cuando existe
una ruta explícita en el servicio de marcos. No renombra de forma silenciosa
`IGS20`, `IGb20` ni `IGc20` como `ITRF`.

Existe una operación global publicada de datum nulo, pero es **optativa y no
predeterminada**, para estados orbitales de satélite declarados `IGS20`,
`IGb20` o `IGc20`. Para habilitarla se deben configurar conjuntamente:

```text
ORBIT_TERRESTRIAL_REALIZATION=ITRF2020
ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT=true
```

La operación conserva la realización fuente individual en la procedencia; no
es una corrección de coordenadas de estación o antena. La política histórica
exacta `ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT` no debe activarse a la vez. Las
realizaciones IGS históricas, incluido `IGS14`, permanecen diagnósticas hasta
que se registre una operación publicada explícita. Consulte [Marcos de
referencia](../engineering/reference-frames.md).

La importación no disfraza este límite. Si no hay una ruta desde la realización
del SP3 hasta la ITRF de salida activa, la ficha de producto informa que el
renderizado terrestre no está disponible y expone el diagnóstico de marco; las
operaciones que necesitan ese estado terrestre, como una vista ITRF o AOS/LOS,
deben configurarse con una ruta válida en lugar de asumir una conversión.

Un estado SP3 declarado en una realización terrestre sigue siendo un estado
nativo de esa realización. Que una escena Earth-fixed pueda dibujarlo no
autoriza a cambiar, por ejemplo, `IGS20` por `ITRF2020`. Una transformación de
realización registrada es una operación de datum distinta de la orientación de
la Tierra. Si Orbit crea desde una ruta inercial una vista con UTC≈UT1 y EOP
nulos, la UI debe mostrar **terrestre aproximada (sin EOP)**; no es una salida
ITRF rigurosa ni un resultado de precisión para AOS/LOS o exportación.

Las consultas se convierten desde la escala solicitada a la escala nativa antes
de buscar una muestra. Para una transformación terrestre reproducible hacen
falta, además del SP3/CLK, los datos de tiempo y orientación terrestre
apropiados: consulte [Tiempo, EOP e ITRF](../operations/time-eop.md).

Los productos ERP y los EOP rápidos no se infieren del nombre de un SP3. La
referencia operativa actual es un snapshot local de [IERS EOP 20u24 C04](time/iers-c04.md)
con su versión y hash. [IERS Bulletin A](time/bulletins.md) y ERP IGS son rutas
futuras: no hay lector, descarga ni emparejamiento automático en esta
importación.

## Flujo de importación

1. Descargue un SP3 y, si es necesario para su análisis, el CLK de la misma
   serie desde CDDIS/IGS/ESA.
2. Compruebe proveedor, fecha, clase (Final/Rapid/Ultra-Rapid), marco,
   `TIME_SYSTEM` y si Ultra-Rapid contiene un tramo predicho.
3. En **Layers → + → Add layer → Add satellite → Import precise GNSS (SP3 /
   CLK)**, seleccione el SP3, SP3c o SP3d y añada el CLK opcional en la misma
   operación. Puede aportar los ficheros comprimidos admitidos directamente.
   El diálogo permite aceptar la detección o declarar proveedor y clase.
4. Revise el resumen de procedencia y las capas creadas por identificador de
   satélite. Una capa representa la efeméride tabulada, no un objeto TLE.
5. Orbit alinea la línea temporal simulada a la cobertura común publicada.
   Mantenga cualquier consulta posterior dentro de las épocas importadas.

La carga es local y se registra de forma durable en el almacén de productos
precisos de Orbit. El runtime se rehidrata al reiniciar a partir de ese registro
y un proyecto puede referenciar identificadores estables del producto; el
binario fuente no se copia dentro de cada documento de proyecto. Esta ruta no
es una sincronización automática del catálogo remoto.

En el panel de objeto, la pestaña de entrada del producto muestra proveedor,
clase, SP3/CLK, cobertura, marco, `TIME_SYSTEM`, número de muestras y resumen
de reloj. Esa información es la ficha de procedencia del archivo, no una
estimación independiente de precisión.

## Límites explícitos

- La importación no autentica ni descarga desde CDDIS Earthdata, IGS o ESA.
- La descarga remota autenticada, la renovación programada y la sincronización
  de catálogos son capacidades futuras; no quedan activadas por importar un
  archivo local.
- No se hace fusión de productos, ajuste de órbita, suavizado ni selección
  automática entre Final, Rapid y Ultra-Rapid.
- Las muestras de CLK se conservan como metadatos de reloj; no cambian la
  posición/velocidad SP3 ni se transforman en una solución de navegación.
- No se aceptan ni se emparejan ficheros ERP, Bulletin A o Bulletin B con el
  SP3. Esos productos requieren una futura ruta de EOP local, versionada y
  auditable.
- Orbit interpola cada serie SP3 con una ventana Lagrange local de hasta diez
  muestras (grado 9); con menos registros degrada explícitamente al mayor
  grado disponible. Esa política acotada no sustituye la estrategia de
  interpolación, los estándares de precisión ni los productos auxiliares del
  proveedor.
- La cobertura temporal es finita: una consulta fuera de las épocas SP3 se
  rechaza en lugar de extrapolar una órbita precisa.
- La importación de producto preciso no implementa RINEX de observaciones,
  PPP, determinación de órbita, clock steering ni estimación de sesgo.

## API y referencias

La interfaz usa `POST /api/precise-products/import`; el endpoint, contrato de
carga y respuestas se documentan en [API de productos precisos](../integrations/rest-api/orbit-operations.md#productos-gnss-precisos).
Para el contrato de registros SP3, consulte [SP3](sp3.md).

Fuentes de producto:

- [CDDIS: IGS orbit and clock products](https://cddis.nasa.gov/Data_and_Derived_Products/GNSS/orbit_and_clock_products.html)
- [IGS: Products](https://www.igs.org/products/)
- [IGS: MGEX data products](https://igs.org/mgex/data-products/)
- [ESA Navigation Support Office: GNSS-based products](https://navigation-office.esa.int/GNSS_based_products.html)
- [IERS EOP 20u24 C04](https://datacenter.iers.org/products/eop/long-term/c04_20u24/)
- [IERS Bulletin A](https://maia.usno.navy.mil/products/bulletin-a)
