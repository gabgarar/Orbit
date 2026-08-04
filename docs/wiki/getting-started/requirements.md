# Requisitos

[Inicio](../index.md) · [Instalación](installation.md) · [Inicio rápido](quick-start.md)

Orbit se distribuye como una aplicación local compuesta por un gateway Node.js,
un frontend React/Cesium compilado como activos estáticos y un servicio Python
interno. La ruta recomendada encapsula los componentes de runtime en Docker
Compose; el frontend no es un tercer proceso de ejecución independiente.

## Entorno recomendado

| Componente | Requisito | Uso en Orbit |
| --- | --- | --- |
| Sistema operativo | Windows, macOS o Linux con Docker Desktop o Docker Engine compatible con Compose | Ejecución reproducible del runtime completo. |
| Docker | Docker Compose v2 y daemon en ejecución | Construcción de la imagen, volumen config/ y publicación HTTP. |
| Navegador | Navegador moderno con WebGL disponible | Visor 3D basado en Cesium y grabación local del canvas. |
| Puerto local | 8100 disponible, o un puerto alternativo | Gateway HTTP de Orbit. |
| Almacenamiento | Espacio para la imagen, dependencias y catálogos locales | La carpeta config/ se conserva fuera de la imagen. |

La publicación predeterminada se limita a 127.0.0.1. Orbit no incorpora
autenticación ni autorización; no debe exponerse a una red no confiable sin un
control de acceso externo.

!!! warning "WebGL es obligatorio para el espacio de trabajo"

    Si el navegador o el controlador gráfico no permite WebGL, el visor 3D no
    puede ofrecer una alternativa equivalente. Verifique la aceleración por
    hardware y las políticas corporativas del navegador antes de desplegarlo
    en un puesto de operación.

## Ejecución sin Docker

La ejecución directa exige Node.js **20.19 o posterior**, o **22.12 o
posterior**, y Python **3.10 o posterior**. También exige npm y acceso a las
dependencias fijadas durante la instalación. El frontend debe compilarse antes
de iniciar el gateway.

~~~powershell
py -3 -m pip install -r server/requirements.txt
Set-Location react-ui
npm.cmd ci
npm.cmd run build
Set-Location ..\server
npm.cmd ci
npm.cmd start
~~~

En macOS y Linux se emplean habitualmente python3 y npm en lugar de py -3 y
npm.cmd.

!!! note "Datos locales"

    El runtime lee configuración y catálogo desde config/. En Docker esa ruta
    se monta como volumen en /app/config; al borrar y recrear un contenedor no
    se eliminan esos archivos.

## Datos temporales para precisión

La visualización puede iniciarse sin productos EOP locales. Los cálculos
reproducibles de tiempo y marcos terrestres requieren, en cambio, un snapshot
IERS C04 y una tabla local de segundos intercalares. Los requisitos, variables
de entorno y límites del modo estricto se describen en
[Operación de tiempo y EOP](../operations/time-eop.md).

## Comprobación previa

~~~powershell
docker compose version
docker compose config
~~~

El segundo comando resuelve el archivo Compose sin iniciar Orbit. Si se usa
un puerto distinto, defina ORBIT_HTTP_PORT; si se cambia la interfaz de
escucha, defina ORBIT_HTTP_BIND. Mantenga este último en 127.0.0.1 para un
uso local normal.

## Límites de plataforma

- No existe instalador de escritorio, CLI de producto ni SDK distribuido.
- No existe almacenamiento remoto, usuarios ni colaboración multiusuario.
- Los mapas base remotos disponibles en la configuración requieren la
  conectividad correspondiente; los activos generados e incluidos localmente
  no requieren un CDN durante la ejecución.

Continúe con la [instalación](installation.md) o con el
[inicio rápido](quick-start.md).
