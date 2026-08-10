# Estaciones de tierra

[Inicio](../index.md) · [Guía de usuario](index.md) · [Capas](layers.md) · [Línea temporal](timeline.md) · [Exportar](export.md)

Una estación de tierra es una capa del espacio de trabajo que combina su posición WGS-84 con un modelo RF determinista. El mismo contrato de estación alimenta el diseñador, la cobertura de la escena, la telemetría instantánea y AOS/LOS, pero cada consumidor declara su propósito: el renderizador limita el alcance dibujado para mantener la escena ágil y el servicio recibe una puerta de alcance operativo explícita. La huella dibujada no sustituye por sí sola el criterio de acceso.

## Visión general

Orbit distingue dos resultados que no deben confundirse:

- La **envolvente de planificación recíproca** estima hasta qué distancia una terminal equivalente a la estación podría cerrar el enlace. Sirve para diseño y visualización; no afirma que un satélite arbitrario vaya a recibir o transmitir correctamente.
- Un **enlace de satélite real** requiere un perfil RF remoto completo: EIRP efectivo hacia la estación, frecuencia o canal compatible, polarización y ancho de banda. Orbit valida que la señal pueda sintonizarse dentro de la banda de recepción antes de calcular potencia o SNR. Si una capa no publica esos datos, presenta el presupuesto de planificación y marca SNR como no disponible. No inventa una calidad de enlace.

La geometría y la línea de vista se evalúan en ITRF/WGS-84. La escala física y los instantes que transporta la API son UTC. La zona horaria IANA de la estación —por ejemplo `Europe/Madrid`— solo formatea las etiquetas de la tabla y de la gráfica en hora local, incluidos los cambios de horario de verano; no cambia el cálculo físico ni los instantes exportados en CSV.

## Crear o editar una estación

El diseñador permite modificar parámetros y revisar valores derivados antes de añadir la capa al proyecto. La ficha de la estación conserva el mismo contrato RF y muestra sus métricas calculadas.

### Geometría y contexto

| Campo | Unidad o valores | Uso en Orbit |
| --- | --- | --- |
| Nombre | Texto | Identifica la capa y las tablas de pases. |
| Latitud, longitud, altitud | grados, grados, m | Posición WGS-84 convertida a ITRF para obtener ángulos locales. |
| Zona horaria | Nombre IANA, por ejemplo Europe/Madrid | Formatea ejes y horas locales. |
| Máscara de elevación | grados | Límite operativo del horizonte. |

### Antena y patrón de radiación

| Campo | Unidad o valores | Uso en Orbit |
| --- | --- | --- |
| Diámetro del plato | m | Calcula ganancia y ancho de haz de una apertura circular. |
| Eficiencia | 0–1 | Escala la ganancia derivada del plato. |
| Frecuencia | MHz o Hz | Determina longitud de onda, pérdida de espacio libre y tamaño de haz. |
| Polarización | RHCP, LHCP o lineal | Se usa con un perfil remoto completo para calcular pérdida por desajuste. |
| Patrón | gaussiano o cos^n | Define la caída de ganancia fuera de boresight. |
| HPBW de azimut/elevación | grados, opcional | Permite imponer el ancho de haz conocido; no transforma el patrón simplificado en una medición. |
| Nivel de lóbulos secundarios | dB por debajo del principal | Fija un suelo conservador; Orbit no inventa posiciones de lóbulos. |

Para un plato circular, Orbit usa:

$$
G_{\max}=10\log_{10}\left[\eta\left(\frac{\pi D}{\lambda}\right)^2\right],
\qquad
\lambda=\frac{c}{f}.
$$

El HPBW derivado es:

$$
\operatorname{HPBW}\approx70\frac{\lambda}{D}\quad[\mathrm{deg}].
$$

\(D\) es el diámetro en m, \(\eta\) la eficiencia adimensional, \(\lambda\) la longitud de onda en m, \(c\) la velocidad de la luz en m/s y \(f\) la frecuencia en Hz. \(G_{\max}\) se expresa en dBi. HPBW es el ancho completo a media potencia: un desplazamiento unidimensional de HPBW/2 equivale a una pérdida de 3 dB.

Orbit evalúa un patrón **continuo** en cada dirección, no una región binaria. Para los desplazamientos respecto al boresight, define:

