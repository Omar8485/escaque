# Cuentas, Premium y sincronización: puesta en marcha

Guía paso a paso para el dueño. Todo lo de aquí es **opcional para la app**: sin cuentas configuradas, Escaque funciona igual que antes (todo en el navegador) y la pantalla Premium dice que los precios no están disponibles. Pero **el despliegue sí necesita la base D1 creada** (paso 1), porque `wrangler.jsonc` declara el enlace `DB`.

Documentación oficial consultada el 2026-11-02 (ver «Fuentes» al final).

---

## 0. Qué se instala

| Pieza | Dónde | Coste |
|---|---|---|
| Base de datos D1 `escaque` (usuarios, sesiones, Premium, datos sincronizados) | Cloudflare | Plan gratuito |
| Inicio de sesión con Google | Google Cloud Console | Gratis |
| Inicio de sesión con Microsoft (cuentas personales) | Microsoft Entra | Gratis |
| Cobros (suscripción mensual/anual y «Fundador» de pago único) | Polar (comerciante registrado) | Comisión por venta |

URL de la app en este documento: `https://coach-chess.TU-SUBDOMINIO.workers.dev` (la que imprime `wrangler deploy`). Si más adelante usas un dominio propio, por ejemplo `https://escaque.app`, repite las URIs de redirección y el webhook con ese dominio (se pueden tener las dos a la vez).

---

## 1. Base de datos D1

```bash
npx wrangler login                     # una sola vez
npx wrangler d1 create escaque
```

El comando imprime un bloque con `"database_id": "…"`. Cópialo en `wrangler.jsonc`, en `d1_databases[0].database_id` (sustituye los ceros). Luego crea las tablas:

```bash
npx wrangler d1 migrations apply escaque --remote
```

Comprobar:

```bash
npx wrangler d1 execute escaque --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
# users, sessions, entitlements, webhook_events, sync_items, sync_state (+ d1_migrations)
```

Las migraciones se aplican en orden y solo una vez (Wrangler las anota en `d1_migrations`). Hoy son dos:

- `0001_accounts.sql`: las tablas.
- `0002_consent_founder.sql` (2026-11-07): `users.terms_version` y `users.consent_at` (versión de los términos que aceptó cada usuario y cuándo) e índices para contar los Fundadores y limpiar sesiones caducadas.

**Si ya tenías la base creada**, aplica la nueva antes de desplegar este código (si no, el login falla porque el Worker usa esas columnas):

```bash
npx wrangler d1 migrations apply escaque --remote
```

Las cuentas creadas antes de la 0002 tienen `terms_version` vacío: al entrar, la app les pide aceptar los términos 1.0 y hasta entonces no sincroniza ni deja comprar. Migraciones futuras: archivo nuevo en `migrations/` (`0003_….sql`) y de nuevo `migrations apply … --remote`.

### Límites del plan gratuito y cómo se respetan

| Límite (Workers Free + D1 Free) | Valor | Qué hace Escaque |
|---|---|---|
| Filas escritas por día (D1) | 100.000 (se reinicia a las 00:00 UTC) | Cada usuario puede subir como mucho **3.000 registros/día** (`SYNC_MAX_DAILY_WRITES`); la sesión solo actualiza «último uso» una vez al día |
| Filas leídas por día (D1) | 5 millones | La bajada es por cursor e índice (`user_id, seq`); páginas de 100 registros |
| Tamaño por base (D1) | 500 MB | **25 MB por usuario** (`SYNC_MAX_USER_BYTES`) y 20.000 registros (`SYNC_MAX_USER_ITEMS`) |
| Almacenamiento por cuenta (D1) | 5 GB | — |
| Consultas por invocación (D1) | 50 (un `batch()` cuenta como 1) | Cada subida usa 2 batches |
| Tamaño de fila / sentencia (D1) | 2 MB / 100 KB | Registro ≤ 128 KB; petición ≤ 512 KB y ≤ 100 registros |
| Parámetros por consulta (D1) | 100 | Los IN se pasan como un solo JSON (`json_each`) |
| Peticiones al Worker | 100.000/día | Solo cuentan las rutas `/api`; la sincronización corre cada 5 min como mucho y tras cambios (agrupados 4 s) |
| CPU por petición | 10 ms | Sin dependencias; las claves JWKS se cachean en memoria |
| Subpeticiones por invocación | 50 | Un login hace 2 (token + JWKS) |

