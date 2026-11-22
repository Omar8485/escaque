-- Migración 0003 (v2): contadores agregados del embudo. Sin identificadores de persona ni IP.
-- Se aplica con: npx wrangler d1 migrations apply escaque --remote   (y --local para wrangler dev)
-- Consulta típica (últimos 14 días):
--   SELECT day, event, SUM(count) AS n FROM events_daily WHERE day >= date('now','-14 days')
--   GROUP BY day, event ORDER BY day, event;
CREATE TABLE events_daily (
  day    TEXT NOT NULL,              -- AAAA-MM-DD (UTC)
  event  TEXT NOT NULL,              -- uno de shared/events.js
  lang   TEXT NOT NULL,              -- es | en | xx
  count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, lang)
);
