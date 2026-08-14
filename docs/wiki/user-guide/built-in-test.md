# Built-In Test

[Inicio](../index.md) · [Guía de usuario](index.md) · [Validación](../operations/validation.md)

El botón **Built-In Test**, situado a la derecha de **Help**, abre un panel de
diagnóstico de solo lectura. No inicia propagaciones largas ni cambia una
órbita: presenta la última comprobación publicada por el backend y el estado
actual de la escena.

## Estados y actualización

Cada tarjeta muestra **Healthy**, **Warning** o **Error**, junto con la última
hora de validación que el componente publicó. **Actualizar** consulta
`/api/system/diagnostics` sin bloquear la interfaz; mientras el panel está
abierto también se actualiza periódicamente. Si se ejecuta contra una versión
anterior del backend, el panel intenta `/api/diagnostics` y deja claro que los
datos remotos no están disponibles en vez de inventar un estado saludable.

## Qué comprueba

| Tarjeta | Información publicada |
| --- | --- |
| ERP / EOP loader | Si se cargó C01/C04, fecha de actualización, URL de procedencia, cobertura y estado de caché. |
| SP3 y OEM | Sonda real de sus parsers; para SP3, además, el número de productos y el solape/local EOP conocido por la escena. |
| Propagadores y fuerzas | Sondas deterministas de energía two-body, Cowell/RK4, J2/J3/J4 y disponibilidad de geopotencial, arrastre y SRP bajo el contrato temporal actual. |
| Time manager (MTR) | Rango temporal maestro, estado del clamp y capas SP3/OEM activas de la escena. |
| Marcos de referencia | Sonda ITRF a EME2000, residual de norma y calidad EOP de la ruta disponible. |
| CI/CD | Última ejecución que la API pública de GitHub haya podido observar para `quality.yml`, `docs-pages.yml` y `release.yml`. |

El monitor de GitHub es opcional y no utiliza credenciales. Si está desactivado,
la tarjeta CI/CD muestra **Warning/Unknown**; consulte directamente Actions
para decidir la aprobación de una release.

!!! warning "No es una certificación de misión"

    El panel usa sondas pequeñas y acotadas. Un estado Healthy indica que la
    ruta comprobada y sus datos publicados son coherentes; no sustituye una
    validación de misión, un ERP adjunto al producto, ni la política ECI
    estricta descrita en [Tiempo, EOP e ITRF](../operations/time-eop.md).

## Lectura de una advertencia EOP

Una advertencia puede significar que la copia C01 tiene más de siete días,
que su cobertura no alcanza la fecha actual o que IERS no respondió y Orbit
conserva la última copia válida. Si no existe copia válida, la vista puede usar
una rotación terrestre nominal. Esa ruta no convierte automáticamente un SP3
en **ITRF (con ERP aplicado)** ni habilita ECI estricto.

