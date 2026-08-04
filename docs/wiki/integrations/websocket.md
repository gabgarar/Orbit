# WebSocket

## Propósito

El WebSocket de Orbit entrega actualizaciones de estado y de órbita para las
suscripciones de un único cliente. El gateway mantiene la conexión del mismo
origen y la reenvía al backend Python privado. No es un canal de control de
simulación, colaboración, persistencia de proyectos ni telemetría de un
vehículo real.

```text
ws://127.0.0.1:8100/ws
```

Cuando la aplicación se sirve mediante HTTPS, el cliente debe usar `wss://`.
La ruta exacta es `/ws`; otras rutas de actualización se rechazan en el
gateway.

## Apertura y límite de seguridad

No se requiere cabecera de autenticación ni token. El endpoint debe mantenerse
en una red de confianza o protegerse con infraestructura externa. El gateway
impone un máximo de 10 segundos para completar el handshake hacia el backend;
si éste no está disponible puede cerrar con `502` o `504`.

Al aceptar una conexión, el servidor envía inmediatamente el catálogo de
nombres:

```json
{
  "type": "catalog",
  "data": ["ISS (ZARYA)", "…"],
  "compressed": false
}
```

La conexión comienza sin suscripciones. Por tanto, las primeras actualizaciones
de `state` y `orbits` pueden contener arreglos vacíos hasta que se reciba una
orden válida.

## Mensajes del cliente

El servidor acepta JSON de texto o bytes UTF-8. Los mensajes inválidos, los
tipos desconocidos y los identificadores que no sean cadenas se ignoran sin
una respuesta de error.

| `type` | Campo `ids` | Efecto |
| --- | --- | --- |
| `subscribe` | Lista de nombres de satélite | Añade nombres a la suscripción actual. |
| `unsubscribe` | Lista de nombres de satélite | Elimina nombres de la suscripción actual. |
| `set_subscriptions` | Lista de nombres de satélite | Sustituye la suscripción completa. |

Ejemplo:

```json
{
  "type": "set_subscriptions",
  "ids": ["ISS (ZARYA)"]
}
```

Los nombres que no existan en el snapshot actual se conservan en la selección
del cliente, pero no generan estado ni órbita hasta que aparezcan en el
catálogo. Cada orden válida fuerza una actualización en el siguiente ciclo del
servidor.

## Mensajes del servidor

| `type` | Frecuencia predeterminada | Contenido |
| --- | --- | --- |
| `catalog` | Una vez al conectar. | Lista de nombres disponibles. |
| `state` | 1 s, configurable en `system.realtime.state_interval_seconds`. | Un estado por satélite suscrito que siga disponible. |
| `orbits` | 10 s, configurable en `system.realtime.orbit_interval_seconds`; sólo si está habilitada la órbita futura. | Muestras de trayectorias para las suscripciones disponibles. |

Ejemplo de `state`:

```json
{
  "type": "state",
  "data": [
    {
      "satellite": "ISS (ZARYA)",
      "reference_frame": "ITRF",
      "position_units": "m",
      "velocity_units": "m/s",
      "position": { "x": 1.0, "y": 2.0, "z": 3.0 },
      "velocity": { "x": 4.0, "y": 5.0, "z": 6.0 }
    }
  ],
  "compressed": false
}
```

Los valores numéricos del ejemplo son ilustrativos. El marco ITRF y las
unidades indicadas forman parte del contrato de la actualización de estado.
Para el significado de TEME, ITRF y la calidad de los datos de orientación de
la Tierra, consulte el [Glosario](../reference/glossary.md).

## Codificación y compresión

El servidor serializa la carga útil como JSON. Si el texto alcanza el umbral
de compresión configurado (1024 caracteres de forma predeterminada), comprime
con `zlib` de nivel 6 y envía un frame binario **sólo cuando el resultado es
más pequeño**. En caso contrario, envía un frame de texto.

!!! warning "La compresión no es autodocumentada por el campo `compressed`"

    La implementación conserva `"compressed": false` dentro de la carga
    incluso cuando el transporte elige un frame binario comprimido. Los
    clientes robustos deben decidir por el tipo de frame: analizar JSON para
    texto y aplicar `zlib` antes de analizar JSON para binario. No deben usar
    ese campo como señal de transporte.

## Gestión de ciclo de vida

La sesión mantiene estado de suscripciones aislado por conexión. Al desconectar
el cliente, el receptor se cancela y el backend libera la sesión. El gateway
cierra sockets y handshakes pendientes durante su parada.

No hay confirmaciones de suscripción, reintento, orden global, identificador de
sesión, garantía de entrega ni reanudación desde una secuencia. El consumidor
debe tratar cada mensaje `state` u `orbits` como un snapshot reemplazable.

## Límites operativos

- El protocolo no expone autenticación, roles ni filtros de acceso.
- Las suscripciones se identifican por nombres de catálogo, no por un ID de
  sesión versionado.
- La precisión de los estados depende del propagador y de los datos temporales
  y EOP configurados; el canal no añade fidelidad numérica.
- La conexión no implementa una API de proyectos, eventos de interfaz ni
  reproducción histórica.

## Referencias relacionadas

- [REST API](rest-api.md)
- [OpenAPI](openapi.md)
- [Arquitectura](../development/architecture.md)
