# RINEX

[Inicio](../index.md) · [Formatos](index.md) · [Formatos no soportados](unsupported-formats.md) · [SP3](sp3.md)

## Estado de soporte

Orbit admite **RINEX CLK** como producto de reloj asociado a una importación
SP3 precisa. Lee registros de reloj de satélite `AS` y conserva el sesgo, y
cuando existen la tasa, la segunda tasa y sus sigmas, en las unidades publicadas
por CLK. Un CLK no es una efeméride cartesiana y no puede crear una capa orbital
sin SP3.

RINEX de observación, navegación y meteorología sigue sin estar implementado.
No hay preprocesado de medidas, modelo de receptor, efeméride de navegación,
PPP, estimación de reloj, determinación de órbita ni integración con estaciones
de tierra a partir de observaciones RINEX.

## Relación con SP3

SP3 y RINEX son formatos distintos. Un producto CLK acompaña los estados SP3
por identificador GNSS y época, pero no modifica las coordenadas ni la
velocidad. La existencia de un lector [SP3](sp3.md) no permite reconstruir un
SP3 a partir de observaciones RINEX dentro de Orbit.

Consulte [Productos GNSS precisos](precise-products.md) para el emparejamiento
SP3+CLK, proveedores, procedencia, escalas temporales y límites.

## Alternativas

Para visualizar una trayectoria calculada externamente, use una efeméride
tabulada compatible con los lectores Python disponibles y conserve en la
procedencia que procede de procesamiento GNSS externo. Orbit no ejecuta ese
procesamiento.
