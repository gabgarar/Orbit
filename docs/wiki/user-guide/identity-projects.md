# Identidad local y proyectos vinculados

[Inicio](../index.md) · [Guía de usuario](index.md) · [Proyectos](projects.md) · [Planificador](planner.md)

!!! success "Implementado localmente"

    Orbit incorpora una puerta de acceso, una bóveda cifrada por cuenta y una
    biblioteca de proyectos por usuario en el dispositivo. No hay un backend
    de usuarios de Orbit ni sincronización remota automática. Las integraciones
    de Google y Microsoft se habilitan únicamente mediante un *companion* local
    configurado por el anfitrión.

Este módulo separa tres responsabilidades: identidad, cifrado/persistencia
local y adaptadores externos. La separación es deliberada: crear una cuenta o
vincular una identidad no da permiso implícito para subir un proyecto, leer un
calendario ni enviar telemetría.

## Acceso y estados

Antes de mostrar el selector de proyectos o aceptar comandos de crear, abrir,
guardar o exportar, Orbit requiere una sesión autenticada. Después, la
validación de arranque científico sigue siendo obligatoria: una sesión válida
no evita que `projectReady: false` bloquee la apertura o creación hasta que
los recursos de Orbit estén preparados.

| Grupo | Estados | Uso actual |
| --- | --- | --- |
| Identidad | `unauthenticated`, `local_user`, `google_user`, `microsoft_user` | Sin sesión, cuenta local desbloqueada o identidad externa vinculada al protector local. |
| Proyecto | `no_project_open`, `project_open`, `project_new`, `project_generated` | Selector, proyecto existente, proyecto nuevo o generado desde cero. |
| Vinculación | `local_only`, `google_linked`, `microsoft_linked` | Metadato local del proyecto; no inicia una transferencia. |
| Preferencia de sincronización | `sync_disabled`, `sync_enabled` | Preferencia persistida para un futuro adaptador explícito. No es un estado de red. |

~~~mermaid
stateDiagram-v2
    [*] --> unauthenticated
    unauthenticated --> local_user: crear o desbloquear cuenta local
    local_user --> google_user: companion local termina OAuth
    local_user --> microsoft_user: companion local termina OAuth
    google_user --> local_user: usar identidad local
    microsoft_user --> local_user: usar identidad local
    local_user --> no_project_open
    google_user --> no_project_open
    microsoft_user --> no_project_open
    no_project_open --> project_new: crear
    no_project_open --> project_generated: generar desde cero
    no_project_open --> project_open: abrir o importar
    project_new --> project_open: guardar
    project_generated --> project_open: guardar
    project_open --> no_project_open: cerrar
~~~

Una sesión Google o Microsoft es una identidad lógica (`provider:subject`)
respaldada por la cuenta local que mantiene la bóveda. La cuenta local sigue
siendo el protector criptográfico y el ámbito de almacenamiento opaco; el
correo o el nombre mostrado no se usan como clave de almacenamiento.

### Acceso por correo

La pantalla de acceso pide primero el correo o identificador local y lo
comprueba **solo en este dispositivo**. La comprobación compara el selector
opaco de la bóveda: no desbloquea una cuenta, no lee perfiles ni devuelve
datos de proyecto. Si encuentra una cuenta, muestra el campo de contraseña;
si no la encuentra, ofrece el registro. Una respuesta indeterminada (por
ejemplo, si se ha perdido la clave HMAC local) no afirma que una cuenta exista
ni que esté libre, pero permite intentar recuperarla con la contraseña. El
desbloqueo solo prospera si esa contraseña autentica la bóveda cifrada.

## Bóveda local cifrada

La implementación no guarda una clave raíz aleatoria ni claves de datos
envueltas. Cada cuenta local usa directamente una clave AES de 256 bits
derivada de la contraseña:

1. La contraseña nunca se guarda ni se puede recuperar. Web Crypto deriva una
   clave **no extraíble** mediante PBKDF2 con SHA-256, una sal aleatoria de al
   menos 16 bytes y **310 000 iteraciones por defecto**. Se rechaza cualquier
   formato que declare menos de **100 000 iteraciones**.
