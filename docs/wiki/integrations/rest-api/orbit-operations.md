# REST API: propagación y efemérides

[Integraciones](../index.md) · [REST API](../rest-api.md) · [Propagación](../../propagation/index.md)

## Rutas de propagación

| Método y ruta | Operación | Límites comprobables |
| --- | --- | --- |
| `GET /api/propagate/:satId` | Propaga un satélite de catálogo al instante `at` opcional. | Si se omite `at`, usa el instante UTC actual. |
| `POST /api/propagate` | Propaga desde catálogo o TLE explícito. | Cuerpo `sat_id` o `line1` + `line2`; `at` opcional. |
| `GET /api/orbits/:satId` | Muestrea una órbita futura de catálogo. | `horizon_hours`: 0.1–8760; `samples`: 2–7200 si se especifica. |
| `POST /api/orbits` | Muestrea una órbita desde catálogo o TLE explícito. | Los mismos límites de horizonte y muestras. |
| `POST /api/ephemeris` | Construye una serie temporal. | `start_time < end_time`, `step_seconds` > 0 y ≤ 3600; máximo 20 000 puntos. |
| `POST /api/orbit-parameters` | Calcula estados y elementos osculadores en un rango. | 2–600.000 muestras; una cadencia explícita se conserva completa. Los modelos RK4 mantienen además su presupuesto independiente de pasos internos. |

Ejemplo de propagación desde TLE explícito:

~~~json
POST /api/propagate
Content-Type: application/json

{
  "line1": "1 25544U 98067A   24120.50000000  .00000000  00000+0  00000+0 0  9990",
  "line2": "2 25544  51.6400 120.0000 0005000  20.0000 340.0000 15.50000000000000",
  "at": "2026-08-04T12:00:00Z"
}
~~~

Una efeméride usa `sat_id`, `start_time`, `end_time`, `step_seconds` e
`include_velocity` opcionalmente.

!!! warning "Fidelidad y marcos"

    Los TLE se propagan con SGP4 y tienen estado nativo TEME. La salida de
    renderizado se transforma a ITRF. No use una respuesta de visualización
    como efeméride de navegación de alta fidelidad.

## Productos GNSS precisos

Los productos precisos se cargan por una ruta distinta del catálogo TLE. El
gateway expone el contrato del backend Python, pero el archivo se proporciona
siempre desde el cliente local: Orbit no recibe una URL, token Earthdata ni
credencial de CDDIS/IGS/ESA.

| Método y ruta | Operación | Límite principal |
| --- | --- | --- |
| `GET /api/precise-products` | Lista productos persistidos, diagnósticos de rehidratación y los IDs runtime por satélite. | No vuelve a descargar fuentes. |
| `POST /api/precise-products/preview` | Valida y analiza un producto GNSS sin guardarlo ni registrar capas. | Devuelve los satélites SP3 disponibles para seleccionar. |
| `POST /api/precise-products/import` | Valida, persiste y registra un producto GNSS. | Un SP3 obligatorio y hasta un archivo de cada auxiliar: CLK, ERP, SUM, ATT y OSB. |

El cuerpo canónico de importación es:

~~~json
POST /api/precise-products/import
Content-Type: application/json

{
  "sp3": {
    "name": "IGS0OPSFIN_20262230000_01D_15M_ORB.SP3.gz",
    "kind": "sp3",
    "content_base64": "<base64-del-archivo-local>"
  },
  "clk": {
    "name": "IGS0OPSFIN_20262230000_01D_05M_CLK.CLK.gz",
    "kind": "clk",
    "content_base64": "<base64-del-archivo-local>"
  },
  "erp": {
    "name": "IGS0OPSFIN_20262230000_01D_ERP.ERP.gz",
    "kind": "erp",
    "content_base64": "<base64-del-archivo-local>"
  }
}
~~~

El mismo cuerpo enviado a `POST /api/precise-products/preview` devuelve
`preview.product` y `preview.satellites`, sin crear un directorio de producto,
una capa ni un ID runtime. Cada candidato incluye su identificador GNSS,
constelación, cobertura UTC, número de muestras y cadencia. Para confirmar un
subconjunto, envíe el cuerpo a `/import` con, por ejemplo:

~~~json
{
  "selected_satellite_ids": ["G01", "C06"]
}
~~~

La selección se valida frente al SP3 y no puede estar vacía. Si se omite,
`/import` conserva el comportamiento compatible de registrar todos los
miembros. Una selección parcial recibe una identidad de producto estable que
incluye el subconjunto, por lo que dos subconjuntos distintos del mismo SP3
pueden coexistir y rehidratarse sin sobrescribirse.

