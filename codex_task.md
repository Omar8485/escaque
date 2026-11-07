# codex_task.md — tareas para Codex (ChatGPT)

> **Cómo se usa este archivo.** Codex implementa las tareas de abajo; **Claude verifica** cada entrega (revisión del diff, tests, lint, build y pruebas en navegador con Playwright) antes de que el dueño fusione. Este archivo lo mantiene Claude en `main`: **Codex no lo edita**; informa su avance en la descripción de cada PR.
>
> Última actualización: 2026-11-03 · Paso 2 (P1–P6) fusionado en `main` (PR #14). **Paso 3 — recompensas (R1–R3): verificadas con correcciones** en la integración `release/v1.3` (ver §4 y `docs/HANDOFF.md` §Integración v1.3).

---

## 0. Contexto en 30 segundos

**Escaque** es una app web de entrenamiento de ajedrez inspirada en Dr. Wolf de chess.com, **con mejoras**. Su punto fuerte, decidido por el dueño, es **el entrenamiento con coach y el seguimiento del progreso**, no los puzles genéricos.

- **Stack:** React 19 + Vite 7, chess.js 1.4, Stockfish 17.1 WASM multihilo en Web Workers, Tailwind 3 (paleta `brand`/`ink`, variantes `dark:`), Vitest 4, **JavaScript + JSDoc** (no TypeScript).
- **Servidor:** Cloudflare Workers en plan gratuito; solo sirve los assets con COOP/COEP y un reenvío de Chess.com. **No hay base de datos en el servidor.** Todos los datos del usuario viven en su navegador, en IndexedDB (`src/storage/db.js`).
- **Qué ya existe:**
  - **Entrenar:** partida contra 10 rivales con personalidad (`src/rivals/`).
  - **Coach** (Alfred, Kairós o Ariadna): comenta tus jugadas, se detiene ante errores con Retroceder / ¿Por qué? / Seguir, y da pistas. Usa plantillas y, opcionalmente, la IA del usuario con su propia clave (`src/llm/`).
  - **Clasificación de todas las jugadas**, también las del rival (`src/coach/useMoveLedger.js`), y estadísticas de fin de partida (`src/coach/summary.js`, `GameSummary.jsx`).
  - **Mis partidas:** importación desde Lichess, Chess.com y PGN (`src/import/`).
  - **Puzles generados de tus errores** en el navegador (`src/puzzles/`), con Elo de puzles.
  - **Idiomas:** español e inglés (`src/i18n/`).
- **Documentación técnica:** `docs/HANDOFF.md` (estado y mapa del código) y `docs/COACH_DESIGN.md` (diseño del coach). **Léelos antes de empezar.**

## 1. Reglas (obligatorias en todas las tareas)

1. **Una tarea = una rama = un PR** contra `main`. Rama: `codex/<id>-<slug>`, p. ej. `codex/P1-guardar-partidas`. Parte siempre del `main` más reciente.
2. **Sin dependencias nuevas** salvo que sea imprescindible. Si añades una, justifícala en el PR (tamaño y licencia). Recharts, lucide-react, chess.js y @dnd-kit ya están.
3. **Todo en el cliente.** Nada de servidores, cuentas ni bases de datos remotas en estas tareas. Los datos persistentes van en IndexedDB a través de `src/storage/db.js`.
   - Si necesitas un almacén o índice nuevo, **sube `DB_VERSION`** y añádelo en `upgrade()` sin borrar ni alterar lo existente; los usuarios ya tienen datos.
   - `localStorage` solo para preferencias pequeñas, siempre con `try/catch`.
4. **Idiomas:** ningún texto visible escrito a mano en los componentes. Todo pasa por `t('clave', vars)` (`useI18n()` en React; `getT(lang)` en funciones puras).
   - Cada clave nueva va en **`src/i18n/es.js` y `src/i18n/en.js`**, con las mismas variables `{…}`. `src/i18n/i18n.test.js` lo comprueba y debe pasar.
   - Plurales con `{ one, other }`; números, fechas y duraciones con los helpers de `src/i18n/core.js`.
5. **Notación SAN en inglés** (Nf3, Qxe5) en ambos idiomas.
6. **Diseño:** usa los componentes y estilos existentes (tarjetas `rounded-2xl`, paleta `brand`/`ink`, variantes `dark:`). Debe verse bien en claro y oscuro, en escritorio (incluida una ventana baja de 1004×508) y en móvil de 390 px, sin desplazamiento horizontal.
7. **Rendimiento:** no bloquees el hilo principal. No lances búsquedas extra de Stockfish si hay datos en caché (`StockfishEngine.getCached`, `analysis` en IndexedDB). Cualquier análisis pesado va en segundo plano, cancelable y reanudable, como el generador de puzles (`src/puzzles/generator/runner.js`).
8. **Lógica pura separada de React** (archivos `.js` sin JSX), con **tests de Vitest** junto al archivo (`*.test.js`).
9. **Atributos para pruebas:** añade `data-testid` a los elementos nuevos que tengan interacción o datos clave. Claude los usa en Playwright.
10. **Antes de abrir el PR** debe pasar todo esto:
    ```bash
    npm ci
    npm test
    npx eslint . --max-warnings 0
    npx vite build
    ```
    Si tu entorno tiene Playwright y Chromium, corre también los e2e afectados (`scripts/e2e-*.cjs`; todos crean el navegador con `locale: 'es-ES'`). Si no, dilo en el PR: Claude los correrá.
11. **No toques** `worker/`, `wrangler.jsonc`, `public/stockfish/` ni los contratos del coach (`shared/coach-contract/`), salvo que la tarea lo pida.
12. **Commits** pequeños, en español, con prefijo convencional (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`).
13. **Documentación:** actualiza `docs/HANDOFF.md` (una sección breve por tarea: qué, dónde, decisiones) y el README si cambia algo visible para el usuario.
14. **Descripción del PR:** qué hiciste, archivos principales, decisiones y alternativas descartadas, resultados exactos de los comandos del punto 10 y qué quedó pendiente.

## 2. Tareas — Paso 2 del plan: **seguimiento del progreso**

Orden recomendado: **P1 → P2 → P3 → P4**. Las tareas **P5** y **P6** son independientes y pueden hacerse en paralelo con las demás.

### P1 · Guardar las partidas jugadas en Escaque
Hoy las partidas de Entrenar no se guardan: al empezar otra se pierden. Sin eso no hay seguimiento.
- **Cuándo se guarda:** al terminar una partida en Entrenar (mate, tablas, tiempo o abandono). Se guarda en IndexedDB como `Game` con `source: 'escaque'`. Consulta el tipo en `src/storage/db.js`.
- **Qué se guarda:**
  - PGN con cabeceras: rival y nivel, color, ritmo, fecha, resultado y terminación;
  - `playerColor` y los tiempos usados.
- **Datos por jugada, en un almacén nuevo `moves`** (o un campo en `analysis`; justifica la elección). Para cada jugada:
  - ply, color, SAN y UCI;
  - etiqueta de clasificación, pérdida de Win%, evaluación antes y después;
  - fase de la partida (`src/coach/phase.js`) y motivo táctico cuando exista (`src/coach/tactics.js`);
  - si el coach interrumpió, si el usuario usó Retroceder y cuántas pistas pidió.

  Usa lo que ya calculan `useMoveLedger` y `useCoach`; **no repitas análisis**.
- **Comportamiento esperado:**
  - La partida aparece en **Mis partidas** (fuente "Escaque") y en **Análisis**.
  - Borrar todas las partidas también borra sus jugadas.
  - Una partida abandonada antes de la primera jugada no se guarda.
- **Criterios de aceptación:**
  - tests de la función pura que arma el registro a partir del estado final;
  - migración de `DB_VERSION` probada con `fake-indexeddb`: una base v1 con datos se abre en v2 sin perder nada;
  - `data-testid` en la fila de Mis partidas.

### P2 · Métricas de progreso (lógica pura)
`src/progress/metrics.js` y sus tests. Entrada: partidas, `analysis` y `moves`.
- **Datos de P1 (ya en `main`):** cada jugada de Entrenar en el almacén `moves` trae `label`, `loss`, `evalBefore/After`, `winBefore/After`, `phase`, `coachInterrupted`, `takebackUsed`, `hintsUsed` y **dos motivos distintos**: `motif` = qué castigó la jugada (motivo de la refutación del rival; solo existe si el coach analizó ese error, si no `null`) y `moveMotif` = qué hizo la propia jugada (captura, jaque, ataque doble…). Para "motivos que más te cuestan" usa **solo `motif`**; `null` cuenta como "desconocido". Las partidas de Entrenar tienen `source: 'escaque'`, `rivalLevel`, `timeUsedMs`, `durationMs` y `retractedMoves` (intentos retirados con Retroceder). Las partidas importadas solo tienen `analysis` si el generador de puzles las analizó; deriva de ahí su clasificación con `src/engine/classify.js` y `src/coach/accuracy.js`. Salida:
- **Por partida:** precisión del jugador, conteos por etiqueta, errores por fase.
- **Agregados** (todas, solo Escaque, solo importadas; filtro por ritmo y por rango de fechas):
  - precisión media y tendencia (media móvil de 10 partidas);
  - errores graves, errores e imprecisiones **cada 100 jugadas, por fase** (apertura, medio juego, final);
  - **motivos** que más te cuestan: pieza colgada, ataque doble, mate permitido… En las importadas, usa `tactics.js` solo en las jugadas que son error y solo si hay datos suficientes; si no, el motivo queda como "desconocido". No inventes motivos.
  - **aperturas:** como blancas y como negras, partidas, % de puntos, precisión media y error más frecuente;
  - **conversión:** partidas en que llegaste a Win% ≥ 80 y no ganaste;
  - **apuros de tiempo**, si el PGN trae `[%clk]`: errores con menos del 10 % del tiempo inicial.
- **Top 3 debilidades** con una puntuación explicable: frecuencia × gravedad × recencia. Cada una lleva su *por qué* en datos, por ejemplo "4 errores graves en finales en tus últimas 20 partidas".
- **Criterios de aceptación:**
  - tests con fixtures pequeños y deterministas, incluidos casos vacíos y partidas sin análisis;
  - funciones puras sin acceso directo a IndexedDB: un módulo aparte carga los datos.

### P3 · Pantalla "Progreso"
Nueva sección del menú lateral, **Progreso**. Sustituye a **Stats** o la absorbe: mantén lo que Stats ya muestra (victorias, derrotas y tablas, Elo por ritmo).
- **Tarjetas:**
  - precisión media con su tendencia (gráfico de Recharts);
  - errores cada 100 jugadas por fase;
  - **tus 3 debilidades**, con su explicación en datos;
  - aperturas (mejores y peores);
  - conversión de posiciones ganadas;
  - apuros de tiempo.
- **Filtros:** fuente (todas, Escaque, importadas), ritmo y período (30 días, 90 días, todo).
- **Estados vacíos claros:** si no hay partidas, invitar a jugar o importar; si las importadas no están analizadas, ofrecer analizarlas con el generador existente, que ya guarda `analysis`.
- **Criterios de aceptación:**
  - `data-testid` en cada tarjeta y en los filtros;
  - claves de idioma en es y en;
  - se ve bien en claro, oscuro, 1004×508 y 390 px.

### P4 · Plan de entrenamiento
A partir de las 3 debilidades de P2, la pantalla Progreso muestra **acciones concretas**, con botón que lleva directo a hacerlas. Ejemplos:
- "Resuelve 5 puzles de *ataque doble* de tus partidas" → Puzles con el filtro de motivo aplicado. Amplía `filterPuzzles` si hace falta.
- "Juega contra Héctor (nivel 6) con negras y practica la Defensa Siciliana" → Entrenar con nivel y color preseleccionados.
- "Revisa tus 3 últimos errores graves en finales" → Análisis abierto en esa jugada.

El texto del plan sale de plantillas en es y en, **sin IA**. Debe ser coherente con los datos: si no hay datos suficientes, no se recomienda nada.

**Criterios de aceptación:** tests de la función pura que genera el plan, y botones con `data-testid`.

### P5 · Repaso espaciado de puzles fallados (independiente)
Los puzles fallados vuelven a aparecer con intervalos crecientes: sistema Leitner o SM-2 simplificado; justifica la elección.
- **En Puzles**, sección **"Repaso de hoy"**: N puzles pendientes y botón para empezar.
- **Comportamiento:** resolver a la primera sube el intervalo; fallar lo reinicia.
- **Datos:** el progreso vive en `escaque:puzzles`. Migra a IndexedDB **solo** si lo justificas, y entonces conserva el progreso existente.
- **Criterios de aceptación:**
  - tests de la planificación, con la fecha inyectada;
  - el Elo de puzles sigue funcionando igual.

### P6 · Selector de coronación en Puzles (independiente, pequeña)
En Entrenar ya se elige la pieza al coronar (`PromotionPicker`, props `promotion` / `onPromotionSelect` / `onPromotionCancel` de `ChessBoard`). Puzles (`PuzzleTrainer.jsx`) todavía corona con la pieza de la solución o con dama. Usa el mismo selector: elegir la pieza correcta resuelve el paso y elegir otra cuenta como fallo.

**Criterios de aceptación:** test de la lógica en `puzzleLogic.js` y `data-testid` heredados del selector.

## 2b. Tareas — Paso 3: **recompensas** (para el lanzamiento público)

Objetivo del dueño: que entrenar enganche (rachas, experiencia, logros), sin anuncios ni nada que se compre. Todo local (IndexedDB), sin servidor. **Parte siempre del `main` actualizado** (ya incluye P1–P6 y los ajustes de Claude: `motif` = refutación y `moveMotif` = la jugada; `discardedTrainingIdRef` en App.jsx).

**Restricción de archivos (importante):** otro agente trabaja en paralelo en `App.jsx` (carga diferida de pantallas, pantalla de bienvenida, botón "Instalar app"), `SideMenu.jsx`, `index.html`, `public/` y `vite.config.js`. Para no chocar:
- Pon toda la lógica en **`src/rewards/`** (lógica pura + tests) y la UI en componentes nuevos (`src/rewards/*.jsx`).
- Para enterarte de lo que pasa en la app usa un **bus de eventos** nuevo `src/rewards/events.js` (`emitRewardEvent(type, data)` / `onRewardEvent`), y emite los eventos con **una línea** en cada sitio: fin de partida en Entrenar (App.jsx, junto a `finishGame`), puzle resuelto o fallado (PuzzleTrainer), repaso completado, "¡Eso es!" tras Retroceder (useCoach), importación terminada (MyGames). Nada más en esos archivos salvo montar tus componentes en **un** punto de App.jsx.
- Si necesitas almacenamiento, usa claves en el almacén `meta` (`getMeta/setMeta`: p. ej. `rewards`), **sin subir `DB_VERSION`**.

### R1 · Experiencia (XP) y niveles
- XP por actividad (valores en una tabla de constantes, fácil de ajustar): terminar una partida contra un rival (base + bonus por nivel del rival + bonus por ganar), partida sin errores graves, resolver un puzle (más si es a la primera), completar el repaso del día, corregir tras Retroceder, cumplir la meta diaria. Sin XP por abandonar en la primera jugada ni por deshacer/repetir para "farmear" (p. ej. un mate deshecho no da XP dos veces: usa el id estable de la partida).
- Niveles con curva creciente (documenta la fórmula); barra de XP y nivel junto al avatar de la cabecera; animación breve al subir de nivel (respeta `prefers-reduced-motion`).
- Criterios: tests de la tabla, la curva y la protección contra duplicados.

### R2 · Racha y meta diaria
- **Racha**: días consecutivos con al menos una actividad de entrenamiento (partida terminada, puzle o repaso), con el día según la zona horaria local del usuario. Racha actual y mejor racha. Un "comodín" de racha por semana (si un día no entrenas, se consume en vez de perder la racha) — documenta la regla.
- **Meta diaria** configurable (por defecto: 1 partida + 3 puzles); progreso visible y aviso discreto al cumplirla.
- Criterios: tests con fechas inyectadas, cambio de día y zona horaria.

### R3 · Logros
- ~20 logros con nombre y descripción en es/en (claves `rewards.ach.*`), por ejemplo: primera partida; vencer a cada rival (uno por rival, y uno especial por Atenea); partida sin errores graves; precisión ≥ 90 % en una partida; convertir una posición ganada; 10 puzles seguidos a la primera; completar 7 días de racha; importar tus primeras partidas; generar tus primeros puzles; usar Retroceder y corregir 10 veces; terminar el plan de entrenamiento de la semana.
- Pantalla **Logros** (sección nueva dentro de Progreso, o pestaña propia si encaja mejor: justifica), con bloqueados en gris y fecha de desbloqueo. Aviso no bloqueante al desbloquear uno (con sonido suave si el sonido está activo).
- Los logros se evalúan con los eventos y, al instalar la versión, una vez sobre el historial ya guardado (partidas de Escaque, puzles) para no empezar de cero.
- Criterios: tests de cada condición; `data-testid` en la pantalla y en los avisos.

Para R1–R3: textos solo vía `t()` con claves en `es.js` y `en.js`; claro/oscuro; 1004×508 y 390 px; un PR (rama) por tarea: `codex/R1-xp`, `codex/R2-racha`, `codex/R3-logros` (R2 y R3 pueden partir de R1).

## 3. Qué verifica Claude en cada PR
- **Revisión del diff:** cumplimiento de las reglas del punto 1, lógica correcta, sin regresiones, sin textos fuera de i18n, migraciones seguras.
- **Comandos:** `npm ci && npm test && npx eslint . --max-warnings 0 && npx vite build`.
- **Pruebas en navegador:** batería e2e existente (`scripts/e2e-*.cjs`) contra el build, más pruebas nuevas de la funcionalidad en es y en, claro y oscuro, escritorio y móvil.
- **Resultado:** cada PR recibe en un comentario "verificado" o una lista concreta de cambios pedidos. Claude actualiza la tabla de estado.

## 4. Estado

| Tarea | Estado | PR | Notas de verificación |
|---|---|---|---|
| P1 Guardar partidas | **verificada** | integración `verify/codex-p1-p5-p6` | Correcta (transacciones atómicas, migración v1→v2 probada). Ajuste de Claude: `motif` solo = refutación y nuevo `moveMotif` (antes se mezclaban). La partida de Entrenar se guarda y luego el generador de puzles la ofrece: e2e-puzzles adaptado. |
| P2 Métricas | **verificada** | #14 | Usa `motif` guardado (refutación) y, si falta, lo deriva del análisis o queda "desconocido"; no inventa motivos. Cálculo en un Web Worker. |
| P3 Pantalla Progreso | **verificada** | #14 | Conflicto con P5 en `PuzzleTrainer.jsx` resuelto por Claude (se conservan "Repaso de hoy" y el filtro inicial de P4). |
| P4 Plan de entrenamiento | **verificada** | #14 | — |
| P5 Repaso espaciado | **verificada** | integración `verify/codex-p1-p5-p6` | Leitner 1/3/7/14/30/60 días; el Elo solo cuenta el primer intento (comprobado en código y e2e). |
| R1 XP y niveles | **verificada con correcciones** | integración `release/v1.3` | Curva 50·(L−1)·L y deduplicación por id estable correctas (deshacer un mate no repite XP: unit + e2e). Correcciones de Claude: fusión entre dispositivos (antes un navegador nuevo borraba la XP al sincronizar), guardado repartido por día (el registro único superaba el tope de 120 KB de la sincronización a los ~2 meses), lectura-escritura en una transacción, `startColor` en la emisión. |
| R2 Racha y meta diaria | **verificada con correcciones** | integración `release/v1.3` | Día civil local, DST, comodín semanal y cambio de año bien probados. Correcciones: la meta gana por `goalSetAt` al fusionar dispositivos; texto de la regla («tras tu primera jugada», no «media jugada»). Observación: el comodín suma el día perdido a la mejor racha aunque la racha se rompa después (documentado, sin cambio). |
| R3 Logros | **verificada con correcciones** | integración `release/v1.3` | 21 logros con tests por condición; historial reconocido en un Worker sin XP retroactiva. Correcciones: el reconocimiento del historial reemplazaba los logros guardados (ahora se fusiona); la cabecera no se actualizaba con datos sincronizados; formato del bloque `rewards` de es/en y «Practice» → «Training». |
| P6 Coronación en Puzles | **verificada** | integración `verify/codex-p1-p5-p6` | Exige la pieza exacta; si la solución es una coronación, no acepta otro mate alternativo (decisión aceptable, distinta de Lichess). |

**Verificación de la integración P1+P5+P6 (Claude, 2026-11-02):** 480 tests, lint y build limpios; e2e contra el build: training-save, review, puzzle-promotion (los 3 de Codex), game-experience, alfred, byok (28/28), rival-voice, rival-voice-en, i18n, import, puzzles, tabs, layout, bars, feel y avatars: todos correctos.

**Verificación de P2+P3+P4 sobre P1+P5+P6 (Claude, 2026-11-02):** 508 tests, lint y build limpios; e2e: progress, training-plan, training-save (5/5 tras el arreglo), review, i18n, tabs, layout, import, game-experience, alfred, puzzles: correctos.
**Bug corregido por Claude (P1):** carrera al deshacer un mate: un efecto de guardado pendiente de un render anterior se ejecutaba después del clic en Deshacer y volvía a guardar la partida retirada (e2e-training-save fallaba 1 de cada 2 veces). Arreglo en `App.jsx` (`discardedTrainingIdRef`).

**Verificación de R1+R2+R3 en la integración v1.3 (Claude, 2026-11-03):** 665 tests, lint, build, build e2e y `wrangler deploy --dry-run` limpios; e2e de recompensas de Codex (rewards 4/4, rewards-daily 2/2, achievements 4/4) y nuevo `e2e-rewards-sync` (19/19: sin red con el SW, XP y racha, sincronización Premium a un segundo navegador). **Para próximas tareas sobre recompensas:** se guardan con `src/rewards/store.js` (`readRewards`/`commitRewards`), no con `getMeta('rewards')`.

**Nota para Codex:** la API de GitHub te devuelve `Forbidden` al crear PRs; basta con subir la rama `codex/<id>-<slug>` y avisar: Claude revisa, integra y abre el PR.
