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
| `POST /api/orbit-parameters` | Calcula elementos osculadores en un rango. | 2–2000 muestras y presupuesto de integración para RK4. |

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
| `POST /api/precise-products/import` | Valida, descomprime, persiste y registra un SP3 con CLK opcional. | Un SP3 lógico y, opcionalmente, un CLK; archivos locales codificados en base64. |

El cuerpo canónico de importación es:

~~~json
POST /api/precise-products/import
Content-Type: application/json

{
  "files": [
    {
      "name": "IGS0OPSFIN_20262230000_01D_15M_ORB.SP3.gz",
      "content_base64": "<base64-del-archivo-local>"
    },
    {
      "name": "IGS0OPSFIN_20262230000_01D_05M_CLK.CLK.gz",
      "content_base64": "<base64-del-archivo-local>"
    }
  ],
  "provider_hint": "cddis-igs",
  "product_class": "final"
}
~~~

`content_base64` contiene el binario sin prefijo `data:`. Los valores canónicos
de `provider_hint` son `auto`, `cddis-igs`, `igs-mgex`, `esa-nso` y `custom`;
los de `product_class` son `auto`, `final`, `rapid` y `ultra-rapid`. Con
`auto`, Orbit propone clasificación a partir del nombre de archivo y registra
`custom`/`unknown` cuando no puede demostrarla.

La ruta acepta como máximo ocho archivos subidos, 32 MiB por archivo y 64 MiB
en total antes de descomprimir. Admite SP3/CLK no comprimidos, `gzip`, ZIP y
UNIX `.Z`; el contenido expandido está limitado a 256 MiB. ZIP cifrados o
anidados, miembros inseguros y pares con más de un SP3 o un CLK se rechazan con
`422`.

Una respuesta correcta contiene `product`, `satellites` e `importedIds`.
`product` declara proveedor, clase, familia, detección, marco, escala temporal,
cobertura, resumen de reloj y los checksums SHA-256 de sus fuentes. Cada ID de
satélite registrado adopta la forma
`precise:<product_id>:<identificador_gnss>`, por ejemplo
`precise:precise-0123456789abcdef0123:G01`. Ese ID puede usarse como `sat_id`
en las rutas de efemérides, parámetros orbitales, propagación y AOS/LOS, pero
la consulta debe quedar dentro de la cobertura SP3.

El servicio guarda el producto y su manifest verificado bajo el volumen
`config/precise-products/`; el runtime lo vuelve a cargar al iniciar. El
proyecto puede conservar el ID estable, pero no incorpora una copia del
binario. Consulte [Productos GNSS precisos](../../formats/precise-products.md)
para proveedores, calidad, CLK, realizaciones y límites científicos.

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
