# Productos GNSS precisos

[Satélite](../satellite/index.md) · [Formatos espaciales](index.md) · [SP3](sp3.md) · [Importar](../user-guide/import.md)

## Visión general

Orbit importa productos GNSS precisos **descargados previamente por el
operador** mediante la ventana **Importar producto GNSS**. Un SP3 es siempre
la fuente orbital obligatoria. CLK, ERP, SUM, ATT y OSB pueden acompañarlo
como productos auxiliares versionados. El resultado es una fuente de estado
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
| [NASA CDDIS — IGS](https://cddis.nasa.gov/Data_and_Derived_Products/GNSS/orbit_and_clock_products.html) | IGS Final, Rapid y Ultra-Rapid SP3. | CLK IGS asociado cuando se aporta. | ID de proveedor `cddis_igs`, familia IGS y clase detectada. |
| [IGS MGEX](https://igs.org/mgex/data-products/) | SP3 multi-GNSS. | CLK multi-GNSS asociado. | ID `igs_mgex`; se conservan los identificadores de constelación del archivo. |
| [ESA Navigation Support Office](https://navigation-office.esa.int/GNSS_based_products.html) | Series operacionales y MGEX, por ejemplo Final, Rapid y Ultra-Rapid. | Productos CLK correspondientes cuando se aportan. | ID `esa_nso`, serie y clase detectadas desde los archivos publicados. |

Los identificadores de satélite permanecen en la forma del producto, por
ejemplo `G01`, `E11`, `C19` o `R05`. Una entrada multi-GNSS no se reduce a GPS
ni se reasigna a un NORAD.

La procedencia, la familia y la clase se determinan automáticamente a partir
de los nombres y del contenido publicado en los archivos. La ventana no ofrece
un selector manual: si no hay evidencia suficiente, Orbit registra `custom`
y/o `unknown` en vez de atribuir una calidad o un proveedor no demostrados. La
cabecera SP3 sigue siendo la autoridad para marco y escala temporal.

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

## Ventana de importación y archivos

Los seis campos de **Importar producto GNSS** son independientes. El nombre de
archivo se conserva como procedencia, pero no sustituye a la cabecera del
producto. Las extensiones de la tabla son las que acepta cada campo con nombre
de la ventana. El flujo heredado de arrastrar o seleccionar varios archivos
mantiene ZIP como compatibilidad para un conjunto SP3/CLK; el backend inspecciona
sus miembros bajo límites de seguridad. Un ZIP no sustituye ninguno de los
campos auxiliares con nombre ni evita su asociación explícita.

Por compatibilidad de API con cargas históricas, el flujo genérico también puede
reconocer SP3c/SP3d y contenedores/compresión heredados. No aparecen en los
campos con nombre ni amplían el contrato canónico de extensiones de esta
ventana.

| Campo | Obligatorio | Extensiones válidas | Papel en Orbit |
| --- | --- | --- | --- |
| **SP3 — órbitas precisas** | Sí | `.SP3`, `.SP3.gz` | Posición y, si existe, velocidad por época y satélite. Es la única fuente que crea las capas orbitales. |
| **CLK — relojes precisos** | No | `.CLK`, `.CLK.gz` | Sesgos, tasas y precisión de reloj cuando el archivo los publica. Se conserva con el SP3, sin alterar su geometría. |
| **ERP — parámetros de rotación terrestre** | No | `.ERP`, `.ERP.gz` | EOP asociados al producto. Se conserva durante la importación y una capacidad inercial futura lo validará cuando lo necesite. |
| **SUM — metadatos** | No | `.SUM`, `.SUM.gz` | Resumen o metadatos del producto; se conserva para auditoría. |
| **ATT — actitud satelital** | No | `.ATT.OBX`, `.ATT.OBX.gz`; alias `.OBX`/`.ATT` y `.gz` | Producto de actitud asociado; se conserva como procedencia, no modifica una órbita SP3. |
| **OSB — sesgos específicos de observable** | No | `.OSB.BIA`, `.OSB.BIA.gz`; alias `.BIA` y `.gz` | Sesgos de observables asociados; se conservan como producto auxiliar, no como corrección de posición. |

El flujo rechaza una importación que no tenga SP3 con el mensaje exacto:

```text
Debe proporcionar un fichero SP3.
```

CLK, SUM, ATT y OSB nunca crean una trayectoria por sí solos. ERP tampoco crea
una trayectoria: completa la trazabilidad de orientación terrestre de la
misma importación. Una carga contiene un único SP3 lógico y, como máximo, un
archivo de cada tipo auxiliar; no mezcle revisiones, fechas o centros de
análisis distintos.

### Validación dependiente de ECI

ERP es opcional en la ventana de importación actual. No hay todavía una
herramienta de comparación de propagadores ni un control de ECI en esta
ventana. Cuando exista una función que solicite convertir el producto a ECI,
la capacidad correspondiente deberá exigir ERP, una ruta de realización y
cobertura temporal válida. Si falta ERP, detendrá esa operación con:

```text
Debe proporcionar un fichero ERP para convertir a ECI.
```

No existe todavía una interfaz ni una ruta independiente de comparación de
propagadores. El contrato interno `require_eci` queda reservado como guard de
esa futura función; no forma parte del formulario de importación ni habilita
una comparación hoy.

!!! warning "No confundir el reloj con la escala temporal"

    Un producto CLK describe correcciones de reloj de satélite. `TIME_SYSTEM`
    de SP3/CLK describe cómo interpretar las épocas. El reloj no convierte GPS
    en UTC ni reemplaza la tabla local de segundos intercalares o el ERP usado
    para una transformación ITRF → ECI.

## Qué conserva Orbit

Por cada producto importado Orbit conserva, como mínimo, el nombre de archivo,
la clasificación de proveedor/producto, los satélites incluidos y los
metadatos publicados por el formato:

- sistema de coordenadas, realización terrestre y centro declarados por SP3;
- escala temporal y época de cada muestra;
- agencia, tipo orbital y cobertura de épocas cuando están disponibles;
- identificador del satélite fuente y la presencia de posiciones, velocidades
  y muestras de reloj;
- presencia, nombre, tipo y checksum de CLK, ERP, SUM, ATT y OSB cuando se
  aportan;
- proveedor, familia y clase inferidos automáticamente de las fuentes, junto
  con la evidencia disponible o el valor `custom`/`unknown` si no se puede
  demostrar una clasificación;
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

SP3 define su propio sistema de coordenadas y escala temporal. Orbit conserva
esa declaración nativa en la procedencia y sólo transforma un estado cuando
existe una ruta explícita en el servicio de marcos. No renombra de forma
silenciosa `IGS20`, `IGb20` ni `IGc20` como `ITRF`.

La ventana de importación separa el **marco nativo del archivo** de la
**capacidad de salida terrestre/inercial**. La segunda se decide por el ERP
asociado a ese producto:

| Estado de ERP y realización | Etiqueta operacional | Capacidades |
| --- | --- | --- |
| ERP asociado, usado y ruta de realización aplicada | **ITRF (con ERP aplicado)** | Se habilita SP3/ITRF → ECI; la procedencia incluye UT1, movimiento polar y los parámetros de rotación terrestre usados. |
| No | **Marco terrestre aproximado (sin ERP)** | Puede inspeccionarse la serie terrestre aproximada, pero no se afirma ITRF ni se habilita la conversión a ECI. |
| ERP asociado, pero falta una ruta de realización | Marco nativo declarado | ERP no inventa IGS→ITRF. Se conserva el diagnóstico y se bloquea ECI hasta registrar la transformación de datum correspondiente. |

Todos los módulos que muestran el marco —ficha de objeto, efemérides,
telemetría, AOS/LOS, exportación y comparación futura— deben usar la etiqueta
operacional, además de conservar el marco declarado en la cabecera SP3. La
ausencia de ERP no se oculta detrás de `ECEF`, `ITRF` ni de un nombre genérico
de escena.

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

Un estado SP3 declarado en una realización terrestre sigue siendo nativo de
esa realización. Que una escena Earth-fixed pueda dibujarlo no autoriza a
cambiar, por ejemplo, `IGS20` por `ITRF2020`. Una transformación de
realización registrada es una operación de datum distinta de la orientación de
la Tierra; el ERP tampoco la sustituye. Sin ERP, Orbit no intenta presentar
una rotación terrestre completa y usa exactamente la etiqueta **Marco
terrestre aproximado (sin ERP)**. ERP aporta orientación terrestre —UT1 y
movimiento polar, entre otros valores publicados—, pero no inventa por sí solo
una transformación de realización IGS→ITRF: esa operación de datum debe estar
registrada y aplicada antes de mostrar **ITRF (con ERP aplicado)**.

Las consultas se convierten desde la escala solicitada a la escala nativa antes
de buscar una muestra. Para una transformación ITRF → ECI reproducible hacen
falta, además de SP3/CLK, el ERP asociado, segundos intercalares y la ruta de
realización aplicable: consulte [Tiempo, EOP e ITRF](../operations/time-eop.md).

Los productos ERP no se infieren del nombre de un SP3. El operador selecciona
el archivo ERP de la misma revisión de producto y Orbit registra su hash y
cobertura. Un snapshot local de [IERS EOP 20u24 C04](time/iers-c04.md) sigue
siendo la referencia operativa independiente para el servicio general de
marcos. [IERS Bulletin A](time/bulletins.md) puede cubrir operaciones rápidas;
no se descarga ni se empareja automáticamente ninguna fuente remota.

## Flujo de importación

1. Descargue el SP3 y, si está disponible, el ERP de la misma revisión de
   producto desde CDDIS/IGS/ESA. Añada CLK, SUM, ATT u OSB solo si necesita
   conservar esos productos auxiliares.
2. Compruebe fecha, marco, `TIME_SYSTEM` y si Ultra-Rapid contiene un tramo
   predicho; Orbit derivará proveedor y clase automáticamente tras la carga.
3. En **Layers → + → Add layer → Add satellite → Importar producto GNSS**,
   seleccione el SP3 obligatorio y rellene los campos opcionales que
   correspondan. El diálogo detecta proveedor y clase desde las fuentes; no
   permite declararlos manualmente ni activa ECI durante la importación.
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
clase, SP3, productos auxiliares, cobertura, marco declarado, etiqueta
operacional, `TIME_SYSTEM`, número de muestras y resumen de reloj. Esa
información es la ficha de procedencia del archivo, no una estimación
independiente de precisión.

## Límites explícitos

- La importación no autentica ni descarga desde CDDIS Earthdata, IGS o ESA.
- La descarga remota autenticada, la renovación programada y la sincronización
  de catálogos son capacidades futuras; no quedan activadas por importar un
  archivo local.
- No se hace fusión de productos, ajuste de órbita, suavizado ni selección
  automática entre Final, Rapid y Ultra-Rapid.
- Las muestras de CLK se conservan como metadatos de reloj; no cambian la
  posición/velocidad SP3 ni se transforman en una solución de navegación.
- SUM, ATT y OSB se conservan como productos auxiliares y procedencia. No
  activan PPP, navegación, determinación de órbita, dinámica de actitud ni una
  corrección de la posición SP3.
- ERP se usa solo cuando la operación solicita ITRF → ECI. No se descarga ni
  se sustituye automáticamente por Bulletin A/B, C04 u otra revisión.
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
