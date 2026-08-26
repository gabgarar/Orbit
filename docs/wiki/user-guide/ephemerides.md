# Inspector de efemérides

[Inicio](../index.md) · [Guía de usuario](index.md) · [Línea temporal](timeline.md) · [Exportar](export.md)

El inspector de efemérides muestra las muestras y la procedencia que Orbit ha
recibido o calculado para una capa orbital. Es una superficie de consulta: no
edita la simulación, no transforma silenciosamente un formato en otro y no
reconstruye el archivo de entrada original.

## Rango de simulación

La sección **Rango de simulación** es de solo lectura. Cuando el espacio de
trabajo está en modo **Simulated**, muestra el inicio, el fin y la duración del
rango activo de la línea temporal. Cambiar el rango global se hace desde la
[línea temporal](timeline.md), no desde el inspector.

| Estado temporal | Qué muestra el inspector | Qué no hace |
| --- | --- | --- |
| Simulated con inicio y fin válidos | El rango UTC activo de la simulación. | No ofrece campos de fecha ni un botón para aplicar ese rango. |
| Real time o Static | Que no hay un rango finito activo; el runtime decide la ventana de consulta aplicable. | No reutiliza como rango de simulación las fechas residuales del reloj. |
| Diseño manual | Los *epochs* de diseño cuando no existe un rango simulado finito. | No cambia los *epochs* del diseño ni el reloj global. |

**Refresh** vuelve a solicitar las efemérides en el contexto actual. Un cambio
de dominio temporal (modo, inicio o fin) sustituye la consulta del inspector;
mover sólo el cursor de reproducción no debe iniciar una serie nueva.

## Historial de propagaciones del proyecto

La pestaña **Información** conserva una tabla de auditoría por proyecto. Cada
fila registra el objetivo, fuente, propagador, ventana UTC, cadencia solicitada
y efectiva, marcos declarados, número de muestras resumido y el estado final:
**en curso**, **completada**, **cancelada** o **error**. Una solicitud que se
sustituye, se cierra o se cancela desde el indicador de tareas conserva su
resultado como cancelada; no desaparece junto con la operación activa.

El historial está separado deliberadamente del icono de tareas: ese icono usa
el *ledger* vivo y sólo muestra trabajo en ejecución. La tabla es metadato del
proyecto, se guarda inmediatamente en la biblioteca local cifrada y viaja en
el documento `.orbit`; al abrir el proyecto se recupera aunque su capa o
producto de origen ya no esté disponible. Para no convertir el proyecto en una
caché de efemérides, no guarda las series, el fichero de entrada ni la respuesta
cruda del backend. Conserva las **200 ejecuciones más recientes** por proyecto.

La tabla no borra ni repropaga resultados por sí sola. Para reproducir valores
numéricos se usa **Refresh** con la capa y los recursos vigentes, o se exporta
la serie explícitamente desde **Valores** con su procedencia.

## Perfil de fuente y disponibilidad

Cada respuesta publica un perfil con `source`, `availability`, `method`,
`frame`, `quality`, `forces`, `precision`, `cartesianColumns` y `rows`. Los
campos ausentes se muestran como no disponibles; una etiqueta o una celda vacía
no se completa con una suposición de formato, propagador, marco o precisión.

| Perfil | Qué puede declararse | Límite importante |
| --- | --- | --- |
| **TLE** | Las líneas/identidad TLE disponibles, SGP4, estado TEME y elementos derivados de la propagación. | No se presenta un TLE recalculado como si fuera el archivo recibido. |
| **OMM** | Los campos OMM conservados y, si contiene elementos TLE utilizables, el método que realmente se ejecutó. | No hay un propagador analítico OMM independiente: el camino compatible actual usa SGP4 solo cuando el import expone TLE utilizable. |
| **SP3** | Cobertura tabulada, marco, escala, centro/proveedor, clase/familia de producto y resumen de CLK declarados, junto con la realización o calidad publicada. | No se extrapola fuera de la cobertura ni se etiqueta como TLE/SGP4. |
| **OEM** | Metadatos y muestras de una efeméride tabulada cuando están disponibles. | Una OEM sin adaptador verificable no se repropaga con SGP4 ni recibe un marco o una escala inventados. |
| **State vector** | Posición, velocidad, época y marco de la definición recibida; los elementos calculados se señalan como derivados. | La entrada manual actual acepta EME2000; `J2000`/`ECI` son alias de migración a EME2000, no marcos de entrada distintos. TEME, ITRF y ECEF se rechazan como vector manual. |
| **Numeric** | Columnas numéricas que la respuesta entrega con sus unidades o etiquetas. | El integrador actual se declara como Cowell/RK4 cuando se usa; no se infiere RK45, procedencia física, fuerzas o precisión sólo porque haya números. |
| **Manual** | Definición de diseño, propagador, fuerzas, época y marco efectivamente usados. | No se atribuye una procedencia de catálogo ni se fabrica un TLE para exportar. |