$$
q=\sqrt{\left(\frac{\Delta A}{\operatorname{HPBW}_{A}/2}\right)^2+
\left(\frac{\Delta E}{\operatorname{HPBW}_{E}/2}\right)^2}.
$$

En el patrón gaussiano, la pérdida relativa es:

$$
\Delta G=\max\left(-3q^2,-L_{\mathrm{SLL}}\right)\quad[\mathrm{dB}].
$$

El patrón `cos^n` calibra su exponente para que la semianchura de HPBW también produzca −3 dB. \(\Delta A\) y \(\Delta E\) son los errores de azimut y elevación en grados; \(L_{\mathrm{SLL}}\) es el nivel de lóbulos secundarios introducido en dB por debajo del máximo. El suelo de lóbulos limita la caída de ganancia, pero Orbit no inventa la posición de lóbulos medidos. Por tanto, el contorno HPBW es un diagnóstico de −3 dB, nunca un corte duro de acceso.

### Potencia, ruido y pérdidas

| Campo | Unidad | Uso en Orbit |
| --- | --- | --- |
| Potencia TX | dBm o W | Se normaliza a dBm para el presupuesto. |
| Ganancia TX/RX | dBi, calculada o forzada | Una ganancia forzada sustituye la derivada del plato para ese puerto. |
| Potencia mínima RX | dBm | Umbral de recepción para la envolvente y un enlace disponible. |
| Temperatura de sistema | K | Determina el ruido térmico del receptor. |
| Ancho de banda de recepción | Hz | Determina ruido térmico y cálculo de SNR. |
| Pérdidas atmosféricas, lluvia, cable y conectores | dB | Se suman como pérdidas independientes. |
| Precisión RMS de apuntado | miligrados | Reduce la ganancia efectiva según HPBW. |
| SNR requerida | dB | Umbral adicional solo cuando existe un perfil RF remoto completo y compatible. |

El suelo de ruido y la figura de mérito se calculan como:

$$
N=-198.6+10\log_{10}(T_{\mathrm{sys}})+10\log_{10}(B)\quad[\mathrm{dBm}],
$$

$$
\frac{G}{T}=G_{\mathrm{RX,ef}}-L_{\mathrm{hardware}}-10\log_{10}(T_{\mathrm{sys}})
\quad[\mathrm{dB/K}].
$$

\(T_{\mathrm{sys}}\) se introduce en K, \(B\) en Hz, \(G_{\mathrm{RX,ef}}\) en dBi y \(L_{\mathrm{hardware}}\) en dB. Cable y conectores pertenecen al término de hardware; las pérdidas atmosféricas y de lluvia se aplican al trayecto. La pérdida por apuntado se calcula con el RMS y el HPBW, y reduce las ganancias efectivas.

### Apuntado y límites mecánicos

| Campo | Valores | Efecto |
| --- | --- | --- |
| Modo | seguimiento, barrido o estacionario | Define cómo se interpreta el haz frente a un objetivo. |
| Boresight | azimut y elevación, grados | Dirección fija usada por el modo estacionario. |
| Límites mecánicos | azimut y elevación, grados | El objetivo debe poder ser alcanzado por la montura. |

En **seguimiento**, la estación orienta el haz al objetivo dentro de sus límites mecánicos; para el presupuesto, el objetivo se evalúa a ganancia de apuntamiento. En **barrido**, Orbit representa el campo de consideración mecánico como **cobertura potencial**: un objetivo alcanzable puede formar parte de la planificación, pero aún no existe una agenda, velocidad, tiempo de permanencia ni ley de barrido que garantice que la antena lo esté siguiendo en ese instante. En **estacionario**, el boresight queda fijo y se aplica la ganancia continua de su patrón en la dirección observada. El HPBW marca el contorno de −3 dB, no una pared binaria: dentro de máscara y límites mecánicos, el patrón direccional y el umbral de enlace determinan si el objetivo queda operativo.

!!! warning "Interpretación del modo de barrido"

    Hasta que Orbit incorpore una agenda de seguimiento o una ley de barrido, un AOS/LOS calculado en modo `scan` representa acceso geométrica y RF potencial dentro de la montura. No confirma asignación de recurso, adquisición, ni tiempo de enlace utilizable.

