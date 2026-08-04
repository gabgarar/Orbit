# Estados cartesianos

[Inicio](../index.md) · [Ingeniería](index.md) · [Marcos de referencia](reference-frames.md) · [Sistemas temporales](time-systems.md)

## Propósito

`StateVector` es el contrato común entre propagadores, lectores de efemérides
y transformaciones de marcos. Representa un estado cartesiano geocéntrico con
unidades SI y metadatos suficientes para conservar su significado físico.

No es una etiqueta de visualización. La posición, la velocidad y la época no
pueden interpretarse correctamente sin su marco, escala temporal y centro.

## Campos del contrato

| Campo | Obligatorio | Unidad o forma | Regla |
| --- | ---: | --- | --- |
| `epoch` | Sí | `datetime` con zona | La época debe ser consciente de zona/escala. |
| `time_scale` | Sí | etiqueta `TimeScale` | Debe ser una escala reconocida. |
| `frame` | Sí | `FrameId` o etiqueta conservada | `ECI` y `ECEF` genéricos se rechazan. |
| `frame_realization` | Sí, si aplica | texto | Declara, por ejemplo, `ITRF2020` o `IGS20`. |
| `center` | Sí | texto normalizado | Las transformaciones implementadas son geocéntricas, con `EARTH`. |
| `position_m` | Sí | m | Tres componentes finitas. |
| `velocity_m_s` | No | m/s | Tres componentes finitas cuando existe. |
| `acceleration_m_s2` | No | m/s² | Tres componentes finitas cuando existe. |
| `covariance` | No | matriz 6×6 SI | Debe ser finita y de dimensión exacta. |
| `provenance` | No | mapa inmutable | Conserva origen, transformaciones e interpolación. |

La fábrica `StateVector.from_kilometres` existe en la frontera con motores y
formatos que usan km y km/s. Tras crear el objeto, el contrato interno siempre
usa metros, metros por segundo y metros por segundo cuadrado.

## Convención de estado

El vector de seis componentes es:

$$
\mathbf{x}=\begin{bmatrix}\mathbf r\\\mathbf v\end{bmatrix}
=\begin{bmatrix}x&y&z&v_x&v_y&v_z\end{bmatrix}^{T}.
$$

`components()` solo está disponible cuando existe velocidad y se conserva como
adaptador de compatibilidad para consumidores históricos. El código nuevo debe
usar los campos con nombre o `state_at`/`native_state_at`.

## Validación y normalización

- `J2000` y `EME2K` se normalizan a `EME2000`; `ITRS` se normaliza a `ITRF`.
- Una etiqueta compacta `ITRF<época>` se expresa como familia `ITRF` y
  realización correspondiente.
- `IGS20`, `IGb20` e `IGc20` se conservan como familia `IGS` con realización;
  no se renombran como ITRF.
- Los números no finitos, matrices que no son 6×6 y épocas sin zona se
  rechazan en la construcción.

!!! warning "No usar ECI/ECEF como contrato"

    `ECI` y `ECEF` no identifican una reducción terrestre ni un marco inercial
    suficientemente precisos. Declare `TEME`, `EME2000`, `GCRF`, `CIRS`,
    `TIRS`, `PEF` o `ITRF`, según corresponda.

## Transformación de posición, velocidad y covarianza

Para una matriz de rotación dependiente del tiempo \(R(t)\), Orbit aplica:

$$
\mathbf r' = R\mathbf r,
\qquad
\mathbf v' = R\mathbf v + \dot R\mathbf r.
$$

Cuando hay aceleración:

$$
\mathbf a' = R\mathbf a + 2\dot R\mathbf v + \ddot R\mathbf r.
$$

El servicio aproxima \(\dot R\) y \(\ddot R\) mediante diferencias centrales
de matrices alrededor de la época. Si se proporciona covarianza, transforma
la matriz 6×6 con el jacobiano cinemático que contiene \(R\) y \(\dot R\).
La covarianza no se propaga en el tiempo por los propagadores de Orbit.

## Procedencia

Una transformación añade a `provenance.frame_transform` el marco origen,
destino, ruta, modelo de reducción, identidad del EOP y procedencia de la
tabla de segundos intercalares. Los interpoladores tabulados añaden
`provenance.tabular_interpolation` con método, grado y épocas empleadas.

Esto permite distinguir un estado nativo de uno transformado o interpolado sin
inferirlo a partir de sus componentes.

## Límites

- Las transformaciones incorporadas solo admiten estados con centro `EARTH`.
- No existe una representación de actitud, masa, maniobra ni covarianza de
  proceso dentro de `StateVector`.
- La presencia de una covarianza no convierte a Orbit en un sistema de
  determinación o propagación de incertidumbre.

Consulte [Marcos de referencia](reference-frames.md),
[Sistemas temporales](time-systems.md) y [Formatos de efemérides](../formats/overview.md).
