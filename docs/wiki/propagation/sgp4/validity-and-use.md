# SGP4: uso recomendado y límites

[Propagación](../index.md) · [SGP4](../sgp4.md) · [Cowell](../cowell.md)

## Cuándo usar SGP4

SGP4 es la elección adecuada para seguir satélites terrestres publicados como
TLE, para catálogo, visualización, preselección de pases y operaciones cuya
precisión sea compatible con la edad y calidad del TLE. Es especialmente útil
cuando la fuente autorizada de la órbita es precisamente un TLE NORAD.

## Régimen de validez

- Está diseñado para satélites en órbita terrestre representados por TLE.
- No es un propagador interplanetario ni un modelo para cuerpos sin TLE NORAD.
- No debe tratarse como un modelo general para órbitas muy excéntricas fuera
  del régimen operativo habitual de los TLE, en especial con dinámica rápida
  cerca del perigeo.
- Maniobras frecuentes, un TLE obsoleto o cambios de configuración degradan
  la predicción porque SGP4 no estima esos eventos.
- No se recomienda extrapolar a largo plazo. Como regla operativa, más de unos
  30 días desde la época del TLE exige actualizar el TLE o usar una efeméride
  validada.

Estas son reglas de uso, no un interruptor binario de calidad: un TLE de baja
calidad puede fallar antes y uno reciente puede servir muy bien para una tarea
de catálogo de corto arco.

## Cuándo elegir otra fuente

Elija una OEM/SP3 validada, o un propagador de mayor fidelidad externo, para
precisión GNSS, determinación de órbita, planificación de maniobras,
evaluación de conjunciones, análisis de reentrada o arcos largos que dependan
de fuerzas y eventos concretos.

## SGP4 frente a Cowell

| Aspecto | SGP4 | Cowell en Orbit |
| --- | --- | --- |
| Entrada | TLE | Estado cartesiano y época |
| Marco nativo | `TEME` | `EME2000` |
| Tipo | Analítico | Numérico: dinámica cartesiana con RK4 |
| Fuerzas | Modelo NORAD fijo | Composición explícita disponible |
| Precisión | Buena a corto plazo con TLE reciente | Depende de fuerzas, paso y arco |
| Uso principal | Catálogo y seguimiento TLE | Simulación y validación de fuerzas |

No hay un ganador universal. SGP4 continúa un producto de catálogo; Cowell
permite estudiar una dinámica configurada. Ninguno debe presentarse como una
efeméride de alta fidelidad fuera de su régimen.