## Modelo de enlace y envolvente

La pérdida de espacio libre es:

$$
L_{\mathrm{FS}}=32.44+20\log_{10}(f_{\mathrm{MHz}})+20\log_{10}(R_{\mathrm{km}})
\quad[\mathrm{dB}].
$$

Para una terminal de referencia, la potencia de planificación es:

$$
P_{\mathrm{RX}}=P_{\mathrm{TX}}+G_{\mathrm{TX}}(\theta,\phi)+G_{\mathrm{RX,ref}}
-L_{\mathrm{FS}}-L_{\mathrm{prop}}-L_{\mathrm{hardware}}.
$$

Orbit despeja la distancia máxima cuando \(P_{\mathrm{RX}}\ge P_{\mathrm{RX,min}}\). Aquí \(f\) está en MHz, \(R\) en km, \(P\) en dBm y las ganancias y pérdidas en dB/dBi. \(G_{\mathrm{TX}}(\theta,\phi)\) es el patrón gaussiano o cos^n con reducción por apuntado y suelo de lóbulos secundarios configurados.

Cuando una capa de satélite publica un perfil RF remoto completo, Orbit calcula el enlace descendente en vez de reutilizar esta envolvente recíproca:

$$
P_{\mathrm{RX,real}}=\operatorname{EIRP}_{\mathrm{remota}}+G_{\mathrm{RX}}(\theta,\phi)
-L_{\mathrm{FS}}-L_{\mathrm{prop}}-L_{\mathrm{hardware}}-L_{\mathrm{pol}},
$$

$$
\operatorname{SNR}=P_{\mathrm{RX,real}}-N.
$$

Además de EIRP, polarización y ancho de banda del remoto, **toda** la señal ocupada debe caber dentro de la recepción centrada de la estación:

$$
|f_{\mathrm{remota}}-f_{\mathrm{estación}}|+\frac{B_{\mathrm{remota}}}{2}
\le\frac{B_{\mathrm{RX}}}{2}.
$$

La condición evita aceptar un portador centrado cuyo espectro quede recortado por el filtro del receptor. Si falla, Orbit deja potencia real y SNR como no disponibles; no aproxima un enlace con datos incompatibles.

!!! info "Límite de interpretación"

    La envolvente no es un mapa de disponibilidad ni una predicción de enlace con una capa TLE, OMM, OEM o SP3 arbitraria. Sin EIRP efectivo, frecuencia o canal compatible, polarización y ancho de banda del terminal remoto, Orbit no puede conocer la potencia recibida real ni SNR. El resultado se etiqueta explícitamente como envolvente de planificación recíproca.

La escena obtiene de este modelo una huella en 2D y un volumen de cobertura en 3D. En 2D, la huella es una proyección geodésica del campo de consideración: los topes de azimut producen sectores y un tope de elevación inferior a 90° puede producir un sector anular. Es una ayuda visual, no un mapa de línea de vista sobre terreno ni la condición de AOS/LOS. En 3D, el modo estacionario construye una malla direccional sobre todo el campo mecánicamente alcanzable: la distancia de cada dirección sigue la ley de rango de espacio libre y el patrón continuo configurado. Seguimiento y barrido muestran el campo mecánico potencial, ya que no existe un único apuntamiento fijo.

El rango dibujado se limita para mantener la escena ágil, mientras que el rango físico calculado sigue disponible en las métricas. La solicitud AOS/LOS usa una puerta de alcance operativo explícita; no se debe inferir de la apariencia o del tamaño de la huella. La pestaña **Patrón** ofrece cortes 2D y una muestra discreta \(G(\theta,\phi)\) para inspeccionar ganancia relativa. Tras analizar un satélite que publique un perfil RF completo, también presenta una muestra angular de \(P_{\mathrm{RX}}\) y margen SNR a la distancia instantánea: esa muestra es alrededor del boresight, no un mapa de disponibilidad sobre la Tierra. La malla y las curvas se derivan de los parámetros introducidos, no de un patrón de antena medido.

## Visibilidad, AOS y LOS

