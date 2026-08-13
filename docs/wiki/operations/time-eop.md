# Operación de tiempo, EOP e ITRF

[Inicio](../index.md) · [Operación](index.md) · [Configuración](configuration.md)

Orbit trata tiempo, orientación terrestre y realización como contratos
explícitos. No descarga productos de tiempo durante una propagación ni una
transformación: el operador monta snapshots locales e identifica cada revisión.

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

## Órbita manual: pestaña TIME y ERP local

La pestaña **TIME** del diseño de órbita manual contiene dos contratos
distintos: **Design window**, que define las épocas UTC que se propagarán, y
**Orbit preview frame**, que solo decide cómo se inspecciona la efeméride. No
son dos relojes ni dos dinámicas diferentes.

Un ERP de una órbita manual se adjunta expresamente desde esa pestaña como un
fichero local. Orbit no descarga ni adopta de forma silenciosa el C04 global,
el ERP de un SP3 ya cargado ni un valor de Internet para completar ese fichero.
El resultado conserva nombre, proveedor, huella, escala UTC y límites de
cobertura del ERP adjunto.

Cuando la validación del ERP termina correctamente, TIME sustituye el
**Design window** por el intervalo completo cubierto por el fichero:

$$
D=[t_{ERP,min},t_{ERP,max}].
$$

En la misma acción, el **State-vector epoch** físico se ancla a
\(t_{ERP,min}\). Esto evita conservar un epoch anterior fuera de cobertura.
Puede editarse después, pero las fuerzas ligadas a Tierra exigen que siga
dentro de la cobertura del ERP.

Esto no se recorta automáticamente a una capa SP3/OEM que estuviera ya en la
escena. Recortarlo ocultaría al operador que dos productos tienen coberturas
distintas y cambiaría el diseño manual sin una acción explícita.

### Cuándo es obligatorio el ERP

El ERP manual es obligatorio si la composición Cowell incluye una fuerza ligada
a Tierra: actualmente `geopotential` o `drag`. Antes de previsualizar o crear,
Orbit exige que el ERP cubra por completo la ventana diseñada:

$$
D\subseteq E_{ERP}.
$$

Si falta, el error es **“Debe proporcionar un fichero ERP para convertir a
ECI.”**; si existe pero no cubre toda la ventana, la creación se rechaza con
una explicación de cobertura. El usuario puede seguir diseñando una órbita de
fuerzas estrictamente inerciales —por ejemplo `central`, tercero cuerpo, SRP o
relatividad— sin adjuntar ERP, pero eso no habilita una evaluación terrestre
estricta. Los requisitos de segundos intercalares y ERFA siguen siendo
independientes del ERP manual.

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
| [Archivos locales](time-eop/data-files.md) | C04 y leap-seconds.list requeridos. |
| [Modo estricto](time-eop/strict-mode.md) | Hashes, variables y cobertura comprobable. |
| [Realizaciones y modo visual](time-eop/realizations.md) | IGS20, ITRF2020 y aproximaciones. |
| [Actualización controlada](time-eop/updates.md) | Renovación de snapshots e invalidación de caché. |
