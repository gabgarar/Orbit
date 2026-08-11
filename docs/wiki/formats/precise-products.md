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

### Lectura técnica por fichero

En esta sección, **leer** significa que Orbit interpreta los registros y los
convierte a su contrato interno; **conservar** significa que almacena el
archivo, su tipo, nombre, tamaño, compresión/origen de archivo y SHA-256 para
procedencia, sin pretender que sus valores ya participen en el cálculo
orbital. Esta distinción es importante: los seis campos pertenecen al mismo
producto GNSS, pero sólo SP3 aporta una trayectoria cartesiana.

#### SP3 — órbitas precisas (obligatorio)

| Parte del SP3 | Parámetros y unidades de fuente que lee Orbit | Uso, persistencia y efecto visible |
| --- | --- | --- |
| Cabeceras `#`, `##`, `+` y `%c` | Versión; tipo de registro `P`/`V`; época inicial; número de épocas; intervalo nominal; lista y número de satélites; datos usados; sistema de coordenadas; tipo orbital; agencia; y `TIME_SYSTEM`. | Valida el producto y conserva esos metadatos como marco nativo, realización, agencia y escala temporal. Una escala no reconocida no se convierte silenciosamente a UTC: se rechaza al construir la fuente de estados. |
| Época y posición | Línea `*` seguida de `P<id> X Y Z [clock]`. `X`, `Y`, `Z` están en **km**. | Cada posición no ausente crea una muestra del satélite GNSS indicado y, tras confirmar la selección, una capa SP3. Las posiciones se normalizan a **m**; son la fuente de la órbita, el globo 2D/3D, ground track, distancia y AOS/LOS. |
| Velocidad | `V<id> VX VY VZ [clock-rate]`; `VX`, `VY`, `VZ` están en **dm/s**. | Si existe, se normaliza a **m/s** y acompaña al estado tabulado. No se inventa una velocidad cuando el fichero no la publica. |
| Reloj embebido | Cuarta componente de `P`: sesgo de reloj en **µs**. Cuarta componente de `V`: tasa en **10⁻⁴ µs/s**. | Se convierte a segundos y segundos/segundo y aparece como resumen/procedencia de reloj. No cambia posición, velocidad, marco, escala de tiempo, distancia ni visibilidad. |

El centinela SP3 de componente ausente (`abs(valor) >= 999999`) y una posición
`P` completa `(0, 0, 0)` son estados ausentes legales: se contabilizan para
validar la estructura, pero no se convierten en una muestra cartesiana ni se
dibujan como coordenadas terrestres. No deben confundirse con un fichero
malformado. Un vector de posición o velocidad no numérico, vacío, `NaN` o
infinito sí hace fallar la importación. La cuarta componente de reloj es
opcional; cuando se publica, debe ser numérica y finita. También fallan los
registros `P`/`V` duplicados para la misma época y satélite. Los indicadores de precisión, correlación, eventos y
registros extendidos que algunos SP3 publican no se convierten en una
covarianza ni en una corrección de la órbita en esta ruta.

Orbit interpola cada serie elegida con una ventana Lagrange local de hasta diez
muestras (grado 9), degradando al máximo grado disponible si la serie es más
corta. Nunca extrapola fuera de las épocas SP3. Durante la prevalidación
reconstruye cada nudo utilizable y exige un error por componente estrictamente
menor que **`1e-9 m`**; además evalúa el punto medio de cada intervalo usable
para descartar una interpolación no finita o mal condicionada. En esos puntos
exige constante de Lebesgue `≤ 512` y magnitud relativa del denominador
baricéntrico `≥ 1e-5`, límites numéricos de protección y no una cota de
precisión del proveedor.
Una serie de una sola época es una consulta exacta sin intervalo interpolable,
por lo que no pretende usar grado 9. El archivo fuente, su cabecera, las muestras interpretadas y su
checksum quedan vinculados al producto y a la ficha de cada satélite.

#### CLK — relojes precisos (opcional)

| Parte del CLK RINEX | Parámetros y unidades de fuente que lee Orbit | Uso, persistencia y efecto visible |
| --- | --- | --- |
| Cabecera | `RINEX VERSION / TYPE`, `TIME SYSTEM ID` y agencia de `PGM / RUN BY / DATE`. | Conserva versión, tipo, agencia y escala temporal declarada. Si no se declara una escala, no presupone UTC ni desplaza épocas SP3. |
| Registro de satélite `AS` | Identificador GNSS, época, número de valores y, en orden: sesgo (**s**), sigma de sesgo (**s**), deriva (**s/s**), sigma de deriva (**s/s**), tasa de deriva (**s/s²**) y su sigma (**s/s²**) cuando están presentes. | Agrupa las muestras por satélite como información de reloj y muestra cobertura/resumen en la ficha de producto. Las conserva junto a SP3, pero no altera la geometría, la interpolación orbital, el render, AOS/LOS ni una conversión de escala temporal. |