Los dos endpoints ejecutan la misma prevalidación estricta del SP3. Comprueba
cabecera, lista de satélites, épocas, cadencia, números finitos, conversión de
la escala temporal declarada y el contrato Lagrange de grado máximo 9. Un
`422` no crea ni persiste un producto; la respuesta satisfactoria incluye
`product.sp3_validation` con el informe de paso. Consulte [Productos GNSS
precisos](../../formats/precise-products.md#puerta-de-seguridad-antes-de-persistir)
para límites, centinelas de estado ausente y condiciones matemáticas.

`content_base64` contiene el binario sin prefijo `data:`. La procedencia, la
familia y la clase se determinan exclusivamente desde las fuentes: las
peticiones no deben asignar `provider_hint` ni `product_class` de forma manual.
Por compatibilidad, el servicio acepta únicamente el valor `auto`; un override
manual se rechaza. Si la evidencia no basta, registra `custom`/`unknown`.

La clasificación de cada entrada se realiza por el campo de la ventana y por
su extensión: SP3 obligatorio `.SP3`/`.SP3.gz`; CLK opcional
`.CLK`/`.CLK.gz`; ERP opcional `.ERP`/`.ERP.gz`; SUM `.SUM`/`.SUM.gz`; ATT
`.ATT.OBX`/`.ATT.OBX.gz` o los alias `.ATT`/`.OBX` y sus variantes `.gz`; y
OSB `.OSB.BIA`/`.OSB.BIA.gz` o `.BIA`/`.BIA.gz`. El servicio rechaza una carga
sin SP3 con `422` y el texto exacto **“Debe proporcionar un fichero SP3.”**.

La interfaz actual no solicita ECI al importar. `require_eci=true` es la puerta
del backend para una capacidad que lo necesite: exige ERP válido, cobertura ERP
completa del subconjunto SP3, una tabla local de segundos intercalares con
versión, SHA-256 y vigencia publicada no caducada que cubra toda esa ventana,
ruta de realización terrestre y ERFA/SOFA con IAU 2006/2000A. Una importación
normal puede usar la tabla integrada, pero devuelve
`product.time_validation.leap_seconds.external_freshness="unverified"`; esa
tabla abierta no habilita ECI de alto rigor. Si falta ERP produce `422` con el
texto exacto **“Debe proporcionar un fichero ERP para convertir a ECI.”**. ERP
aporta UT1 y movimiento polar; si el SP3 declara una realización IGS, también
debe existir una transformación de realización registrada y aplicada. ERP no
inventa esa transformación y el modelo visual GMST no sustituye la reducción
precisa, por lo que ECI permanece bloqueado hasta cumplir todas las
condiciones. Una llamada ECI de una órbita SP3 ligada al producto no puede
anular este contrato con un `EarthOrientation` explícito.

Una respuesta correcta contiene `product`, `satellites` e `importedIds`.
`product` declara proveedor, clase, familia, detección, marco nativo, etiqueta
operacional de marco, escala temporal, cobertura, productos auxiliares y los
checksums SHA-256 de sus fuentes, además de `sp3_validation` cuando el archivo
ha superado la puerta estricta. Cada ID de satélite registrado adopta la forma
`precise:<product_id>:<identificador_gnss>`, por ejemplo
`precise:precise-0123456789abcdef0123:G01`. Ese ID puede usarse como `sat_id`
en las rutas de efemérides, parámetros orbitales, propagación y AOS/LOS, pero
la consulta debe quedar dentro de la cobertura SP3.

El servicio guarda el producto y su manifest verificado bajo el volumen
`config/precise-products/`; el runtime lo vuelve a cargar al iniciar. El
proyecto puede conservar el ID estable, pero no incorpora una copia del
binario. Consulte [Productos GNSS precisos](../../formats/precise-products.md)
para proveedores, calidad, productos auxiliares, realizaciones y límites
científicos.

## Órbita manual

`POST /api/manual-orbits` crea una órbita manual transitoria y su efeméride de
vista previa. Admite `two-body`, `sgp4` y `cowell-rk4`; J2 se conserva solo por
compatibilidad.

| Campo | Requisito |
| --- | --- |
| `epoch` | Instante ISO-8601 con zona horaria. |
| `keplerian` | EME2000/UTC; semieje mayor en km y ángulos en grados. |
| `state_vector` | EME2000/UTC; posición km y velocidad km/s. |
| `propagation_options.force_terms` | `central` se añade automáticamente; `j2`, `j3`, `j4` y `drag` son opcionales. |
| `propagation_options.numerical_integrator` | Solo `rk4`. |

La respuesta devuelve la forma canónica, el motor resuelto, el resumen
geométrico y la efeméride. No incorpora la órbita al catálogo persistente.
