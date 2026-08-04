# Estaciones de tierra

[Inicio](../index.md) · [Guía de usuario](index.md) · [Capas](layers.md) · [Línea temporal](timeline.md) · [Exportar](export.md)

Una estación de tierra es una capa del espacio de trabajo con posición,
máscara de elevación y atributos de presentación y radio simplificados. Las
estaciones se guardan dentro del documento de proyecto.

## Parámetros configurables

| Grupo | Campos |
| --- | --- |
| General | Nombre, latitud, longitud, altitud, máscara de elevación y radio de cobertura. |
| Radio | Frecuencia, potencia de transmisión, ganancia de transmisión y ganancia de recepción. |
| Visual | Tamaño y color del símbolo. |
| Cobertura | Visibilidad de cobertura y mapa de calor, cuando se habilitan. |

Las coordenadas de interfaz se introducen en grados para latitud y longitud y
en metros para altitud. La máscara de elevación determina el umbral utilizado
para clasificar una muestra como visible.

## Visibilidad y pases

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

+### Ecuaciones de visibilidad implementadas

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
