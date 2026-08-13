# Geopotencial de grado y orden configurable

[Inicio](../index.md) · [Propagación](index.md) · [Modelos de fuerzas](force-models.md) · [Modelos de gravedad](../engineering/gravity-models.md)

## Objetivo y estado

El término canónico disponible es `geopotential`. Evalúa un campo gravitatorio
terrestre de armónicos esféricos hasta un **grado** \(N\) y un **orden** \(M\)
configurables, con \(0\leq M\leq N\). El runtime solo lo habilita cuando hay un
campo local válido y la ruta de marcos estricta; los zonales históricos `j2`,
`j3` y `j4` siguen disponibles como compatibilidad independiente.

No habrá una degradación silenciosa a J2/J3/J4 cuando se solicite
`geopotential`. Si el producto de gravedad o la ruta de marcos no cumplen el
contrato, la operación debe rechazar la solicitud.

## Campo y configuración

El campo se carga de un fichero ICGEM `.gfc` identificado. El lector admite
únicamente coeficientes **completamente normalizados** y debe conservar:

- nombre y fuente publicados del modelo;
- huella criptográfica del fichero;
- \(\mu\), radio de referencia \(R_\oplus\), normalización y grado máximo del
  encabezado;
- coeficientes \(\bar C_{nm}\), \(\bar S_{nm}\) y su intervalo válido si el
  producto lo publica;
- grado y orden efectivamente seleccionados.

La carga debe rechazar un encabezado incompleto, una normalización no admitida,
coeficientes no finitos, un grado/orden fuera del campo o una huella esperada
que no coincida. No se cambia de normalización ni se inventan coeficientes en
segundo plano.

| Ajuste | Significado | Restricción |
| --- | --- | --- |
| `degree` | Máximo \(n\) evaluado. | Entero \(2\leq N\leq \min(N_{campo},2159)\). `2159` es el máximo semántico de modelo/API/UI, alineado con un campo completo EGM2008; 0/1 se conservan solo como valores inactivos de compatibilidad. |
| `order` | Máximo \(m\) por grado. | Entero \(0\leq M\leq \min(N,M_{campo},2159)\). |
| `geopotential` | Activa la suma armónica no central. | No combinar con `j2`, `j3` o `j4`. |

La gravedad central se mantiene como término `central` separado y obligatorio.
Así no se suma dos veces el término \(n=0\). El runtime rechaza con 422 un
grado menor que 2 cuando `geopotential` está activo.

!!! warning "Límite semántico y presupuesto de ejecución son distintos"

    `2159 × 2159` es el máximo que Orbit admite como contrato de campo,
    configuración y procedencia; no significa que el RK4 actual pueda ejecutar
    automáticamente ese campo completo. El evaluador Python de paso fijo tiene
    un guard explícito de **2.555 coeficientes armónicos no centrales por
    etapa**. Una configuración que lo supere se rechaza antes de propagar: no
    se recorta ni se sustituye por un modelo menor de forma silenciosa.

    Un `70 × 70` denso es un ejemplo que cabe en el perfil actual. Una
    configuración zonal o de orden bajo puede alcanzar grados superiores si sigue
    dentro del presupuesto. Un `2159 × 2159` completo requiere un evaluador
    optimizado y un integrador adaptativo antes de ofrecerse como cálculo de
    misión.

## Elección de grado y orden \(N\times M\)

El valor debe elegirse por convergencia contra la tolerancia de la misión, no
por usar el mayor número disponible. Como punto de partida práctico:

| Caso | Selección inicial | Motivo y límite |
| --- | ---: | --- |
| Prueba rápida o diseño preliminar | **20 × 20** | Coste bajo; útil para comprobar geometría y configuración. |
| LEO general, análisis de ingeniería | **40 × 40** | Punto de partida recomendado para comparar sensibilidad. |
| LEO, arco corto o sensibilidad | **60 × 60** | Añade detalle sin agotar normalmente el perfil actual. |
| Máximo denso del perfil RK4 actual | **70 × 70** | Ejemplo dentro del guard de 2.555 términos; no es el máximo semántico del modelo. |
| MEO/GNSS | **20 × 20** | Los armónicos altos se atenúan con la altura; validar siempre contra la referencia elegida. |
| GEO | **12 × 12 a 20 × 20** | Punto de partida; otras perturbaciones pueden dominar el presupuesto de error. |
| Estudio de misión futuro | **120 × 120** inicial; **180 × 180 a 360 × 360** tras convergencia | Requiere el futuro motor optimizado e integración adaptativa. |
| Campo EGM2008 completo | **2159 × 2159** | Máximo de datos/configuración admitido; no ejecutable con el RK4 Python actual. |

Para justificar una selección, propague el mismo arco con `20 × 20`, `40 ×
40` y `60 × 60`; compare posición final y RMS con el producto de referencia
—por ejemplo un SP3— y elija el menor modelo cuya diferencia con el siguiente
cumpla el umbral de la misión. Esta prueba no sustituye mareas, arrastre, SRP,
actitud ni una prueba de paso de integración.