Si `availability.available` es falso, el inspector conserva la razón publicada
por el runtime. Es preferible una sección explícitamente no disponible a una
serie calculada con un motor o unos datos distintos de los solicitados.
Para productos tabulados SP3 u OEM, la capacidad debe declararse expresamente
por el backend; una respuesta con muestras pero sin esa declaración se muestra
como no disponible, no como una conversión implícita a TLE/SGP4.

### Marcos nativos por defecto

| Entrada | Marco nativo que se conserva | Nota de cálculo/salida |
| --- | --- | --- |
| TLE / SGP4 | TEME | Es el estado nativo de SGP4; los elementos osculantes derivados se calculan en TEME salvo que el servicio publique otro marco de cálculo verificable. |
| SP3 | La etiqueta y realización exactas de la cabecera, por ejemplo `IGS20` | No se reduce a “ITRF” genérico. Puede solicitarse una salida distinta únicamente mediante una ruta de transformación declarada. |
| OEM | El marco del segmento seleccionado | Cada segmento puede tener un marco, centro o escala distintos. |
| OMM compatible | TEME si se ejecuta mediante SGP4 | El OMM conserva sus campos medios de entrada y no obtiene por ello un modelo analítico nuevo. |
| Vector manual / numérica | EME2000 | La integración manual/numerica trabaja en EME2000; la salida transformada depende de la misma validación de marcos. |

## Marco, método y muestreo

El inspector separa deliberadamente cuatro conceptos que suelen confundirse:

1. **Marco nativo del estado**: el marco en el que el proveedor entregó `r/v`.
2. **Marco de salida de la tabla**: el marco del estado cartesiano que el
   servicio devolvió realmente para esta consulta.
3. **Marco de cálculo**: el marco sobre el que el runtime declaró que obtuvo un
   elemento osculante, si lo hubo.
4. **Marco de visualización**: el que puede usar la escena, que no convierte
   por sí mismo la tabla ni cambia la procedencia de la muestra.

La tarjeta **Método y fuente** publica el motor realmente aplicado, su familia,
la interpolación declarada y su grado, la cadencia media publicada, las fuerzas,
el paso interno y las tolerancias solo si el runtime los devuelve. El selector
**Marco de salida** ofrece `TEME`, `ITRF`, `EME2000`, `GCRF` e `ICRF` solo si el
endpoint declaró una ruta de transformación. La opción **Nativo** omite la
petición de transformación. Cada selección se comprueba para *todo* el rango:
una ruta puede fallar por falta de EOP/ERP, de segundos intercalares, de
cobertura o de una realización compatible. En ese caso se muestra el error y
no se publica una tabla renombrada.

La respuesta conserva `frame.native`, `frame.current`, `frame.output` y
`frame.calculation`; por fila conserva además el marco nativo y la procedencia
de transformación cuando la hubo. Por ejemplo, un TLE puede publicar `r/v` en
ITRF y seguir calculando sus elementos osculantes en TEME. A la inversa, un SP3
terrestre convertido verificablemente a GCRF puede calcular elementos en GCRF.
Solicitar `ITRF` para una realización nativa `IGS20` no rebautiza el datum:
`frame.current` continúa mostrando `IGS20` mientras no haya una transformación
real. `ECI` y `ECEF` genéricos no son opciones válidas.

El intervalo tampoco es una configuración local: **Refresh** usa el rango
activo global. La zona de presentación y exportación está fijada en **UTC**;
la escala temporal de origen se conserva por fila. El selector **Paso de
muestreo** controla la cadencia de la solicitud del inspector (automática,
1 min … 1 día), no el rango global ni la cadencia física del producto.

