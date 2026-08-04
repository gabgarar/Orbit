# Servicio orbital

## Visión general

El servicio Python valida el dominio orbital, adapta formatos, propaga, transforma marcos y ofrece primitivas de análisis. Se alcanza a través del gateway, nunca como servidor público independiente.

## Formatos

| Formato | Contrato |
| --- | --- |
| TLE | Entrada SGP4; marco nativo TEME. |
| OMM / OPM | Intercambio de elementos y parámetros orbitales. |
| OEM | Efemérides cartesianas con marco, escala y covarianza por segmento. |
| SP3 | Preparado para ingestión precisa; la realización terrestre será explícita. |
| CPF / RINEX | Cobertura declarada como soportada, parcial o no soportada. |

Un segmento OEM mantiene su escala y marco. La covarianza debe poder convertirse al marco del estado; si no, la importación falla antes de relabelar datos de forma insegura.

## Catálogo, análisis y exportación

El servicio inspecciona registros, crea órbitas manuales, analiza y genera salidas conscientes del formato. Comparación de propagadores, gráficas, estadísticas, eventos, medidas, tracking y alcance de OD conservan identidad de estado, época y transformaciones aplicadas.

+## Ecuaciones de efemérides

Orbit no reintegra un OEM o SP3 tabulado: evalúa la interpolación declarada del segmento. Para dos muestras consecutivas y \(\alpha=(t-t_0)/(t_1-t_0)\), la ruta lineal usa:

$$
\mathbf x(t)=(1-\alpha)\mathbf x_0+\alpha\mathbf x_1.
$$

Para una ventana Lagrange, cada componente vectorial se evalúa con:

$$
\mathbf x(t)=\sum_{i=0}^{n}\mathbf x_i
\prod_{\substack{j=0\\j\ne i}}^{n}
\frac{t-t_j}{t_i-t_j}.
$$

La ruta Hermite construye un polinomio que satisface las restricciones de posición y velocidad declaradas:

$$
H(t_i)=\mathbf r_i,\qquad \dot H(t_i)=\mathbf v_i.
$$

La aceleración Hermite se deriva del polinomio, \(\mathbf a(t)=\ddot H(t)\). Orbit no interpola la covarianza: la salida interpolada declara explícitamente que la covarianza es nula.

## Límites

- SP3 y OEM de alta fidelidad no se degradan a semántica TLE.
- No se anuncia precisión, datum o modelo de fuerzas que el origen no haya establecido.
- Los formatos no soportados siguen siendo límites explícitos.
