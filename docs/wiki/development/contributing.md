# Contribuir

## Estado de la política

El repositorio no contiene actualmente un archivo `CONTRIBUTING`, una plantilla
de pull request, reglas `CODEOWNERS`, un acuerdo de contribución ni automatización
CI declarada. Esta página establece las reglas de mantenimiento necesarias para
que un cambio sea revisable dentro de la arquitectura existente; no crea un
proceso de publicación externo ni una garantía de aceptación.

## Preparación del entorno

La ruta reproducible recomendada es Docker Compose. Para desarrollo sin Docker,
el repositorio documenta Node.js 24 y Python 3.10+ como mínimo,
además de las dependencias fijadas por los lockfiles y
`server/requirements.txt`.

```bash
docker compose up --build
```

La documentación de [Despliegue](deployment.md) describe puertos, volumen de
configuración y controles de exposición. La documentación de [Testing](testing.md)
describe la verificación local.

## Ámbitos de cambio

| Área | Responsabilidad | Verificación esperada |
| --- | --- | --- |
| `react-ui/` | Composición React/Vite y componentes de interfaz. | Build React; pruebas de UI si cambia el flujo visible. |
| `front/` | Runtime Cesium heredado, assets y módulos en migración. | Pruebas frontend; build/runtime assets cuando corresponda. |
| `server/src/` | Gateway, catálogos, configuración y proxy. | Pruebas Node. |
| `server/python/orbit_api/` | Dominio orbital, API, marcos, tiempo y formatos. | Pytest de los módulos modificados y contratos de ruta. |
| `config/` | Datos operativos de ejemplo o configuración persistida. | Verificar formato, ruta montada y ausencia de secretos. |
| `docs/wiki/` | Documentación publicable y enlaces relativos. | Revisar enlaces, límites y coherencia con el código. |

No mezcle una refactorización de interfaz con un cambio de física o de contrato
HTTP salvo que la relación sea necesaria y quede probada de extremo a extremo.

## Reglas de contratos orbitales

1. Cada estado debe conservar época, escala temporal, marco, centro y unidades.
2. No introducir `ECI` o `ECEF` como etiquetas nuevas: son ambiguas y el
   contrato `StateVector` las rechaza.
3. SGP4 conserva TEME como marco nativo; dos cuerpos y Cowell manuales usan
   EME2000. Una conversión a ITRF debe pasar por `FrameTransformService`.
4. Los datos EOP y de segundos intercalares se cargan de archivos locales al
   inicio. No añada una descarga de red a una transformación o propagación.
5. Si una salida depende de un producto de referencia, incorpore su identidad
   a procedencia y caché.
6. No anuncie un formato, modelo de fuerzas o realización terrestre como
   soportado hasta que tenga un contrato, pruebas y una ruta de uso definida.

## Reglas de interfaces

- Mantener la validación de forma y límites en `domain/requests.py` y el
  mapeo de HTTP en `api/routes/`.
- Mantener los errores de entrada como errores explícitos de cliente (`400`,
  `422`, `404`) en lugar de convertirlos en fallos silenciosos.
- Documentar campos de compatibilidad `camelCase` o heredados junto con su
  forma canónica; no eliminar uno sin una migración declarada.
- No exponer directamente el puerto Python como atajo de integración.
- Tratar el WebSocket como snapshots sin garantía de entrega y actualizar su
  documentación si cambia codificación, frecuencia o semántica.

## Reglas de persistencia y seguridad

- El catálogo y la configuración son datos de operador. No sobrescribirlos ni
  reordenarlos masivamente como efecto colateral de una prueba o build.
- Respetar la normalización de nombres de archivo y el límite del directorio
  `config/`.
- No incorporar secretos, tokens de proveedores, rutas de usuario o snapshots
  EOP sin su procedencia y política operativa.
- La ausencia de autenticación exige especial cuidado: no amplíe la exposición
  de rutas administrativas sin controles de infraestructura y documentación.

## Proceso de verificación

1. Inspeccionar las modificaciones ajenas existentes antes de editar y no
   revertirlas.
2. Añadir o actualizar pruebas que reproduzcan el comportamiento modificado.
3. Ejecutar la capa mínima correspondiente y las pruebas transversales que
   afecte el cambio.
4. Verificar que el build React y los assets offline siguen siendo válidos si
   se toca la interfaz o su empaquetado.
5. Actualizar documentación, límites y referencias cruzadas.
6. Incluir en la propuesta de cambio qué se verificó y qué no pudo verificarse
   en el entorno disponible.

## Documentación y lenguaje

La documentación oficial se escribe en español, usa Markdown compatible con
Material for MkDocs y enlaza entre páginas mediante rutas relativas. Debe
describir únicamente lo que puede verificarse en código, pruebas o configuración
del repositorio. Las capacidades ausentes se documentan como límites, no como
promesas.

## Referencias relacionadas

- [Arquitectura](architecture.md)
- [Testing](testing.md)
- [Validación](validation.md)
- [Hoja de ruta de plugins](../integrations/plugins.md)