Cuando el operador elige una cadencia concreta, Orbit calcula **todas** las
muestras que esa cadencia requiere, incluidos ambos extremos del intervalo: no
la sustituye por la antigua vista de 121 puntos. Por ejemplo, 24 horas a un
minuto producen 1.441 muestras. Las solicitudes densas muestran su número de
muestras como una tarea en ejecución y avisan de que pueden tardar unos
momentos; se pueden cancelar desde **Tareas** sin modificar la simulación. El
modo **Automático** sí escoge una densidad de presentación acotada para ventanas
muy largas, porque no representa una cadencia solicitada por el operador. La
tarjeta de método conserva por separado la cadencia y el método de
interpolación declarados por SP3/OEM.

Los modelos numéricos de paso fijo, como Cowell/RK4, mantienen además una
validación independiente de pasos internos. Si una solicitud densa no se puede
ejecutar de forma segura con ese integrador, Orbit la rechaza con el número de
pasos y una alternativa accionable; nunca reduce silenciosamente la cadencia
que elegiste. Esa protección no afecta a la resolución solicitada para las
fuentes analíticas o tabuladas que sí pueden atender el intervalo.

## Tabla de estados

La tabla conserva un núcleo cartesiano común cuando la fuente lo proporciona:

- época UTC;
- `X`, `Y`, `Z` de posición, con sus unidades declaradas;
- `VX`, `VY`, `VZ` de velocidad, con sus unidades declaradas;
- marco, escala temporal y procedencia de la fila o de la serie cuando el
  contrato los distingue.

El orden inicial de una tabla completa es `Epoch UTC`, `Frame`, `Escala temporal`,
`X`, `Y`, `Z`, `Vx`, `Vy`, `Vz`, `|r|` y `|v|`. `Epoch UTC` es el instante de
consulta normalizado por la API; **Escala temporal** conserva la escala nativa
de la muestra cuando el proveedor la declara (por ejemplo, GPS o TAI en un
producto preciso). Las unidades salen del contrato de cada
columna, de modo que la cabecera no afirma `km` o `km/s` si la fuente declaró
otra unidad. `|r|` y `|v|` llevan la etiqueta **DERIVADO** y solo aparecen si
están los tres componentes necesarios.

Las columnas derivadas —por ejemplo norma de posición, norma de velocidad,
elementos osculantes, altitud o periodo— sólo aparecen cuando sus entradas son
finitas y la operación está declarada. Un valor derivado no sustituye los
componentes cartesianos de origen y nunca rellena una velocidad, una covarianza
o una precisión que no fue publicada.

Los filtros actúan sobre las filas ya recibidas y no modifican la efeméride,
el rango global ni el backend. Su objetivo es reducir la vista y, cuando se
exporta la selección filtrada, dejar una traza del criterio aplicado y del
número de filas resultante.

La ventana tiene tres pestañas: **Información**, **Gráfica** y **Valores**.
En **Valores**, cada cabecera permite ordenar ascendente o descendentemente;
el selector de columnas muestra u oculta campos sin cambiar la serie; y el
filtro `Desde UTC` / `Hasta UTC` reduce solo las filas visibles. Las cabeceras
marcan los campos **DIRECTO** y **DERIVADO**. La gráfica usa el marco de salida
real de la tabla, no el marco de representación de Cesium.

### Lectura de la gráfica

La pestaña **Gráfica** es una vista compacta de inspección: conserva zoom con
rueda, desplazamiento mediante arrastre y exportación PNG, pero ajusta la
altura al espacio de la ventana para no ocultar los controles operativos. Las
marcas del eje Y se generan con pasos legibles de la serie (`1`, `2`, `2,5`,
`5` y sus potencias de diez); se muestran decimales únicamente cuando el paso
físico los necesita.

El selector de parámetro usa la **misma normalización de columnas que la
pestaña Valores**. Por ello puede representar cualquier columna numérica que
la respuesta publique y que tenga al menos dos muestras finitas; no limita la
gráfica a una lista fija de elementos orbitales. Quedan excluidos los campos de
tiempo, marco, escala temporal, texto y banderas, porque no forman
una magnitud continua. Cada opción conserva su marca **DIRECTO** o
**DERIVADO**, igual que la cabecera de Valores. La unidad que aparece junto al
parámetro es la unidad declarada por esa columna; puede variar entre fuentes y
no se inventa una unidad común cuando el contrato no la publica.

