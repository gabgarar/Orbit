# SP3

[Satélite](../satellite/index.md) · [Formatos espaciales](index.md) · [Productos GNSS precisos](precise-products.md) · [Marcos de referencia](../engineering/reference-frames.md)

## Visión general

SP3 es un formato tabulado de órbitas GNSS precisas. Orbit lo usa como una
fuente de estados por época y satélite, no como un conjunto de elementos
keplerianos, un TLE ni un modelo de fuerzas configurable.

Un SP3 importado crea una fuente de efeméride para cada identificador de
satélite contenido en el archivo. Puede acompañarse de CLK, ERP, SUM, ATT y
OSB; las coordenadas y la velocidad siguen procediendo exclusivamente de SP3.

Para proveedores, clases Final/Rapid/Ultra-Rapid, MGEX, compresión y flujo de
importación, consulte [Productos GNSS precisos](precise-products.md).

## Cabecera y contrato de metadatos

Orbit exige una cabecera SP3 significativa que empieza por `#` —distinta de
`##`— y que contiene los campos estructurales necesarios. Conserva los
siguientes metadatos en lugar de inferirlos del nombre de archivo:

| Campo | Uso en Orbit |
| --- | --- |
| Versión SP3 y tipo de registro | Valida que la serie contiene posiciones (`P`) o posiciones/velocidades (`V`). |
| Época inicial y número de épocas | Delimita la cobertura de la serie. |
| Tipo orbital y agencia | Procedencia declarada por el producto. |
| Sistema de coordenadas | Marco nativo de los estados. |
| `TIME_SYSTEM` de `%c` | Escala temporal nativa de las épocas. |
| Lista de satélites | Determina las capas/series que se pueden seleccionar. |

Las realizaciones `IGS20`, `IGb20` e `IGc20` se conservan como familia `IGS`
con realización explícita. No se renombran como ITRF ni como una etiqueta
genérica `ECEF`.

## Registros de estado

Las épocas se introducen mediante líneas `*`. Los registros `P` y `V` se
asocian por época e identificador de satélite.

| Registro | Unidades de fuente | Conversión interna |
| --- | --- | --- |
| `P` | km | posición en m. |
| `V` | dm/s | velocidad en m/s. |

El centinela de componente ausente (`abs(valor) >= 999999`) no se interpreta
como una coordenada válida. Los registros duplicados del mismo tipo, época y
satélite se rechazan: una serie tabulada no puede tener dos valores diferentes
para la misma muestra.

La cuarta columna de un registro SP3 corresponde al reloj en el formato fuente.
Orbit la conserva como metadato de reloj cuando está disponible; no se usa para
modificar la posición, velocidad, marcos, escalas temporales ni la geometría de
visibilidad.

## Selección e interpolación

Un archivo SP3 puede incluir muchos satélites. La consulta exige
`satellite_id` salvo cuando la serie contiene exactamente uno. Cada satélite usa
una serie `TabularStateProvider` con interpolación Lagrange local y acotada. La
ventana usa como máximo diez muestras (grado 9) y, si el fichero contiene menos
registros, degrada de forma explícita al mayor grado disponible (`n - 1`). Por
ejemplo, una serie de dos épocas conserva un polinomio de grado 1; no se
presenta como una interpolación precisa de orden alto.
Una serie con una única época solo admite la consulta exacta de esa muestra.

Una consulta se convierte desde la escala solicitada a la escala nativa antes
de buscar e interpolar. Por ejemplo, una serie GPS mantiene sus épocas GPS en
sus metadatos aunque una petición se formule en UTC.

!!! warning "La interpolación de Orbit no sustituye la del proveedor"

    La calidad publicada por IGS o ESA pertenece a sus muestras y a su cadena
    de producción. Orbit aplica una ventana Lagrange local de hasta grado 9,
    pero no reproduce la estrategia completa del centro de análisis ni sus
    productos auxiliares. Use una cadencia adecuada, no consulte fuera de
    cobertura y documente los EOP, leap seconds y la transformación empleada
    antes de atribuir precisión geodésica al resultado.

## Tiempo, marco y realización

`native_state_at` devuelve el estado en el marco y escala declarados por el
archivo. Solicitar ITRF para un SP3 de la familia IGS exige una transformación
de realización registrada. Orbit no renombra implícitamente `IGS20`, `IGb20`
ni `IGc20`.

La alineación global publicada para esa familia es optativa: requiere
`ORBIT_TERRESTRIAL_REALIZATION=ITRF2020` y
`ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT=true`. Sólo se aplica a estados
orbitales geocéntricos de satélite y conserva la etiqueta de realización
fuente. No transforma estaciones ni antenas. La política histórica exacta
`ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT` es incompatible con la política de
familia; `IGS14` y otras realizaciones históricas necesitan su propia operación
publicada. Consulte [Marcos de referencia](../engineering/reference-frames.md).

La transformación de un estado terrestre requiere los datos auxiliares
pertinentes. Para una ejecución reproducible, cargue los productos de tiempo y
EOP locales indicados en [Tiempo, EOP e ITRF](../operations/time-eop.md).

El marco nativo y una vista terrestre no son la misma afirmación. Una
coordenada SP3 declarada `IGS20` sigue siendo `IGS20` aunque el visor pueda
colocarla sobre el globo; no se presenta como `ITRF` sin una operación de
realización fuente→ITRF registrada. Si una ruta inercial genera una vista
terrestre con UTC≈UT1 y EOP nulos, el resultado se etiqueta **terrestre
aproximada (sin EOP)**, no ITRF. Una salida ITRF reproducible requiere la ruta
explícita, segundos intercalares y EOP versionados —DUT1, `xp`, `yp` y, para la
reducción moderna, `dX`/`dY`—.

## Productos asociados

La ventana **Importar producto GNSS** acepta productos auxiliares asociados a
un único SP3. CLK aporta sesgos de reloj; SUM aporta metadatos; ATT conserva la
actitud publicada; y OSB conserva sesgos específicos de observable. Ninguno
crea una órbita ni modifica las posiciones y velocidades de SP3.

ERP es distinto: aporta UT1 y movimiento polar para una solicitud inercial. La
conversión ITRF → ECI y la etiqueta **ITRF (con ERP aplicado)** exigen además
una ruta de realización aplicada; ERP no inventa IGS→ITRF. Sin ERP, no se
afirma una transformación terrestre completa y se etiqueta **Marco terrestre
aproximado (sin ERP)**. Solicitar ECI sin ese ERP se rechaza con `Debe
proporcionar un fichero ERP para convertir a ECI.`

Para los formatos de cada campo y la validación del SP3 obligatorio, consulte
[Productos GNSS precisos](precise-products.md).

## Límites

- No hay exportación SP3/CLK ni generación de productos precisos por Orbit.
- No hay descarga autenticada desde CDDIS Earthdata ni sincronización remota
  de IGS/MGEX/ESA; la entrada es un archivo local.
- No se fusionan productos ni se deduce cuál de Final, Rapid o Ultra-Rapid es
  preferible para una misión concreta.
- Una escala temporal no reconocida se conserva al leer metadatos, pero se
  rechaza al construir un proveedor de estados convertible.
- No se inventa una transformación entre realizaciones terrestres.