## J1, J2 y J3

Los armónicos zonales están incluidos de forma natural cuando el campo y el
grado seleccionado los contienen. Con coeficientes completamente normalizados,
la relación habitual para el zonal es:

$$
J_n=-\sqrt{2n+1}\;\bar C_{n0}.
$$

Por tanto, J2 y J3 no serán interruptores adicionales al usar
`geopotential`. J1 tampoco se ofrece como fuerza seleccionable: en un modelo de
la Tierra cuyo origen es su centro de masas, el grado uno representa un
desplazamiento del origen y debe ser nulo (salvo redondeo documentado). Activar
J1 sobre un origen ya centrado introduciría una aceleración espuria, no más
fidelidad.

## Evaluación física y marcos

Los coeficientes de un geopotencial terrestre están ligados a la Tierra. Por
eso no se evalúan con la longitud de un vector `EME2000` como si el eje de giro
fuese fijo. Para **cada** evaluación \(f(t,\mathbf y)\) de RK4:

1. Orbit transforma \((\mathbf r,\mathbf v)\) de `EME2000` a `ITRF` en la época
   de la etapa.
2. Evalúa la aceleración no central \(\mathbf a_{ITRF}\) en el ITRF instantáneo.
3. Rota la aceleración libre a `EME2000`:

   $$
   \mathbf a_{EME2000}=R_{ITRF\rightarrow EME2000}(t)\mathbf a_{ITRF}.
   $$

4. Suma \(\mathbf a_{EME2000}\) a la derivada que se integra.

El estado no se integra en ITRF; eso exigiría términos ficticios de Coriolis,
centrífugo y Euler. La rotación anterior aplica únicamente a la aceleración
física del geopotencial y mantiene la ecuación de movimiento en el marco
inercial de Cowell.

La transformación debe usar EOP, UT1−UTC, movimiento polar, una tabla de
segundos intercalares válida y ERFA/SOFA con la reducción IAU 2006/2000A. Si el
producto usa una realización distinta de ITRF, también debe existir una ruta de
alineación declarada. Sin esos datos, el marco correcto es aproximado y el
término `geopotential` no debe habilitarse.

## Ecuación y unidades

El potencial completo es:

$$
U(r,\phi,\lambda)=\frac{\mu}{r}\left[1+
\sum_{n=2}^{N}\left(\frac{R_\oplus}{r}\right)^n
\sum_{m=0}^{\min(n,M)}\bar P_{nm}(\sin\phi)
\left(\bar C_{nm}\cos m\lambda+\bar S_{nm}\sin m\lambda\right)\right],
\qquad \mathbf a=-\nabla U.
$$

| Símbolo | Significado | Unidad |
| --- | --- | --- |
| \(U\) | Potencial gravitatorio. | km²/s². |
| \(r,\phi,\lambda\) | Radio, latitud y longitud geocéntricos en ITRF. | km, rad, rad. |
| \(N,M\) | Grado y orden aplicados. | Enteros. |
| \(\bar P_{nm}\), \(\bar C_{nm}\), \(\bar S_{nm}\) | Legendre y coeficientes completamente normalizados. | Adimensionales. |
| \(\mathbf a\) | Aceleración no central retornada al núcleo Cowell. | km/s². |

La implementación debe calcular el gradiente analíticamente; no mediante
diferencias finitas. Se comprueba contra los términos zonales J2/J3/J4 en
puntos no polares y se rechaza cualquier resultado no finito.

## Validaciones numéricas obligatorias

- La matriz de rotación debe ser ortonormal dentro de la tolerancia numérica:
  \(R^TR\simeq I\).
- La norma de un vector libre debe conservarse al rotarlo:
  \(\lVert\mathbf a_{ITRF}\rVert\simeq\lVert\mathbf a_{EME2000}\rVert\).
- La configuración de grado/orden debe pertenecer al campo cargado.
- El modelo de prueba zonal de orden cero debe reproducir los términos
  históricos J2/J3/J4 en los puntos y tolerancias documentados por las pruebas.
- Cada etapa RK4 debe usar su propia época, incluidas las dos medias etapas.

## Lo que aún no incluye

Este geopotencial estático no incluye correcciones de marea sólida, marea
oceánica, carga atmosférica, variaciones temporales \(\dot C_{nm},\dot S_{nm}\)
y coeficientes estacionales. Esas correcciones requieren convenciones IERS,
efemérides coherentes de Sol/Luna y una política explícita de producto; se
tratan en [Mareas](tides.md).

Tampoco convierte por sí mismo la integración RK4 de 60 s en una solución de
precisión de misión. Para arcos largos, perigeos rápidos o un grado alto habrá
que añadir control adaptativo de error y comparar contra una referencia.
