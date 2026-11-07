# Notas legales: privacidad, términos y consentimiento

> **Estado: resuelto (2026-11-07, rama `feat/legal-pricing`).** `public/privacidad.html`, `privacy.html`, `terminos.html` y `terms.html` son la **versión 1.0, vigente desde el 7 de noviembre de 2026**, sin marca de borrador. El dueño no puede contratar abogado: Claude revisó el marco legal y el dueño aceptó las decisiones de abajo. No es asesoría legal; si algún día hay un profesional, conviene que revise sobre todo los puntos de «Límites de esta revisión».

## Responsable

- El **titular de Escaque** (persona natural, Quito, Ecuador) — su nombre no se guarda en el repositorio: se inserta en el build desde `VITE_CONTROLLER_NAME` (`.env.production.local`) —: responsable del tratamiento y titular del servicio.
- Contacto: **escaque.ec@gmail.com** (`DEFAULT_CONTACT_EMAIL` en `src/appInfo.js`; las páginas lo reciben en el build por `%CONTACT_EMAIL%`).

## Decisiones del dueño (aceptadas)

| Tema | Decisión |
|---|---|
| Edad mínima para crear cuenta | **16 años** (la LOPDP art. 21 permite consentir desde los 15; se eligió 16, que además es el valor por defecto del RGPD art. 8). Sin cuenta, cualquier edad. Compras: mayoría de edad o autorización del representante. |
| Consentimiento | Casilla obligatoria, no premarcada, antes del primer inicio de sesión: «Tengo 16 años o más y acepto los Términos y la Política de privacidad, incluida la transferencia de mis datos a los proveedores indicados fuera de Ecuador». Se registra versión y fecha en D1. |
| Transferencias internacionales | Base: consentimiento explícito al crear la cuenta (LOPDP art. 33; RGPD art. 49.1.a), además de los compromisos que publica cada proveedor. |
| Reembolsos | 14 días desde la primera compra de cualquier plan (mensual, anual o Fundador): reembolso completo sin justificar, por correo o por Polar. Renovaciones: no, salvo ley o servicio no prestado. Cancelación en cualquier momento; Premium hasta el fin del período pagado. |
| Plan Fundador | «Para siempre» = durante la vida del servicio Escaque. Intransferible. 500 plazas (`FOUNDER_LIMIT`). Cierre: aviso ≥ 90 días, exportar datos, la app sigue funcionando sin servidor, y reembolso proporcional a quien compró en los 12 meses anteriores al cierre. |
| Ley y jurisdicción | Leyes de Ecuador, jueces de Quito, sin perjuicio de los derechos irrenunciables del consumidor según la ley de su país; la compra se rige además por los términos de Polar. |
| Precios (delegado en Claude) | Mensual 2,99 USD · Anual 19,99 USD (1,67 al mes, ahorra 44 %) · Fundador 49,99 USD pago único, primeros 500. Se crean en Polar; la app los lee de Polar. |
| Datos sincronizados de quien deja de ser Premium | Se conservan hasta que el usuario los borre o borre la cuenta (no hay borrado automático); se pueden borrar sin Premium. |

## Dónde está cada cosa

