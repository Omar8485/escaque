-- Migración 0001: cuentas, sesiones, derechos (Premium), webhooks procesados y sincronización.
-- Se aplica con: npx wrangler d1 migrations apply escaque --remote   (y --local para wrangler dev)
-- Tiempos en milisegundos desde epoch (INTEGER). D1 aplica las claves foráneas (PRAGMA foreign_keys = ON).

-- Usuario de Escaque. Una fila por (proveedor, sub): no se fusionan cuentas de Google y Microsoft
-- aunque tengan el mismo correo (el correo puede cambiar y no es un identificador estable).
CREATE TABLE users (
  id          TEXT PRIMARY KEY,                 -- uuid propio; es el external_customer_id en Polar
  provider    TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'test')),
  subject     TEXT NOT NULL,                    -- claim `sub` del id_token
  email       TEXT,                             -- solo para mostrar y para el recibo de Polar
  name        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE (provider, subject)
);

-- Sesiones: solo se guarda el SHA-256 del token de la cookie (si se filtra la base, no sirven).
CREATE TABLE sessions (
  id_hash       TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Derechos Premium. Una fila por usuario y tipo: la suscripción (mensual/anual) y el pago único
-- «Fundador» (de por vida) pueden coexistir. `source_ts` ordena los webhooks que llegan desordenados.
CREATE TABLE entitlements (
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL CHECK (kind IN ('subscription', 'lifetime')),
  plan                TEXT NOT NULL,            -- monthly | yearly | founder
  status              TEXT NOT NULL,            -- active | canceled | past_due | expired | refunded
  current_period_end  INTEGER,                  -- null en «Fundador»
  polar_customer_id   TEXT,
  polar_ref           TEXT,                     -- id de la suscripción o del pedido en Polar
  source_ts           INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);

-- Webhooks ya procesados (idempotencia por la cabecera webhook-id). Se purgan a los 30 días.
CREATE TABLE webhook_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  received_at  INTEGER NOT NULL
);
CREATE INDEX webhook_events_received ON webhook_events (received_at);

-- Datos sincronizados: un registro por (usuario, almacén, clave). `k` = almacén + U+001F + clave.
-- Última escritura gana por `updated_at` (del cliente); los borrados quedan como lápidas (deleted = 1).
-- `seq` es un contador por usuario: el cliente pide los cambios con seq > cursor.
CREATE TABLE sync_items (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  k           TEXT NOT NULL,
  store       TEXT NOT NULL,
  key         TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0,
  data        TEXT,
  size        INTEGER NOT NULL DEFAULT 0,
  seq         INTEGER NOT NULL,
  PRIMARY KEY (user_id, k)
);
CREATE INDEX sync_items_seq ON sync_items (user_id, seq);

-- Estado de sincronización por usuario: contador de seq, uso (bytes/registros) y cupo diario.
CREATE TABLE sync_state (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL DEFAULT 0,
  bytes       INTEGER NOT NULL DEFAULT 0,
  items       INTEGER NOT NULL DEFAULT 0,
  day         TEXT NOT NULL DEFAULT '',
  day_writes  INTEGER NOT NULL DEFAULT 0
);
