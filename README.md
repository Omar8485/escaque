# Escaque

**Escaque** (en español, cada casilla del tablero) es un entrenador de ajedrez personal: juegas contra 10 rivales con nombre mientras un coach que eliges (Alfred, Kairós o Ariadna) comenta tus jugadas con datos de Stockfish, que corre en el navegador. Incluye análisis de partidas reales y estadísticas.

## Funcionalidades actuales

- **Coronación en Puzles**: eliges dama, caballo, torre o alfil con el mismo selector de Entrenar; debes elegir la pieza de la solución. Esc o clic fuera cancela sin jugar.

- **En español y en inglés**: la app se muestra en el idioma del navegador (español si empieza por `es`, inglés si empieza por `en` o si es cualquier otro) y se puede elegir en el menú (Automático / Español / English; se recuerda en el navegador). Están en ambos idiomas la interfaz, el coach (plantillas, voces y el prompt de la IA, que responde en tu idioma), las 390 frases de los rivales (adaptadas, no traducidas al pie de la letra), los puzles, la importación y la página de licencias. Cambiar de idioma traduce al momento también los mensajes que ya se ven. La notación de jugadas (SAN) va en inglés en ambos idiomas. Ver [docs/I18N.md](docs/I18N.md).
- **Puzles de tus partidas**: importas tus partidas y Stockfish, **en tu navegador**, convierte tus errores y oportunidades perdidas en puzles (incremental, reanudable y cancelable; se guardan en IndexedDB); el coach te explica los fallos, da pistas y lleva tu Elo de puzles.
- **Tu coach** (pestaña Entrenar): eliges entre **Alfred**, **Kairós** o **Ariadna** (cada uno con su voz y su avatar con expresiones). Comenta cada jugada tuya con datos calculados por Stockfish y chess.js; ante un error o error grave detiene la partida con **Retroceder**, **¿Por qué?** y **Seguir**, felicita cuando corriges, y da pistas en 3 niveles (idea, pieza, flecha). Por defecto redacta con **plantillas** (sin IA, sin red); opcionalmente, con **tu propia clave** de Gemini, OpenAI, Anthropic, OpenRouter o un servidor local compatible con OpenAI (ver [IA opcional](#ia-opcional-con-tu-propia-clave)). Ver [docs/HANDOFF.md](docs/HANDOFF.md).
- **Entrenar**: partida contra 10 rivales con nombre (de Ícaro ≈600 a Atenea, la fuerza máxima; por defecto Héctor ≈1500) y elección de color (blancas, negras o aleatorio); el rival responde solo, con pausa, deshacer (tu jugada y la del rival), reloj configurable, detección de apertura y evaluación en vivo con Stockfish.
- **Rivales con personalidad**: cada uno de los 10 rivales habla con su propia voz (Ícaro fanfarrón, Odiseo burlón, Atenea serena…): saluda al empezar, presume de sus buenas jugadas, comenta tus errores y reacciona al ganar, perder o empatar, en un globo junto a su barra que se cierra solo o con un clic. Habla poco (cooldown y probabilidades), nunca repite frase en una partida y no le pisa la palabra al coach: si el coach te detiene espera a que elijas, y si retrocedes no comenta la jugada deshecha. Se puede silenciar en el selector de rival ("El rival habla"). Ver [docs/HANDOFF.md](docs/HANDOFF.md#v11--personalidades-de-los-rivales).
- **Avatares**: cada personaje tiene el suyo y tú puedes crear el tuyo (clic en tu avatar, arriba a la derecha).
- **Experiencia de partida (v1.1)**: al coronar eliges **dama, caballo, torre o alfil** en un selector sobre la casilla (clic-clic o arrastre; Esc o clic fuera cancela); **campanillas** al empezar y al terminar la partida; el **rey derrotado se inclina** al perder por mate, tiempo o abandono; y al terminar, una **tarjeta de estadísticas**: tiempo total y de cada jugador, jugadas y plies, y por color Mejor/Excelente/Buena/Imprecisión/Error/Error grave y precisión (fórmula de Lichess). Las jugadas del rival también se clasifican, en segundo plano y sin búsquedas extra del motor.
- **La jugada del rival se ve**: su pieza se desliza y las casillas de la última jugada quedan resaltadas; **sonido de madera** al mover (se puede silenciar).
- **Barras de jugador** junto al tablero: nombre, piezas capturadas, ventaja de material (+N) y el reloj de cada uno de su lado.
- **Menú tipo hamburguesa**: oculto para dejar el espacio al tablero; se abre con ☰ o acercando el ratón al borde izquierdo.
- **Se adapta al zoom y a la pantalla**: el tablero toma el mayor tamaño que cabe sin cortarse; con zoom alto o en móvil los paneles se apilan y la página se desplaza.
- **Tablero de madera** (o verde, a elegir) y una paleta propia cálida: terracota, piedra y café.
- **Tema claro y oscuro**: botón en la esquina superior derecha; se recuerda en el navegador. El tablero se ve igual en ambos.
- **La partida sigue aunque cambies de pestaña**: el reloj corre y el rival juega; fuera de Entrenar tienes 30 s para volver o la partida se da por abandonada. Las piezas se mueven arrastrando o con dos clics.
- **Mis partidas**: importa tus partidas de **Lichess** o **Chess.com** con tu nombre de usuario (sin contraseña) o sube archivos **.pgn** de cualquier plataforma. Solo ajedrez estándar; se guardan en tu navegador (IndexedDB) y la siguiente importación trae solo las nuevas. Ver [Cómo importar tus partidas](#cómo-importar-tus-partidas).
- **Análisis**: tablero propio (no toca la partida de Entrenar), lista paginada de tus partidas importadas, navegación jugada a jugada y barra de evaluación.
- **Clasificación de jugadas** (Best, Excellent, Good, Inaccuracy, Mistake, Blunder) con modo revisión para explorar la variante con el reloj en pausa.
- **Flechas** con clic derecho y arrastrar (Shift para flechas rojas).
- **Stats**: victorias, derrotas y tablas por ritmo y progresión de Elo, con tus partidas importadas. Tu rating en la app es tu último Elo en el ritmo que más juegas (sin partidas importadas, no se muestra rating).

Las partidas terminadas en **Entrenar** se guardan automáticamente en este navegador (IndexedDB), con fuente **Escaque**, PGN, tiempos y datos de las jugadas ya evaluadas. Se pueden abrir desde **Mis partidas** o **Análisis**. Una partida abandonada sin hacer ninguna jugada no se guarda; borrar todas las partidas elimina también estos datos por jugada.
- **Repaso de hoy** en Puzles: los puzles fallados vuelven con intervalos crecientes (1, 3, 7, 14, 30 y 60 días). Resolver sin fallar alarga el intervalo; otro fallo lo reinicia. Los repasos no vuelven a modificar el Elo del primer intento.

**Progreso** reúne resultados y Elo por ritmo con precisión, tendencia, errores por fase, debilidades, aperturas, conversión y apuros de tiempo. Filtra por fuente, ritmo y período. Las partidas sin análisis conservan sus resultados y ofrecen analizarlas con el generador existente en Puzles; los valores desconocidos se muestran sin inventar estadísticas.

En **Tu plan de entrenamiento**, Progreso propone acciones basadas en tus errores: puzles disponibles del motivo, revisión directa de jugadas concretas y práctica de aperturas con rival y color preseleccionados. Las recomendaciones usan los datos guardados, sin IA; si faltan datos no se inventa un plan.

Las actividades de entrenamiento conceden **XP y niveles** locales, visibles junto al avatar. Los premios se conceden una sola vez por partida, puzle, corrección o repaso del día; repetir jugadas o abandonar al principio no permite acumularlos.

La **racha** usa tu calendario local, con un comodín semanal para un día perdido. En Progreso o junto al avatar puedes configurar la **meta diaria** (por defecto 1 partida + 3 puzles resueltos) y ver cómo avanzas.

Los **Logros** están dentro de Progreso: 21 hitos de juego, rivales, puzles y constancia, con reconocimiento del historial previo y avisos discretos al desbloquearlos. Las recompensas son gratuitas y se guardan en tu navegador; con Premium se sincronizan entre tus dispositivos (se fusionan: no se pierde lo ganado en ninguno).

## Stack

- [React 19](https://react.dev/) + [Vite 7](https://vite.dev/)
- [chess.js](https://github.com/jhlywa/chess.js) para reglas, SAN y PGN
- [Stockfish.js 17.1](https://github.com/nmrugg/stockfish.js) (WebAssembly) en un Web Worker
- [Tailwind CSS 3](https://tailwindcss.com/)
- [@dnd-kit](https://dndkit.com/) para arrastrar y soltar piezas
- [Recharts](https://recharts.org/) para gráficos y [lucide-react](https://lucide.dev/) para íconos

## Cómo correrlo

Requiere Node.js 20.19+ o 22.12+ (requisito de Vite 7).

```bash
npm ci          # instala dependencias exactas según package-lock.json
npm run dev     # servidor de desarrollo en http://localhost:5173
npm run build   # build de producción en dist/
npm run preview # sirve dist/ localmente para probar el build
npm run lint    # ESLint
npm test        # tests unitarios (Vitest) del motor y la clasificación
npm run build:e2e # build de pruebas en dist-e2e/ (con el gancho window.__escaqueTest; ver abajo)
```

**Pruebas en el navegador** (Playwright): con `npm run build && npx vite preview --port 4622`, `node scripts/e2e-tabs.cjs http://localhost:4622/` (y `e2e-feel`, `e2e-bars`, `e2e-layout`, `e2e-alfred`…). Los e2e abren el navegador con `locale: 'es-ES'` (comprueban textos en español); `e2e-i18n.cjs` prueba los idiomas (inglés, español, francés → inglés, selector que se recuerda) y que ninguna pestaña en inglés muestre texto en español. La de la experiencia de partida necesita el **build de pruebas**, que expone `window.__escaqueTest.startFromFen(fen)` para empezar una partida contra el rival desde un FEN (en el build de producción ese código no existe: `import.meta.env.MODE` es `production` y Vite lo elimina):

```bash
npm run build:e2e && npx vite preview --port 4622 --outDir dist-e2e
node scripts/e2e-game-experience.cjs http://localhost:4622/ [--baseline URL_DE_OTRO_BUILD] [--moves 10]
```

## Estructura de carpetas

```
.
├── public/
│   ├── _headers            # COOP/COEP para los assets en Cloudflare (y no-cache para sw.js)
│   ├── manifest*.webmanifest, icons/, favicon.svg, og-image.png  # PWA e imagen para redes
│   ├── privacidad.html, privacy.html, terminos.html, terms.html  # política de privacidad y términos 1.0 (vigentes desde 2026-11-07)
│   └── stockfish/          # stockfish.js + stockfish.wasm (motor, se sirve tal cual)
├── src/
│   ├── App.jsx             # pestañas (Stats, Análisis, Entrenar, Puzles, Mis partidas) y estado principal
│   ├── main.jsx            # punto de entrada
│   ├── screens.js          # pantallas diferidas (React.lazy) y su descarga en segundo plano; startup.js: qué espera a que el motor esté listo
│   ├── appInfo.js          # nombre y valores de publicación (SITE_URL, CONTACT_EMAIL, analítica, FEEDBACK_URL)
│   ├── pwa/                # service worker (sw-template.js), registro, instalación y aviso de versión nueva
│   ├── seo/documentMeta.js # título, descripción, Open Graph y manifiesto según el idioma
│   ├── welcome/            # bienvenida de la primera visita («Acerca de» en el menú)
│   ├── i18n/               # idiomas: core.js (detección, t, plurales, Intl), es.js y en.js (diccionarios), I18nProvider.jsx + useI18n.js; i18n.test.js (paridad es/en y claves usadas en el código)
│   ├── components/         # MiniBoard (línea de "¿Por qué?"), ChessBoard, ChessPiece, EvalBar, GameClock, LevelSelector, CoachPanel, MoveBadge, AlfredAvatar, SideMenu, ThemeToggle, PlayerBar, Avatars, AvatarEditor, GameSummary (tarjeta de estadísticas), RivalSpeech (globo del rival) (sin GameClock: el reloj va en las barras)
│   ├── engine/             # capa del motor, sin React
│   │   ├── uci.js          # parseo UCI, perspectiva de blancas, win% y formato
│   │   ├── classify.js     # clasificación de jugadas por pérdida de win%
│   │   ├── engine.js       # StockfishEngine (analista): worker, cola secuencial, caché por FEN
│   │   ├── rival.js        # RivalEngine: worker propio con fuerza limitada, sin caché
│   │   └── rivalLevels.js  # los 10 personajes del rival (nombre, lema, Elo aprox. y opciones del motor)
│   ├── coach/              # Alfred: hechos, contrato, cliente y UI (sin React salvo los hooks use*)
│   │   ├── enrich.js, tactics.js, phase.js, accuracy.js  # hechos calculados (T1/T2)
│   │   ├── coachPipeline.js # análisis previo MultiPV 3, posterior y confirmación a depth 18 (T5)
│   │   ├── buildRequest.js # arma el CoachRequest con minimización (T5)
│   │   ├── opening.js      # nombre de apertura e inBook
│   │   ├── templates.js    # plantillas en español (Alfred sin IA), "¿Por qué?" (whyTemplate) y notación con figuras
│   │   ├── refutationLine.js # línea de refutación de Stockfish para "¿Por qué?" (SAN numerada, corte 4–8 plies, material/mate)
│   │   ├── textChoice.js   # qué texto se muestra: IA, plantilla o "pensando"; vista preferida
│   │   ├── coachClient.js  # llama al proveedor del usuario (si hay clave): validación §5.3, caché, timeout, pausas (T9)
│   │   ├── useCoach.js     # hook de Alfred durante la partida (T6)
│   │   ├── summary.js      # estadísticas de fin de partida (puro: jugadas, conteos por color, precisión, tiempos)
│   │   ├── useMoveLedger.js # clasifica en segundo plano tus jugadas y las del rival (reutiliza la caché del motor)
│   │   └── useGameLoop.js  # bucle de partida contra el rival (color, nivel, pausa, deshacer)
│   ├── rivals/             # voz de los rivales: personalities.js (frases de cada uno) y personalities.en.js (las mismas en inglés, mismos índices), voice.js (cuándo hablan, puro), useRivalVoice.js (hook + preferencia)
│   ├── puzzles/            # puzles de tus partidas
│   │   ├── PuzzleTrainer.jsx, GeneratorPanel.jsx  # entrenador con el coach y panel "Generar puzles"
│   │   ├── puzzleLogic.js  # comprobar jugadas, Elo de puzles, siguiente puzle, progreso
│   │   ├── generator/core.js   # criterios del generador (puro; lo comparten navegador y Node)
│   │   ├── generator/runner.js # generación en el navegador: games → analysis + puzzles (IndexedDB)
│   │   ├── generator/useGeneratePuzzles.js # estado global de la generación y hooks
│   │   └── generator/sources.js # PGN/JSON → Game (solo Node y pruebas, no entra en el bundle)
│   ├── llm/                # IA opcional en el navegador: gemini.js, openai.js (OpenAI/OpenRouter/compatible), anthropic.js, provider.js (registro + Probar conexión), settings.js (clave del usuario), usage.js (consumo por partida), pricing.js (precios aproximados)
│   ├── hooks/
│   │   ├── useStockfish.js # hooks React sobre StockfishEngine
│   │   ├── useChessClock.js # reloj de la partida (corre en cualquier pestaña) y cuenta atrás de abandono
│   │   └── useRivalEngine.js # hook React sobre RivalEngine
│   ├── import/             # importación de partidas (Mis partidas)
│   │   ├── lichess.js      # API pública de Lichess (NDJSON en streaming, incremental)
│   │   ├── chesscom.js     # Published-Data API de Chess.com (meses en serie, incremental)
│   │   ├── pgn.js          # archivos .pgn: separar partidas, detectar al usuario, hash
│   │   ├── normalize.js    # cada fuente → tipo Game de src/storage/db.js; ritmo, rating
│   │   ├── store.js        # guardar sin duplicar, cuentas vinculadas, marcas, borrar
│   │   ├── net.js          # una petición a la vez y espera ante 429
│   │   └── __fixtures__/   # respuestas reales recortadas para los tests
│   ├── storage/db.js       # IndexedDB: partidas, análisis, puzles y meta
│   ├── utils/
│   │   ├── sound.js        # golpes de pieza y campanillas de inicio/fin (Web Audio, sin archivos)
│   │   └── stats.js        # victorias/derrotas/tablas e historial de Elo
│   └── data/
│       └── openings_map.json # secuencias de jugadas -> nombre de apertura
├── shared/coach-contract/  # contrato del coach: schemas JSON, system prompt (prompt.es.js y prompt.en.js), hechos compactos (compact.js), salida pedida al LLM (llmOutput.js), validación anti-alucinación (validateOutput.js) y fixtures
├── build-tools/            # plugins de Vite: pwa.js (genera dist/sw.js) y site.js (SITE_URL, robots, sitemap, legales, analítica)
├── worker/                 # Cloudflare Worker (sin LLM ni secretos)
│   ├── index.js            # /api/health, /api/proxy y COOP/COEP
│   └── proxy.js            # reenvío mínimo a la API pública de Chess.com (lista blanca), respaldo de la importación
├── public/licencias.html   # licencias y créditos (Stockfish GPLv3: texto en public/stockfish/COPYING.txt); public/licenses.html, la misma en inglés
├── scripts/                # pruebas en el navegador con Playwright: e2e-game-experience.cjs (coronación, campanillas, rey derrotado, estadísticas, búsquedas del motor), e2e-alfred.cjs, e2e-byok.cjs, e2e-tabs.cjs, e2e-layout.cjs, e2e-bars.cjs, e2e-feel.cjs, e2e-avatars.cjs, e2e-rival-voice.cjs (voz de los rivales), e2e-rival-voice-en.cjs (voz en inglés y cambio de idioma), e2e-i18n.cjs (idioma del navegador, selector y barrido de pestañas en inglés), e2e-puzzles.cjs (siembra partidas solo de prueba y genera en el navegador), e2e-import.cjs; build-puzzles.mjs genera puzles en Node desde un PGN/JSON (mismo núcleo)
├── wrangler.jsonc          # configuración del Worker y de Static Assets
├── eslint.config.js
├── vite.config.js
└── tailwind.config.js
```

### Aviso de `npm audit` (6 moderadas)

`npm ci` muestra «6 moderate severity vulnerabilities». Son **un solo aviso** ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), denegación de servicio en `minimatch` < 11.0.1) que npm cuenta seis veces porque llega por ESLint y sus paquetes. Solo afecta a la herramienta de lint en la máquina de desarrollo, con patrones de archivos de nuestra propia configuración; **no entra en la app publicada**: `npm audit --omit=dev` da 0. No hay corrección disponible: ESLint 9 usa minimatch 3 y ESLint 10 (el último) minimatch 10, ambos dentro del rango afectado, y forzar minimatch 11 rompe ESLint. Se resolverá al actualizar ESLint cuando adopte minimatch ≥ 11.0.1. Para auditar solo lo que se publica: `npm run audit:prod`.

## Stockfish y cabeceras COOP/COEP

Stockfish 17.1 multihilo usa `SharedArrayBuffer`, que el navegador solo habilita si la página está aislada entre orígenes. Para eso el servidor debe enviar:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`vite.config.js` ya las envía en `npm run dev` y `npm run preview`, y `public/_headers` en Cloudflare (ver [Despliegue en Cloudflare](#despliegue-en-cloudflare)). **En cualquier otro hosting de producción** (Netlify, Vercel, Cloudflare Pages, Nginx, etc.) hay que configurarlas también; si faltan, el motor no arranca. Tener en cuenta que `require-corp` bloquea recursos de terceros que no envíen `Cross-Origin-Resource-Policy` o CORS.

## Despliegue en Cloudflare

La app se publica como un solo **Cloudflare Worker con Static Assets** (`coach-chess`): Cloudflare sirve el build de Vite (`dist/`) y el Worker (`worker/index.js`) atiende `/api/health` en el mismo origen. El Worker no tiene LLM: la IA es opcional y la pone cada usuario desde su navegador. Las cuentas también son opcionales.

- **COOP/COEP**: `public/_headers` (Vite lo copia a `dist/`) aplica las dos cabeceras a todos los archivos estáticos: HTML, JS y `.wasm`. Ese archivo no se aplica a las respuestas que genera el Worker, así que `worker/index.js` las añade por su cuenta.
- **Rutas**: `wrangler.jsonc` usa `run_worker_first: ["/api", "/api/*"]`. Solo esas rutas ejecutan el Worker; el resto se sirve como asset sin invocarlo.
- **API**:
  - `GET /api/health` → `{ ok, version }`.
  - Cuentas opcionales (Google/Microsoft, desde 16 años y con consentimiento explícito), Premium con Polar y sincronización en D1: `/api/auth/*`, `/api/me` (y `/api/me/consent`), `/api/billing/*`, `/api/webhooks/polar`, `/api/sync/*`. Puesta en marcha paso a paso en **[docs/DEPLOY-ACCOUNTS.md](docs/DEPLOY-ACCOUNTS.md)**.
  - **Precios** (se crean en Polar, no en el código): Mensual 2,99 USD, Anual 19,99 USD y Fundador 49,99 USD de pago único, limitado a los primeros 500 (`FOUNDER_LIMIT`). La pantalla Premium calcula el equivalente mensual y el ahorro del anual con los precios reales de Polar y muestra las plazas de Fundador que quedan.
  - Cualquier otra ruta `/api/*` → 404 JSON.
- **Antes del primer `cf:deploy` con esta versión** hay que crear la base D1 y poner su `database_id` en `wrangler.jsonc` (§1 de DEPLOY-ACCOUNTS). Sin secretos de cuentas la app funciona igual que antes, sin cuenta.

### Requisitos

- Node.js 22 o superior (lo exige Wrangler 4).
- Una cuenta de Cloudflare (sirve el plan gratuito). Para desarrollo local no hace falta iniciar sesión.

### Desarrollo local

```bash
npm run cf:dev                   # build + wrangler dev en http://localhost:8787
```

`npm run cf:dev` sirve el build igual que en producción. Para trabajar con recarga en caliente, deja `npx wrangler dev` corriendo en otra terminal y usa `npm run dev`: Vite reenvía `/api` a `http://localhost:8787`.

### Publicar

```bash
npx wrangler login               # una sola vez; abre el navegador para autorizar
npm run cf:deploy                # build + wrangler deploy (sin secretos ni KV que configurar)
```

### Límites del plan gratuito de Workers

- **100.000 peticiones por día** al Worker (se reinicia a medianoche UTC). Solo cuentan las rutas `/api`; las peticiones a assets estáticos son gratis e ilimitadas.
- **10 ms de CPU por petición** (de sobra para `/api/health`).
- **Assets**: hasta 20.000 archivos por versión y 25 MiB por archivo (`stockfish.wasm` pesa unos 7 MB).
- Al superar el límite diario, las rutas que ejecutan el Worker responden con error (1027 o 429) hasta el reinicio.

## Publicación

### Valores que el dueño debe completar

Todo en **`src/appInfo.js`** (valor por defecto) o, sin tocar el código, como variable de entorno del build (`.env.production`, `.env.local` o el entorno de CI; mandan sobre el archivo):

| Valor | Variable | Por defecto | Para qué |
|---|---|---|---|
| `DEFAULT_SITE_URL` | `VITE_SITE_URL` | `https://coach-chess.example.workers.dev` (marcador) | `canonical`, `og:url`, `og:image`, `robots.txt` y `sitemap.xml`. Poner la URL pública sin barra final (p. ej. `https://coach-chess.<subdominio>.workers.dev` o el dominio propio). |
| `DEFAULT_CONTACT_EMAIL` | `VITE_CONTACT_EMAIL` | `escaque.ec@gmail.com` | Correo del responsable en las páginas de privacidad y términos (soporte y derechos sobre los datos). Vacío → muestran «CONTACT_EMAIL — pendiente de completar». |
| `DEFAULT_CF_ANALYTICS_TOKEN` | `VITE_CF_ANALYTICS_TOKEN` | vacío (sin analítica) | Activa Cloudflare Web Analytics (ver abajo). |
| `DEFAULT_FEEDBACK_URL` | `VITE_FEEDBACK_URL` | `https://github.com/Omar8485/escaque/issues` | Enlace «Enviar comentarios» del menú (`https://…` o `mailto:`; vacío lo oculta). Por defecto, los issues del repositorio público. |

Ejemplo: `VITE_SITE_URL=https://escaque.app VITE_CONTACT_EMAIL=hola@escaque.app npm run cf:deploy`.

### URL pública

Con `npm run cf:deploy` la app queda en `https://coach-chess.<tu-subdominio>.workers.dev` (lo imprime Wrangler). Para un dominio propio: Cloudflare → Workers → `coach-chess` → *Domains & Routes*. En los dos casos, pon esa URL en `SITE_URL` y vuelve a publicar.

### Instalar como app (PWA)

- **Chrome, Edge, Android**: menú ☰ → **Instalar app** (aparece cuando el navegador lo permite) o el icono de instalar de la barra de direcciones.
- **iPhone / iPad**: en Safari, Compartir → **Añadir a pantalla de inicio** (el menú lo explica en «Instalar app»).
- Instalada o no, tras la primera visita la app funciona **sin conexión** (Entrenar, Puzles, Progreso, Análisis y las páginas legales): un service worker propio (`src/pwa/sw-template.js` → `dist/sw.js`, sin dependencias) guarda el shell y Stockfish (≈7 MB). Se registra cuando la página cargó y el motor está «Listo», y toma el motor de la caché HTTP (comprueba su SHA-256), así la primera visita no lo descarga dos veces. Todo lo que sirve lleva COOP/COEP: sin conexión sigue `crossOriginIsolated === true`.

### Actualizar

Cada `npm run cf:deploy` genera un `sw.js` cuya versión depende del contenido del build. Quien tenga la app abierta ve el aviso **«Nueva versión disponible — Actualizar»** (no bloquea): al pulsarlo se activa la versión nueva y la página se recarga; si lo ignora, la versión nueva se aplica al cerrar todas las pestañas. `public/_headers` sirve `sw.js` con `Cache-Control: no-cache` para que el cambio se detecte en la siguiente visita. El motor tiene su propia caché (por hash): si no cambia, no se vuelve a descargar.

- **Páginas legales y de licencias** (`/privacidad`, `/privacy`, `/terminos`, `/terms`, `/licencias`, `/licenses`): el service worker las pide **primero a la red** y solo usa la caché sin conexión, así que siempre se lee la versión publicada aunque la app sea la anterior.
- **Página sin service worker al mando** (p. ej. tras Ctrl+Shift+R, que lo carga todo de la red): si hay una versión esperando, se activa en silencio, sin aviso ni recarga.
- Durante la primera visita tras un despliegue, la app antigua (de la caché) habla con el Worker nuevo hasta que el usuario pulsa «Actualizar» o vuelve a abrir la app: un cambio incompatible en la API se nota en esa sesión (p. ej. el 403 `consent_required` de la sincronización al publicar los términos 1.0).

### Analítica (opcional, desactivada por defecto)

1. Cloudflare → *Analytics & Logs* → **Web Analytics** → *Add a site* → copia el **token** del fragmento JS.
2. Publica con `VITE_CF_ANALYTICS_TOKEN=<token> npm run cf:deploy` (o pon el token en `src/appInfo.js`).

El build añade `beacon.min.js` (sin cookies; con `crossorigin` porque la página exige COEP) y la política de privacidad pasa a explicarlo. Sin token no hay script y la política dice que no hay analítica.

### SEO, redes y páginas legales

- Título y descripción en español e inglés (cambian con el idioma; `src/seo/documentMeta.js`), Open Graph y Twitter Card con `public/og-image.png` (1200×630).
- `robots.txt` y `sitemap.xml` los genera el build (`build-tools/site.js`).
- `public/privacidad.html`, `privacy.html`, `terminos.html` y `terms.html`: **Política de privacidad y Términos de uso, versión 1.0, vigentes desde el 7 de noviembre de 2026** (responsable: el titular de Escaque (nombre desde `VITE_CONTROLLER_NAME` en el build), Quito; contacto `escaque.ec@gmail.com`). Se basan en la LOPDP de Ecuador y el RGPD como referencia; decisiones y tabla «sección → norma» en [docs/LEGAL-NOTES.md](docs/LEGAL-NOTES.md). Enlazados en el menú junto a Licencias, en la casilla de consentimiento y en la pantalla Premium.
- **Versión de los términos**: un solo sitio, `shared/legal.js` (`TERMS_VERSION`, fecha y edad mínima). Si cambias los textos de forma sustancial, súbela aquí y en las cuatro páginas (`build-tools/site.test.js` lo comprueba): todos los usuarios con cuenta tendrán que volver a aceptar al entrar.
- **Consentimiento**: antes del primer inicio de sesión hay una casilla obligatoria («Tengo 16 años o más y acepto…»); el Worker guarda la versión aceptada y la fecha (`users.terms_version`, `consent_at`, migración `0002`) y no crea cuentas sin ella.
- Iconos, favicon e imagen para redes: `node scripts/gen-brand-images.cjs` los regenera a partir de `src/components/Logo.jsx` (Playwright; no añade dependencias).

### Pruebas del lanzamiento

Con `npm run build && npx wrangler dev --port 8787` (aplica `_headers` y el Worker como en producción):

```bash
node scripts/e2e-pwa.cjs http://127.0.0.1:8787/     # manifiestos, iconos, SW, recarga sin conexión con Stockfish «Listo», instalar
node scripts/e2e-launch.cjs http://127.0.0.1:8787/  # bienvenida, meta es/en, robots, sitemap, legales, analítica/comentarios (--configured)
node scripts/e2e-pwa-update.cjs                     # aviso de versión nueva (sirve dist/ con su propio servidor)
```

## IA opcional (con tu propia clave)

El coach funciona completo **sin IA**: Stockfish y chess.js calculan los hechos y las plantillas los redactan. Si quieres comentarios redactados por un modelo, en Entrenar abre el engranaje del coach → **IA (opcional)**:

1. Elige proveedor: **Google Gemini**, **OpenAI**, **Anthropic (Claude)**, **OpenRouter** o **Compatible con OpenAI** (Ollama, LM Studio… con URL base propia).
2. Modelo: vacío = el barato por defecto (`gemini-3.5-flash-lite`, `gpt-6-luna`, `claude-haiku-5-5`, `google/gemini-3.5-flash-lite` en OpenRouter).
3. Pega tu clave, pulsa **Probar conexión** (una llamada mínima) y **Guardar y activar**. El panel se pliega solo y queda una línea de resumen: "IA activa · Gemini · gemini-3.5-flash-lite" (o "Plantillas (sin IA)") y el consumo de la partida. La flecha de esa línea lo despliega o pliega; el estado se recuerda.

Cómo funciona y qué implica:

- **La clave nunca va al servidor de Escaque.** Se guarda solo en tu navegador (`localStorage`, clave `escaque:ia`), o solo en memoria si desmarcas "Recordar la clave en este equipo". **Borrar clave** la elimina y vuelve a las plantillas.
- Las llamadas van **directamente del navegador al proveedor** (todos los proveedores admitidos aceptan CORS; Anthropic exige la cabecera `anthropic-dangerous-direct-browser-access`, que el adaptador envía). Las **pagas tú** a tu proveedor: como mucho 30 por partida, solo en errores, grandes jugadas, "¿Por qué?" y pistas 1–2.
- Se envían **solo hechos de la jugada** (posición, jugadas y casillas permitidas, evaluación, tu rating aproximado y el coach elegido), sin datos personales.
- **Anti-alucinación**: toda respuesta pasa por `validateOutput` (§5.3 del diseño) en el navegador: jugadas solo de `allowedMoves`, casillas solo de `allowedSquares`, nunca la casilla de destino de la pista. Si falla, se muestra la plantilla. Los mensajes llevan un indicador discreto **IA** o **plantilla**.
- **Sin parpadeo**: cuando la jugada va a la IA, el coach se queda "pensando" hasta que llega su texto (o falla o vence el plazo) y solo entonces habla. Sin IA, la plantilla sale al instante.
- **IA ↔ plantilla**: de cada jugada existen las dos versiones; el botón ⇄ junto al indicador **IA**/**plantilla** cambia entre ellas (se recuerda tu última elección).
- **"¿Por qué?"** muestra la línea con la que el rival castiga tu jugada (la calcula Stockfish, 4–8 medias jugadas, p. ej. *4…Qg5 5.Nxf7 Qxg2*) en un mini tablero con ⏮ ◀ ▶ ⏭, y explica qué gana el rival (material, mate, ataque doble, pieza colgada). En los errores que detienen la partida, esa explicación llega en la misma llamada que el comentario (una llamada en vez de dos). Si la IA falla o repite el comentario, queda la explicación de plantilla.
- **Consumo**: el panel de IA muestra "Esta partida: N solicitudes · X tokens de entrada · Y de salida · ≈ costo (aprox.)" con los tokens que informa tu proveedor, y el detalle por solicitud (tipo, tokens, latencia). Los precios aproximados están en `src/llm/pricing.js` (un solo lugar; manda tu factura). Desde la v1.1 cada solicitud lleva ~40 % menos tokens de entrada (prompt y hechos compactos; ver `docs/COACH_DESIGN.md` §7.8).
- Timeout de 4,5 s por llamada; ante clave rechazada, sin saldo o modelo inexistente, el coach vuelve a plantillas hasta que cambies la configuración; ante 429/5xx, pausa de al menos 60 s.
- Riesgo a tener en cuenta: cualquier extensión o script con acceso a la página podría leer la clave. Usa una clave dedicada y con límite de gasto.
- Servidores locales (Ollama, LM Studio): deben permitir CORS desde el origen de Escaque (Ollama: `OLLAMA_ORIGINS`; LM Studio: "Enable CORS"); `http://` solo se admite para `localhost`.

Pruebas: `npm test` (adaptadores con `fetch` simulado, validación, almacenamiento de la clave) y `node scripts/e2e-byok.cjs http://localhost:4173/` con `npx vite preview` (sin clave → 0 peticiones a proveedores y "¿Por qué?" con línea y mini tablero; proveedor simulado con 1,5 s de retraso → "pensando" sin plantilla previa, mensaje "IA", alternar IA/plantilla, "¿Por qué?" en la misma llamada, consumo en el panel; respuesta con jugada no permitida → plantilla; 401 → error claro; el panel de IA se pliega al guardar; COEP no bloquea las llamadas con CORS).

## Capa del motor

- **Perspectiva**: UCI da `score` desde el lado que mueve; `src/engine/uci.js` lo normaliza siempre a perspectiva de blancas. Entre módulos viaja un objeto `{ type: 'cp' | 'mate', value, winner? }`, nunca strings.
- **Sincronización**: una sola búsqueda a la vez. Cada análisis envía `position` + `isready`, espera `readyok` y recién entonces `go depth N`; cancelar envía `stop` y se descarta todo hasta el `bestmove` de esa búsqueda.
- **Clasificación**: una vez por jugada, con las evaluaciones FINALES (al `bestmove`) de la posición antes y después, por pérdida de probabilidad de ganar (modelo de Lichess) del jugador que movió: Best (= jugada del motor), Excellent ≤2, Good ≤5, Inaccuracy ≤10, Mistake ≤20, Blunder >20 puntos porcentuales.
- **Análisis de partidas**: no se analiza la partida completa al cargarla (≈80 posiciones a profundidad 15 bloquearían el motor alrededor de un minuto). Se clasifica bajo demanda la jugada mostrada al navegar; lo calculado queda en caché por FEN.

## Cómo importar tus partidas

Menú ☰ → **Mis partidas**. Nada de lo importado sale de tu navegador; Escaque no tiene servidor de datos ni pide contraseñas.

- **Lichess**: escribe tu usuario y pulsa **Importar**. La primera vez trae las últimas 200 partidas (o las que elijas, o desde una fecha); después, con «Solo las nuevas», solo las jugadas desde la última importación. Usa `GET https://lichess.org/api/games/user/{usuario}` (NDJSON en streaming, con relojes y apertura), una petición a la vez y espera si Lichess responde 429.
- **Chess.com**: igual, con tu usuario. Lee la lista de meses y luego cada mes, uno detrás de otro (`/pub/player/{usuario}/games/archives` y `/games/{AAAA}/{MM}` de la Published-Data API). Escaque no está afiliado a Chess.com.
- **Archivo PGN**: sube uno o varios `.pgn` (pueden tener muchas partidas). Escaque propone quién eres (el nombre que más se repite como blancas o negras) y puedes cambiarlo. Subir el mismo archivo otra vez no duplica partidas.
- Solo se importa **ajedrez estándar** desde la posición inicial (se descartan Chess960, ajedrez con ventaja, «From Position», etc.). Las partidas aparecen en **Análisis** y **Stats**; con **Borrar todas** se eliminan del navegador.
- Si el navegador no puede leer la respuesta de Chess.com (CORS), la app reintenta por el Worker (`/api/proxy/chesscom/…`, solo esas dos rutas). En `npm run dev`/`vite preview` sin Worker, ese respaldo no existe.

Prueba en el navegador (con `npx vite preview --port 4173` en marcha): `node scripts/e2e-import.cjs http://localhost:4173/` (respuestas simuladas; `--real` para una importación real pequeña; `--worker` contra `npx wrangler dev` para probar el reenvío).

## Puzles generados en el navegador

Al pulsar **Generar puzles** (sección Puzles), Escaque toma de IndexedDB tus partidas importadas sin análisis vigente, de la más reciente a la más antigua (últimas 50 / 100 / todas), y las analiza con una instancia propia de Stockfish que usa la mitad de los núcleos. Por cada partida guarda sus puzles y su análisis (`GameAnalysis`): si cierras la pestaña, al volver sigue donde quedó; cancelar conserva lo hecho. Detalles, criterios y tiempos medidos en [docs/HANDOFF.md §3j](docs/HANDOFF.md).

Para regenerar a mano en Node con los mismos criterios:

```bash
node scripts/build-puzzles.mjs partidas.pgn --user tu_cuenta --out puzzles-node.json
```

## Estado y roadmap

Prototipo funcional en desarrollo. Próximos pasos:

- **Probar la IA opcional con claves reales** de cada proveedor y medir latencia (objetivo p95 < 4,5 s): ver [docs/HANDOFF.md](docs/HANDOFF.md).
- **Resumen narrado de fin de partida** (T10: las estadísticas ya están; faltan los 3 momentos clave y el texto del coach), **calibración de niveles** (T11) y **arnés de evaluación de prompts** (T12).
- Reescritura de la lógica de evaluación y clasificación de jugadas.

## Licencia

Escaque es software libre bajo la **GNU General Public License v3.0** (archivo `LICENSE`).


Stockfish.js 17.1 se distribuye sin modificar bajo **GPLv3**: texto completo en `public/stockfish/COPYING.txt` y créditos y enlaces al código fuente en `public/licencias.html` (en inglés, `public/licenses.html`; el menú enlaza la del idioma activo). El código propio de Escaque también es GPLv3 (repositorio público: <https://github.com/Omar8485/escaque>); los Términos de uso (§3) dicen que no restringen ningún derecho de la GPL.