Con 3.000 registros/día por usuario (~6.000 filas escritas con su índice), unas 15 subidas iniciales completas caben en un día. Si hay muchos usuarios Premium nuevos el mismo día, la subida inicial sigue al día siguiente (la app lo dice: «Límite diario alcanzado»). Para ajustar sin tocar código, en `wrangler.jsonc` → `vars`:

```jsonc
"SYNC_MAX_DAILY_WRITES": "3000",
"SYNC_MAX_USER_BYTES": "26214400",
"SYNC_MAX_USER_ITEMS": "20000"
```

### Límites de frecuencia (anti-abuso)

`wrangler.jsonc` declara tres limitadores (`RL_AUTH` 20/min por IP en el login; `RL_API` 120/min por usuario o IP; `RL_WEBHOOK` 120/min). Son aproximados y por ubicación de Cloudflare. **Si `wrangler deploy` rechaza el bloque `ratelimits`** en tu plan, bórralo: el Worker usa entonces un contador en memoria (menos preciso, pero funciona).

---

## 2. Secreto de sesión

Firma la cookie del inicio de sesión y los tokens CSRF. Mínimo 32 caracteres.

```bash
openssl rand -base64 48                # copia el resultado
npx wrangler secret put SESSION_SECRET # pégalo cuando lo pida
```

Si lo cambias, todos tienen que volver a iniciar sesión (sus datos no se pierden).

---

## 3. Google

1. Entra en <https://console.cloud.google.com/> y crea un proyecto (p. ej. «Escaque»).
2. **Google Auth Platform → Branding**: nombre de la app «Escaque», correo de soporte, logotipo opcional, **dominios autorizados**: `workers.dev` no es tuyo; añade tu dominio propio cuando lo tengas. Enlaces a la política de privacidad y términos (las páginas legales de `public/`).
3. **Audience**: tipo de usuario **External**. Para pruebas puede quedarse en **Testing** (hasta 100 usuarios de prueba). Como Escaque solo pide `openid email profile` (ámbitos no sensibles), pulsa **Publish app** para pasar a **In production** cuando quieras abrirlo a todos.
4. **Clients → Create client** → tipo **Web application**, nombre «Escaque web».
   - **Authorized redirect URIs** (exactas, sin barra final):
     - `https://coach-chess.TU-SUBDOMINIO.workers.dev/api/auth/callback/google`
     - (dominio futuro) `https://escaque.app/api/auth/callback/google`
     - (opcional, pruebas locales con Google real) `http://localhost:8787/api/auth/callback/google`
   - No hace falta «Authorized JavaScript origins» (el canje se hace en el servidor).
5. Al crear, copia **Client ID** y **Client secret** (el secreto solo se muestra entero una vez):

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Los cambios de URIs en Google pueden tardar de 5 minutos a unas horas.

---

## 4. Microsoft (cuentas personales: Outlook, Hotmail, Xbox)

1. Entra en <https://entra.microsoft.com> con tu cuenta (sirve una cuenta personal; si no tienes inquilino, el portal te ofrece crear uno gratuito).
2. **Entra ID → App registrations → New registration**:
   - Name: «Escaque».
   - **Supported account types: Personal accounts only** (el Worker además exige el inquilino de consumidores `9188040d-6c67-4c5b-b112-36a304b66dad`).
   - Redirect URI: plataforma **Web**, `https://coach-chess.TU-SUBDOMINIO.workers.dev/api/auth/callback/microsoft`.
   - Register.
