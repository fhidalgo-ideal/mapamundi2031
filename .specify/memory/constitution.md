<!--
Sync Impact Report
- Cambio de versión: (plantilla sin rellenar) → 1.0.0
- Principios definidos (los seis sustituyen a los marcadores de la plantilla):
  - [PRINCIPLE_1_NAME] → I. Un único camino de despliegue
  - [PRINCIPLE_2_NAME] → II. Los datos no se pierden
  - [PRINCIPLE_3_NAME] → III. Los secretos viven en el servidor
  - [PRINCIPLE_4_NAME] → IV. Desarrollo igual que producción
  - [PRINCIPLE_5_NAME] → V. Pruebas contra el servicio real
  - (nuevo) → VI. Privacidad de quien contribuye
- Secciones añadidas:
  - [SECTION_2_NAME] → Restricciones técnicas y de seguridad
  - [SECTION_3_NAME] → Flujo de trabajo y puertas de calidad
- Secciones eliminadas: ninguna
- Pendientes: ninguno
-->

# Constitución de Granada 2031 — Mapamundi

Plataforma participativa donde personas de todo el mundo sitúan en un mapa su vínculo
con Granada. Recoge datos personales y fotografías de gente real, y publica solo lo que
un equipo humano ha revisado. Estos principios describen cómo se construye y se opera.

## Core Principles

### I. Un único camino de despliegue

Existe un solo procedimiento de despliegue: `scripts/deploy.sh`. La automatización de
CI lo invoca y una persona en el servidor lo invoca igual, con los mismos pasos y en el
mismo orden. NO se admite un procedimiento manual alternativo "para emergencias": la
emergencia es precisamente cuando un camino menos probado falla.

El despliegue DEBE rechazar cualquier commit que no sea la punta de `origin/main`, y
cualquier árbol de trabajo con cambios sin registrar. Producción siempre corresponde a
un commit que cualquiera puede consultar.

*Razón*: cuando el despliegue manual y el automático divergen, el que se usa bajo
presión es el que nadie ha probado. Y una ejecución de CI encolada puede despacharse
mucho después de crearse — al volver un runner caído, por ejemplo — y revertir en
silencio todo lo integrado desde entonces.

### II. Los datos no se pierden

Las contribuciones son irreemplazables: nadie va a volver a escribir su recuerdo si se
borra. Por tanto:

- Todo despliegue DEBE hacer una copia de seguridad antes de modificar nada, y esa copia
  DEBE verificarse en el momento de crearse. Una copia que no se puede leer no es una
  copia.
- Los cambios de esquema van en ficheros numerados bajo `migrations/`, se aplican una
  sola vez y en orden, y se ejecutan **antes** de que la nueva API atienda tráfico.
- Las migraciones se escriben de forma aditiva: añadir un campo, rellenarlo, y eliminar
  el antiguo solo en una migración posterior, cuando ya nada lo lee. La versión anterior
  del código DEBE seguir funcionando contra el esquema nuevo.
- La restauración se prueba, no se supone. Restaurar DEBE empezar por una copia del
  estado actual, para que restaurar el punto equivocado también tenga vuelta atrás.

*Razón*: escribir migraciones de forma aditiva es lo que permite revertir el código sin
restaurar datos, que es siempre la operación más lenta y arriesgada.

### III. Los secretos viven en el servidor

Las credenciales de producción residen en el servidor, bajo `/etc/granada/`, propiedad
de `root` y legibles solo por quien las necesita. NUNCA se guardan en el repositorio, ni
se derivan de valores por defecto del código.

Ningún servicio del stack se publica en una interfaz pública. Los contenedores escuchan
en `127.0.0.1` y el Nginx del anfitrión es el único punto de entrada, porque Docker
publica puertos por delante del cortafuegos.

Todo valor por defecto que sirva como credencial (contraseña de administración, secreto
de sesión, usuario de base de datos) DEBE ser inutilizable en producción: o se
proporciona explícitamente, o el servicio no arranca con un valor conocido públicamente.

*Razón*: un marcador de posición del repositorio funcionando como contraseña real es
indistinguible de no tener contraseña.

### IV. Desarrollo igual que producción