- Versión de los términos: `shared/legal.js` (`TERMS_VERSION`, `TERMS_EFFECTIVE_DATE`, `MIN_ACCOUNT_AGE`). Al cambiar los textos de forma sustancial, súbela allí y en las cuatro páginas (`data-legal-version` y la línea «Versión …»); `build-tools/site.test.js` lo comprueba. Todos los usuarios con cuenta tendrán que volver a aceptar.
- Consentimiento en el Worker: `worker/auth/routes.js` (la versión viaja en la cookie firmada del login; sin ella no se crea usuario nuevo → `account=error:consent_required`; `POST /api/me/consent`), `worker/auth/session.js` (`consentRequired`, `recordConsent`), migración `migrations/0002_consent_founder.sql`. Sin la versión vigente aceptada: no hay sincronización (`/api/sync/push|pull` → 403) ni compra (`/api/billing/checkout` → 403); sí cerrar sesión, borrar datos o cuenta y abrir el portal de Polar para cancelar.
- Casilla y aviso en la app: `src/account/Consent.jsx`, `ProviderButtons.jsx`, `AccountSection.jsx`.
- Borrar la cuenta: ☰ → «Borrar mi cuenta» (menú) y en la pantalla Premium; `src/account/deleteAccount.js` → `DELETE /api/me` (cascada: `sessions`, `entitlements`, `sync_items`, `sync_state`).
- Plazas de Fundador: `worker/billing/routes.js` (`founderSlots`), `FOUNDER_LIMIT` en `wrangler.jsonc`.
- Pantalla Premium: `src/account/PremiumScreen.jsx` y `src/account/pricing.js` (equivalente mensual y ahorro a partir de los precios reales de Polar; ahorro redondeado hacia abajo; sin precios tachados ni «Más elegido», que no tendría datos que lo respalden).

## Tabla sección → norma

### Política de privacidad (`/privacidad`, `/privacy`)

| Sección | Qué dice | Norma que cubre |
|---|---|---|
| 1. Responsable | Nombre, domicilio (Quito), contacto, ley aplicable | LOPDP art. 12 (identidad y datos de contacto del responsable); RGPD art. 13.1.a |
| 2. En resumen | Sin cuenta no hay datos en servidores; cuenta opcional 16+; sin publicidad | LOPDP art. 12 (información clara); principio de minimización (LOPDP art. 10; RGPD art. 5.1.c) |
| 3. Sin cuenta | Qué queda en el navegador; datos técnicos de conexión y registros de Cloudflare (3–7 días) | LOPDP art. 12; RGPD art. 13 |
| 4. Si creas una cuenta | Datos, finalidades, bases legales (consentimiento, contrato, interés legítimo), plazos de conservación, sin decisiones automatizadas | LOPDP arts. 7, 8 y 12 (finalidad, base, conservación); RGPD arts. 6.1.a/b/f, 13.1.c, 13.2.a y 13.2.f |
| 5. Datos sincronizados | Qué se sincroniza y qué no; marcas de borrado; límites | LOPDP art. 12; RGPD art. 13 |
| 6. Terceros y transferencias | Cloudflare (encargado), Google, Microsoft, Polar (comerciante registrado, responsable de los pagos), Lichess, Chess.com, IA con clave propia; transferencia a EE. UU. con consentimiento explícito | LOPDP arts. 12 num. 10, 33 y 55–58; RGPD arts. 13.1.e/f, 28, 44–49 (45, 46 y 49.1.a) |
| 7. Cookies y almacenamiento | Solo cookies técnicas `__Host-escaque_sid` (30 días) y `__Host-escaque_oidc` (10 min); almacenamiento local; analítica sin cookies solo si se activa | LOPDP art. 12; Directiva ePrivacy art. 5.3 (cookies estrictamente necesarias) como referencia |
| 8. Derechos | Acceso, rectificación, eliminación, oposición, portabilidad, suspensión, no a decisiones automatizadas; retirar el consentimiento; desde la app y por correo; respuesta en 15 días; reclamo ante la autoridad | LOPDP arts. 13–20 (15 días en arts. 13–16) y 12 num. 16; RGPD arts. 7.3, 12.3, 15–22 y 77 |
| 9. Menores | Sin cuenta, cualquier edad; cuenta desde 16; compras con mayoría de edad o autorización | LOPDP art. 21 (consentimiento desde 15) y art. 24; RGPD art. 8 |
| 10. Seguridad y brechas | Medidas técnicas; notificación a la autoridad (≤ 5 días) y al titular (≤ 3 días) | LOPDP arts. 37, 43 y 46; RGPD arts. 32–34 |
| 11. Cambios | Versión y fecha; aviso en la app; volver a aceptar | LOPDP art. 12 (información previa); RGPD art. 13.3 |
| 12. Contacto | Responsable y correo | LOPDP art. 12 |