3. En **Overview** copia **Application (client) ID**.
4. **Authentication → Web → Add URI** para las demás:
   - `https://escaque.app/api/auth/callback/microsoft` (dominio futuro)
   - `http://localhost:8787/api/auth/callback/microsoft` (opcional, local)
5. **Certificates & secrets → Client secrets → New client secret** (caducidad máxima 24 meses: **apunta la fecha**, al caducar el inicio con Microsoft falla). Copia el **Value** (no el «Secret ID»).

```bash
npx wrangler secret put MS_CLIENT_ID
npx wrangler secret put MS_CLIENT_SECRET
```

Si solo configuras uno de los dos proveedores, la app muestra solo ese botón.

---

## 5. Polar (cobros)

Polar es el **comerciante registrado**: cobra, emite facturas, gestiona impuestos (IVA/ventas) y te paga a Ecuador mediante Stripe Connect Express. Hay dos entornos **separados** (cuentas, organizaciones, productos y tokens distintos): sandbox para probar y producción para cobrar.

### 5.1 Sandbox (primero)

1. Crea cuenta y organización en <https://sandbox.polar.sh/start>.
2. **Products → New product**, tres productos con **estos precios exactos en USD** (decididos el 2026-11-07; la app lee los precios de Polar y nunca los fija en el código, así que cualquier otro importe se mostraría tal cual y el «ahorra X %» del anual se recalcularía):

   | Producto (nombre) | Tipo en Polar | Precio | Descripción sugerida (Polar tiene un solo campo: va bilingüe) |
   |---|---|---|---|
   | `Escaque Premium mensual` | Recurrente, **mensual**, precio fijo | **2,99 USD** | «Premium de Escaque: historial completo, Progreso completo, plan completo, sincronización entre dispositivos y temas extra. Se renueva cada mes; cancela cuando quieras. — Escaque Premium: full history, full Progress, full plan, sync across devices and extra themes. Renews monthly; cancel anytime.» |
   | `Escaque Premium anual` | Recurrente, **anual**, precio fijo | **19,99 USD** | «Premium de Escaque por un año (equivale a 1,67 USD al mes). Se renueva cada año; cancela cuando quieras. — Escaque Premium for one year (about 1.67 USD per month). Renews yearly; cancel anytime.» |
   | `Escaque Fundador` | **Pago único**, precio fijo | **49,99 USD** | «Premium para siempre mientras exista el servicio Escaque. Intransferible. Solo para los primeros 500. — Premium forever, for as long as the Escaque service exists. Non-transferable. First 500 buyers only.» |

   - Moneda **USD** en los tres. No actives «pay what you want», pruebas gratuitas ni descuentos: la pantalla Premium y los términos dan por hecho precios fijos.
   - El anual equivale a 19,99 / 12 = 1,67 USD al mes y ahorra un 44 % frente a 12 meses del mensual (35,88 USD); la app lo calcula sola con los precios de Polar (redondea el ahorro hacia abajo).
   - Copia el **ID** de cada producto (uuid).
3. **Settings → Developers → New Token** (Organization Access Token): nombre «Escaque Worker», ámbitos **`products:read`, `checkouts:write`, `customer_sessions:write`**, caducidad a tu gusto (apúntala).
4. **Settings → Webhooks → Add Endpoint**:
   - URL: `https://coach-chess.TU-SUBDOMINIO.workers.dev/api/webhooks/polar`
   - Format: **Raw**
   - Secret: **Generate** y cópialo (`whsec_…`).
   - Events: `order.paid`, `order.updated`, `order.refunded`, `subscription.created`, `subscription.active`, `subscription.updated`, `subscription.canceled`, `subscription.uncanceled`, `subscription.past_due`, `subscription.revoked`.
5. En `wrangler.jsonc` → `vars`:

