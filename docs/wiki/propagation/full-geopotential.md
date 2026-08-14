# Geopotencial de grado y orden configurable

[Inicio](../index.md) · [Propagación](index.md) · [Modelos de fuerzas](force-models.md) · [Modelos de gravedad](../engineering/gravity-models.md)

## Objetivo y estado

El término canónico disponible es `geopotential`. Evalúa un campo gravitatorio
terrestre de armónicos esféricos hasta un **grado** \(N\) y un **orden** \(M\)
configurables, con \(0\leq M\leq N\). El runtime solo lo habilita cuando hay un
campo ICGEM local explícito y controlado por checksum **o** una caché NGA ya
validada, y existe una ruta temporal EME2000↔ITRF; los zonales históricos `j2`,
`j3` y `j4` siguen disponibles como compatibilidad independiente.

No habrá una degradación silenciosa a J2/J3/J4 cuando se solicite
`geopotential`. Si el producto de gravedad o la ruta temporal obligatoria no
cumplen el contrato, la operación debe rechazar la solicitud. En órbitas
manuales, la falta de una muestra EOP automática se distingue: se propaga con
rotación nominal etiquetada, nunca como una ruta ECI/SP3 rigurosa.

## Campo y configuración

El campo se carga de un fichero ICGEM `.gfc` identificado o del miembro de
coeficientes reconocido de un archivo EGM oficial de NGA. El lector admite
únicamente coeficientes **completamente normalizados** y debe conservar:

- nombre publicado del modelo y URL de fuente o fuente local explícita;
- huella criptográfica del archivo/fichero;
- \(\mu\), radio de referencia \(R_\oplus\), normalización, sistema de marea y
  `maxDegree`/`maxOrder` detectados, del encabezado ICGEM validado o del
  miembro de coeficientes NGA ya descomprimido;
- coeficientes \(\bar C_{nm}\), \(\bar S_{nm}\) y su intervalo válido si el
  producto lo publica;
- grado y orden efectivamente seleccionados.

La carga debe rechazar un encabezado incompleto, una normalización no admitida,
coeficientes no finitos, un grado/orden fuera del campo o una huella esperada
que no coincida. No se cambia de normalización ni se inventan coeficientes en
segundo plano.

| Ajuste | Significado | Restricción |
| --- | --- | --- |
| `degree` | Máximo \(n\) evaluado. | Entero \(2\leq N\leq N_{max}\), donde `maxDegree` se lee de la fuente validada. 0/1 se conservan solo como valores inactivos de compatibilidad. |
| `order` | Máximo \(m\) por grado. | Entero \(0\leq M\leq \min(N,M_{max})\), donde `maxOrder` se lee de la fuente validada. |
| `geopotential` | Activa la suma armónica no central. | No combinar con `j2`, `j3` o `j4`. |

La gravedad central se mantiene como término `central` separado y obligatorio.
Así no se suma dos veces el término \(n=0\). El runtime rechaza con 422 un
grado menor que 2 cuando `geopotential` está activo.

## Caché automática NGA EGM

Salvo que se configure un campo ICGEM explícito con `ORBIT_GRAVITY_FIELD_PATH`,
Orbit puede usar una caché local de estos dos productos oficiales fijos de NGA:

| Modelo | Fuente oficial | Campo seleccionable | Detalle del archivo conservado como procedencia |
| --- | --- | --- | --- |
| `EGM96` | [Armónicos esféricos NGA EGM96](https://earth-info.nga.mil/php/download.php?file=egm-96spherical) | `maxDegree` / `maxOrder` detectados tras validar. | Se registra el archivo y la cobertura de coeficientes, sin asumirlos por el nombre del modelo. |
| `EGM2008` | [Armónicos esféricos NGA EGM2008](https://earth-info.nga.mil/php/download.php?file=egm-08spherical) | `maxDegree` / `maxOrder` detectados tras validar. | `2190 × 2190` es un sobre de archivo anunciado/protector, no una promesa de matriz densa completa ni de selección efectiva. |

El directorio de caché por defecto es `data/geopotential`; debe conservarse en
el volumen persistente `./data`. `ORBIT_GRAVITY_MODEL` selecciona `EGM96` o
`EGM2008` (por defecto). El monitor de salud, después de que FastAPI esté
saludable, valida primero una copia local y renueva una ausente u obsoleta tras
el intervalo configurado (30 días por defecto). Una etapa Cowell/RK4 nunca
espera una descarga ni realiza trabajo de refresco de disco o red.

Antes de activar una entrada de caché, Orbit acepta solo la URL HTTPS fija de
NGA sin redirecciones, aplica límites de tamaño de archivo/extracción, exige el
miembro ZIP esperado, valida rutas seguras, continuidad completa de
coeficientes y valores finitos físicamente plausibles, registra SHA-256 y
sustituye archivo y coeficientes validados de forma atómica. Un campo ICGEM
explícito mantiene prioridad y la caché nunca lo sustituye silenciosamente.

El registro lee grado máximo y orden máximo de esa fuente validada y
descomprimida, y los publica para la UI y Built-In Test. Son los únicos límites
que se ofrecen para seleccionar. El nombre de un modelo o un sobre publicado
no sustituye la cobertura real de coeficientes; en particular, un grado máximo
y un orden máximo no implican por sí mismos una matriz cuadrada completa.
Antes de la primera validación, esos valores son `null` y el selector falla
cerrado, en vez de presentar un límite numérico no verificado.

Si el miembro validado declara y contiene de forma continua todos los
coeficientes hasta \(N=M=2190\), Orbit publicará esa **cobertura** como
**2190 × 2190**. No es una autorización de ejecución: el RK4 actual rechaza
esa selección por superar su presupuesto de 2.555 términos por etapa. Por
ejemplo, una selección zonal \(N=2190, M=0\) sí puede ejecutarse si las filas
validadas la cubren; una selección por encima del presupuesto se rechaza de
forma explícita. Si la cabecera y las filas no coinciden, no se inventan
términos: la carga se rechaza o el perfil validado limita cada grado al último
orden realmente presente.

Si falla la renovación y existe una copia antigua válida, esa copia sigue
utilizable con **Warning**. Si no hay copia local válida (o se deshabilita la
descarga automática), el geopotencial completo no está disponible y el panel
publica un aviso/error recuperable; Orbit no lo sustituye por J2/J3/J4. La
caché aporta únicamente coeficientes gravitatorios: no aporta ERP, ruta de
datum ni autorización para ECI estricto.

!!! warning "Límites de modelo derivados del archivo y presupuesto de ejecución"

    El techo de selección UI/API es `maxDegree` y `maxOrder` de la fuente
    validada, no un rectángulo EGM2008 codificado. El sobre publicado de
    EGM2008 anunciado/protector puede describirse como 2190 × 2190, pero Orbit
    no afirma que cada archivo validado contenga un campo denso completo en ese
    sobre.

    Ese límite de procedencia/selección no significa que el RK4 actual pueda
    ejecutar todo el campo detectado. El evaluador Python de paso fijo tiene un
    guard explícito de **2.555 coeficientes armónicos no centrales por etapa**.
    Una configuración que lo supere se rechaza antes de propagar: no se recorta
    ni se sustituye por un modelo menor de forma silenciosa.

    Un `70 × 70` denso es un ejemplo que cabe en el perfil actual. Una
    configuración zonal o de orden bajo puede alcanzar grados superiores si
    sigue dentro del presupuesto. Los campos completos de misión requieren un
    evaluador optimizado y un integrador adaptativo antes de poder ofrecerse.

Para el registro automático, una solicitud que supera la cobertura de la fuente
validada seleccionada devuelve grado/orden efectivos y una indicación explícita
`clamped`. Este clamp trazable de modelo es distinto del presupuesto de etapa
RK4, que rechaza una evaluación de fuerza fuera de presupuesto en lugar de
reducirla silenciosamente.

!!! info "Límite de carga para ICGEM local explícito"

    Un `.gfc` indicado mediante `ORBIT_GRAVITY_FIELD_PATH` se comprueba y se
    materializa completo al arrancar; no se presupone que un N×M posterior vaya
    a permitir descartar filas del archivo. Para acotar memoria y tiempo de
    arranque, ese camino acepta como máximo **16 MiB** y **2.556 coeficientes
    completos** (un campo denso `70 × 70`, incluido C00). Un encabezado de grado
    71 o superior se rechaza antes de retener coeficientes, con un error que
    indica usar la caché NGA validada o un motor de misión optimizado.

    No se truncan ni se convierten en ceros las filas excedentes. El registro
    NGA conserva y valida el archivo grande en disco, pero materializa en
    memoria únicamente el N×M seleccionado dentro del presupuesto RK4; es la
    ruta indicada para EGM96/EGM2008 y para estudiar órdenes bajos a grados
    altos.

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
| Mayor selección EGM2008 validada | `maxDegree` / `maxOrder` publicados | Consulte los valores efectivos en la UI/Built-In Test; la ejecución densa completa no está disponible en el RK4 Python actual. |

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

Para una órbita manual, la transformación usa el proveedor automático IERS C01
del proceso para EOP, UT1−UTC, movimiento polar y LOD; el mismo proveedor se
usa en `drag`. Si no hay una muestra C01 válida para una etapa, la propagación
manual conserva una rotación terrestre **nominal** y lo publica como advertencia
de procedencia, en vez de pedir un ERP manual. Una instantánea ERP local sigue
siendo un override opcional y reproducible que debe cubrir su diseño completo.

La ruta EME2000↔ITRF requiere además una tabla de segundos intercalares válida y
ERFA/SOFA con la reducción IAU 2006/2000A. Si un producto preciso usa una
realización distinta de ITRF, también necesita una ruta de alineación declarada.
La conversión ECI rigurosa de SP3 es un contrato separado y fail-closed: ni la
caché NGA, ni C01 global ni la rotación nominal la habilitan.

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