### Términos de uso (`/terminos`, `/terms`)

| Sección | Qué dice | Norma o fuente |
|---|---|---|
| 1. Titular, objeto, aceptación | Persona natural en Quito; aceptación expresa al crear la cuenta | Código Civil de Ecuador (contratos); Ley de Comercio Electrónico (aceptación electrónica) como referencia |
| 2. Cuenta y edad | 16+ para cuenta; compras con mayoría de edad o autorización | LOPDP art. 21; capacidad civil |
| 3. Licencia | GPLv3; los términos no restringen derechos de la GPL; sin derechos sobre el nombre | GPLv3 (§§ 2, 7 y 10: no imponer restricciones adicionales) |
| 4. Planes y pagos | Gratis/Premium según `src/premium/limits.js`; Polar como comerciante registrado; USD + impuestos; renovación automática y cancelación | Términos del comprador de Polar; Ley Orgánica de Defensa del Consumidor (información de precio y condiciones) |
| 5. Reembolsos | 14 días en la primera compra; renovaciones no, salvo ley o servicio no prestado | Decisión del dueño; coincide con el desistimiento de 14 días de la UE (Directiva 2011/83/UE art. 9) y con los términos de Polar («fees for elapsed billing periods are non-refundable» salvo ley o servicio no prestado) |
| 6. Fundador | Vida del servicio; intransferible; 500 plazas; cierre con 90 días, exportación y reembolso proporcional | Decisión del dueño (evita la ambigüedad de «de por vida») |
| 7. Uso aceptable | Sin abuso de la API, sin acceder a datos ajenos, suspensión | — |
| 8. Terceros e importaciones | Sin afiliación con Lichess/Chess.com; importar solo partidas accesibles | Condiciones de Lichess y Chess.com |
| 9. IA opcional | La paga y configura el usuario; comentarios orientativos | — |
| 10. Datos y sincronización | Datos en el navegador; límites técnicos | Remite a la Política de privacidad |
| 11. Garantías y responsabilidad | «Tal cual»; límite al importe de los últimos 12 meses salvo dolo o lo que la ley prohíba limitar | Ley Orgánica de Defensa del Consumidor (cláusulas que limitan la responsabilidad del proveedor pueden no valer frente a consumidores: por eso la salvedad) |
| 12. Ley y jurisdicción | Ecuador, jueces de Quito, sin perjuicio de derechos irrenunciables del consumidor; compra también bajo términos de Polar | Decisión del dueño; Reglamento Roma I art. 6 (consumidores de la UE) como referencia |
| 13. Cambios | Aviso previo en la app; volver a aceptar; puede borrar la cuenta | — |

## Revisión de coherencia con el código (2026-11-07)

Lo que dicen los textos se comprobó contra el código. Discrepancias encontradas y cómo se resolvieron:

1. **Sesiones «30 días»**: las caducadas solo se borraban cuando ese mismo usuario volvía a iniciar sesión (podían quedarse para siempre). Ahora `createSession` borra las caducadas de todos (índice `sessions_expires`) y la política dice «se eliminan en la siguiente limpieza automática».
2. **Avisos de Polar «30 días»**: solo se purgaban al llegar otro webhook. Ahora también se purgan en cada inicio de sesión.
3. **Copias de seguridad**: la política no mencionaba Time Travel de D1 (los datos borrados siguen restaurables unos días). Añadido (7 días en el plan gratuito, como máximo 30).
4. **Registros de Cloudflare**: el Worker tiene `observability` activado; se precisó la retención (3 días en el plan gratuito, como máximo 7) y que la app consulta `/api/me` al abrirse aunque no haya cuenta.
5. **Reenvío de Chess.com «no guarda nada»**: cierto para Escaque, pero el Worker pide a Cloudflare cachear la respuesta pública 10 minutos (`cacheTtl: 600`). Se dice en la política.
6. **«Fundador (de por vida)»** en la pantalla Premium contradecía la decisión «vida del servicio»: ahora «Fundador» + «Pago único · para siempre mientras exista Escaque».
7. **Borrar la cuenta no cancela la suscripción en Polar** (seguiría cobrando): la confirmación lo avisa si hay una suscripción que se renueva, y también que el plan Fundador se pierde; la política lo dice.
8. **Portabilidad**: no hay botón para exportarlo todo; la política lo dice y ofrece la copia en JSON por correo (consultas en `DEPLOY-ACCOUNTS.md` §9).
9. **Borrar la cuenta desde el menú**: solo estaba en la pantalla Premium; ahora también en el menú (la política lo indica así).
10. **README** decía que el código no tenía licencia publicada: corregido (GPLv3, repositorio público).