```jsonc
"POLAR_SERVER": "sandbox",
"POLAR_PRODUCT_MONTHLY": "uuid-del-mensual",
"POLAR_PRODUCT_YEARLY": "uuid-del-anual",
"POLAR_PRODUCT_FOUNDER": "uuid-del-fundador",
"FOUNDER_LIMIT": "500"
```

`FOUNDER_LIMIT` = plazas de Fundador (500 por defecto aunque no la pongas). El Worker cuenta los derechos de por vida **activos** en D1 (`entitlements` con `kind = 'lifetime'` y `status = 'active'`; los reembolsados liberan su plaza y los que des a mano en §9 también cuentan), devuelve las plazas restantes en `GET /api/billing/products` y responde `409 founder_sold_out` a `POST /api/billing/checkout` de Fundador cuando se agotan; la app muestra «Agotado». El límite se comprueba al abrir el pago, no al cobrar: dos compras simultáneas con la última plaza podrían pasar las dos (como mucho alguna plaza de más).

6. Secretos:

```bash
npx wrangler secret put POLAR_ACCESS_TOKEN     # polar_oat_…
npx wrangler secret put POLAR_WEBHOOK_SECRET   # whsec_…
npm run cf:deploy
```

### 5.2 Probar en sandbox

1. Abre la app → ☰ → marca la casilla «Tengo 16 años o más y acepto…» → **Iniciar sesión con Google/Microsoft** (sin la casilla los botones están deshabilitados).
2. ☰ → **Hazte Premium**: deben verse los tres precios con el aviso «Modo de prueba»: Mensual 2,99 US$ · **Anual 19,99 US$ («Mejor valor», «1,67 US$ al mes · ahorra 44 %»)** · Fundador 49,99 US$ con «Quedan 500 plazas de 500».
3. **Elegir** en Mensual → página de pago de Polar → tarjeta **4242 4242 4242 4242**, cualquier fecha futura y cualquier CVC.
4. Vuelves a la app («¡Gracias! Activando Premium…»); en unos segundos el menú muestra «Premium mensual». Si no, mira en Polar **Settings → Webhooks → (endpoint) → Deliveries**: debe haber respuestas **202**. Un 403 = secreto distinto; 503 = falta `POLAR_WEBHOOK_SECRET` o la base D1.
5. **Gestionar suscripción y facturas** abre el portal de cliente de Polar; cancela desde ahí: la app muestra «Cancelada: Premium sigue activo hasta el …» y al terminar el período (evento `subscription.revoked`) vuelve al plan gratuito.
6. Abre la app en otro navegador o en el móvil, entra con la misma cuenta y comprueba que llegan tus partidas (☰ → Tu Premium → Sincronización).

En sandbox, los correos de Polar solo llegan a miembros de la organización.

### 5.3 Producción

Repite 5.1 en <https://polar.sh> (cuenta de producción, completa la verificación de la organización y la configuración de pagos/Stripe que pida Polar), con los nuevos IDs, token y secreto, y cambia `"POLAR_SERVER": "production"`. Vuelve a cargar `POLAR_ACCESS_TOKEN` y `POLAR_WEBHOOK_SECRET` (los de sandbox no sirven en producción) y despliega.

### 5.4 Reembolsos y cierre (lo que prometen los Términos)

- **14 días**: quien lo pida dentro de los 14 días siguientes a su primera compra de un plan (primer pago de mensual o anual, o el Fundador) recibe el reembolso **completo**, sin preguntas. Hazlo en Polar → **Orders** → el pedido → **Refund** (total). Polar envía `order.refunded` y la app quita ese Premium sola; en Fundador, la plaza se libera.
- **Renovaciones**: no se reembolsan salvo que la ley lo exija o el servicio no se haya prestado (p. ej. una caída larga).
- **Cierre del servicio** (Términos §6): aviso de 90 días en la app y por correo, y reembolso proporcional a los Fundadores que compraron en los 12 meses anteriores al cierre (meses no disfrutados de esos 12 / 12 × lo pagado; el mes en curso cuenta como no disfrutado). Quiénes son: `SELECT u.email, e.polar_ref FROM entitlements e JOIN users u ON u.id = e.user_id WHERE e.kind = 'lifetime' AND e.status = 'active'` y la fecha de cada pedido en Polar.
- Si Polar pide la URL de la política de reembolsos o de los términos del vendedor: `https://TU-DOMINIO/terminos#reembolsos` (en inglés `/terms#refunds`); privacidad: `https://TU-DOMINIO/privacidad`.