Los registros RINEX `AR`, `CR` y `DR`, así como continuaciones que sólo
contengan diagnósticos adicionales, no se modelan todavía como datos de
satélite. Un CLK no crea capas sin SP3 y no es una solución de navegación,
PPP ni *clock steering*.

#### ERP — parámetros de rotación terrestre (opcional; condicional para ECI)

Orbit interpreta tablas **IGS ERP v2** que declaren las cinco columnas
obligatorias siguientes. Puede reconocer las grafías habituales de cada
cabecera (`Xpole`/`Xp`, `Ypole`/`Yp`, `UT1-UTC`/`UT1R-UTC` y `LOD`/`LODR`).

| Columna ERP | Unidad esperada en el ERP IGS v2 | Conversión y uso en Orbit |
| --- | --- | --- |
| `MJD` | días | Se convierte a la época UTC de cada muestra y define la cobertura finita del ERP. |
| `Xpole`, `Ypole` | microsegundos de arco (**µas**) | Se convierten a radianes como `xp` e `yp` para la orientación polar de la Tierra. |
| `UT1-UTC` o `UT1R-UTC` | décimas de microsegundo (**0,1 µs**) | Se convierte a segundos como DUT1. Es necesario para la rotación terrestre reproducible. |
| `LOD` o `LODR` | décimas de microsegundo (**0,1 µs**) | Se convierte a segundos y se conserva como longitud del día. |

El ERP se persiste con su cobertura, número de muestras, origen, versión y
snapshot/checksum. Orbit interpola linealmente sus muestras dentro de esa
cobertura y no las extrapola. El lector ERP v2 actual no toma `dX`/`dY` de un
archivo ERP: los deja explícitamente a cero, por lo que no sustituye un
producto IERS C04 de correcciones celestes.

Para una consulta SP3 terrestre → ECI hacen falta **a la vez**: ERP con
cobertura en la época solicitada, una tabla de segundos intercalares que pueda
convertir la escala de tiempo declarada, una ruta de realización terrestre
válida y ERFA/SOFA (`pyerfa`) con IAU 2006/2000A. Si faltan, Orbit bloquea la
conversión; el respaldo GMST de la vista no se reutiliza como resultado GNSS
preciso. ERP no crea por sí solo una transformación de datum como
IGS20 → ITRF2020. Sin ERP, la capa puede inspeccionarse en su marco terrestre
nativo, pero se etiqueta **Marco terrestre aproximado (sin ERP)** y se bloquea
la conversión a ECI. Adjuntar ERP no cambia por sí mismo la posición SP3 ni
crea una nueva órbita; habilita y documenta la orientación terrestre usada.

#### SUM — resumen y metadatos (opcional)

Orbit **no interpreta todavía campos internos de SUM**. Conserva el fichero
como compañero inmutable del SP3 —nombre, tipo, tamaño, procedencia y SHA-256—
y expone su presencia en la ficha y el manifest. No se derivan de él posición,
velocidad, reloj, calidad numérica, marco, render ni capacidad ECI. Por ello,
un SUM sirve hoy para auditoría y para mantener juntos los metadatos publicados
por el proveedor, no para sobrescribir la cabecera SP3.

#### ATT / OBX — actitud satelital (opcional)

El campo acepta productos de actitud publicados como `ATT.OBX`, `OBX` o `ATT`
compatibles. Orbit identifica y conserva el archivo asociado, pero **no decodifica
aún sus parámetros de actitud**: cuaterniones, ángulos *yaw/pitch/roll*,
maniobras, centro de fase de antena o banderas de actitud no pasan a un estado
de actitud interno. Por tanto, no modifica el dibujo de la órbita ni genera
un cono de apuntado, una huella de antena o una corrección de enlace. Su valor
actual es trazabilidad del producto exacto utilizado.

#### OSB / BIA — sesgos por observable (opcional)

El campo acepta `OSB.BIA` y alias BIA compatibles. Orbit conserva su presencia
y checksum, pero **no interpreta todavía** códigos de observable, intervalos de
validez, sesgos, desviaciones estándar o unidades de fase/código del BIA. No
aplica los sesgos al CLK, SP3, rango, AOS/LOS, SNR ni a una solución PPP. Como
SUM y ATT, se mantiene para procedencia y para que una futura cadena de
observaciones pueda usar exactamente el producto auxiliar seleccionado.

#### Límites comunes de carga y conservación

- Un producto lógico admite un SP3 obligatorio y, como máximo, un CLK, ERP,
  SUM, ATT y OSB; el backend mantiene un límite absoluto de ocho ficheros para
  compatibilidad con cargas archivadas.
