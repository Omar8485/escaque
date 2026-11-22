-- Migración 0002: consentimiento explícito al crear la cuenta, cupos de «Fundador» y limpieza.
-- Se aplica con: npx wrangler d1 migrations apply escaque --remote   (y --local para wrangler dev)

-- Versión de los Términos y la Política de privacidad que aceptó el usuario (shared/legal.js →
-- TERMS_VERSION) y cuándo (ms desde epoch). NULL = cuenta creada antes de pedir el consentimiento:
-- la app le pide aceptar antes de seguir (y lo mismo cuando cambia la versión).
ALTER TABLE users ADD COLUMN terms_version TEXT;
ALTER TABLE users ADD COLUMN consent_at INTEGER;

-- Cuenta rápida de los «Fundador» activos (FOUNDER_LIMIT) sin recorrer toda la tabla.
CREATE INDEX entitlements_kind_status ON entitlements (kind, status);

-- Limpieza de sesiones caducadas de todos los usuarios (se hace al iniciar sesión).
CREATE INDEX sessions_expires ON sessions (expires_at);