---

## 6. Resumen de secretos y variables

| Nombre | Tipo | De dónde sale |
|---|---|---|
| `SESSION_SECRET` | secreto | `openssl rand -base64 48` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | secretos | Google Auth Platform → Clients |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | secretos | Entra → App registrations |
| `POLAR_ACCESS_TOKEN` | secreto | Polar → Settings → Developers |
| `POLAR_WEBHOOK_SECRET` | secreto | Polar → Settings → Webhooks |
| `POLAR_SERVER` | var | `sandbox` o `production` |
| `POLAR_PRODUCT_MONTHLY/YEARLY/FOUNDER` | var | IDs de producto de Polar |
| `FOUNDER_LIMIT` | var (opcional) | Plazas de Fundador; por defecto `500` |
| `SYNC_MAX_*` | var (opcional) | ver §1 |
| `AUTH_TEST_MODE` | **no la pongas en producción** | Solo pruebas locales; aun puesta, el Worker la ignora fuera de `localhost` |

Ver lo cargado: `npx wrangler secret list`. Los secretos no están en el repositorio (el código es GPLv3 y público): nunca los pongas en `wrangler.jsonc`.

---

## 7. Probar en local

Con proveedores y Polar **simulados** (sin cuentas reales; es lo que usa el e2e):

```bash
npm run build
node scripts/e2e-accounts.cjs            # arranca wrangler dev :8799 con D1 local temporal
```

A mano:

```bash
npx wrangler d1 migrations apply escaque --local
npx wrangler dev --var AUTH_TEST_MODE:1 --var POLAR_SERVER:mock \
  --var POLAR_PRODUCT_MONTHLY:mock-monthly --var POLAR_PRODUCT_YEARLY:mock-yearly --var POLAR_PRODUCT_FOUNDER:mock-founder \
  --var SESSION_SECRET:una-cadena-local-de-al-menos-32-caracteres \
  --var POLAR_WEBHOOK_SECRET:whsec_AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcY
```

Con Google/Microsoft reales en local, crea `.dev.vars` (no se sube al repo; está en `.gitignore`) con `SESSION_SECRET=…`, `GOOGLE_CLIENT_ID=…`, etc., y registra las URIs `http://localhost:8787/api/auth/callback/…`.

Pruebas automáticas: `npm test` (incluye el Worker con D1 sobre SQLite de Node: rutas, id_token con claves de prueba, webhooks firmados, sincronización y límites).

---

## 8. Microsoft Store

La PWA en la Microsoft Store puede usar este mismo sistema de cobro (Polar) porque Escaque no es un juego: la política de la Store permite a las apps que no son juegos usar su propio sistema de pago. El inicio de sesión funciona igual dentro de la PWA instalada (navegación completa al proveedor y vuelta al mismo origen).

---

## 9. Operación

