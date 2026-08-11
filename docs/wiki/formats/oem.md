# OEM

[Inicio](../index.md) · [Formatos](index.md) · [Estados cartesianos](../engineering/cartesian-states.md) · [Sistemas temporales](../engineering/time-systems.md)

## Alcance dividido

Orbit tiene tres rutas OEM diferentes que no deben confundirse.

| Ruta | Comportamiento |
| --- | --- |
| Importación de catálogo mediante UI/gateway | Solo extrae `TLE_LINE1` y `TLE_LINE2` embebidos. Un OEM ephemeris puro se rechaza. |
| Visor web local | Puede cargar un OEM puro como track visual local y transitorio. |
| `OemStateProvider` de Python | Lee segmentos OEM tabulados, interpolación y parte de covarianza. No está conectado a UI, gateway, API pública ni `OrbitRuntime`. |

Las tres rutas tienen contratos independientes. El visor puede mostrar un OEM
puro como track local y transitorio, pero esa visualización no pasa por
Gateway/FastAPI, no crea un objeto de catálogo y no registra un proveedor de
efemérides en `OrbitRuntime`. `OemStateProvider` es una capacidad de biblioteca
interna, no una conversión de fichero a capa, satélite de catálogo o fuente de
propagación del producto.

## Lector Python de segmentos

`OemStateProvider.from_text` exige `CCSDS_OEM_VERS` y uno o más bloques
`META_START`/`META_STOP`. Cada segmento maneja los siguientes metadatos;
`REF_FRAME` y `TIME_SYSTEM` son obligatorios:

| Metadato | Uso |
| --- | --- |
| `REF_FRAME` (obligatorio) | Marco nativo y, si procede, realización. |
| `TIME_SYSTEM` (obligatorio) | Escala temporal nativa. |
| `OBJECT_NAME`, `OBJECT_ID`, `CENTER_NAME` | Se conservan cuando están presentes; el centro de estados por defecto es `EARTH`. |
| `START_TIME`, `STOP_TIME`, `USEABLE_*` | Metadatos de segmento conservados. |
| `INTERPOLATION`, `INTERPOLATION_DEGREE` | Opcionales; si se declaran, su grado y las muestras deben poder cumplirlos. |

Los segmentos conservan sus metadatos de forma independiente. Si existen varios,
una consulta debe incluir `segment_index`; Orbit nunca interpola a través de un
cambio de marco, realización o sistema temporal.

## Registros de estado

El lector acepta una época CCSDS de calendario o año/día del año, seguida de:

```text
EPOCH X Y Z VX VY VZ
EPOCH X Y Z VX VY VZ AX AY AZ
```

Las posiciones están en km, velocidades en km/s y aceleraciones en km/s². La
aceleración opcional requiere `CCSDS_OEM_VERS` 2.0 o posterior. Los estados se
convierten a SI al entrar en `StateVector`, pero conservan `REF_FRAME` y
`TIME_SYSTEM` de origen.

Una escala temporal desconocida o un segmento sin estados utilizables falla en
la construcción del proveedor.

## Interpolación

| Declaración | Regla aplicada |
| --- | --- |
| Sin `INTERPOLATION` | Lineal entre las dos muestras contiguas. |
| `LINEAR` | Requiere grado 1. |
| `LAGRANGE` | Requiere grado ≥1 y `grado + 1` muestras. |
| `HERMITE` | Requiere grado impar, velocidades y `(grado + 1)/2` muestras. |

Hermite utiliza restricciones de posición y velocidad y deriva aceleración del
polinomio. Lagrange y lineal preservan aceleración solo cuando las muestras
correspondientes la contienen. Toda consulta fuera de cobertura falla; no hay
extrapolación.

## OEM del visor: ruta distinta

La carga OEM disponible en el visor web no usa todavía `OemStateProvider`.
Lee una pista local y transitoria de puntos, la dibuja como polilínea y mueve
el marcador con interpolación lineal por tramos entre sus horas de muestra.
Por ello un `INTERPOLATION = LAGRANGE` o `HERMITE` de un OEM no se aplica en
esa ruta visual; no debe interpretarse como una validación del método
declarado por el productor.

La ruta Python de la tabla anterior sí honra la declaración del segmento,
pero no está conectada actualmente a la importación OEM del catálogo ni al
runtime. Para la diferencia general entre evaluación de estado, muestreo y
reproducción visual, consulte
[Efemérides e interpolación](../orbit-service.md).

## Covarianza OEM

Para OEM 2.0 o posterior se lee `COVARIANCE_START`/`COVARIANCE_STOP` con:

- `EPOCH` seguido de seis filas triangulares inferiores 1..6;
- `COV_REF_FRAME` opcional; si falta, se usa el `REF_FRAME` del segmento;
- comentarios asociados a la matriz.

La matriz se expande simétricamente al contrato 6×6 y el lector aplica un
factor de `1_000_000` para llevar los valores km-basados a su contrato SI. Se
adjunta solo si la consulta coincide exactamente con el `EPOCH` de navegación;
no se interpola una covarianza.

Los marcos cartesianos que el transformador puede convertir pueden llevar la
covarianza al marco del estado. `RTN`, `RSW` y `TNW` se rechazan de forma
explícita, así como una realización terrestre que no pueda transformarse sin
inventar una operación de datum.

## Transformación posterior

`native_state_at` devuelve el estado nativo. `state_at` solicita una
transformación explícita mediante el servicio de marcos. Una realización IGS,
por ejemplo, no se convierte automáticamente a ITRF. Consulte
[Marcos de referencia](../engineering/reference-frames.md).

## Exportación e importación de catálogo

El importador de catálogo detecta `.oem` y solo acepta el contenido cuando
encuentra `TLE_LINE1` y `TLE_LINE2`; en tal caso registra una entrada TLE con
`sourceFormat=OEM`. Un OEM sin ambas líneas devuelve un error explícito.

La exportación OEM de catálogo emite una cabecera de perfil mínimo con las
líneas TLE como comentarios, no una efeméride muestreada. La exportación de
efemérides SGP4 puede emitir puntos OEM separados. Ninguna de estas salidas
implica soporte completo de perfiles OEM.

## Límites

- No hay carga de OEM como objeto de catálogo, proveedor público REST/gateway
  o fuente del runtime orbital; el visor solo puede mostrar un track local y
  transitorio.
- No hay extrapolación ni mezcla de segmentos.
- No hay covarianza local orbital, covarianza interpolada, OD ni propagación
  de incertidumbre.
- El lector no es un validador completo de todos los perfiles CCSDS OEM.
