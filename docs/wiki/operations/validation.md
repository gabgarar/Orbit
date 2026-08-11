# Validación

[Inicio](../index.md) · [Operación](index.md) · [Instalación](../getting-started/installation.md) · [Configuración](configuration.md) · [Tiempo y EOP](time-eop.md)

La validación de Orbit combina un healthcheck del runtime, pruebas automáticas
por capa y validación de contratos de entrada. Una comprobación de estado
saludable confirma que el servicio responde; no certifica por sí sola la
exactitud de una efeméride ni la idoneidad de los datos de origen.

## Healthcheck del servicio

El contenedor expone un healthcheck HTTP contra la ruta /health del gateway.
Después de un arranque o reinicio, compruebe el estado:

~~~powershell
docker compose ps
./.scripts/orbit-status.cmd
~~~

El estado esperado es healthy. Si no se alcanza dentro del tiempo de espera del
script de reinicio, revise los registros:

~~~powershell
docker compose logs -f orbit
./.scripts/orbit-logs.cmd
~~~

## Suites automatizadas

El repositorio separa las pruebas por responsabilidad.

| Script | Cobertura ejecutada |
| --- | --- |
| ./.scripts/test-node.cmd | Pruebas unitarias del gateway Node.js. |
| ./.scripts/test-frontend.cmd | Pruebas unitarias de los módulos de front/. |
| ./.scripts/test-react-build.cmd | Compilación del frontend React y validación de activos del runtime. |
| ./.scripts/test-backend.cmd | Pruebas Python bajo server/python/ dentro de Docker. |
| ./.scripts/test-ui.cmd | Reinicio del runtime y pruebas de navegador. |
| ./.scripts/test-all.cmd | Ejecución ordenada de frontend, backend e integración. |

La imagen Docker también ejecuta las suites de Node, frontend y Python antes
de compilar el frontend final. Un fallo de esas pruebas impide que se complete
el build de la imagen.

!!! note "Ámbito de una suite"

    Una suite que termina correctamente demuestra los contratos cubiertos por
    sus casos. No implica una validación independiente de una fuente TLE,
    OEM, C04 o leap-seconds.list que el operador haya montado posteriormente.

## Validación de datos de operación

| Datos | Validación aplicada |
| --- | --- |
| Configuración del sistema | Normalización de valores y nombre de catálogo contenido dentro de config/. |
| Proyecto | El importador exige el formato orbit-project y versión 1. |
| Catálogo | Los formatos TLE, OMM y OEM se analizan antes de incorporarse; OEM puro no se convierte en objeto de catálogo. |
| Producto GNSS preciso | Se validan SP3 obligatorio; CLK, ERP, SUM, ATT y OSB por campo; `require_eci`, extensiones, checksums, marco, escala temporal y duplicados por época. El manifest se vuelve a verificar al arrancar. |
| C04 local | Se valida lectura, codificación, orden temporal, coherencia MJD/fecha, columnas y hash si se exige. |
| leap-seconds.list | Se valida la identidad, cobertura y, cuando se configura, la expiración #@. |
| Ventana EOP | En modo estricto, los límites declarados deben estar cubiertos por C04 y UTC–TAI. |

La política de C04 requiere el producto IAU 2000A con dX/dY; un encabezado que
declara dPsi/dEps se rechaza. Consulte [Tiempo y EOP](time-eop.md) para la
configuración de hashes y cobertura.

## Validación antes de una operación reproducible

1. Conserve el archivo fuente de cada TLE, OMM, OEM o producto GNSS SP3/CLK/ERP/SUM/ATT/OSB y su SHA-256.
2. Ejecute la suite adecuada tras actualizar código o configuración.
3. Compruebe el healthcheck y los logs del runtime iniciado.
4. Registre rango temporal, paso, propagador, marco y escala de cualquier
   efeméride exportada.
5. Registre la versión y SHA-256 de C04 y leap-seconds.list cuando intervenga
   una transformación terrestre de precisión.

## Límites

- No existe una certificación de precisión de misión, validación de
  determinación de órbita ni comparación automática contra una verdad de
  referencia externa.
- La detección AOS/LOS explora por muestreo. Refina por bisección los cambios
  de visibilidad ya encerrados hasta aproximadamente 0,5 s, pero no es un
  solver general de raíces ni garantiza detectar un pase entero entre dos
  muestras de exploración.
- El modo visual sin snapshots locales EOP sigue siendo aproximado aunque el
  servicio pase el healthcheck.
- No existe CI hospedada ni un informe de conformidad de estándar expuesto
  por el producto.

Los controles de presentación y coste se describen en
[Rendimiento](performance.md).
