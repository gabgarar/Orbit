# SP3

[Inicio](../index.md) · [Formatos](index.md) · [Marcos de referencia](../engineering/reference-frames.md) · [Sistemas temporales](../engineering/time-systems.md)

## Estado de soporte

`Sp3StateProvider` es un lector Python de estados tabulados SP3. No hay
importación SP3 en la UI, gateway, API pública ni `OrbitRuntime`; el lector no
crea automáticamente objetos de catálogo o capas del visor.

## Cabecera admitida

El parser exige una primera cabecera significativa con `#`, distinta de `##`,
y al menos 51 caracteres. Conserva:

| Campo | Fuente |
| --- | --- |
| Versión y tipo de registro | Posiciones fijas de la cabecera `#`. El tipo debe ser `P` o `V`. |
| Época inicial | Calendario de cabecera, sin asumir UTC. |
| Número de épocas, datos, tipo orbital y agencia | Campos fijos cuando están presentes. |
| Sistema de coordenadas | Campo de cabecera, obligatorio. |
| Sistema temporal | Línea `%c`, campo `TIME_SYSTEM`, obligatorio. |

Las realizaciones `IGS20`, `IGb20` e `IGc20` se conservan como familia `IGS`
con realización explícita. No se renombran como ITRF.

## Registros de estado

Las épocas se introducen mediante líneas `*`. Los registros `P` y `V` se
asocian por época e identificador de satélite.

| Registro | Unidades de fuente | Conversión a `StateVector` |
| --- | --- | --- |
| `P` | km | m. |
| `V` | dm/s | m/s. |

El centinela SP3 de componente ausente (`abs(valor) >= 999999`) se omite; no
se trata como una coordenada válida. Registros duplicados del mismo tipo,
época y satélite se rechazan.

## Selección e interpolación

Un fichero SP3 puede contener múltiples satélites. El método de consulta exige
`satellite_id` excepto cuando la serie contiene exactamente uno. Cada satélite
usa `TabularStateProvider` con interpolación lineal acotada por defecto.

Las consultas se convierten desde la escala indicada por el solicitante a la
escala nativa antes de buscar e interpolar. Por ejemplo, una serie GPS conserva
sus épocas GPS en la salida aunque la consulta se haya formulado en UTC.

## Marco y realización

`native_state_at` devuelve la muestra en el marco de la cabecera. Pedir ITRF
para un SP3 en `IGS20` falla si no existe una transformación de realización
registrada. La única alineación integrada optativa es IGS20↔ITRF2020 bajo la
política descrita en [Marcos de referencia](../engineering/reference-frames.md);
IGb20 e IGc20 no se convierten implícitamente.

## Límites

- No se implementan entrada UI/API, exportación SP3 ni registro en runtime.
- No hay interpolación de alta orden declarada por SP3, precisión de reloj ni
  uso de campos de error o correlación.
- Una escala temporal no reconocida se conserva al leer metadatos, pero se
  rechaza al construir el proveedor de estados.
- No hay transformación inventada entre realizaciones terrestres.