2. La clave derivada se usa con AES-256-GCM. Cada cifrado genera un IV nuevo de
   12 bytes. Los datos autenticados incluyen el esquema, la versión y la
   pertenencia: cuenta y selector para la bóveda, o cuenta y propósito para un
   sobre de datos. Un error de autenticidad o de formato bloquea la lectura;
   jamás se interpreta el contenido como JSON válido.
3. El único índice no cifrado vive bajo una única clave de almacenamiento
   gestionada por un adaptador de acceso restringido y contiene IDs opacos de
   cuenta. Las cuentas nuevas usan un selector HMAC-SHA-256 de la identidad
   normalizada, calculado con una clave HMAC aleatoria, no extraíble y propia
   de la instalación, persistida en IndexedDB. `localStorage` solo conserva la
   referencia opaca de esa clave, nunca su material ni un hash determinista
   reutilizable del correo o nombre. El identificador, perfil, identidades
   externas y sobres de tokens permanecen dentro del ciphertext.
4. Los índices v1 con selector SHA-256 se aceptan únicamente para
   compatibilidad: tras desbloquear correctamente una cuenta se migra a v2 y
   se vuelve a sellar la bóveda con el selector HMAC. Si la clave de selector
   de IndexedDB se pierde, una cuenta existente puede recuperarse verificando
   los candidatos con la contraseña y se rota la referencia cuando el almacén
   está disponible; crear otra cuenta falla de forma cerrada hasta disponer de
   ese almacén. No se sustituye por un selector SHA-256 nuevo.
5. Las sesiones no se persisten. Una nueva instancia del servicio comienza en
   `unauthenticated`; la clave desbloqueada y las capacidades `seal`/`open`
   viven solo en memoria. Cerrar sesión o cambiar de sesión invalida esas
   capacidades.
6. Los tokens de proveedor se guardan solo como sobres AES-GCM cifrados en la
   bóveda. Las APIs públicas devuelven estado y metadatos cifrados; el único
   punto de consumo de texto claro es una devolución de llamada efímera
   (`withProviderTokens`) mientras la sesión sigue activa.

!!! warning "Límite del navegador"

    El cifrado con contraseña protege los datos persistidos frente a una copia
    pasiva del almacenamiento sin la contraseña. No convierte `localStorage`
    en un gestor de secretos del sistema operativo. La clave HMAC no extraíble
    evita que una copia aislada de `localStorage` reproduzca el selector, pero
    no protege frente a código malicioso que pueda ejecutarse en el mismo
    origen e invocarla, ni frente a una sesión comprometida. Para esa protección
    se necesita un contenedor de escritorio y un almacén de credenciales del SO.

El núcleo de identidad y la biblioteca local no hacen `fetch`, no contienen
telemetría y no dependen de un servidor de Orbit.

## Biblioteca de proyectos por usuario

Al autenticarse, Orbit abre una biblioteca asociada al propietario lógico de
la sesión. La cuenta externa puede ser el propietario visible, pero el sobre
queda sellado por la capacidad de la bóveda local que la respalda. Así, una
inspección de `localStorage` no revela nombres de proyectos, eventos manuales
del planificador ni datos de escena.

Se cifran de forma independiente:

- el índice de la biblioteca (metadatos, nombres, vinculación y preferencias),
- cada documento de proyecto, ligado a su `projectId`, revisión y propósito de
  cifrado.

Los metadatos incluyen un `projectId` local aleatorio, propietario, fechas,
versión, modo de creación, vinculación y preferencia de sincronización. La
biblioteca permite crear, importar, abrir, guardar, renombrar, duplicar,
eliminar y exportar. Las operaciones se serializan y validan el formato y la
revisión antes de aceptar el documento. Cuando el navegador ofrece Web Locks,
las escrituras se coordinan también entre pestañas; sin Web Locks solo existe
la serialización dentro del proceso, por lo que no se promete una transacción
multi-pestaña en navegadores antiguos. Las claves de almacenamiento derivan una
partición opaca del ámbito de bóveda y del propietario lógico, sin incluir IDs
de propietario en claro.

