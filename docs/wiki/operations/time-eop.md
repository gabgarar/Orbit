# Operación de tiempo, EOP e ITRF

[Inicio](../index.md) · [Operación](index.md) · [Configuración](configuration.md)

Orbit trata tiempo, orientación terrestre y realización como contratos
explícitos. Ninguna propagación ni transformación descarga productos de tiempo.
El runtime puede actualizar una caché operativa genérica en segundo plano al
arrancar; las rutas científicas estrictas siguen identificando snapshots locales
y cada revisión usada.

## Caché automática IERS C01

Cuando no se ha configurado un snapshot reproducible `ORBIT_EOP_C04_PATH`, el
monitor de salud intenta cargar el producto oficial
[IERS EOP_C01_IAU2000_1846-now](https://datacenter.iers.org/data/latestVersion/EOP_C01_IAU2000_1846-now.txt).
Su caché mutable está en:

```text
./data/erp/EOP_C01_IAU2000_1846-now.txt
```

El monitor valida primero la copia local. Si falta o su fecha de modificación
supera siete días, descarga el fichero por HTTPS, lo valida completamente y lo
reemplaza de forma atómica. El inicio y `/health` no esperan esa descarga: el
visor conserva una rotación nominal mientras el monitor trabaja.

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
  publica **Warning** con su antigüedad.
- Si no existe una copia válida, publica **Warning** o **Error** y utiliza
  solo la rotación ITRF nominal para la vista. No fabrica ERP ni extrapola la
  cobertura.
- El archivo está fuera de la imagen Docker y se monta como volumen `./data`;
  así sobrevive a un reinicio sin convertirse en parte de una release.

Esta caché es una orientación global operativa, no un sustituto de un ERP de
producto ni una autorización implícita para ECI estricto. Un C04 explícito
tiene prioridad y nunca se reemplaza automáticamente. Un ERP adjunto a un
SP3 continúa siendo su propia fuente, cobertura y procedencia.

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

Para fuerzas manuales ligadas a Tierra, Orbit usa por defecto el mismo
proveedor automático IERS C01 para `geopotential` y `drag`. No se pide adjuntar
un ERP para crear ni previsualizar una órbita manual. La caché C01 no cambia la
**Design window** ni el epoch físico: es una fuente operativa de UT1–UTC,
movimiento polar y LOD para las etapas de propagación.

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

`geopotential` y `drag` comparten la caché automática IERS C01 del proceso.
Cuando contiene una muestra válida para cada etapa, Orbit aplica UT1–UTC,
movimiento polar y LOD de esa fuente. No es necesario adjuntar un fichero ERP
manual.

Si C01 no está disponible o no cubre la etapa solicitada, la órbita manual se
puede crear con la advertencia **“No hay datos ERP disponibles. El geopotencial
y el arrastre atmosférico usarán una rotación terrestre nominal.”** La
procedencia publicada marca entonces esa ruta como nominal; no se presenta como
una solución EOP precisa.

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