- Cada fichero cargado está limitado a **32 MiB** y el conjunto binario a
  **64 MiB**; el servicio HTTP reserva **90 MiB** para el JSON codificado en
  base64. Tras descomprimir, el total no puede superar **256 MiB**.
- `.gz` se descomprime bajo ese límite. Los ZIP son una compatibilidad para
  conjuntos heredados: máximo 16 miembros, sin ZIP cifrado ni ZIP anidado, y
  cada miembro conserva su nombre de archivo seguro y su hash.
- SP3, CLK y ERP se vuelven a interpretar al rehidratar el producto. SUM, ATT
  y OSB se vuelven a verificar como fuentes persistidas, pero no adquieren una
  semántica nueva sólo por reiniciar Orbit.

### Puerta de seguridad antes de persistir

**Previsualizar satélites** e **Importar** ejecutan la misma prevalidación
estricta del SP3 antes de crear una capa, un ID de runtime, un manifest o un
directorio bajo `config/precise-products/`. La previsualización nunca persiste;
la importación sólo llega a persistir cuando todas las comprobaciones pasan.
Un fallo devuelve `422`, muestra el detalle en un cuadro de diálogo y no deja
un producto parcialmente registrado.

| Área | Comprobaciones que deben pasar |
| --- | --- |
| Archivo y cabecera | El contenido debe poder decodificarse bajo los límites de carga; la cabecera principal `#` debe ser válida, declarar una época inicial y un número positivo de épocas, debe existir una única línea `##` con cadencia positiva y finita, y las líneas `+` deben declarar una lista única cuyo tamaño coincida con su contador. |
| Tabla de épocas | Debe haber exactamente el número de épocas declarado; la primera coincide con la cabecera, las épocas son estrictamente crecientes y cada intervalo coincide con `##` con una tolerancia de **2 µs** de redondeo. Cada época debe contener un registro `P` de cada satélite declarado, sin miembros inesperados ni duplicados. Un estado ausente legal sigue contando como registro de ese miembro. |
| Valores numéricos | Los vectores de coordenadas y velocidad deben estar completos, ser numéricos y finitos. La cuarta componente de reloj es opcional, pero si se publica también debe ser numérica y finita. Los vectores vacíos, `NaN`, `Inf` o un identificador de satélite inválido se rechazan en lugar de convertirse en una geometría o una fecha aproximada. |
| Tiempo | `TIME_SYSTEM` se conserva y debe ser una escala reconocida. Orbit convierte explícitamente la cobertura SP3 a UTC con su tabla local de segundos intercalares; no interpreta una época GPS, TAI u otra escala como si fuera UTC. Si la tabla no puede representar la época, el producto se rechaza en vez de introducir un desfase silencioso de un segundo. |
| Interpolación | Cada serie con dos o más muestras usa Lagrange local de grado `min(9, N−1)`. La prevalidación reproduce todos los nudos utilizables con error `< 1e-9 m`; en el punto medio de cada intervalo exige una posición finita, constante de Lebesgue `≤ 512` y magnitud relativa del denominador baricéntrico `≥ 1e-5`. Son límites de estabilidad numérica, no una garantía de precisión del proveedor. No existe extrapolación fuera de cobertura. |

Los centinelas oficiales de estado ausente se informan por separado de las
muestras utilizables. Por ejemplo, no convierten un `P 0 0 0` o un valor
`999999…` en una órbita en el centro de la Tierra ni hacen que un SP3 por lo
demás válido se confunda con un archivo corrupto. El producto requiere al
menos un estado utilizable para poder ofrecer satélites seleccionables.

Una respuesta satisfactoria expone el informe de paso en
`product.sp3_validation`: contador y miembros de cabecera, número/cadencia de
épocas, estados utilizables/ausentes y el contrato de interpolación. El informe
no es una estimación de precisión del proveedor; acredita únicamente las
invariantes de lectura que Orbit ha podido verificar.

!!! warning "Límite de la validación temporal"

    La comprobación GPS/TAI/GAL/BDT ↔ UTC valida la conversión configurada de
    Orbit y la cobertura de su snapshot de segundos intercalares. Ese snapshot
    y su procedencia forman parte de la frontera de confianza: Orbit no puede
    demostrar por sí solo que un proveedor etiquetó correctamente
    `TIME_SYSTEM`, ni detectar una tabla local obsoleta si aún cubre la fecha.
    El operador debe mantener y auditar la fuente de segundos intercalares;
    consulte [Tiempo, EOP e ITRF](../operations/time-eop.md).

    Una importación terrestre normal puede usar la tabla integrada de Orbit, de
    vigencia abierta. En ese caso se admite el producto, pero la respuesta marca
    `time_validation.leap_seconds.external_freshness` como `unverified`: no se
    afirma que la relación UTC sea verificable externamente para esa fecha.