Comprobado sin cambios: qué se sincroniza (`SYNCED_STORES` + `SYNCED_PREF_KEYS`, nunca `escaque:ia`, tema, idioma ni sonido), cookies y sus atributos, `escaque:account` (7 días) y `escaque:products` (24 h), qué hechos se envían a la IA (`shared/coach-contract/compact.js`: sin nombres ni partidas completas), qué se manda a Polar (id interno y correo), el borrado en cascada de `DELETE /api/me`, límites de 25 MB y 3.000 cambios al día.

## Fuentes consultadas

- LOPDP, texto publicado por ESPOL: <https://www.dspace.espol.edu.ec/bitstream/123456789/57303/1/LEY%20ORG%C3%81NICA%20DE%20PROTECCI%C3%93N%20DE%20DATOS%20PERSONALES.pdf> (leído el 2026-11-07). Confirmado en el texto: R.O. 5.º Supl. 459 de 26-V-2021; art. 7 (num. 1 consentimiento, num. 5 contrato) y art. 8; art. 12 (información, num. 10 transferencias y num. 16 reclamos); **15 días** para acceso (13), rectificación (14), eliminación (15) y oposición (16); portabilidad (17) sin plazo, a regular por la Autoridad; art. 21 (adolescentes desde 15 años); art. 33 (transferencia con consentimiento); art. 43 (5 días a la Autoridad); art. 46 (3 días al titular); arts. 55–58 (transferencia internacional: nivel adecuado, garantías adecuadas, normas corporativas).
- Términos del comprador de Polar (Polar Software, Inc., Delaware): <https://polar.sh/legal/checkout-buyer-terms>; privacidad: <https://polar.sh/legal/privacy-policy>.
- Cloudflare Workers Logs (retención 3 días Free / 7 Paid): <https://developers.cloudflare.com/workers/observability/logs/workers-logs/>.
- RGPD (Reglamento UE 2016/679), como referencia para usuarios de la UE.

## Límites de esta revisión

- El PDF de la LOPDP consultado termina en el art. 58: no se pudo leer el texto de los artículos posteriores (p. ej. el que organiza la Superintendencia de Protección de Datos Personales ni posibles excepciones específicas para transferencias internacionales). Por eso la política cita «arts. 33 y 55 y siguientes» y nombra a la autoridad como «Autoridad de Protección de Datos Personales (Superintendencia de Protección de Datos Personales)», sin artículo.
- No se verificó si Polar Software, Inc. está adherida al Marco de Privacidad de Datos UE-EE. UU.; la política habla de «compromisos que cada proveedor publica… cuando corresponda», sin afirmarlo de ningún proveedor en concreto.
- Los términos de Polar someten la compra a la ley de Delaware y a arbitraje individual (JAMS). Los nuestros dicen que la compra se rige «además» por los de Polar: para un problema con el cobro, el usuario puede acabar en ese procedimiento.
- La limitación de responsabilidad (§11 de los términos) puede no valer frente a consumidores ecuatorianos o europeos; el texto ya lo salva («en la medida en que la ley lo permita»).