El entorno local usa los mismos ficheros de composición que producción, la misma base de
datos y con la misma autenticación. La diferencia se limita a un overlay que ajusta
puertos y desactiva el contenido de demostración.

Un cambio que solo funciona en local, o solo en producción, indica que la paridad se ha
roto y DEBE corregirse antes de continuar.

*Razón*: cada diferencia entre entornos es un fallo que solo aparece después de
desplegar, cuando ya afecta a gente.

### V. Pruebas contra el servicio real

Las pruebas arrancan el servidor como proceso real y lo interrogan por HTTP, sobre
directorios y bases de datos desechables. Cubren ambos backends de almacenamiento.

Las pruebas NO DEBEN tocar los datos, las subidas ni la configuración de producción.
Y DEBEN ser baratas de ejecutar: comparten máquina con el sitio en producción, así que
se limitan sus recursos y se cancelan las ejecuciones superadas en lugar de encolarlas.

Una prueba que se salta silenciosamente no protege nada: si una suite depende de una
variable de entorno, algún trabajo de CI DEBE proporcionarla.

*Razón*: los dobles de prueba confirman lo que creemos del sistema; solo el servicio
arrancado confirma lo que hace.

### VI. Privacidad de quien contribuye

Quien participa entrega su nombre, su correo y una fotografía a cambio de aparecer en un
mapa. La API pública NO DEBE exponer datos personales que no sean necesarios para
mostrar la contribución — el correo electrónico, en particular, nunca sale al público.

Ninguna contribución se publica sin revisión humana. Los endpoints que aprueban, editan
o eliminan contribuciones están siempre autenticados.

*Razón*: la confianza de quien participa es la materia prima del proyecto, y se pierde
una sola vez.

## Restricciones técnicas y de seguridad

- **Stack**: API en Bun (TypeScript), MongoDB como almacén principal con SQLite como
  alternativa local, y Nginx como pasarela. El frontend no carga dependencias desde
  CDN: se vendorizan como assets estáticos.
- **Aislamiento**: el servidor de producción aloja otros servicios. Ningún cambio de
  este proyecto puede degradarlos; los puertos, redes y volúmenes se declaran de forma
  explícita y acotada.
- **Copias**: diarias y antes de cada despliegue, con retención acotada que conserva
  siempre las más recientes con independencia de su antigüedad.
- **Interrupciones**: cuando el stack no responde, el sitio sirve una página de
  mantenimiento que conserva el código de estado de error, para que las comprobaciones
  automáticas sigan viendo el fallo.

## Flujo de trabajo y puertas de calidad

- El trabajo se especifica antes de construirse; `specs/` conserva la especificación, el
  plan y las tareas de cada funcionalidad.
- Las pruebas se ejecutan en cada pull request. Solo el código y la configuración
  disparan un despliegue: la documentación y las especificaciones no reconstruyen nada.
- Cada despliegue termina comprobando que la API y la pasarela responden. Un despliegue
  que no se puede verificar se considera fallido.
- Los mensajes de commit explican por qué cambió algo y qué se rompía antes, no solo qué
  fichero se tocó.

## Governance

Esta constitución prevalece sobre cualquier otra práctica del proyecto. Cuando una
decisión técnica entre en conflicto con estos principios, se cambia la decisión o se
enmienda la constitución — no se ignora.

**Enmiendas**: se proponen por pull request, describiendo el principio afectado, el
motivo del cambio y su efecto sobre el código existente. Una enmienda que invalide
prácticas en curso DEBE incluir cómo se migra desde ellas.

**Versionado**: MAJOR cuando se elimina o redefine un principio de forma incompatible;
MINOR cuando se añade un principio o se amplía materialmente una guía; PATCH para
aclaraciones y correcciones sin cambio de significado.

**Cumplimiento**: toda revisión de código verifica que los cambios respetan estos
principios. La complejidad añadida se justifica de forma explícita; en ausencia de
justificación, se elige la opción más simple. El `README.md` documenta el detalle
operativo — despliegue, migraciones, copias — y es la guía de referencia en el día a día.

**Version**: 1.0.0 | **Ratified**: 2026-08-10 | **Last Amended**: 2026-08-10