**Ground Stations** permite seleccionar libremente una estación y una fuente orbital presente en Layers. Puede ser una capa TLE/SGP4 de catálogo, una órbita manual confirmada o un satélite de un producto SP3 preciso importado. No es necesaria una asociación permanente entre satélite y estación. Una efeméride SP3 sólo puede planificar pases dentro de sus épocas publicadas; Orbit no la extrapola para completar una ventana AOS/LOS. Las capas OEM locales siguen siendo sólo de visualización y no ofrecen un proveedor general de acceso. La tabla lista AOS, LOS y elevación máxima para la ventana elegida; se puede exportar como CSV. Los instantes de la respuesta y del CSV se conservan en UTC; la tabla y la gráfica los presentan en la zona IANA de la estación.

### Fuente manual para tablas de pases

Una órbita manual se analiza desde su propia definición autorada: época, elementos o vector de estado, propagador seleccionado y opciones de propagación. Por ejemplo, una definición `two-body` conserva su dinámica analítica y una definición `cowell-rk4` conserva sus términos de fuerza y RK4; la tabla no la convierte en un TLE ni la propaga con SGP4.

La geometría de estación sigue un único contrato. Orbit propaga primero el estado manual en su marco dinámico nativo `EME2000` y transforma **solo la posición** de cada muestra a `ITRF`; después calcula ENU, azimut, elevación y rango respecto de la estación WGS-84. Por ello la respuesta publica `reference_frame: ITRF` y `time_scale: UTC`, también cuando la fuente de origen es manual.

En la interfaz, la tabla de una órbita manual usa de forma fija el intervalo UTC de diseño/propagación guardado (`startTime` a `endTime`). Así la tabla y su gráfica nunca salen de la efeméride que el operador confirmó. Para analizar otro intervalo se edita y vuelve a propagar la órbita manual. El contrato REST mantiene `start_time` y `end_time` explícitos para integraciones que necesiten solicitar otra ventana de forma deliberada.

Una consulta manual no registra un satélite en el catálogo, no crea un NORAD/COSPAR y no modifica la capa manual. El nombre autorado se usa solamente como etiqueta `satellite` de la respuesta y la procedencia devuelve `source.kind: manual`, el propagador canónico y `dynamics_reference_frame: EME2000`. Las consultas manuales usan **POST**; `GET /api/aos-los` continúa reservado a un identificador de catálogo.

Todas las vistas aplican la misma condición operativa:

1. La elevación supera la máscara.
2. El azimut y la elevación están dentro de los límites mecánicos.
3. En modo estacionario, el patrón de un boresight fijo aplica su ganancia direccional.
4. El presupuesto de planificación alcanza el umbral de recepción con esa ganancia.

Una línea verde estación–satélite se dibuja solo mientras se cumplen esas condiciones. La carta de elevación usa una curva única: cambia de color en el tramo operativo y marca AOS/LOS con líneas verticales. Las marcas de la línea temporal corresponden a los mismos intervalos calculados.

### Geometría implementada

Orbit convierte la estación geodésica WGS-84 a ITRF. Con semieje mayor \(a\), excentricidad cuadrada \(e^2\), latitud \(\varphi\), longitud \(\lambda\) y altura \(h\):

$$
N(\varphi)=\frac{a}{\sqrt{1-e^2\sin^2\varphi}},
$$

$$
\mathbf r_{\mathrm{est}}=
\begin{bmatrix}
(N+h)\cos\varphi\cos\lambda\\
(N+h)\cos\varphi\sin\lambda\\
\left[N(1-e^2)+h\right]\sin\varphi
\end{bmatrix}.
$$

Para \(\Delta\mathbf r=\mathbf r_{\mathrm{sat,ITRF}}-\mathbf r_{\mathrm{est}}\), las componentes ENU son:

$$
\begin{aligned}
E&=-\sin\lambda\,\Delta x+\cos\lambda\,\Delta y,\\
N&=-\sin\varphi\cos\lambda\,\Delta x-\sin\varphi\sin\lambda\,\Delta y+\cos\varphi\,\Delta z,\\
U&=\cos\varphi\cos\lambda\,\Delta x+\cos\varphi\sin\lambda\,\Delta y+\sin\varphi\,\Delta z.
\end{aligned}
$$

$$
\epsilon=\operatorname{atan2}\left(U,\sqrt{E^2+N^2}\right).
$$