El documento conserva datos de autoría del proyecto: capas, configuración,
escena y eventos manuales/filtros del planificador. Los pases AOS/LOS, avisos
BIT, horizontes ERP y otros resultados derivados se recalculan localmente; no
se persisten como eventos autorizados por el usuario.

La exportación de un proyecto es una acción explícita y genera un documento
legible `.orbit.json`; no es una exportación cifrada por defecto. Trátalo como
cualquier otro archivo compartible. El planificador conserva sus eventos
manuales dentro del documento y puede exportarlos localmente a ICS cuando esa
función se solicite; exportar ICS tampoco activa una cuenta externa.

## Vinculación y sincronización

`google_linked` y `microsoft_linked` son metadatos de vinculación. Pueden
guardar una referencia de proyecto remota futura, pero la biblioteca actual no
llama a Drive, OneDrive, Google Calendar ni Microsoft Graph.

La opción `sync_enabled` del planificador es una **preferencia** local para un
adaptador de sincronización futuro y explícito. Por ahora:

| Recurso | Comportamiento implementado |
| --- | --- |
| Documento de proyecto | Cifrado local por usuario; importación y exportación explícitas. |
| Eventos manuales del planificador | Se guardan en el proyecto; exportación ICS local. |
| Pases, AOS/LOS, ERP, SP3, BIT y eventos derivados | Se calculan en Orbit; no se sincronizan ni se guardan como calendario manual. |
| Cuenta y tokens | Sobres cifrados locales; no forman parte del archivo de proyecto exportado. |
| Interruptor de sincronización | Solo registra preferencia y elegibilidad de un proyecto vinculado; no inicia requests. |

Cuando se incorpore un adaptador, deberá pedir ámbitos y destino concretos,
mostrar qué datos salen del dispositivo, registrar conflictos y permitir
revocar la vinculación. Ninguna de esas transferencias está implementada por
el interruptor actual.

## Google y Microsoft mediante OAuth PKCE

Las opciones externas solo se muestran cuando hay conexión, una configuración
PKCE válida y un *companion* OAuth local **de confianza** que pueda completar
el flujo. Si no están listas, no ocupan espacio en la pantalla de acceso. No
basta con `enabled: true`, un
objeto de configuración o un listener de evento: el companion debe aportar
`enabled: true` y una función `start`. En modo sin conexión solo se puede crear
o desbloquear una cuenta local. Una sesión externa existente tampoco se puede
reabrir si su token ha expirado o no hay red.

El flujo externo exige primero crear o desbloquear un **protector local de
bóveda**. El companion, no el componente React, es dueño de la transacción
PKCE, el navegador del sistema, el callback, el canje de código y la
validación de la identidad. La interfaz llama directamente, dentro del mismo
proceso, a `start({ provider, capability, transactionId, signal, service })`;
`service` nunca se publica en el DOM y está limitado a ese proveedor y a esa
transacción. El companion de confianza debe guardar el sobre de tokens cifrado
mediante esa capacidad local y completar después la identidad externa. Al
resolver `start`, Orbit verifica que la sesión se ha convertido realmente en
`google_user` o `microsoft_user` para el proveedor solicitado. Si no es así,
la vinculación falla de forma cerrada y no se abre el espacio externo.

Un bootstrap de host puede declarar el contrato mínimo así:

```js
window.__orbitOAuthCompanion = {
  enabled: true,
  providers: ["google", "microsoft"],
  async start({ provider, capability, transactionId, signal, service }) {
    // Código de host de confianza: PKCE, navegador/callback e identidad
    // verificada. Respetar signal.aborted; nunca pasar secretos o tokens al DOM.
    await service.storeProviderTokens(provider, tokenPayload);
    await service.completeExternalIdentity({
      provider,
      identity: verifiedIdentity,
      tokenEnvelope: service.getProviderTokenEnvelope(provider)
    });
  }
};
```

