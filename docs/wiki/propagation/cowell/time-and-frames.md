# Cowell: tiempo y marcos

[Propagación](../index.md) · [Cowell](../cowell.md) · [Tiempo, EOP e ITRF](../../operations/time-eop.md) · [Marcos de referencia](../../engineering/reference-frames.md)

## Época de integración

Cowell recibe una época inicial `UTC` y un estado inicial `EME2000`. Para una
consulta calcula \(\Delta t=t-t_0\) en segundos. UTC identifica los instantes
de entrada y publicación; el paso de RK4 es una decisión numérica, no una nueva
escala de tiempo.

Cada etapa RK4 tiene una época propia: \(t_n\), \(t_n+h/2\), \(t_n+h/2\) y
\(t_n+h\). Un modelo dependiente de la Tierra o de la geometría Sol/Luna debe
evaluarse en el instante de cada etapa, nunca reutilizar datos de la época
inicial a lo largo de todo el paso.

## Ruta para fuerzas terrestres estrictas

`EME2000` es el marco de la ecuación integrada. Para geopotencial de grado y
orden y cualquier futuro modelo ligado a la Tierra, la fuerza se evalúa en
`ITRF` y vuelve como vector libre al marco inercial:

$$
\begin{aligned}
(\mathbf r,\mathbf v)_{ITRF} &= T_{EME2000\rightarrow ITRF}(t)
(\mathbf r,\mathbf v)_{EME2000},\\
\mathbf a_{EME2000} &= R_{ITRF\rightarrow EME2000}(t)\mathbf a_{ITRF}.
\end{aligned}
$$

La primera transformación sí trata correctamente velocidad y deriva la matriz
temporal. La segunda rota una **aceleración libre**; no transforma una nueva
derivada de estado ni añade términos de marco rotante. Esto es deliberado:
integrar en ITRF sin Coriolis, centrífuga y Euler sería inconsistente.

La ruta exige:

| Dato o capacidad | Por qué se requiere |
| --- | --- |
| EOP cubriendo la época | Movimiento polar y DUT1/UT1−UTC. |
| Tabla local de leap seconds | UTC→TAI→TT de forma trazable y sin saltos ocultos. |
| ERFA/SOFA | Precesión-nutación IAU 2006/2000A y transformación de marcos. |
| Realización declarada | No confundir IGS20/IGB20 u otra realización con ITRF sin una ruta de alineación. |
| Validación de matriz | Comprobar \(R^TR\simeq I\) y conservación de norma de vectores libres. |

Si falta alguno, Orbit debe rechazar `geopotential` y cualquier término que
declare ese contrato. Etiquetar el resultado como `ITRF` sin aplicar estos datos
sería incorrecto; para una visualización no estricta corresponde «Marco
terrestre aproximado (sin ruta ECI)».

## Términos de marco celeste

Las perturbaciones solar/lunar, la SRP y la corrección Schwarzschild usan la
misma época que el estado. Sus vectores deben estar referidos a un origen y
marco celeste coherentes con `EME2000`; su proveedor y cobertura deben formar
parte de la procedencia. No se deben mezclar directamente coordenadas
bariocéntricas, geocéntricas, TEME o ITRF.

## Transformación de salida

Después de integrar, `state_at` puede pedir
`EME2000 → CIRS → TIRS → ITRF` al `FrameTransformService`. TT interviene en la
reducción celeste y UT1 en la rotación terrestre. Esta conversión de salida no
sustituye la evaluación por etapa explicada arriba: una fuerza terrestre debe
haber usado los datos correctos durante la integración, no solo al representar
el resultado.

## Límite de precisión

La fidelidad final es el mínimo entre la calidad de las fuerzas, la orientación
terrestre, los datos auxiliares y el integrador. EOP exactos no compensan un
modelo atmosférico simplificado; un geopotencial correcto tampoco compensa un
paso de integración demasiado grueso. La procedencia permite distinguir esas
fuentes de error, no eliminarlas.