- **Ver errores**: `npx wrangler tail` (los registros nunca incluyen tokens, cookies ni secretos).
- **Usuarios Premium**: `npx wrangler d1 execute escaque --remote --command "SELECT plan, status, COUNT(*) FROM entitlements GROUP BY 1,2"`.
- **Plazas de Fundador vendidas**: `npx wrangler d1 execute escaque --remote --command "SELECT COUNT(*) FROM entitlements WHERE kind = 'lifetime' AND status = 'active'"` (lo mismo que cuenta la app).
- **Solicitudes de derechos por correo** (acceso o portabilidad; la política promete responder en 15 días): busca al usuario por su correo y exporta en JSON:
  ```bash
  npx wrangler d1 execute escaque --remote --json --command "SELECT id, provider, email, name, created_at, terms_version, consent_at FROM users WHERE email = 'persona@ejemplo.com'"
  npx wrangler d1 execute escaque --remote --json --command "SELECT kind, plan, status, current_period_end FROM entitlements WHERE user_id = '<id>'"
  npx wrangler d1 execute escaque --remote --json --command "SELECT store, key, updated_at, deleted, data FROM sync_items WHERE user_id = '<id>'"
  ```
  Para **borrar** a petición: `DELETE FROM users WHERE id = '<id>'` (en cascada: sesiones, plan y datos sincronizados), igual que el botón «Borrar mi cuenta».
- **Dar Premium a mano** (soporte; un Fundador dado a mano ocupa plaza): `INSERT INTO entitlements (user_id, kind, plan, status, current_period_end, source_ts, updated_at) VALUES ('<id>', 'lifetime', 'founder', 'active', NULL, strftime('%s','now')*1000, strftime('%s','now')*1000)`.
- **Copias**: D1 guarda Time Travel 7 días en el plan gratuito (`npx wrangler d1 time-travel info escaque`).
- **Cambiar qué es gratis**: un solo archivo, `src/premium/limits.js`.

## Fuentes

- Cloudflare D1, límites: <https://developers.cloudflare.com/d1/platform/limits/> · precios y cupos diarios del plan gratuito: <https://developers.cloudflare.com/d1/platform/pricing/> · API (`batch()` es transacción): <https://developers.cloudflare.com/d1/worker-api/d1-database/>
- Cloudflare Workers, límites: <https://developers.cloudflare.com/workers/platform/limits/> · Rate Limiting: <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/>
- Google OIDC: <https://developers.google.com/identity/openid-connect/openid-connect> · descubrimiento: <https://accounts.google.com/.well-known/openid-configuration> · reglas de URIs: <https://developers.google.com/identity/protocols/oauth2/web-server> · clientes: <https://support.google.com/cloud/answer/15549257> · audiencia: <https://support.google.com/cloud/answer/15549945>
- Microsoft: <https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc> · <https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow> · claims: <https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference> · descubrimiento consumers: <https://login.microsoftonline.com/consumers/v2.0/.well-known/openid-configuration> · registro: <https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app>
- Polar, términos del comprador (Polar Software, Inc. como comerciante registrado; consultados el 2026-11-07): <https://polar.sh/legal/checkout-buyer-terms> · privacidad: <https://polar.sh/legal/privacy-policy>
- Polar: sandbox <https://polar.sh/docs/integrate/sandbox> · checkout <https://polar.sh/docs/api-reference/checkouts/create-session> · portal <https://polar.sh/docs/api-reference/customer-portal/sessions/create> · productos <https://polar.sh/docs/api-reference/products/list> · webhooks (firma y secretos) <https://polar.sh/docs/integrate/webhooks/delivery> · eventos <https://polar.sh/docs/integrate/webhooks/events> · endpoints <https://polar.sh/docs/integrate/webhooks/endpoints> · tokens <https://polar.sh/docs/integrate/oat>
- Standard Webhooks: <https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md>

## 10. Nombre del responsable en las páginas legales (privacidad)

El nombre del responsable del tratamiento **no está en el repositorio** (que es público): las páginas legales llevan un marcador que el build completa. En tu equipo, crea el archivo `.env.production.local` en la raíz del proyecto (git lo ignora) con:

```
VITE_CONTROLLER_NAME=Tu nombre completo
```

y vuelve a publicar con `npm run cf:deploy`. Si no lo creas, las páginas dicen «el titular de Escaque». Las páginas legales llevan `noindex` (no se indexan en buscadores) y no están en el sitemap.
