# Operación de tiempo, EOP e ITRF

[Inicio](../index.md) · [Operación](index.md) · [Configuración](configuration.md)

Orbit trata tiempo, orientación terrestre y realización como contratos
explícitos. Ninguna propagación ni transformación descarga productos de tiempo.
El runtime puede actualizar una caché operativa genérica en segundo plano al
arrancar; las rutas científicas estrictas siguen identificando snapshots locales
y cada revisión usada.

## Fuentes automáticas IERS: C01 y finals2000A

Cuando no se ha configurado un snapshot reproducible `ORBIT_EOP_C04_PATH`, el
monitor de salud intenta cargar el producto oficial
[IERS EOP_C01_IAU2000_1846-now](https://datacenter.iers.org/data/latestVersion/EOP_C01_IAU2000_1846-now.txt).
Su caché mutable está en:

```text
./data/erp/EOP_C01_IAU2000_1846-now.txt
```

El monitor valida primero la copia local. Si falta, su fecha de modificación
supera siete días **o ya no cubre el instante que se está comprobando**,
descarga el fichero por HTTPS, lo valida completamente y lo reemplaza de forma
atómica. Así una descarga reciente pero publicada con una cobertura antigua no
se presenta como EOP vigente. El inicio y `/health` no esperan esa descarga:
el visor conserva una rotación nominal mientras el monitor trabaja.

La validación exige fichero no vacío, cabecera C01 `COMB EARTH ROTATION DATA`,
columnas `MJD`, `PM-X`, `PM-Y`, `UT1-TAI`, `dX`, `dY` y `LOD`, épocas
ordenadas y valores finitos dentro de envolventes físicas. C01 publica
`UT1-TAI`, que Orbit convierte a `UT1-UTC` con la tabla local de segundos
intercalares; no se interpreta como si fuera un C04. `PM-X`, `PM-Y`, `dX` y
`dY` se convierten de segundos de arco a radianes; `LOD` ya viene en segundos.
La sonda de ejemplo comprueba el valor nominal `|LOD| < 1 ms`; el parser usa
además una envolvente de corrupción de ±10 ms para no rechazar por diseño una
serie combinada/histórica IERS legítima. Ese límite operativo no cambia la
política más restrictiva del ERP adjunto a un producto.

- Si IERS falla pero existe una copia validada, Orbit conserva esa copia y
  publica **Warning** con su antigüedad y su límite de cobertura como hechos
  separados.
- Si C01 no cubre una etapa, Orbit puede continuar con el siguiente producto
  automático descrito abajo; nunca presenta esa transición como si C01 siguiera
  vigente.
- El archivo está fuera de la imagen Docker y se monta como volumen `./data`;
  así sobrevive a un reinicio sin convertirse en parte de una release.

Esta caché es una orientación global operativa, no un sustituto de un ERP de
producto ni una autorización implícita para ECI estricto. Un C04 explícito
tiene prioridad y nunca se reemplaza automáticamente. Un ERP adjunto a un
SP3 continúa siendo su propia fuente, cobertura y procedencia.

### Puente rápido oficial y límites de calidad

Cuando C01 no llega a una época solicitada, Orbit consulta además el producto
oficial IERS Rapid Service / Prediction Centre
[`finals2000A.all`](https://datacenter.iers.org/products/eop/rapid/standard/finals2000A.all).
Se descarga exclusivamente por HTTPS desde el Data Center de IERS, se valida
antes de activarse y se guarda como caché operativa separada. Una propagación,
transformación o cálculo de pases nunca inicia una descarga: el monitor de
inicio/diagnóstico es el único que actualiza estas cachés.

La ruta por defecto es `./data/erp/finals2000A.all`; un despliegue puede fijar
otra ruta montada mediante `ORBIT_FINALS2000A_CACHE_PATH`. Igual que C01, son
bytes operativos mutables fuera de un proyecto y de la imagen de release.

`finals2000A.all` es ASCII diario con EOP desde 1973 y la realización
IAU 2000A (`dX`/`dY`). Sus banderas son parte del dato: `I` identifica la
determinación IERS/Bulletin A disponible para ese parámetro y `P` una predicción
de Bulletin A. El fichero también contiene columnas de Bulletin B. Orbit marca
una tupla Bulletin B completa como `final` (**LOD sigue siendo Bulletin A u
opcional**); si no existe, una tupla Bulletin A con todas las banderas `I` es
`rapid` y una con alguna `P` es `predicted`.
Por ello no denomina «final» a toda la tabla ni convierte una predicción en una
medida. `LOD` no se inventa si su campo está vacío.

IERS publica normalmente predicciones de Bulletin A de hasta aproximadamente un
año, pero Orbit usa únicamente las filas que el snapshot realmente contiene y
valida; no presupone un horizonte de 365 días ni convierte ese horizonte
editorial en una garantía de precisión.

La selección automática se evalúa para **cada época**, en este orden, y conserva
la procedencia de cada tramo:

| Tramo disponible | Fuente que se usa | Etiqueta y garantía |
| --- | --- | --- |
| La época está dentro de la cobertura validada C01. | `EOP_C01_IAU2000`. | EOP combinado C01; su fin es un límite factual de la copia concreta. |
| C01 no cubre la época y `finals2000A.all` tiene todos los parámetros utilizables. | `finals2000A.all`. | Calidad `final` (tupla Bulletin B completa; LOD Bulletin A/opcional), `rapid` (Bulletin A `I`) o `predicted` (alguna `P`), indicada de forma explícita. Una predicción no es una observación ni un ERP de producto. |
| La época queda después del último dato utilizable de ambos productos automáticos, pero no más de 30 días después del fin de finals. | Extrapolación lineal local desde las dos últimas muestras utilizables de `finals2000A.all`. | **Extrapolada**: no es IERS, no es ERP válido ni habilita una ruta científica estricta. |
| Más de 30 días después del fin utilizable de finals, o sin dos muestras compatibles. | No hay EOP automático. | `UTC≈UT1 visual fallback` con calidad `approximate`; una ruta estricta se rechaza y no se inventa una pendiente. |

No existe una fecha fija para esos cambios: dependen de las muestras validadas
que haya en las dos cachés. La cola lineal está limitada de forma dura a **30
días** desde el fin usable de `finals2000A.all`. Si se supera ese horizonte o
faltan dos muestras compatibles, Orbit no inventa una pendiente; la vista
degrada a rotación nominal y las operaciones estrictas se rechazan según su
contrato.

La extrapolación lineal es un recurso operativo claramente señalado, no una
predicción oficial de IERS. No reemplaza un C04 configurado, un ERP adjunto a
SP3 ni un ERP manual; tampoco hace válida una conversión ECI/ITRF que exige un
snapshot reproducible. El resultado conserva `source`, calidad y el intervalo
de aplicación para que un operador pueda excluirlo o repetir el cálculo con un
producto actualizado.

El componente ERP de **Diagnóstico** expone estas transiciones como
`coverageTimeline`: tramos C01/finals y, cuando se necesita, un objeto
`linear-extrapolation` con `start`, `end`, `startsAfter`, `quality` y
`maxHorizonDays: 30`; después publica `nominal-fallback` desde ese `end` sin fin
finito. `selection` repite los instantes operativos
`extrapolationStartsAt`, `extrapolationEndsAt` y `nominalFallbackStartsAt`. Son
hechos de la caché validada, no fechas configuradas a mano.

## Cadena temporal y de marcos

~~~mermaid
flowchart LR
    UTC[UTC] -->|DUT1| UT1[UT1]
    UTC -->|segundos intercalares| TAI[TAI]
    TAI -->|+ 32.184 s| TT[TT]
    I[GCRF / ICRF / EME2000] --> C[CIRS] --> T[TIRS] --> R[ITRF]
    M[TEME] --> P[PEF] --> R
~~~

La interfaz muestra UTC. UT1 se obtiene aplicando DUT1 y TT mediante
UTC → TAI → TT. Las etiquetas genéricas ECI y ECEF se rechazan. El acrónimo
correcto es ITRF, no IRTF.

Una etiqueta `ITRF` rigurosa no se infiere del globo ni de una rotación con
UTC≈UT1. Para transformar un estado inercial se necesita una ruta de marcos
explícita, segundos intercalares y EOP versionados —como mínimo DUT1, `xp` e
`yp`, y `dX`/`dY` en la reducción CIO—. Sin ellos la interfaz solo puede
presentar una **vista terrestre aproximada**, nunca relabelarla como ITRF.

Para un producto GNSS importado, el ERP seleccionado con el SP3 es el contrato
de producto para pedir ITRF → ECI. Aporta UT1 y movimiento polar, pero no crea
por sí solo una operación de datum IGS→ITRF: también debe existir y aplicarse
la ruta de realización correspondiente. Solo entonces la UI muestra **ITRF
(con ERP aplicado)**. Si no existe ERP, debe mostrar **Marco terrestre
aproximado (sin ERP)** y rechazar cualquier solicitud que declare `require_eci`.
El snapshot C04 global no se adopta silenciosamente como ERP de una revisión
SP3: ambos orígenes mantienen su propia versión y procedencia.

## Órbita manual: pestaña TIME y ERP local opcional

La pestaña **TIME** del diseño de órbita manual contiene dos contratos
distintos: **Design window**, que define las épocas UTC que se propagarán, y
**Orbit preview frame**, que solo decide cómo se inspecciona la efeméride. No
son dos relojes ni dos dinámicas diferentes.

Para fuerzas manuales ligadas a Tierra, Orbit usa por defecto la cadena
automática IERS C01 → `finals2000A.all` → extrapolación lineal señalada para
`geopotential` y `drag`. No se pide adjuntar un ERP para crear ni previsualizar
una órbita manual. Estas cachés no cambian la **Design window** ni el epoch
físico: aportan UT1–UTC, movimiento polar y LOD a las etapas de propagación con
su fuente y calidad publicadas.

Adjuntar un ERP local desde TIME sigue siendo opcional: fija una instantánea
reproducible y explícita para ese diseño. El resultado conserva nombre,
proveedor, huella, escala UTC y límites de cobertura del ERP adjunto; no mezcla
el ERP de un SP3 ya cargado con la órbita manual.

Cuando se adjunta y valida un ERP manual, TIME sustituye el
**Design window** por el intervalo completo cubierto por el fichero:

$$
D=[t_{ERP,min},t_{ERP,max}].
$$

En la misma acción, el **State-vector epoch** físico se ancla a
\(t_{ERP,min}\). Esto evita conservar un epoch anterior fuera de cobertura.
Puede editarse después, pero las fuerzas ligadas a Tierra que usen ese ERP
explícito exigen que siga dentro de su cobertura.

Esto no se recorta automáticamente a una capa SP3/OEM que estuviera ya en la
escena. Recortarlo ocultaría al operador que dos productos tienen coberturas
distintas y cambiaría el diseño manual sin una acción explícita.

### Proveedor de orientación terrestre

`geopotential` y `drag` comparten la cadena automática IERS del proceso. Para
cada etapa usa C01 si hay muestra válida; de lo contrario usa la fila
compatible de `finals2000A.all` y deja visible si su calidad es `final`,
`rapid` o `predicted`. Después del fin realmente utilizable de `finals2000A.all`,
solo puede usarse la extrapolación lineal local explícitamente etiquetada
durante un máximo de 30 días. Pasado ese límite no hay EOP automático y la ruta
visual degrada a rotación nominal. No es necesario adjuntar un fichero ERP
manual para esta ruta operativa.

Si no hay una muestra compatible ni dos puntos finales para extrapolar, la
órbita manual puede crearse con la advertencia **“No hay datos ERP disponibles.
El geopotencial y el arrastre atmosférico usarán una rotación terrestre
nominal.”** La procedencia publicada marca entonces esa ruta como nominal; no
se presenta como una solución EOP precisa.

### Preflight de cobertura en operaciones largas

Antes de enviar una operación dependiente de orientación terrestre, Orbit
evalúa la **ventana completa** y las etapas solicitadas, no solo el epoch
inicial. Esto incluye, por ejemplo, una propagación numérica con geopotencial o
arrastre y las transformaciones que pidan EOP. El preflight publica los
subintervalos que usarán C01, `finals2000A` con calidad `final`/`rapid`/
`predicted`, extrapolación lineal o, si procede, el fallback visual
`UTC≈UT1` con calidad `approximate`.

Por tanto una ventana que empiece dentro de C01 y termine fuera de su cobertura
no queda silenciosamente clasificada como «válida». Antes de ejecutarla la UI
indica el instante de transición, el recurso que se utilizará después y un
aviso reforzado si alcanza predicciones o extrapolación. El operador puede
acortar la ventana, actualizar los datos IERS o continuar sabiendo qué tramo
queda degradado. Ese aviso no inicia una descarga ni modifica la órbita por sí
solo.

Un ERP local elegido explícitamente conserva su contrato más estricto: debe
cubrir por completo toda la ventana y sus etapas. En ese caso no se permite
mezclar silenciosamente C01, `finals2000A` ni extrapolación para rellenar un
hueco; la operación se rechaza con el límite exacto de cobertura.

Un ERP local opcional sí debe cubrir por completo la ventana diseñada y el
epoch físico cuando se elige como override reproducible:

$$
D\subseteq E_{ERP}.
$$

Si ese override existe pero no cubre toda la ventana, la creación se rechaza
con una explicación de cobertura. La ruta EME2000↔ITRF sigue requiriendo la
tabla local de segundos intercalares y ERFA/SOFA; son requisitos independientes
del ERP manual. La conversión ECI rigurosa de un producto SP3 conserva su
contrato separado y fail-closed: la caché C01 global o el fallback nominal no
la habilitan.

### Alineación con SP3, OEM y el rango de la escena

No aparecen “marcos de tiempo” distintos: el reloj común de Orbit es UTC. Lo
que puede diferir es la cobertura. Si hay una ventana de escena \(S\) y capas
finitas con dominios publicados \(P_1,\ldots,P_k\), la ventana permitida para
una comparación, una gráfica conjunta o un cálculo que use ambas fuentes es:

$$
C=D\cap S\cap P_1\cap\cdots\cap P_k.
$$

- Si \(C\) existe pero es menor que \(D\), TIME indica la **ventana común**;
  la operación conjunta debe usarla, no extrapolar el SP3/OEM.
- Si \(C\) es vacía, la órbita manual puede crearse si su propio contrato ERP
  es válido, pero no se permite presentarla como comparable o analizable junto
  con esas capas hasta que el usuario seleccione productos/rangos que solapen.
- El rango global no se modifica implícitamente al adjuntar un ERP. El usuario
  puede aplicar la ventana común de forma explícita; así la cronología del
  proyecto sigue siendo reproducible.

La procedencia de una órbita manual debe incluir su ventana de diseño, la
cobertura y huella del ERP si se utilizó, el marco de previsualización elegido
y la ventana común efectiva cuando se ejecute una operación multi-fuente.

## Guías operativas

| Tema | Contenido |
| --- | --- |
| [Archivos locales](time-eop/data-files.md) | Caché C01 automática, C04 explícito y leap-seconds.list. |
| [Modo estricto](time-eop/strict-mode.md) | Hashes, variables y cobertura comprobable. |
| [Realizaciones y modo visual](time-eop/realizations.md) | IGS20, ITRF2020 y aproximaciones. |
| [Actualización controlada](time-eop/updates.md) | Renovación de snapshots e invalidación de caché. |
