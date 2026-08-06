# Estaciones de tierra

[Inicio](../index.md) · [Guía de usuario](index.md) · [Capas](layers.md) · [Línea temporal](timeline.md) · [Exportar](export.md)

Una estación de tierra es una capa del espacio de trabajo con posición,
máscara de elevación y atributos de presentación y radio simplificados. Las
estaciones se guardan dentro del documento de proyecto.

## Parámetros configurables

| Grupo | Campos |
| --- | --- |
| General | Nombre, latitud, longitud, altitud, máscara de elevación y radio de cobertura. |
| Tiempo | Zona horaria IANA de la estación, por ejemplo `Europe/Madrid` o `UTC`. |
| Radio | Frecuencia, potencia de transmisión, ganancia de transmisión y ganancia de recepción. |
| Visual | Tamaño y color del símbolo. |
| Cobertura | Visibilidad de cobertura y mapa de calor, cuando se habilitan. |

Las coordenadas de interfaz se introducen en grados para latitud y longitud y
en metros para altitud. La máscara de elevación determina el umbral utilizado
para clasificar una muestra como visible.

## Visibilidad y pases

El acceso operativo comienza en **Ground Stations** de la barra superior. El
panel permite seleccionar una estación y una capa orbital y calcular los pases
de las siguientes 24 h desde la época activa. Usa siempre la máscara de
elevación configurada al crear o editar la estación; no existe una segunda
máscara temporal en el análisis. El resultado indica AOS, LOS y elevación máxima; activa el ground track de la
capa y dibuja en verde el enlace estación-satélite mientras el satélite supera
la máscara. La geometría de la estación y los estados de visibilidad se
evalúan en ITRF/WGS-84. Las marcas verdes de AOS/LOS aparecen en la línea temporal
simulada y la tabla de pases puede exportarse como CSV. El perfil de elevación
del panel representa las muestras calculadas cada 30 s: azul para toda la
trayectoria y verde únicamente donde supera la máscara. No representa todavía
crepúsculo, Sol, Luna ni restricciones astronómicas.

Cada par estación–satélite monitorizado dibuja automáticamente una línea verde
en la escena mientras la elevación instantánea supera la máscara de esa
estación. La línea desaparece al perder visibilidad; no se dibuja para capas
que la estación no monitoriza. El eje temporal de la carta usa la zona horaria
IANA de la estación y conserva el desfase UTC en cada etiqueta.

Actualmente el cálculo operativo de pases está habilitado para las capas con
TLE/SGP4. Las capas OEM, SP3 y los diseños manuales conservan su visualización,
pero requieren un proveedor de efemérides de acceso general antes de poder
planificar pases desde este panel.

## Monitorización

Al crear una estación, Orbit solicita qué capas TLE/SGP4 debe monitorizar. La
misma asignación puede modificarse desde **Satélites monitorizados** en el
panel de estación. Al activar una nueva capa satelital, aparece el flujo
inverso para seleccionar las estaciones que la seguirán. La ficha de cada
estación ofrece **Tablas AOS / LOS** como acceso directo a sus pases.

Orbit calcula elevación de los estados propagados y devuelve muestras con una
marca de visibilidad. Los intervalos AOS/LOS se extraen al cruzar el umbral de
la máscara durante el muestreo de la efeméride.

~~~mermaid
flowchart LR
    S[Estado propagado] --> E[Elevación en la estación]
    E --> M{Máscara de elevación}
    M -->|superada| V[Muestra visible]
    M -->|no superada| N[Muestra no visible]
    V --> P[Extracción de pases]
    N --> P
~~~

!!! warning "Resolución de AOS y LOS"

    La detección de pases se obtiene mediante muestreo por paso. No utiliza
    búsqueda de raíces de alta precisión para el instante de cruce. Reduzca el
    paso de muestreo en el flujo que construye la efeméride si se necesita una
    mayor resolución y valide el resultado con herramientas apropiadas para
    misión.

### Ecuaciones de visibilidad implementadas

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

Para \(\Delta\mathbf r=\mathbf r_{\mathrm{sat,ITRF}}-\mathbf r_{\mathrm{est}}\), las componentes locales que calcula el servicio son:

$$
\begin{aligned}
E&=-\sin\lambda\,\Delta x+\cos\lambda\,\Delta y,\\
N&=-\sin\varphi\cos\lambda\,\Delta x-\sin\varphi\sin\lambda\,\Delta y+\cos\varphi\,\Delta z,\\
U&=\cos\varphi\cos\lambda\,\Delta x+\cos\varphi\sin\lambda\,\Delta y+\sin\varphi\,\Delta z.
\end{aligned}
$$

La elevación y la clasificación de visibilidad son:

$$
\epsilon=\operatorname{atan2}\left(U,\sqrt{E^2+N^2}\right),
\qquad
\mathrm{visible}\iff\epsilon\ge\epsilon_{\min}.
$$

AOS y LOS se extraen de la primera y última muestra que cumplen ese umbral; no se refina el instante de cruce.

### Variables, unidades y uso en Orbit

\(a\), \(N\), \(h\), \(E\), \(N\), \(U\), \(\Delta\mathbf r\) y las posiciones ITRF se expresan en metros; \(e^2\) es adimensional y \(\varphi\), \(\lambda\), \(\epsilon\) y \(\epsilon_{\min}\) se convierten a radianes durante el cálculo. La interfaz recibe latitud/longitud en grados y altitud o máscara en metros/grados, pero `ground_stations.visibility` las normaliza antes de evaluar ENU y el umbral. AOS/LOS se derivan de muestras discretas, no de una raíz continua.

## Cobertura y radio

El footprint y el mapa de calor son representaciones visuales asociadas a la
capa. Los campos de radio permiten un presupuesto de enlace simplificado, no
un modelo completo de cadena RF. No hay modelado publicado de antenas,
propagación atmosférica, interferencia, disponibilidad, planificación de red
ni medidas recibidas.

## Uso en un proyecto

1. Cree o edite la estación desde el espacio de trabajo.
2. Introduzca sus parámetros y guarde los cambios.
3. Active su visibilidad y, si corresponde, cobertura o mapa de calor.
4. Seleccione una época o rango temporal antes de consultar la visibilidad.
5. Guarde o exporte el [Proyecto](projects.md) para conservar la estación.

Las estaciones no son objetos de catálogo y no se exportan como un estándar
externo de estación desde el diálogo de efemérides. Actualmente se conservan
en el JSON de proyecto.