`transactionId` es un correlador opaco, no un secreto OAuth. Al pulsar
**Continuar solo con cuenta local**, cerrar sesión o desmontar la interfaz,
Orbit aborta `signal` e invalida esa transacción antes de aceptar un resultado.
El companion debe cerrar o ignorar su callback cuando `signal.aborted` sea
`true`. Incluso si una devolución tardía intenta completar el flujo, la
capacidad acotada la rechaza y Orbit vuelve al protector local; el resultado no
se publica como una sesión externa. La pantalla queda bloqueada para proyectos
desde el inicio de la operación, incluso durante la creación o el desbloqueo
asíncrono de la bóveda local.

Si una cancelación llega después de haber escrito un sobre, su limpieza no
aplica una lectura y borrado separados: vuelve a leer y autenticar la bóveda
cifrada dentro del mismo bloqueo de mutación y solo borra si el sobre actual es
exactamente el que creó esa transacción. Por tanto, un sobre más reciente de
otra pestaña o instancia gana la carrera y se conserva.

El módulo proporciona utilidades para preparar y validar Authorization Code +
PKCE con S256, pero esas utilidades no contactan un proveedor, no canjean
códigos, no renuevan tokens y no aceptan `client_secret`.

Como señal de observabilidad opcional, la interfaz puede emitir el evento local
`orbit:identity-oauth-request` con este contrato:

```json
{
  "version": 1,
  "provider": "google | microsoft",
  "capability": "interactive-pkce-only",
  "flow": "companion-owned-pkce"
}
```

No se incluyen en ese evento contraseña, URL de autorización, `state`,
`code_verifier`, código, token, secreto de cliente, correo ni perfil. El evento
no puede iniciar ni completar una sesión por sí solo; solo la llamada directa a
`start` del companion de confianza puede hacerlo. Los sobres marcan
`renewalRequired: true`: no hay renovación silenciosa ni promesa de
sincronización desatendida en el cliente actual.

!!! note "Qué significa «vinculado» hoy"

    Una identidad de Google o Microsoft puede quedar vinculada de forma local
    al protector de bóveda. Eso no instala un conector remoto ni añade acceso a
    un calendario. Mientras no se configure e implemente un adaptador, las
    operaciones siguen siendo locales.

!!! tip "Desvincular un proveedor"

    Desde una sesión Google o Microsoft, **Desvincular** borra el sobre de
    tokens cifrado y la identidad externa de este dispositivo y devuelve la
    sesión al protector local. No hace una llamada al proveedor ni elimina los
    proyectos locales; esas operaciones se controlan por separado.

## Errores, operación sin conexión y pruebas

- Los errores de contraseña, almacenamiento, Web Crypto, formato o integridad
  no desbloquean la bóveda. Los mensajes de la interfaz no deben incluir
  contraseñas, tokens, códigos OAuth ni contenido de eventos.
- Sin red continúan disponibles las cuentas y proyectos locales ya creados,
  dentro de los recursos científicos validados. Google y Microsoft se
  deshabilitan antes de iniciar el companion; no se intenta abrir el navegador
  ni reactivar una sesión externa.
- La biblioteca rechaza documentos con esquema no admitido, propietario
  incorrecto, revisiones incoherentes o ciphertext que no se pueda verificar.
- Las pruebas unitarias cubren derivación/cifrado, rechazo de formatos y
  credenciales, invalidez tras `logout`, aislamiento entre usuarios,
  persistencia cifrada de la biblioteca, preferencias del planificador y el
  contrato de interfaz del companion OAuth, incluido el requisito de
  `enabled: true` + `start` y el rechazo de una finalización solo por evento.
  Las pruebas de integración del companion y de cualquier sincronización remota
  se añaden junto con el adaptador que la implemente.

## Referencias de proveedores

- [Google: OAuth para aplicaciones de escritorio](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google: elegir un modelo de autorización](https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model)
- [Microsoft: Authorization Code con PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Microsoft: restricciones de redirect URI](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)