### Validación dependiente de ECI

ERP sigue siendo opcional para una importación terrestre normal, pero **todo
ERP que se adjunte se valida** antes de persistirlo: MJD finito y válido,
épocas en orden cronológico estricto sin duplicados, y valores físicos
plausibles. Los límites de protección son `|xp|, |yp| ≤ 1 arcsec`,
`|UT1−UTC| ≤ 0,5 s` y `|LOD| ≤ 0,010 s`. Son límites de cordura para detectar
un fichero corrupto o una unidad mal interpretada; no son una garantía de
precisión ni sustituyen el control de calidad del centro de análisis.

La interfaz actual no activa ECI durante la importación, pero el contrato de
servicio `require_eci=true` ya es una puerta estricta para la función que lo
solicite. Exige ERP, cobertura ERP completa del subconjunto SP3 elegido, una
ruta de realización terrestre registrada y `pyerfa`/SOFA para la reducción
IAU 2006/2000A. Además exige un snapshot **local** de segundos intercalares
con versión, SHA-256 y horizonte de validez publicado por su emisor, no
caducado y que cubra toda la ventana SP3 seleccionada. Una tabla integrada o
abierta no satisface esta garantía de alto rigor. Si falta ERP, esa operación
se detiene con:

```text
Debe proporcionar un fichero ERP para convertir a ECI.
```

En una consulta ECI puntual, la época solicitada también debe estar cubierta
por el ERP y por el snapshot local de segundos intercalares verificado. La ruta
usa `xp`/`yp` para el movimiento polar, `UT1−UTC` para UTC→UT1 y el ángulo de
rotación terrestre, y la precesión/nutación IAU 2006/2000A de ERFA/SOFA. El
modelo GMST de respaldo de visualización nunca se presenta como una conversión
GNSS precisa. Una órbita SP3 ligada al producto tampoco admite que el llamador
inyecte un `EarthOrientation` explícito: sólo puede usar el ERP registrado con
ese producto. Como comprobación matemática, la matriz de rotación debe ser
ortonormal (`RᵀR = I`), tener determinante `+1` y conservar la norma de posición
(`|r_ITRF| ≈ |r_ECI|`); cualquier fallo bloquea la conversión.

No existe todavía una interfaz ni una ruta independiente de comparación de
propagadores, ni métricas de error medio/umbral. Esta puerta sólo evita que
una futura comparación solicite ECI sin los datos y el modelo necesarios; no
declara que Orbit ya compare propagadores ni valida la exactitud científica
del producto frente a otra efeméride.

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
| ERP asociado, ruta de realización disponible, ERFA/SOFA disponible y cobertura ERP coincidente | **ITRF (con ERP aplicado)** | La etiqueta sólo cubre las épocas solapadas. La conversión completa del subconjunto SP3 exige que ERP cubra toda su ventana; la procedencia incluye UT1, movimiento polar y el modelo IAU 2006/2000A usado. |
| No | **Marco terrestre aproximado (sin ERP)** | Puede inspeccionarse la serie terrestre aproximada, pero no se afirma ITRF ni se habilita la conversión a ECI. |
| ERP asociado, pero falta cobertura, ruta de realización o ERFA/SOFA | Marco nativo declarado | ERP no inventa IGS→ITRF y un modelo visual no sustituye IAU 2006/2000A. Se conserva el diagnóstico y se bloquea ECI hasta cumplir todas las condiciones. |

Todos los módulos que muestran el marco —ficha de objeto, efemérides,
telemetría, AOS/LOS, exportación y comparación futura— deben usar la etiqueta
operacional, además de conservar el marco declarado en la cabecera SP3. La
ausencia de ERP no se oculta detrás de `ECEF`, `ITRF` ni de un nombre genérico
de escena.

Orbit habilita por defecto en el despliegue Compose la operación global
publicada de datum nulo para estados orbitales de satélite declarados `IGS20`,
`IGb20` o `IGc20`. La política usa:

```text
ORBIT_TERRESTRIAL_REALIZATION=ITRF2020
ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT=true
```

Un operador puede desactivarla explícitamente con
`ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT=false`. No es un relabelado:
la operación y la realización fuente permanecen en la procedencia.

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
4. Pulse **Previsualizar satélites**. Orbit analiza el producto sin persistirlo
   y muestra una tabla de identificador GNSS, constelación, cobertura y
   muestreo. Marque el subconjunto que va a usar o **Seleccionar todos**;
   cancelar no crea ninguna capa.
5. Confirme **Importar N satélites**. Sólo los miembros elegidos se registran
   y cada capa representa una efeméride tabulada, no un objeto TLE.
6. Orbit alinea la línea temporal simulada a la cobertura común publicada.
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
