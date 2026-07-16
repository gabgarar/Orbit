# Estructura de Orbit

- `react-ui/`: interfaz React/Vite. Contiene la cabecera, el rail izquierdo, los paneles contenedores y la composición del visor.
- `front/`: cliente Cesium heredado y assets. Su lógica orbital se mantiene aquí durante la migración incremental a componentes React.
- `server/`: servidor Node.js, API y proceso Python de propagación. No es parte de la interfaz.
- `server/python/`: cálculo y API orbital en Python.
- `config/`: catálogo y configuración persistente.

React no reemplaza Node.js: el primero renderiza la interfaz; el segundo sirve la aplicación, gestiona archivos y conecta el cliente con el propagador Python.
