# Gateway

## Visión general

El gateway Node.js es la frontera pública de Orbit. Sirve el frontend compilado, expone HTTP/WebSocket, gestiona datos locales y supervisa el servicio Python privado.

## Runtime

Docker ejecuta Node.js 24 como proceso principal y Python en `127.0.0.1:8765`. El gateway escucha en `8100` y monta `config/` desde el host.

```text
navegador → gateway Node :8100 → servicio Python privado :8765
```

La imagen instala dependencias y ejecuta pruebas Node, frontend y Python antes de producir el runtime. Si la reconstrucción falla, el script de reinicio preserva el contenedor anterior.

## Configuración

`config/` es dato operacional persistente y propiedad del operador. `ORBIT_HTTP_BIND` define exposición local o de red; `ORBIT_HTTP_PORT` define el puerto. Orbit no implementa autenticación, por lo que una exposición de red requiere controles externos.

## Límites

- No hay despliegue distribuido, base de datos remota ni colaboración multiusuario.
- El puerto Python no es API pública.
- La configuración local no es un gestor de secretos.

## Siguientes destinos

<div class="grid cards" markdown>

- :material-api: **Consumir el límite público**

  Rutas HTTP, WebSocket y contratos de respuesta.

  [Ir a la API →](api.md)

- :material-layers-triple: **Abrir el cliente**

  Comportamiento del proyecto y visualización.

  [Ir al espacio de trabajo →](workspace.md)

</div>