La etiqueta **Muestreo** indica el método declarado por la fuente —por ejemplo
Lagrange, Hermite o lineal y su grado cuando se publica—, no uno supuesto por
la interfaz. El cursor diferencia dos lecturas:

- **Muestra de la serie**: valor recibido o evaluado para una época de la
  respuesta; muestra también la procedencia de su interpolación de origen.
- **Lectura del trazo**: posición visual del cursor entre dos muestras. La
  interfaz la obtiene linealmente solo para ubicar el puntero; no crea una
  muestra, no ejecuta una propagación y no sustituye el método declarado por
  SP3 u OEM.

Así, una línea continua hace la serie legible sin presentar un valor de cursor
como una efeméride nueva o como una interpolación física distinta.

### Datos específicos por perfil

| Perfil | Datos directos que puede mostrar | Datos calculados que puede mostrar | Interpretación operativa |
| --- | --- | --- | --- |
| TLE / SGP4 | identidad, época y elementos medios TLE disponibles | `a`, `e`, `i`, RAAN, argumento de periapsis, anomalías, período, perigeo y apogeo | El estado es TEME de SGP4; los elementos de las filas son **osculantes derivados**, no una reescritura del TLE medio. |
| SP3 | `r/v` si están publicados, reloj, sigma/RMS de proveedor, calidad, centro y clase de producto cuando existan | solo normas cartesianas; elementos osculantes únicamente si el runtime los declaró | El reloj directo en segundos se normaliza a `ns`; sigma/RMS lineales explícitos se normalizan a `mm`. El campo separado **Sigma orbital SP3** procede de `++`: es una declaración 1σ por satélite y fichero (`2^n mm`), no una sigma por época/componente, RMS ni covarianza; blanco o `0` significa no declarado. Un RINEX CLK solo se adjunta cuando coincide de forma única con la época física SP3 bajo el contrato de escala, leap seconds y ERP; no usa vecino más cercano ni interpolación. CLK no sustituye la cronología ni la posición SP3. Sin asociación verificable, SP3 sigue válido y CLK queda sin asociar. |
| OEM | `r/v`, marco/escala por segmento, interpolación, aceleración y covarianza cuando el proveedor las publique | elementos osculantes solo para un estado completo, centrado en Tierra y en marco inercial | Cada segmento es una fuente independiente. La covarianza se vincula a su época exacta; no se interpola ni se inventa entre épocas. Una fila de maniobra solo aparece si el proveedor la declara: no se sintetizan flags de maniobra. |
| OMM | elementos medios, movimiento medio, B*, drag y SRP que el mensaje aportó | una serie osculante solo si el motor la devuelve separadamente | El panel distingue siempre los campos **medios OMM** de cualquier campo osculante. Para poder filtrarlos y exportarlos junto a cada estado, los campos de entrada se repiten por fila con procedencia `source-input`; no representan una serie osculante variable. Si el importador ejecuta SGP4 con líneas TLE contenidas, lo declara como `OMM de entrada / SGP4 aplicado`; no lo llama modelo analítico ficticio. |
| Vector de estado | época, `r/v` y marco de la definición | elementos osculantes, período, perigeo y apogeo, si el runtime los calculó | Ningún vector se convierte en TLE sintético. La entrada manual de vector es EME2000, con los alias de migración documentados arriba. |
| Numérica / manual | aceleraciones `ax/ay/az`, fuerzas, integrador, tolerancias y eventos cuando se publiquen | elementos derivados por el propagador | Las aceleraciones y eventos llevan su propia unidad/procedencia; una fuerza solicitada pero no aplicada no se presenta como aplicada. El panel no anuncia un integrador o una maniobra que el runtime no haya confirmado. |

Las etiquetas pequeñas de cada cabecera indican **DIRECTO** o **DERIVADO**. La
procedencia por fila y sus unidades se conservan también en la exportación.
Los campos de texto —calidad, evento, maniobra y resumen de covarianza— nunca
se fuerzan a una columna numérica vacía.

### OEM multisegmento

Un OEM con varios bloques puede cambiar marco, centro, escala temporal o
interpolación. Por seguridad el backend exige `source.segmentIndex` para una
consulta multisegmento y rechaza una ventana que cruce el límite de ese
segmento. No escoge el primer tramo de forma implícita ni interpola a través de
una discontinuidad. Una OEM local que aún no tenga proveedor registrado en el
backend se muestra como **no disponible** con esa causa exacta, en vez de
repropagarse mediante SGP4.