Las posiciones y componentes ENU se expresan en metros. \(\varphi\), \(\lambda\) y \(\epsilon\) se calculan en radianes, aunque la interfaz recibe y muestra grados. La efeméride base se muestrea con el paso solicitado. Cuando dos muestras contiguas cambian de estado operativo, Orbit vuelve a evaluar el mismo propagador y la misma geometría ITRF mediante bisección hasta acotar AOS o LOS a aproximadamente 0.5 s. La elevación máxima publicada sigue siendo la máxima de las muestras del perfil, no un máximo optimizado de forma continua.

El análisis abierto de **Tablas AOS/LOS** explora el perfil a 20 s y refina cada cruce AOS/LOS a aproximadamente 0.5 s; mantiene varias muestras por contacto LEO normal sin bloquear la interfaz con una serie de 24 horas innecesaria. La gráfica recibe solo el entorno de los pases, con 120 s adicionales antes y después de cada uno. Las tarjetas de «próximo pase» usan una consulta aún más ligera de exploración a 30 s, sin descargar la serie de elevación completa y con pocas solicitudes simultáneas. Es una previsión de interfaz; para una decisión operativa se debe abrir la tabla. Como en cualquier muestreo discreto, un contacto completo más corto que el paso puede no quedar encerrado; reduzca el paso mediante la API si su caso requiere ese nivel de detección.

!!! warning "Resolución de pases"

    El refinamiento solo mejora una transición que ya ha quedado encerrada entre dos muestras. Un paso demasiado grande puede omitir por completo un pase breve o representar mal el máximo de elevación. Un paso menor mejora el perfil y la detección de ventanas, pero no convierte el resultado en una predicción certificada para operación. Orbit no modela todavía obstáculo local, refracción, lluvia dependiente del tiempo, interferencias, disponibilidad, agenda de antena ni adquisición.

## Uso en un proyecto

1. Cree una estación y complete geometría, antena, RF y apuntado.
2. Revise las métricas derivadas antes de seleccionar **Añadir a Layers**.
3. En **Ground Stations**, seleccione cualquier estación disponible y una capa TLE/SGP4 de catálogo u órbita manual confirmada para abrir las tablas AOS/LOS. Una órbita manual usa su intervalo UTC diseñado; edítela y vuelva a propagarla antes de cambiar esa ventana.
4. Active cobertura si desea inspeccionar la huella o el volumen de planificación.
5. Guarde el [Proyecto](projects.md) para conservar el contrato RF completo.

## Importar y exportar estaciones

El dialogo **Exportar** permite elegir GeoJSON, KML, KMZ, GeoPackage, WKT,
WKB, Orbit JSON o CSV. KML/KMZ son adecuados para Google Earth; GeoPackage
produce una capa Point real para GIS; WKT/WKB llevan solo geometria Point Z.
Estos formatos espaciales adicionales son solo de exportacion. La
reimportacion sigue disponible con GeoJSON, Orbit JSON y CSV. Una estacion es
un punto WGS-84 fijo, por lo que nunca se exporta como TLE, OEM, efemeride,
ground track o malla de cobertura.

Pulse **Importar** para añadir un archivo GeoJSON, Orbit JSON o CSV al proyecto
abierto. La importación valida cada registro, añade los válidos y comunica los
que se omiten. No restaura una simulación ni sustituye el proyecto actual.

Seleccione **Exportar** en la acción de una estación para elegir entre GeoJSON,
Orbit JSON y CSV; las acciones del proyecto permiten hacer lo mismo con todas
las estaciones. GeoJSON es la opción recomendada para QGIS y otros flujos GIS.
Orbit JSON es la copia nativa de estaciones para reimportarlas en Orbit. CSV
sirve para edición tabular y no contiene resultados calculados.

Los tres formatos reimportables conservan posición y configuración autorada, pero no el
rango, malla, AOS/LOS, SNR, resultados de pases ni entidades del visor. Use el
[JSON de proyecto](projects.md) si necesita restaurar el espacio de trabajo
completo. Consulte [Intercambio de estaciones terrestres](../formats/ground-stations/interchange.md)
para el esquema, campos RF, uso en QGIS y límites de interoperabilidad.
