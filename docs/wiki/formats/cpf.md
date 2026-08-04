# CPF

[Inicio](../index.md) · [Formatos](index.md) · [Formatos no soportados](unsupported-formats.md) · [OEM](oem.md)

## Estado de soporte

Orbit no implementa el formato Consolidated Prediction Format (CPF).

No hay importador, parser, interpolador, exportador, conversión de tiempos,
adaptador de estaciones o integración con la visualización/API. Ningún archivo
con extensión CPF se detecta como una fuente orbital admitida.

## Alternativas

Cuando se disponga de una trayectoria cartesiana externa, conviértala fuera de
Orbit a un formato que el lector Python pueda interpretar, como [OEM](oem.md),
y declare explícitamente marco, realización, centro y escala temporal. Esa
conversión externa no habilita una carga CPF de producto ni debe ocultar la
procedencia original.

Las funciones de estación de tierra existentes no constituyen compatibilidad
con CPF o con predicción laser de rango.