## Exportación desde el inspector

La exportación genera un *snapshot* de `exportMetadata` junto con las filas que
se van a descargar. Como mínimo, la traza conserva:

- el perfil de fuente (`type`, `origin` y `format`) y su disponibilidad;
- método, marco, calidad, fuerzas y precisión declarados;
- marco nativo, marco de salida real, marco de cálculo y la solicitud de
  transformación, cuando corresponda;
- `range` de consulta y `simulationRange` activo que dieron contexto a la
  serie;
- las columnas incluidas, `scope`, `presentation.timeFilter`,
  `presentation.sort` y el recuento de filas exportadas.

El menú ofrece **CSV** y **JSON**. CSV contiene las columnas visibles y una
cabecera de metadatos serializada. JSON conserva `metadata`, `rows` y el array
alineado `rowMetadata`: éste incluye las unidades y procedencia por fila,
interpolación/muestreo declarados, datos de covarianza, marco nativo y la ruta
de transformación de esa fila cuando existan. La posición de `rowMetadata[n]` corresponde siempre a `rows[n]`, aun
si dos muestras comparten época. Se puede exportar el intervalo completo recibido o solo las
filas visibles tras el filtro temporal y el orden actual. Ocultar una columna
derivada la excluye de la descarga, pero nunca elimina del metadato la fuente,
el método o el marco que explican las filas. HDF5 no se anuncia como formato
disponible mientras no exista un escritor de grandes volúmenes con el mismo
contrato de procedencia.

Los filtros no deben ocultar esa procedencia: exportar menos filas no convierte
una OEM en TLE, ni una definición manual en catálogo. Los valores de la tabla
pueden redondearse para leerlos, pero la exportación debe conservar el valor
numérico entregado por el contrato y dejar ausentes los campos que no existen.
Consulte [Exportar](export.md) para los formatos de intercambio generales y sus
limitaciones.

## Límites prácticos

### Errores accionables

| Situación | Comportamiento del inspector | Acción del operador |
| --- | --- | --- |
| Marco de salida sin ruta/EOP/ERP para toda la ventana | Rechaza la solicitud y conserva el mensaje del servicio; no marca el marco como aplicado. | Elija **Nativo**, reduzca/cambie el rango global o aporte la cobertura temporal necesaria. |
| SP3/OEM fuera de cobertura | No extrapola ni devuelve filas imaginarias. | Seleccione un intervalo cubierto o importe el producto adecuado. |
| OEM multisegmento sin `segmentIndex` o con rango que cruza segmentos | Falla de forma explícita antes de interpolar. | Seleccione el segmento y use un rango completamente contenido en él. |
| Vector sin velocidad o marco no inercial | Conserva las componentes disponibles, pero no inventa elementos osculantes. | Complete el estado o consulte un marco inercial verificable. |
| Muestreo explícito denso | Calcula la serie completa y publica una tarea cancelable con el número de muestras. | Espere a que termine o cancele la tarea; la simulación no cambia. |

- El inspector no es un reproductor histórico de catálogos ni una herramienta
  de determinación orbital.
- La cobertura finita de SP3 y OEM se respeta: no se extrapola fuera de una
  ventana autorizada y cualquier interpolación se limita a la cobertura
  declarada.
- Un marco genérico ECI/ECEF no sustituye la realización y la procedencia de
  tiempo necesarias para un resultado de precisión. Revise [Tiempo, EOP e
  ITRF](../operations/time-eop.md) cuando corresponda.
- Conserve el archivo original si necesita fidelidad documental: las vistas,
  los perfiles derivados y las exportaciones muestreadas no son una copia
  forense del producto de entrada.

## Flujo recomendado

1. Seleccione la capa y confirme su formato, marco y cobertura.
2. Establezca el rango global desde la línea temporal si necesita una ventana
   finita reproducible.
3. Abra el inspector y revise la disponibilidad y el perfil antes de comparar
   columnas derivadas.
4. Aplique filtros sólo para inspección o para delimitar la exportación.
5. Guarde el archivo exportado con su metadato y, cuando sea necesario, con el
   producto fuente y el contexto EOP usados.
