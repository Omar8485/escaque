# Traspaso: estado de Alfred (coach) para retomar en Cowork

Última actualización: 2026-11-03 (**integración v1.3** en `release/v1.3`: lanzamiento + cuentas/Premium + recompensas de Codex, ver §Integración v1.3; antes, lanzamiento en `feat/launch-ready`: PWA, carga diferida, SEO, bienvenida y legales, ver §Lanzamiento; antes: idiomas español/inglés en `feat/i18n`, ver §8c y [I18N.md](I18N.md); antes: v1.1 integrada en `release/v1.1`: experiencia de partida, personalidades de los rivales y coach e IA; ver §v1.1 y §4b) · Rama original: `claude/gifted-thompson-0o1tsm` (sobre `main` 6f671da) · PR: #10 del repositorio de desarrollo (privado) · Diseño de referencia: [COACH_DESIGN.md](COACH_DESIGN.md)

## 1. Resumen en una línea

El coach (**Alfred**) ya funciona de punta a punta en la pestaña **Entrenar**: analiza cada jugada tuya, la comenta, detiene la partida ante errores con **Retroceder / ¿Por qué? / Seguir**, felicita cuando corriges y da pistas en 3 niveles. Por defecto redacta con **plantillas** (sin IA ni red). La IA es **opcional y la pone el usuario con su propia clave** (Gemini, OpenAI, Anthropic, OpenRouter o un servidor compatible con OpenAI): el navegador llama directamente al proveedor y Escaque no paga ni aloja ningún LLM (ver §4).

## 2. Qué se hizo en esta sesión

| Tarea (§9 del diseño) | Commit | Estado |
|---|---|---|
| T5 · Datos de cada jugada para Gemini (`CoachRequest`) | `fef61cb` | Hecho, con tests de los ejemplos §6.2 y §6.3 |
| T8 · Conexión de Alfred con Gemini + tope de 5 USD | `2b3804e` | **Sustituido** el 2026-11-02: sin LLM en el servidor; IA opcional con la clave del usuario (§4–§5) |
| T6 + T9 · Interfaz de Alfred y cliente del coach | `ebf4d48` | Hecho y probado en Chromium (Playwright) con y sin backend |
| Documentación (este archivo, README) | último commit | Hecho |

Antes de esta sesión ya estaban en `main`: T1 (enrich/accuracy), T2 (tactics/phase), T3 (rival), T4 (bucle de partida) y T7 (Worker con `/api/health`).

Nota: al empezar no había ramas ni sesiones en la nube con T5 ni T8, así que se implementaron aquí. Si existe trabajo local en Cowork sobre esas tareas que no se subió, hay que compararlo con esta rama antes de fusionar.

Verificación: `npm test` → 193 tests en verde (11 archivos); `npm run lint` limpio; `wrangler deploy --dry-run` empaqueta el Worker (≈ 56 KB); prueba de punta a punta en el navegador sin errores de consola.

## 3. Cómo funciona (mapa rápido)

```
Tu jugada ─▶ useCoach (src/coach/useCoach.js)
              ├─ analyzePlayerMove (coachPipeline.js): posición previa MultiPV 3 (ya en caché por la
              │   evaluación en vivo), posición posterior depth 15, confirmación a depth 18 cerca del umbral
              ├─ buildMoveRequest (buildRequest.js): hechos de enrich/tactics/phase → CoachRequest v1
              ├─ plantilla (templates.js): inmediata si no se llama a la IA
              └─ si es gran jugada / error / error grave Y el usuario configuró su IA (v1.1: "pensando" hasta la respuesta):
                   coachClient (src/coach/coachClient.js) → adaptador del proveedor (src/llm/)
                   → fetch directo del navegador al proveedor (timeout 4,5 s)
                   → validación §5.3 en el navegador (shared/coach-contract/validateOutput.js)
                   → si pasa, se muestra (marcada "IA", alternable con la plantilla); si no, la plantilla
```

- **El rival espera**: App retiene la jugada del rival mientras Alfred analiza tu jugada (~0,5–1,5 s) o mientras decides tras un aviso. El reloj se para durante el aviso.
- **Retroceder** deshace solo tu jugada (el rival aún no respondió). Si luego juegas la mejor o una excelente: "¡Eso es! … corrige el problema".
- **Seguir** deja entrar la jugada del rival y revela la mejor jugada.
- **¿Por qué?** (v1.1, §4b) muestra la línea de refutación de Stockfish en un mini tablero y explica qué gana el rival; en los errores que detienen la partida la explicación de la IA llega con el comentario; en las imprecisiones, una llamada `why`. Sin IA, plantilla (`whyTemplate`).
- **Pista**: nivel 1 = idea/tema, nivel 2 = pieza y casilla de origen, nivel 3 = flecha verde en el tablero (sin LLM). La casilla de destino nunca va al LLM ni puede aparecer en su respuesta.
- **Avatar**: `src/components/AlfredAvatar.jsx`, ilustración SVG propia (señor mayor de barba y bigote blancos, gafas redondas, saco de tweed con un caballo en la solapa), sin imágenes externas. Se muestra grande junto a sus mensajes en un globo de diálogo y cambia de expresión: `feliz` (elogio, gran jugada, felicitación), `neutral`, `pensativo` (imprecisión, pista), `preocupado` (error, error grave) y `pensando` (analizando). Es un diseño original: no reutiliza el dibujo ni la marca de Dr. Wolf.
- **Preferencias** (engranaje del panel, guardadas en el navegador): Alfred activo o en silencio; detenerse en "errores y errores graves" (por defecto), "también imprecisiones" o "nunca".
- Con Alfred activo, en tu turno el panel "Stockfish 17.1" oculta la mejor jugada (para eso están las pistas). En Análisis y fuera de partida se ve como antes.

### Cuándo se llama al LLM, si el usuario puso su clave (§7.1)

| Situación | ¿LLM? |
|---|---|
| Mejor / Excelente / Buena | No (plantilla) |
| Gran jugada | Sí, 1 llamada |
| Imprecisión | Solo si pulsas "¿Por qué?" |
| Error / error grave / mate concedido | Sí, automática |
| Pista 1–2 | Sí · Pista 3: no |

Máximo 30 llamadas por partida; caché en el navegador (retroceder y repetir no vuelve a llamar).

## 3b. Partida en Entrenar al cambiar de pestaña (y arrastre de piezas)

- **Arrastrar piezas** funciona (antes no: la pieza estaba dentro de un contenedor con `pointer-events-none` y una capa encima capturaba el ratón). Los manejadores de flechas (clic derecho) pasaron a la casilla (`ChessBoard.jsx`), así que también se dibujan flechas empezando sobre una pieza. Clic-clic sigue funcionando.
- **La partida no se pierde al cambiar de pestaña.** Entrenar y Análisis tienen tableros separados (`analysisView` en `App.jsx`); entrar a una pestaña ya no reinicia nada.
- **El reloj sigue corriendo** en cualquier pestaña: lo lleva `useChessClock` (`src/hooks/useChessClock.js`) en `App`, midiendo tiempo real; `GameClock` solo lo dibuja.
- **El rival sigue jugando** fuera de Entrenar (su worker ya no se apaga al salir).
- **Abandono**: fuera de Entrenar con la partida en juego empieza una cuenta atrás de **30 s** (`ABANDON_GRACE_MS`), con un aviso arriba (tu reloj, segundos restantes y botón "Volver a la partida") y un punto naranja en "Entrenar". Si no vuelves, pierdes por abandono ("Abandono · Gana el rival"). Una partida **en pausa** no cuenta (su reloj está parado). El botón **Abandonar** también termina la partida como abandono (antes la borraba sin resultado). Deshacer no revierte un abandono ni un tiempo agotado.
- Mientras hay una partida en juego no se puede abrir un puzzle (pisaría la partida).
- Prueba: `scripts/e2e-tabs.cjs` (con `npm run build` y `npx vite preview --port 4173`).

## 3c. Tema claro / oscuro

- Botón sol/luna en la esquina superior derecha (`src/components/ThemeToggle.jsx`), junto al avatar "OM". La elección se guarda en el navegador (`localStorage`, clave `coach-chess:theme`); por defecto, claro.
- Tailwind con `darkMode: 'class'`: `useTheme` (`src/hooks/useTheme.js`) pone o quita `class="dark"` en `<html>`; un script en `index.html` lo aplica antes de cargar React para que no parpadee.
- La interfaz usa variantes `dark:` (App, CoachPanel, LevelSelector, GameClock, MoveBadge). **El tablero no cambia**: `ChessBoard.jsx`, `ChessPiece.jsx` y `EvalBar.jsx` no se tocaron (comprobado: mismos colores de casillas y marco en ambos temas).
- `src/index.css`: los estilos base de la plantilla de Vite seguían el tema del sistema operativo; ahora siguen el de la app.
- Para pantallas nuevas: añadir `dark:` junto a cada color claro (p. ej. `bg-white dark:bg-slate-900`, `text-slate-800 dark:text-slate-100`, `border-slate-200 dark:border-slate-700`). Botones sin fondo propio: añadir `bg-transparent` (si no, heredan el gris claro base).

## 3d. Tamaño del tablero y zoom del navegador

- **Antes**: el tablero se dimensionaba con la altura de su tarjeta sin descontar los controles de abajo (⏮ ◀ ▶ ⏭, Girar, Reiniciar), así que la tarjeta lo recortaba; la página no se podía desplazar y con zoom ≥ 125 % el tablero casi desaparecía; por debajo de 768 px el menú lateral ocupaba toda la pantalla; y estilos sobrantes de la plantilla de Vite en `index.css` (`body { display: flex }`) encogían la app.
- **Ahora**: `ChessBoard` mide su espacio libre (ResizeObserver) y toma el mayor cuadrado que cabe junto a la barra de evaluación (`aside`) y sobre sus controles. Casillas, piezas y colores no cambian.
  - Desde 960 px de ancho (hasta ~150 % de zoom en una pantalla de 1500 px): tablero y paneles lado a lado, todo visible sin desplazarse (`fitHeight`).
  - Por debajo: apilados; el tablero se ajusta al ancho con un tope del 78 % del alto de la ventana y la página se desplaza. El menú pasa a barra superior en < 768 px.
  - Tamaño mínimo 240 px: si no cabe, la página se desplaza en vez de recortar.
- Archivos: `ChessBoard.jsx` (props `fitHeight` y `aside`), `src/hooks/useMediaQuery.js`, `App.jsx` (contenedores y `main` con scroll), `src/index.css`.
- Prueba: `scripts/e2e-layout.cjs` (zoom 100/125/150/175/200 % y móvil; tablero entero y cuadrado, controles visibles).

## 3e. Menú hamburguesa, tablero grande y oscuro sin blancos (2.ª pasada)

Reporte del dueño (portátil, zoom 125 %, ≈1004×508 px CSS): tablero diminuto, franjas y botones blancos en tema oscuro; pidió menú tipo hamburguesa.

- **Menú** (`src/components/SideMenu.jsx`): oculto por defecto. Se abre con ☰ (arriba a la izquierda) o dejando el ratón un instante (150 ms) en el borde izquierdo. Se cierra al elegir opción, clic fuera, Esc o, si se abrió con el ratón, al sacarlo del menú. El punto ámbar de "partida en curso" aparece en ☰ y en Entrenar.
- **Tablero**: `src/utils/boardLayout.js` elige poner los controles en una columna estrecha al lado del tablero (pantallas apaisadas) o en una fila debajo, lo que deje el tablero más grande. Cabecera y márgenes compactos. Resultado: en el caso reportado el tablero pasó de ~230 px a 369 px (73 % del alto); al 100 % en 1500×950, 792 px (83 %).
- **Tema oscuro**: controles y marco del tablero con variantes oscuras; `index.css` deja el fondo base de los botones en transparente (el gris casi blanco de la plantilla de Vite era el origen de los "botones blancos"). Barrido automático de las 4 pestañas en oscuro: sin fondos claros salvo los puntos ámbar intencionales. La parte blanca de la barra de evaluación es la ventaja de blancas (no es un error de tema).
- Pruebas: `scripts/e2e-layout.cjs` incluye el tamaño del portátil, el % del alto que ocupa el tablero, el menú (☰, borde, Esc, cierre) y los colores en oscuro. Las pruebas abren el menú antes de navegar y mueven el ratón al centro al empezar (Playwright arranca en (0,0), sobre el borde que abre el menú).

## 3f. Barras de jugador (reloj, capturas y +N) y piezas más grandes

- **Piezas**: 93 % de la casilla (antes 85 %); marco interior del tablero algo más fino.
- **Barras de jugador** (`src/components/PlayerBar.jsx`): nombre (tú: "Ana (1495)"; rival: "Rival · nivel"; en Análisis, los jugadores y su Elo de la partida cargada), piezas capturadas a ese rival, ventaja de material **+N** (como lichess/chess.com; `src/utils/material.js`) y **su reloj** (en Entrenar). El reloj activo se resalta y pasa a rojo con ≤ 20 s.
- **Dónde van** (`src/utils/boardLayout.js`, automático): encima/debajo del tablero (estilo chess.com) si hay espacio; en pantallas bajas y anchas, en una columna a la derecha (rival arriba, tú abajo, estilo lichess) cuando eso agranda el tablero ≥ 12 %. En el portátil del dueño (125 %, ≈1004×508) usa la columna: tablero ≈ 396 px (78 % del alto).
- El reloj suelto de la columna derecha solo aparece antes de empezar o al terminar, para elegir el ritmo (1/3/5/10 min).
- Prueba: `scripts/e2e-bars.cjs`.

### ¿Hace falta conectar un modelo a Alfred? (pregunta del dueño, 2026-11-02)

Respuesta dada: **no para lo actual** (y desde el 2026-11-02 la IA es opcional con la clave del propio usuario, §4). Todo el contenido ajedrecístico lo calculan Stockfish y chess.js; las plantillas lo redactan bien. El modelo aportaría redacción variada, "¿Por qué?" más pedagógico y adaptado al nivel y preguntas socráticas, y es **imprescindible** solo para lo que viene: resumen narrado de fin de partida (T10) y chat libre sobre la posición. Recomendación: dejarlo en plantillas; probar Gemini (nivel gratuito) una semana cuando exista el resumen o el chat.

## 3g. Personajes, un solo reloj, sin chat, animación y sonido (2026-11-02)

### Decisiones firmes del dueño
- **Sin sección de chat ("Coach")**: se eliminó la pestaña con el chat simulado. No se vuelve a añadir salvo que el dueño lo pida expresamente. Alfred (en Entrenar) es el único coach. Esto también deja fuera del plan el "chat libre" (§1.3 del diseño): si algún día se quisiera, sería dentro del panel de Alfred y con LLM.
- **Un solo juego de relojes**: los de las barras del tablero. El reloj suelto de la columna derecha se borró (`GameClock.jsx` eliminado); el ritmo (1/3/5/10 min) se elige en el selector de rival.
- **Rivales con nombre**: 10 personajes griegos, en vez de "Club 1500".

### Personajes y fuerza (`src/engine/rivalLevels.js`)
| Nivel | Personaje | Lema | Elo humano aprox. | Motor |
|---|---|---|---|---|
| 1 | Ícaro | vuela alto y cae pronto | ≈600 | Skill 0, depth 1 |
| 2 | Narciso | mira más su reflejo que el tablero | ≈800 | Skill 3, depth 3 |
| 3 | Perseo | aprendiz con suerte de héroe | ≈1000 | Skill 6, depth 5 |
| 4 | Jasón | busca el vellocino y a veces lo encuentra | ≈1150 | UCI_Elo 1450, 0,8 s |
| 5 | Teseo | sabe salir de cualquier laberinto | ≈1300 | UCI_Elo 1650, 0,8 s |
| 6 | **Héctor** (por defecto) | defensor firme de Troya | ≈1500 | UCI_Elo 1850, 1 s |
| 7 | Odiseo | astuto: siempre prepara una trampa | ≈1700 | UCI_Elo 2050, 1 s |
| 8 | Aquiles | ataca sin piedad | ≈1900 | UCI_Elo 2300, 1,2 s |
| 9 | Heracles | fuerza descomunal | ≈2200 | UCI_Elo 2600, 1,5 s |
| 10 | Atenea | la estrategia hecha diosa | máximo | Skill 20, 1,5 s |

**Por qué los UCI_Elo van ~350 por encima**: el dueño (≈1495 en Lichess) sintió el antiguo nivel "1500" (UCI_Elo 1500) como un 1200. `UCI_Elo` está calibrado motor contra motor (CCRL, Stockfish nativo); con la variante Lite en WASM y < 1 s por jugada juega más flojo que un humano del mismo número. Ajuste empírico; afinar con T11 y con los resultados del dueño contra cada personaje. El contrato admite `rival.level` 1–10.

### Jugada del rival visible
- La pieza del rival se desliza desde su casilla (≈0,3 s; `ChessBoard` prop `animateMove`, CSS `.piece-slide` en `index.css`; se omite con "reducir movimiento").
- Las casillas de origen y destino de la última jugada quedan resaltadas en amarillo suave (prop `lastMove`), como en lichess.

### Sonido de las piezas (`src/utils/sound.js`)
- Sintetizado con Web Audio (sin archivos: nada que licenciar ni descargar, compatible con COEP): golpe grave + chasquido de madera; la captura es un doble golpe. Suena en tus jugadas y en las del rival.
- Botón de altavoz junto al de tema para silenciar (se recuerda en el navegador, clave `coach-chess:sound`). El audio se habilita con el primer clic o tecla (regla de los navegadores).
- Si se quiere un sonido grabado, basta reemplazar `playMoveSound` por un `<audio>` con un archivo propio en `public/` (mismo origen).

Prueba: `scripts/e2e-feel.cjs` (personajes, ritmo, sin chat, animación, resaltado, sonido y silencio).

## 3h. Avatares y nombre de la app (2026-11-02)

- **Personajes con avatar** (`src/components/Avatars.jsx`, `RivalAvatar`): caritas SVG propias, cada una con su sello: Ícaro (alas y sol), Narciso (espejo y destello), Perseo (casco alado), Jasón (vellocino de oro), Teseo (cinta y ovillo de Ariadna), Héctor (casco troyano), Odiseo (gorro pilos y guiño), Aquiles (casco dorado con penacho), Heracles (piel de león), Atenea (casco y búho). Aparecen en el selector de rival, en el panel de la partida y en la barra del tablero.
- **Avatar del usuario** (`UserAvatar` + `src/components/AvatarEditor.jsx`): clic en el avatar de la cabecera → piel, peinado (corto, rizado, largo, cresta, calvo), color de pelo, barba/bigote/perilla, gafas, camiseta, fondo, "Sorpréndeme" y nombre visible. Se guarda en el navegador (`coach-chess:profile`; opciones en `src/utils/avatarOptions.js`). El rating sigue siendo 1495.
- En las barras, el avatar sustituye al cuadrito de color; un puntito blanco o negro en su esquina indica con qué color juega. Antes de empezar ya se ve "tú contra el personaje elegido". En Análisis (partidas de Lichess) se mantiene el cuadrito.
- **Título**: "Dojo de Entrenamiento" → "Entrenamiento". **Nombre de la app**: provisional "Coach Chess", centralizado en `src/appInfo.js` (y `<title>` de `index.html`). Pendiente: que el dueño elija nombre (propuestas en la conversación del 2026-11-02: Escaque, Kairós, Ariadna, Casilla 65, Ágora, Odisea 64, Jaquemente…; verificar dominios, tiendas y marcas antes de decidir).
- Prueba: `scripts/e2e-avatars.cjs`.

## 3i. Escaque: nombre, coaches elegibles, paleta propia y tablero de madera (2026-11-02)

- **Nombre**: la app se llama **Escaque** (decisión del dueño). `src/appInfo.js`, `<title>`, logo propio (`src/components/Logo.jsx`: un escaque girado partido en cuatro).
- **Tres coaches a elegir** (`shared/coach-contract/coaches.js`): **Alfred** (veterano sereno y directo), **Kairós** (dios del momento oportuno: enérgico y breve; avatar con el famoso mechón y alitas) y **Ariadna** (paciente, guía paso a paso; trenza e hilo rojo). Se elige en la preparación de la partida y en las preferencias del panel (se guarda con las preferencias del coach, `alfred:prefs`). Mismos hechos, distinta voz: frases de plantilla por coach (`coachVoice` en `templates.js`) y personalidad en el prompt (`systemPrompt(coachId)`; `PROMPT_VERSION` → `coach-es-v2`; el `CoachRequest` lleva `coach`). Avatares con 5 expresiones en `src/components/CoachAvatars.jsx`.
- **Benchmark Dr. Wolf** (búsqueda web 2026-11-02; no se encontraron capturas fiables de la interfaz): ofrece 4 perfiles de coach con voz y personalidad propias (valida los 3 coaches de Escaque), aprendizaje práctico y voz; crítica frecuente: no mide el progreso (no hay Elo). Oportunidad para Escaque: seguimiento de progreso. No se copia su identidad visual (marca de chess.com).
- **Paleta propia** (`tailwind.config.js`): `brand` = terracota (antes índigo) y `ink` = piedra cálida / café espresso en oscuro (antes slate). Todas las clases `indigo-*`/`slate-*` pasaron a `brand-*`/`ink-*`. Fondo base: pergamino `#faf6f0` en claro, `#14110e` en oscuro.
- **Tablero de madera** (por defecto): veta con degradados CSS (`.sq-wood-light/.sq-wood-dark` en `index.css`; la dirección alterna y varía por casilla), marco de nogal. Botón en los controles del tablero para alternar **Madera / Verde** (se recuerda: `escaque:board`).

## 3j. Puzles de tus partidas (2026-11-02; generación en el navegador en `feat/puzzles-in-browser`)

Sección **Puzles** (menú ☰). Es lo que más le interesa al dueño. **Decisión del dueño**: cada usuario importa sus partidas (almacén `games`; lo hace la importación de "Mis partidas", en otra rama) y Escaque genera **en su navegador** puzles a partir de sus propios errores para entrenarlos con el coach. No competimos con la base de puzles de Lichess/Chess.com: el valor es que salen de tus partidas y se entrenan con el coach. `src/data/puzzles.json` (los 79 puzles del dueño) se borró del bundle.

### Generador (mismo núcleo en el navegador y en Node)

`src/puzzles/generator/core.js`, funciones puras que reciben evaluaciones ya calculadas o un **analizador inyectado** `(fen, {depth, multipv, signal}) → {lines, bestMove}` (la forma de `StockfishEngine.analyze`):

- Evalúa todas las posiciones (depth 12) y busca jugadas tuyas que pierden ≥ 18 pp de Win% desde una posición no decidida (tu Win% entre 30 y 97). Valida a depth 16 con MultiPV 2 que la mejor jugada gane (≥ 60 % o mate) y sea **única** (2.ª ≥ 15 pp peor). Alarga la solución mientras tus jugadas sigan siendo únicas (hasta 3 tuyas). Tipos: **Tu error** u **Oportunidad perdida** (ibas ≥ 70 %). Quita la misma idea repetida (misma primera jugada a ≤ 6 plies). Dificultad orientativa por longitud, jugada tranquila y mate.
- API: `parseGameMoves`, `positionsOf`, `terminalScore`, `evaluatePositions`, `findCandidates`, `uniqueWinning`, `buildSolution`, `difficulty`, `puzzleType`, `isRepeatedIdea`, `gameLink`, `gameMeta`, `findGamePuzzles`, `analyzeGame` (tubería de una partida), `estimatePlies`; constantes `GENERATOR_VERSION` (= 1) y `GENERATOR_DEFAULTS`. Subir `GENERATOR_VERSION` al cambiar criterios o profundidades: las partidas se vuelven a analizar y sus puzles se reemplazan.
- Puzle guardado (almacén `puzzles`, clave `id` = `${gameId}-${ply+1}`, índice `gameId`): campos de siempre (`fen`, `solution` UCI, `color`, `type`, `motif`, `mateIn`, `phase`, `moveNumber`, `played`, `winBefore`, `winAfter`, `opponent`, `date`, `timeControl`, `opening`, `rating`, `gameUrl` con `#ply` en Lichess) + `gameId`, `ply`, `source`, `generatorVersion`, `createdAt`.
- Tests: `core.test.js` (evaluaciones sintéticas), `sources.test.js`, `runner.test.js` (fake-indexeddb). Fixtures PGN propios en `src/puzzles/__fixtures__/games.pgn`.

### Generación en el navegador

- `src/puzzles/generator/runner.js`: `runGeneration({ limit, signal, onProgress, onGame, analyzer?, createEngine?, options? })` lee de `games` las partidas elegibles (estándar y con `playerColor`) **sin `GameAnalysis` de la versión actual**, de la más reciente a la más antigua, con límite (`LIMIT_OPTIONS` = últimas 50 / 100 / todas). Usa una instancia **propia** de `StockfishEngine` con `generatorThreads()` = la mitad de los núcleos (1 sin COOP/COEP) y 32 MB de hash; la termina al acabar. Por cada partida guarda **primero los puzles y después el `GameAnalysis`** (`scores`, `bestMoves` por ply, `depth`, `generatorVersion`): una partida con análisis vigente no se repite; si se corta a mitad de una partida, esa partida se repite entera (ids estables: no hay duplicados). Progreso: `{ total, done, runTotal, runDone, puzzlesFound, current: {white, black, date, positions, positionsTotal}, elapsedMs, etaMs, msPerGame }` (ETA por plies hechos). Otras: `selectGames`, `generationSummary`, `loadPuzzles` (devuelve los puzles y **borra los de partidas que ya no existen**), `isEligible`, `isCurrentAnalysis`.
- `useGeneratePuzzles.js`: estado global fuera de React (`startPuzzleGeneration`, `cancelPuzzleGeneration`, `resumeInterruptedGeneration`, `setGenerationLimit`; hooks `useGeneratePuzzles`, `useGeneratorField`, `usePuzzleLibrary`). La generación **sigue al cambiar de pestaña** dentro de la app. Candado entre pestañas con Web Locks (`escaque:puzzle-generator`). En `meta` (`puzzleGenerator`) se guarda `{status: running|done|cancelled|error, limit}`: si cerraste la pestaña a mitad, al abrir Puzles **se reanuda sola**; si cancelaste, no.
- Interfaz: estado vacío "Importa tus partidas en **Mis partidas** y genera tus puzles" + `GeneratorPanel` (límite, Generar/Cancelar, barra, partida y posición en curso, puzles nuevos, "Quedan ≈ …"). Con puzles, el mismo panel va en la columna derecha ("Puzles de partidas nuevas"). Se mantienen Elo de puzles, rachas, filtros, pistas, solución animada y la presentación del coach. El enlace dice "Ver tu partida en Lichess/Chess.com".
- Progreso guardado: `escaque:puzzles` en localStorage (igual que antes). Los resultados con ids antiguos (`Demo0016-30`) se migran a `lichess:Demo0016-30` al leer.
- `App.jsx`: solo se quitó `import PUZZLES_DATA` (el entrenador carga solo) y el número del botón de Stats.

### Script de Node

```bash
node scripts/build-puzzles.mjs partidas.pgn --user jugador_demo --out puzzles-node.json
```
Acepta PGN con varias partidas, JSON con `Game[]` o el formato antiguo de `partidas.json`; opciones `--depth`, `--deep`, `--limit`, `--threads`, `--no-cache`. Usa el mismo núcleo y `scripts/lib/node-engine.mjs`. Caché en `.puzzle-cache.json`; salida ignorada por git (`puzzles-node*.json`).

### Medidas (sandbox con 2 núcleos → 1 hilo para el generador; 20 partidas más recientes del dueño, 1452 posiciones)

| Dónde | Profundidad | Tiempo 20 partidas | Por partida | Puzles | Candidatos / descartados por no única |
|---|---|---|---|---|---|
| Navegador (Chromium, Playwright) | 12 / 16 | **49–56 s** (2 ejecuciones) | 2,5–2,8 s (0,9–5,6 s; 34–39 ms por posición) | **5** | — |
| Node, 1 hilo | 10 / 14 | 20 s | 1,0 s | 4 | 32 / 27 (+1 jugaste la mejor) |
| Node, 1 hilo | 12 / 16 | 45 s | 2,2 s | 5 | 27 / 22 |
| Node, 1 hilo | 14 / 18 | 110 s | 5,5 s | 5 (otro conjunto) | 25 / 20 |

- **UI mientras genera** (Entrenar, nivel 1): jugada del usuario dibujada en 43–94 ms (sin generar: 36–74 ms), en dos ejecuciones; 0 tareas largas (> 50 ms) en el hilo principal. El motor corre en su propio worker; el hilo principal solo parsea PGN y escribe en IndexedDB.
- **Compromiso calidad/tiempo**: se quedan 12/16. 10/14 es 2,3× más rápido pero pierde 1 de 5 puzles (un error real, `Demo0003-17`) y mete un falso candidato; 14/18 es 2,4× más lento y da el mismo número pero no los mismos (pierde `Demo0003-17`, gana `Demo0018-77` y alarga `Demo0020-45` a 3 plies): no compensa en el navegador. Con 12/16 y 1 hilo: ≈ 2–2,5 min para 50 partidas, ≈ 4–5 min para 100 y ≈ 14–16 min para 337. En un equipo con 8 núcleos (4 hilos) debería ir bastante más rápido (no medido aquí).

### Comparación con el generador de Node anterior (`src/data/puzzles.json`)

- Mismas 20 partidas: anterior **5**, Node con el núcleo nuevo **5**, navegador **5**: **los mismos 5 ids y las mismas soluciones** (`Demo0003-17`, `Demo0016-30`, `Demo0018-119`, `Demo0020-45`, `Demo0020-49` con 5 plies). Única diferencia: `Demo0020-49` era "Tu error" (Win% previo 68) y ahora es "Oportunidad perdida" (74 en Node, 71 en el navegador): cae justo en el umbral del 70 %, y la evaluación a depth fija varía con el número de hilos (antes había más núcleos), el tamaño del hash (64 MB en Node, 32 MB en el navegador) y lo que quedó en la tabla hash de búsquedas previas. Los Win% de los demás varían ±2–4 pp por lo mismo.
- 60 partidas más recientes (Node 12/16, 1 hilo, 2,3 s/partida): anterior **12**, nuevo **12**, 11 en común. Solo en el anterior `8WiXlwyl-58` (Win% 73 → 39, ahora la 2.ª jugada queda a < 15 pp: no única); solo en el nuevo `zyaIi3le-55` (lo contrario). Cambian de tipo `Demo0020-49` y `zMYme0k3-41` (Win% cerca del 70 %), y `zMYme0k3-87` pasa de 5 plies a 1 (la 2.ª jugada tuya dejó de ser única a depth 16). Todo son casos en el borde de un umbral (unicidad 15 pp, oportunidad 70 %) donde pesa el no determinismo del motor; los criterios son idénticos.
- Segunda generación en el navegador (con cancelación y pestaña cerrada a mitad): de nuevo 5 puzles.

### Pruebas

- `npm test` (núcleo, runner con fake-indexeddb, migración del progreso).
- `scripts/e2e-puzzles.cjs` (contra `npx vite preview`): **sembrado solo de prueba** en IndexedDB de partidas `Game` (desde `src/data/partidas.json` mientras exista, o `--games archivo.pgn --user cuenta`; también sirve `src/puzzles/__fixtures__/games.pgn`), estado vacío, generar midiendo tiempos y la UI en Entrenar, validar los puzles (solución legal y primera jugada = mejor jugada de Stockfish depth 16 en Node), resolver y fallar uno, recargar (persisten, "Puzles al día", no reanaliza), filtros, cancelar a mitad, recargar a mitad (se reanuda sola y no repite partidas), borrar una partida (sus puzles desaparecen), 0 errores de consola. `--dump salida.json` guarda tiempos y puzles; `--shots carpeta` capturas.

**Pendiente / siguientes pasos**: conectar con la importación real cuando se fusione (el generador solo necesita `games` con `pgn`, `playerColor` y `endTime`); generar automáticamente tras importar (hoy es manual con el botón); medir en un equipo con más núcleos y valorar 3/4 de los núcleos cuando no hay partida en curso; reanudar a mitad de partida guardando evaluaciones parciales (hoy se repite la partida cortada, ≈ 2,5 s); calibrar la dificultad con tus resultados; repaso espaciado de los fallados; enlace del puzle a la partida dentro de "Mis partidas".

## 3k. Importar partidas: «Mis partidas» y app multiusuario (2026-11-02)

Decisión del dueño: cualquier usuario carga sus partidas; nada de datos fijos del dueño en el bundle. Se borraron `src/data/partidas.json` y `mock_games.json` (`scripts/build-puzzles.mjs` aún los lee: lo reescribe la rama de puzles en el navegador).

- **Dónde**: menú ☰ → **Mis partidas** (`src/components/MyGames.jsx`). Lógica en `src/import/` (sin React salvo `useImportedGames.js`), sobre el contrato de `src/storage/db.js` (sin cambiar versión ni esquema).
- **Lichess** (`lichess.js`): `GET https://lichess.org/api/games/user/{u}?perfType=…&pgnInJson=true&clocks=true&opening=true&max=N[&since=ms]` con `Accept: application/x-ndjson`, leído en streaming con progreso. CORS: la especificación OpenAPI oficial declara `Access-Control-Allow-Origin: *` en esta respuesta → directo desde el navegador. Una petición a la vez (`net.js`, cola por servicio); ante 429 espera `Retry-After` o 60 s (hasta 3 reintentos). Incremental: marca `import:lichess:<u>` = mayor `createdAt` visto; la siguiente usa `since` + `sort=dateAsc` (sin huecos aunque haya más de N nuevas).
- **Chess.com** (`chesscom.js`): `/pub/player/{u}/games/archives` → cada `/games/{AAAA}/{MM}` (JSON: trae el PGN con relojes, `rules` y `uuid`), en serie, del más nuevo hacia atrás hasta N partidas. Solo `rules: 'chess'` sin `initial_setup` distinto. Incremental por mes (`import:chesscom:<u>`: último mes leído; se repite si no había terminado). CORS: su documentación no lo menciona y en su foro hay reportes de fallos de CORS intermitentes → directo y, si el navegador bloquea, **reenvío del Worker** `worker/proxy.js` (solo GET/HEAD a esas dos rutas, sin query, sin cookies, User-Agent con contacto `PROXY_CONTACT` o el repo). Aviso «Escaque no está afiliado a Chess.com.» en la tarjeta.
- **PGN** (`pgn.js`): varios archivos y partidas; propone al usuario (nombre más frecuente en White/Black, si está en ≥ la mitad); id `pgn:<sha256 24 hex>` del texto canónico.
- **Normalización** (`normalize.js`): ritmo con los cortes de Lichess (base + 40 × incremento: <30 s UltraBullet, <180 Bullet, <480 Blitz, <1500 Rápidas, <21600 Clásicas); descarta variantes y posiciones iniciales distintas; `userRatingFromGames` = último Elo del ritmo más jugado.
- **App**: Análisis y Stats leen IndexedDB. `USER_PROFILE` ya no existe: nombre del perfil (editor de avatar, por defecto «Jugador») y rating de las partidas importadas o `null`. Con `null`, Alfred recibe `Math.round(null) = 0` en `player.rating` (válido por el esquema; conviene que el contrato admita `null`) y Puzles muestra «(—)».
- **Borrar todas**: partidas, análisis y marcas de importación (no las cuentas vinculadas ni los puzles).
- **Pruebas**: `src/import/*.test.js` (fixtures reales recortados: ejemplo oficial de la API de Lichess, 3 partidas de jugador_demo, un mes real de Chess.com), `worker/proxy.test.js`, `scripts/e2e-import.cjs` (Playwright, respuestas simuladas; `--real`; `--worker`). Desde la nube no hubo red hacia lichess.org ni api.chess.com: falta una importación real desde la computadora del dueño.

## v1.1 — experiencia de partida (2026-11-02, rama `feat/game-experience`)

Cuatro pedidos del dueño para la pestaña **Entrenar**. Archivos: `App.jsx`, `ChessBoard.jsx`, `index.css`, `src/utils/sound.js`, `src/coach/useGameLoop.js`, `src/hooks/useChessClock.js` y nuevos `src/coach/summary.js` (+ test), `src/coach/useMoveLedger.js`, `src/components/GameSummary.jsx`, `src/utils/sound.test.js`, `scripts/e2e-game-experience.cjs`.

### 1. Elegir pieza al coronar
- Al llevar un peón a la última fila (clic-clic o arrastre) App no mueve: guarda `pendingPromotion` `{fen, from, to, color}` y `ChessBoard` dibuja `PromotionPicker` (props `promotion`, `onPromotionSelect`, `onPromotionCancel`): columna de 4 círculos (dama, caballo, torre, alfil, con las piezas del set y el color que corona) que sale de la casilla de coronación hacia el centro, en % del tablero (sirve en ambas orientaciones y a cualquier tamaño). Velo oscuro: clic fuera o **Esc** cancelan y la pieza queda en su casilla. El selector va atado al FEN: si la posición cambia (tiempo, abandono, deshacer) desaparece solo; mientras está abierto el tablero no acepta otras jugadas.
- La jugada entra con `promotion` elegido → chess.js da `lan` = `e7e8n`, que es lo que usan Alfred, la clasificación del panel y las estadísticas. Funciona en Entrenar, en el modo "Ver variante" y en el juego libre (la pestaña Análisis es de solo lectura). El rival ya coronaba lo que dice el motor. **Puzles** (`PuzzleTrainer`) tiene su propio manejo de jugadas y no se tocó (ver Pendiente).

### 2. Campanillas
- `playGameStartSound()` (dos notas ascendentes, 784 y 1175 Hz) al pulsar "Jugar contra…" y `playGameEndSound()` (tres descendentes, 1047, 784 y 523 Hz, más largas) cuando la partida pasa de "en juego" a "terminada" (mate, tablas, tiempo, abandono; efecto en App). Senos inarmónicos con caída exponencial (`bell`, `CHIMES` en `sound.js`), sin archivos (COEP). Respetan el botón de silencio. Si el contexto de audio está suspendido esperan a `resume()`.

### 3. Rey derrotado inclinado
- `ChessBoard` prop `defeatedKing` (`'w'|'b'|null`): el rey de ese color lleva `.king-defeated` → `rotate(-16deg)` desde la base, con transición de 0,7 s (`.king-tilt` en `index.css`; sin transición con `prefers-reduced-motion`). App lo pone solo en Entrenar, mostrando la posición final, si la partida terminó con ganador (mate, tiempo, abandono) o hay mate en juego libre. En tablas, en curso, navegando el historial o en revisión, ninguno. Deshacer un mate lo endereza.

### 4. Estadísticas de fin de partida
- **Lógica pura** `src/coach/summary.js`: `lineFromSans(startFen, sans)`, `moveKey`, `summarizeGame({ line, classifications, timeUsedMs, durationMs, result, playerColor, startColor })` → plies, jugadas (`fullMoves`), jugadas por color, conteo por color de las 6 etiquetas, pendientes, precisión por color (`gameAccuracy` de `accuracy.js`, fórmula de Lichess, solo con todas las jugadas clasificadas) y tiempos; `formatDuration`. Tests en `summary.test.js`.
- **Clasificar también al rival** (`useMoveLedger`): clasifica en segundo plano cada jugada de la línea con **exactamente** los mismos análisis (FEN, depth 15, MultiPV) que la app ya pide, así el `StockfishEngine` los da de la caché o los une al trabajo en curso: jugada del rival = posición previa (tras tu jugada, MultiPV 1, ya la piden Alfred y la evaluación en vivo) + posterior (tu turno: MultiPV 3 con Alfred, 1 sin él, como la evaluación en vivo); tu jugada = `analyzePlayerMove` con Alfred activo (misma etiqueta que él, con la confirmación a depth 18) o MultiPV 1 sin él. El hook se llama **después** de `usePositionAnalysis` para que sus peticiones se sumen a las de la evaluación en vivo. El rival juega en su propio worker: nada de esto lo frena. Deshacer cancela lo que ya no está en la línea; cambiar de partida cancela todo.
- **Tarjeta** `GameSummary.jsx`: al terminar aparece bajo el panel de la partida (el selector de rival pasa debajo): tiempo total de reloj (suma de los dos) y el real de inicio a fin, jugadas y plies, y por jugador: tiempo usado, jugadas, precisión y Mejor/Excelente/Buena/Imprecisión/Error/Error grave ("Analizando N jugadas…" mientras falte alguna). Tras "Nueva partida" queda el botón **"Estadísticas de la partida anterior"** hasta que empiece otra. App guarda una foto al terminar (`finishedGame`: FEN inicial, SAN, resultado, color, nivel, tiempo usado por bando con los ms de `useChessClock`, duración real); el tiempo de reloj no cuenta antes de tu primera jugada ni durante pausas o avisos del coach (así funciona el reloj).

### API para las frases del rival: `onRivalMoveClassified`
En `App.jsx` (busca "Enganche: jugada del RIVAL clasificada"): `onRivalMoveClassified(classification)` se llama **una vez por cada jugada del rival** de la partida de Entrenar en cuanto queda clasificada (≈ lo que tarda la evaluación de tu turno tras su jugada). Hoy guarda la última en el estado `lastRivalClassification` (también visible en `data-last-rival-label` / `data-last-rival-uci` del panel de la partida); quien haga las frases puede reaccionar ahí o pasar `lastRivalClassification` como prop. `classification` (`RivalMoveClassification`, JSDoc en `useMoveLedger.js`) = salida de `classifyMove` (`label`, `loss`, `winBefore/winAfter` del rival, `evalBefore/evalAfter` en perspectiva de blancas, `isBest`, `bestMoveUci/San`, `moveUci`, `moveSan`, `color`, `fenBefore/fenAfter`, `pvSan`, profundidades) + `key`, `gameId`, `ply`, `moveNumber`, `san`, `byRival: true`. No se llama para jugadas deshechas antes de clasificarse ni de partidas anteriores; un error dentro del callback se registra y no rompe nada.

### Otros cambios
- `useGameLoop.startGame(forcedColor?)` acepta el color del usuario (lo usa el gancho de pruebas); `useChessClock` devuelve también `ms: {w, b}`.
- App guarda `startFen` (estándar salvo en pruebas): navegar el historial y "Continuar partida" reconstruyen desde ahí.
- **Gancho de pruebas**: `window.__escaqueTest.startFromFen(fen, {color})` solo existe en el build `npm run build:e2e` (`--mode e2e`, salida `dist-e2e/`, ignorada por git y ESLint). En `npm run build` no está (comprobado: el bundle no contiene `__escaqueTest`).

### Verificación (2026-11-02, sandbox de 2 núcleos)
- `npm ci && npm test` → 25 archivos, **332 tests** en verde; `npx eslint . --max-warnings 0` limpio; `npx vite build` correcto.
- Contra `npx vite preview --port 4622` (build de producción): `e2e-tabs` 17 OK, `e2e-feel` 15 OK, `e2e-bars` 16 OK, `e2e-layout` y `e2e-alfred` correctos, sin errores de consola.
- `scripts/e2e-game-experience.cjs` (build de pruebas, 52 comprobaciones OK): coronar a caballo con clic-clic y arrastre, blancas abajo y tablero girado (selector sobre la casilla, el tablero muestra el caballo y el analista busca la posición con caballo, no con dama); Esc y clic fuera cancelan; campanillas: se crean los osciladores de inicio (784/1175 Hz) y fin (1047/784/523 Hz) y con silencio ninguno; rey perdedor a −16° (transform computado) tras mate y abandono, el ganador recto, ninguno en ahogado ni en curso, transición visible a mitad y sin transición con reducir movimiento; tarjeta tras 4 jugadas + abandono: 4 jugadas / 8 plies / 4 por color, conteos por color = jugadas, precisión de ambos y total = suma de los relojes; reaparece tras "Nueva partida" y desaparece al empezar otra; **0 búsquedas duplicadas** del analista; 0 errores de consola.
- **Tiempo de respuesta del rival** (nivel 1, retardo visible fijado con `Math.random = 0.5`, 10 jugadas guionizadas) contra el build de `main`: con Alfred 1086 vs 1070 ms y 1340 vs 1267 ms de mediana en dos ejecuciones (ruido del sandbox: la otra varía igual); sin Alfred 1062 vs 1060 y 1117 vs 1094 ms. Búsquedas del analista en la misma partida: 22–23 vs 23 (con Alfred) y 21 vs 21 (sin Alfred): clasificar al rival no añade ninguna.

### Pendiente
- Puzles: `PuzzleTrainer` no usa el selector; corona con la pieza de la solución si la jugada coincide y si no, dama. Se puede enganchar el mismo `PromotionPicker` (props de `ChessBoard`) cuando se toque esa pantalla.
- Resumen narrado (T10): los 3 momentos clave y el texto del coach sobre `summarizeGame`.
- Integrar las frases del rival con `onRivalMoveClassified` (otro agente).

## v1.1 — personalidades de los rivales

Rama `feat/rival-personalities` (sobre `main` b4a9500). Pedido del dueño: cada rival tiene su personalidad y **habla**: una frase al empezar, cuando hace una buena jugada, cuando cometes un error y al ganar, perder o empatar. Más personal y divertido, **sin molestar**.

### Rivales y su voz

| Nivel | Rival | Rasgo de su voz | Ejemplo |
|---|---|---|---|
| 1 | Ícaro | impulsivo y fanfarrón; se derrumba en cuanto algo sale mal | «Se derritió la cera. Otra vez. Bien jugado.» |
| 2 | Narciso | vanidoso: se admira más que al tablero | «¿Perdí? Seguro que fue la iluminación.» |
| 3 | Perseo | aprendiz con suerte de héroe: entusiasta y humilde | «¿{move} fue buena? ¡Lo sabía! Bueno, lo intuía.» |
| 4 | Jasón | aventurero: cada partida es una travesía | «¡Tierra a la vista! Mi plan va viento en popa.» |
| 5 | Teseo | metódico de laberintos, con el hilo de Ariadna | «Esa ruta tiene una pared al final, me temo.» |
| 6 | Héctor | noble y firme, respeta al rival | «Caen las murallas. Lo acepto con honor.» |
| 7 | Odiseo | astuto y burlón (con cariño): siempre insinúa una trampa | «Me llaman Nadie. Recuérdalo cuando te pregunten quién te ganó.» |
| 8 | Aquiles | orgulloso e implacable | «¿Cómo…? Encontraste mi talón. Bien jugado.» |
| 9 | Heracles | fuerza bruta y bravuconería alegre | «Calenté levantando un toro. Ya estoy listo.» |
| 10 | Atenea | serena y sabia: cada momento es una lección | «Te apresuraste. La lechuza nunca se apresura.» |

Frases originales en español neutro (tuteo), ≤ 90 caracteres, humor amable sin insultos; 5 por evento obligatorio y 4 de elogio por rival (390 en total, ninguna repetida).

### Eventos

| Evento | Cuándo | Probabilidad |
|---|---|---|
| `game_start` | al empezar la partida | siempre |
| `rival_good_move` | su jugada es Mejor/Excelente y queda con Win% ≥ 65 (o ≥ 55 si es captura/jaque) | 35 % |
| `player_mistake` | tu jugada es Error (Mistake) | 50 % |
| `player_blunder` | tu jugada es Error grave (Blunder) | siempre (*) |
| `player_good_move` | tu jugada es Mejor/Excelente (elogio) | 10 % (60 % si el coach la marca como gran jugada) |
| `rival_wins` / `rival_loses` / `draw` | fin de partida (mate, tablas, tiempo o abandono; frases válidas para cualquier motivo) | siempre |

(*) "Casi siempre" en la práctica: el cooldown y la regla del coach lo filtran. Se dejó en 1 para que la prueba en el navegador sea determinista; si se prefiere 0,9, cambiar `PROBABILITIES.player_blunder`.

### Reglas de frecuencia (`src/rivals/voice.js`)
- **Cooldown** (`COOLDOWN`): ≥ 4 s desde la última frase y, además, ≥ 3 jugadas (plies) o ≥ 15 s. El saludo y el fin de partida lo ignoran.
- **Prioridad** (`PRIORITY`): los eventos que llegan casi a la vez (ventana de 350 ms, `COALESCE_MS`) se resuelven con uno solo: fin de partida > error grave > buena jugada del rival > error > saludo > elogio. Si el elegido no pasa su probabilidad, no habla otro en su lugar.
- **Sin repetir**: ninguna frase se repite en la misma partida; si se agotan las de un evento, calla.
- **No compite con el coach**: el comentario sobre tu jugada queda pendiente mientras el coach la analiza o te detiene (`coach.rivalBlocked`). Con **Seguir** el rival comenta; con **Retroceder** (o Deshacer, o navegar atrás) la jugada desaparece y no la comenta. Una jugada ya comentada no se vuelve a comentar al navegar.
- El globo se muestra 4–8 s (según la longitud, `displayMs`), se cierra con un clic y se oculta si deshaces la jugada que comentaba, al salir de Entrenar o al empezar otra partida.

### Dónde está cada cosa
- **Frases**: `src/rivals/personalities.js` (`PERSONALITIES`, una entrada por nivel con `trait` y `lines` por evento). Variable segura: `{move}` (SAN inglés; en `rival_good_move` la jugada del rival, en `player_*` la tuya); cada evento tiene frases sin `{move}`. Los tests validan longitud, cobertura, duplicados y variables.
- **Lógica pura**: `src/rivals/voice.js` (`decide`, `createVoiceController`, `gatePlayerMove`, `isRivalGoodMove`, `createRng` para semilla, constantes de arriba).
- **Hook**: `src/rivals/useRivalVoice.js` → `{ speech, dismiss, voiceOn, setVoiceOn, notifyRivalMove }`. Preferencia **"El rival habla: sí/no"** en `localStorage` (`escaque:rival-voice` = `on`/`off`, con try/catch), interruptor en `LevelSelector.jsx`. Silenciado, el rival no muestra nada (ni saludo ni fin).
- **UI**: `src/components/RivalSpeech.jsx`, alojado por `PlayerBar.jsx` (prop `speech`). En las barras encima/debajo del tablero flota a la derecha del avatar (máx. 3 líneas; solo puede asomar sobre el marco, nunca sobre las casillas); en la columna lateral (estilo lichess) va bajo el nombre. `role="status"` + `aria-live="polite"`, colores claro/oscuro, animación `.rival-speech-in/out` en `index.css` (sin animación con "reducir movimiento").
- **Enganche en `App.jsx`** (a fusionar con la rama dueña de App): imports (l. 40–41); llamada a `useRivalVoice` tras `lastMoveClassification` (l. 308–315: partida, resultado, historial, clasificación de tu jugada desde `coach.view` o, sin coach, desde la clasificación de App, y `coachHolding: coach.rivalBlocked`); `speech` en `playerBarProps` para la barra del rival (l. 502, 519, 534); `rivalVoiceOn`/`onRivalVoiceChange` en `LevelSelector` (l. 778–779).

### Pendiente
- **`rival_good_move` sin conectar**: falta la clasificación de las jugadas del rival, que expondrá la otra rama como `onRivalMoveClassified(classification)` (salida de `classifyMove` para SU jugada). Al fusionar: `onRivalMoveClassified: rivalVoice.notifyRivalMove` (TODO en `App.jsx` l. 309 y en `useRivalVoice.js`). Ya probado en `voice.test.js`. Solo cuenta si esa jugada sigue siendo la última del tablero.
- Frases por motivo de final (p. ej. una de mate y otra de tiempo) si el dueño lo quiere; hoy son válidas para cualquier motivo.
- Que el dueño revise el tono de las frases y ajuste probabilidades tras jugar unas partidas.

Pruebas: `src/rivals/{personalities,voice,prefs}.test.js` (37 tests) y `node scripts/e2e-rival-voice.cjs http://localhost:4623/ [capturas]` con `npx vite preview --port 4623`: saludo de Ícaro, globo sin tapar casillas (escritorio y móvil 390 px, claro y oscuro), clic cierra, silencio mientras el coach detiene, nada tras Retroceder, comentario tras Seguir, frase de fin al abandonar, "El rival habla: no" sin globos y recordado al recargar, 0 errores de consola.

## 4. IA opcional con la clave del usuario (arquitectura desde 2026-11-02)

**Decisión del dueño**: Escaque no paga ni aloja ningún LLM. El coach con plantillas es la experiencia por defecto y es idéntica sin clave (0 peticiones de red a proveedores). Quien quiera comentarios redactados por un modelo pone **su propia clave** en Entrenar → engranaje del coach → **IA (opcional)**.

- **Dónde vive cada cosa**
  - `src/llm/`: interfaz común (`provider.js`: `generateStructured`, `PROVIDERS`, `createProvider`, `configProblem`, `testConnection`), adaptadores `gemini.js`, `openai.js` (OpenAI, OpenRouter y "compatible con OpenAI" con URL base), `anthropic.js`, utilidades `http.js` (timeout, cancelación, errores HTTP, parseo robusto de JSON) y `errors.js` (`LlmError` + mensajes claros).
  - `src/llm/settings.js`: proveedor, modelo, URL base y clave. La clave se guarda solo en el navegador (`localStorage`, clave `escaque:ia`, con try/catch) o solo en memoria con "no recordar"; "Borrar clave" la elimina y vuelve a plantillas.
  - `shared/coach-contract/prompt.es.js` (system prompt con las voces de Alfred, Kairós y Ariadna; `PROMPT_VERSION`) y `validateOutput.js` (§5.3): antes en el Worker, ahora en el navegador. **Ninguna respuesta del LLM se muestra sin pasar la validación**; si falla, plantilla.
  - `src/coach/coachClient.js`: sin clave devuelve `no_key` sin red; con clave arma prompt + hechos, llama al adaptador, valida, cachea (memoria + `sessionStorage`, clave con proveedor y modelo). Una petición en vuelo, timeout 4,5 s, máx. 30 llamadas por partida (`useCoach`). Clave rechazada / sin saldo / modelo inexistente / petición rechazada → plantillas hasta que el usuario cambie la configuración; 429/5xx → pausa ≥ 60 s; red/CORS/timeout → "sin conexión".
  - `src/components/AiSettings.jsx` (dentro de las preferencias de `CoachPanel`): proveedor, modelo (vacío = el barato por defecto), URL base (solo "compatible"), clave, "Recordar en este equipo", **Probar conexión** (llamada mínima con salida estructurada), **Guardar y activar**, **Borrar clave**, estado "Plantillas (sin IA)" / "IA activa · proveedor · modelo" (plegable desde la v1.1, §4b) y el texto sobre privacidad y costos. Los mensajes del coach llevan el indicador discreto **IA** / **plantilla** (`data-testid=coach-source`).

- **Proveedores (verificado en la documentación oficial el 2026-11-02)**

| Proveedor | Endpoint | Autenticación | CORS desde el navegador | Modelo por defecto | Salida estructurada |
|---|---|---|---|---|---|
| Google Gemini | `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | `x-goog-api-key` | Sí: el SDK oficial `@google/genai` documenta uso en navegador (con advertencia de exponer claves). No se pudo comprobar en vivo desde la nube (dominio bloqueado). | `gemini-3.5-flash-lite` | `generationConfig.responseMimeType` + `responseJsonSchema`; `thinkingConfig.thinkingLevel: minimal` |
| OpenAI | `POST https://api.openai.com/v1/chat/completions` | `Authorization: Bearer` | Sí (uso habitual; las caídas de CORS de oct-2025 y ene-2026 se trataron como bugs y se corrigieron) | `gpt-6-luna` | `response_format: json_schema` (strict), `max_completion_tokens`, `reasoning_effort: none` |
| Anthropic | `POST https://api.anthropic.com/v1/messages` | `x-api-key` + `anthropic-version: 2023-06-01` | Sí, con `anthropic-dangerous-direct-browser-access: true` (**comprobado en vivo**: con ella responde `access-control-allow-origin: *`, también en 401; sin ella, no) | `claude-haiku-5-5` | `output_config.format` (json_schema, sin `maxItems`: se valida en el cliente), `effort: low`, `thinking: disabled` en Haiku 5.5 |
| OpenRouter | `POST https://openrouter.ai/api/v1/chat/completions` | `Authorization: Bearer` | Sí (su guía OAuth PKCE indica guardar la clave en el navegador y llamar con `fetch`) | `google/gemini-3.5-flash-lite` | `response_format: json_schema` (strict) + `provider.require_parameters: true` |
| Compatible con OpenAI | `{URL base}/chat/completions` (p. ej. `http://localhost:11434/v1`) | `Bearer` opcional | Depende del servidor (Ollama: `OLLAMA_ORIGINS`; LM Studio: "Enable CORS") | — (obligatorio) | `json_schema` + schema en el system prompt + parseo tolerante (```json, texto alrededor) |

  Como todos aceptan CORS, **no hizo falta el reenvío por el Worker** (`/api/llm-proxy/*`); no existe.

- **COEP**: `require-corp` no bloquea `fetch` en modo CORS a otros orígenes si el servidor responde con CORS (CORP solo se exige a peticiones `no-cors`). Comprobado con Playwright contra `vite preview` (página `crossOriginIsolated`): servidor local en otro puerto con CORS → 200; sin cabeceras CORS → `TypeError` (bloqueo CORS, no COEP); y llamada real a `api.anthropic.com` con clave inválida → 401 leído y mostrado como "clave no válida".

- **Pruebas**: `npm test` incluye `src/llm/providers.test.js` (petición exacta, cabeceras, parseo y errores por proveedor), `src/llm/settings.test.js` (recordar / no recordar / borrar / almacenamiento roto), `src/coach/coachClient.test.js` (sin clave = 0 red, validación, caché, errores) y `shared/coach-contract/validateOutput.test.js` (§5.3). En el navegador: `node scripts/e2e-byok.cjs http://localhost:4173/` con `npx vite preview` (17 comprobaciones; con `E2E_REAL_ANTHROPIC=1` añade la llamada real a Anthropic).

- **Pendiente**: probar con claves reales de cada proveedor (sobre todo Gemini, cuyo CORS no se pudo comprobar en vivo) y medir latencia p50/p95 frente al timeout de 4,5 s; si algún modelo por defecto pasa del timeout con frecuencia, cambiarlo en `PROVIDERS` (`src/llm/provider.js`).

## 4b. v1.1 — coach e IA (2026-11-02, rama `feat/coach-ux`)

Pedidos del dueño tras probar la v1 con su clave de Gemini. Qué cambió y dónde:

| Pedido | Qué hace ahora | Dónde |
|---|---|---|
| 1. Panel de IA plegable | Al **Guardar y activar** se pliega solo; queda la línea "IA activa · Gemini · gemini-3.5-flash-lite" (o "Plantillas (sin IA)") + el consumo de la partida. Botón con `aria-expanded` para desplegar/plegar; el estado se recuerda (`escaque:ia-panel`). | `src/components/AiSettings.jsx`, `readAiPanelOpen`/`writeAiPanelOpen` y `aiStatusText` en `src/llm/settings.js`, `shortLabel` en `PROVIDERS` |
| 2. Sin parpadeo plantilla→IA | Si la jugada va a la IA, el coach muestra "pensando" (avatar `pensando`, `data-testid=coach-thinking`) hasta que llega el texto validado o falla/vence el plazo (4,5 s); solo entonces habla. Retroceder/Seguir ya están disponibles; "¿Por qué?" espera. Sin IA, plantilla al instante. Igual en pistas. | `src/coach/textChoice.js` (`pickText`), `feedbackView`/`hintView` en `useCoach.js`, `CoachPanel.jsx` |
| 3. Alternar IA ↔ plantilla | Ambas versiones existen para la misma jugada; botón ⇄ (`data-testid=coach-source-toggle`, con `aria-label`) junto al indicador IA/plantilla, en el comentario, el "¿Por qué?" y las pistas. Se recuerda la última vista (`escaque:coach-view`). Con vista "plantilla" no se espera a la IA (llega como alternativa). | `textChoice.js`, `SourceToggle` en `CoachPanel.jsx` |
| 4. "¿Por qué?" útil | Línea de refutación **de Stockfish** (PV de `fenAfter` a depth 15/18, alargada a depth 12 si < 4 plies; corte entre 4 y 8 plies en un punto tranquilo o en el mate) en SAN numerada ("4…Qg5 5.Nxf7 Qxg2"), mini tablero de solo lectura con flechas y ⏮ ◀ ▶ ⏭, y explicación nueva: mecanismo (ataque doble, jaque con ataque, captura, mate), qué gana el rival al final de la línea (material neto o mate) y una idea práctica; ya no repite el comentario. Con IA: `refutationLine` + hechos en la petición (contrato y prompt actualizados; sus jugadas/casillas entran en `allowedMoves`/`allowedSquares` y `validateOutput` también revisa `why`); si la IA falla o repite el comentario (`isRepetition`), queda la plantilla. | `src/coach/refutationLine.js`, `refutationLineFor` en `coachPipeline.js`, `whyTemplate` en `templates.js`, `src/components/MiniBoard.jsx` (piezas `PieceIcon` de `ChessPiece`, sin tocar `ChessBoard`/`ChessPiece`), `buildMoveRequest({ line })`, `request.schema.json` (`refutationLine`, `policy.explainWhy`), `feedback.schema.json` (`why`) |
| 5. Consumo de tokens | Registro por solicitud (tipo, tokens del proveedor —incluidos los de caché—, latencia, tamaño estimado de system y hechos) y resumen "Esta partida: N solicitudes · X tokens de entrada · Y de salida · ≈ costo (aprox.)" con detalle. Optimización: prompt v3 (~40 % más corto, mismas reglas), hechos compactos, salida reducida, "¿Por qué?" del error en la misma llamada, sin llamada al corregir tras Retroceder. Entrada estimada por solicitud −32 % a −44 %; partida típica 12 → 9 solicitudes, ≈ 18,4k → 8,5k tokens de entrada, ≈ 0,009 → 0,0047 USD. Caché implícita de Gemini: no aplica (mínimo 2.048–4.096 tokens; Flash-Lite no figura). Detalle en [COACH_DESIGN.md §7.8](COACH_DESIGN.md). | `src/llm/usage.js`, `src/llm/pricing.js`, adaptadores (`cachedTokens`), `CoachClient`, `shared/coach-contract/{prompt.es.js,compact.js,llmOutput.js}`, `tokenBudget.test.js` |

- **Política intacta**: interrumpe en errores y errores graves (no con Win% ≥ 80, `stillWinning`), máx. 30 llamadas por partida, sin IA todo igual y 0 peticiones de red.
- **App.jsx no se tocó**: todo entra por el objeto `coach` que ya recibía `CoachPanel` (`usage`, `preferredSource`, `setPreferredSource`, `view.state: 'thinking'`, `view.why`, `view.whyLine`).
- **Corrección incluida**: tras Retroceder, un segundo error desde la misma posición también se comenta con la IA (antes se mostraba la plantilla).
- **Caché del cliente**: prefijo `escaque:coach:v3:` y `PROMPT_VERSION = coach-es-v3` (las respuestas de v2 no se reutilizan).
- **Pruebas**: `npm test` añade `refutationLine.test.js`, `textChoice.test.js`, `src/llm/usage.test.js`, `shared/coach-contract/compact.test.js` y `tokenBudget.test.js`. `scripts/e2e-byok.cjs` (adaptado) comprueba con Gemini simulado y 1,5 s de retraso que durante la espera el DOM está en "pensando" y nunca muestra la plantilla antes que la IA, el selector IA/plantilla, el "¿Por qué?" en la misma llamada con la línea y el mini tablero avanzando, el consumo en el panel, el panel plegable y 0 errores de consola.
- **Pendiente**: que el dueño juegue una partida con su clave y compare el panel de consumo con la estimación de §7.8 (y si Gemini cuenta el schema como entrada); medir latencia real de la respuesta con `why` (sale algo más larga) frente al timeout de 4,5 s.

## 5. Qué se quitó del servidor

- `POST /api/coach`, el tope de gasto (`worker/budget.js`, KV `COACH_KV`), el límite por IP (`worker/ratelimit.js`), `worker/llm/*` (Gemini y simulador), `worker/coach.js` y sus tests.
- De `wrangler.jsonc`: `vars` (`LLM_PROVIDER`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `COACH_MONTHLY_BUDGET_USD`, `COACH_DAILY_CAP`, `ALLOWED_ORIGIN`) y `kv_namespaces`. Se eliminó `.dev.vars.example` (ya no hay secretos).
- `GET /api/health` responde solo `{ ok, version }`. El Worker sigue sirviendo los assets con COOP/COEP (`public/_headers` + cabeceras propias en `/api`). `wrangler deploy --dry-run`: ≈ 2,6 KiB, único binding `ASSETS`.

## 6. Decisiones tomadas por defecto (revisables)

Respuestas a las "preguntas para el dueño" del diseño que se asumieron para avanzar:

| Pregunta | Decisión aplicada | Dónde cambiarla |
|---|---|---|
| Nombre del coach | **Alfred** | `COACH_NAME` en `shared/coach-contract/index.js` (UI y prompt) |
| Costo | **0 para Escaque**: el usuario paga su IA (opcional) | `src/llm/` |
| Interrupciones | Solo errores y errores graves (configurable en el panel) | `INTERRUPT_MODES` en `useCoach.js` |
| Notación | SAN en inglés con figuras (♘xe5) | `figurine()` en `templates.js` |
| Etiquetas | Traducidas en la UI (Mejor, Excelente, Buena, Imprecisión, Error, Error grave) | `LABEL_ES` en `templates.js` |
| Rating | Último Elo del ritmo más jugado en las partidas importadas (`null` si no hay) | `userRatingFromGames` en `src/import/normalize.js` |
| Lenguaje | JS + JSDoc | — |
| Proveedor | El que elija el usuario (Gemini, OpenAI, Anthropic, OpenRouter, compatible), REST con `fetch` desde el navegador, sin SDK | `src/llm/provider.js` |
| System prompt | En `shared/coach-contract/prompt.es.js` (se arma en el navegador) | — |

## 7. Archivos nuevos o cambiados

- `shared/coach-contract/`: `request.schema.json`, `feedback.schema.json`, `summary.schema.json`, `validate.js` (validador sin dependencias), `index.js` (constantes: versión de prompt, nombre, límites), `fixtures/` (ejemplos §6.2 y §6.3, para T12).
- `src/coach/`: `buildRequest.js`, `coachPipeline.js`, `opening.js`, `templates.js`, `coachClient.js`, `useCoach.js` + tests (`buildRequest.test.js`, `coachUi.test.js`).
- `src/components/`: `CoachPanel.jsx`, `MoveBadge.jsx`, `AlfredAvatar.jsx`; `ChessBoard.jsx` admite `extraArrows`.
- `src/App.jsx`: conexión de Alfred (retención de la jugada del rival, reloj, MultiPV 3 en tu turno, mejor jugada oculta).
- `worker/`: (histórico, retirado el 2026-11-02, ver §5) `coach.js`, `budget.js`, `ratelimit.js`, `llm/*`; `validate.js` y `prompts/system.es.js` pasaron a `shared/coach-contract/`. Hoy: `index.js` (`/api/health` + COOP/COEP) y su test.
- `wrangler.jsonc`: assets + `observability` (sin `vars` ni KV).
- IA opcional (2026-11-02): `src/llm/*`, `src/components/AiSettings.jsx`, `shared/coach-contract/{prompt.es.js,validateOutput.js}`, `scripts/e2e-byok.cjs`.
- `.dev.vars.example`: `LLM_PROVIDER=fake` y `ALLOWED_ORIGIN` para Vite (5173 y 4173).
- `scripts/e2e-alfred.cjs`: prueba de punta a punta de Alfred; `scripts/e2e-tabs.cjs`: arrastre, cambio de pestaña y abandono; `scripts/e2e-layout.cjs`: tamaño del tablero con zoom; `scripts/e2e-bars.cjs`: barras de jugador; `scripts/e2e-feel.cjs`: personajes, animación y sonido; `scripts/e2e-avatars.cjs`: avatares; `scripts/e2e-puzzles.cjs`: puzles.
- `src/hooks/useChessClock.js`: reloj de la partida y cuenta atrás de abandono.

## 8. Cómo probar

Sin clave (experiencia por defecto): `npm run dev` o `npm run build && npx vite preview`, pestaña **Entrenar**. Todo lo que dice el coach es plantilla y no hay peticiones a proveedores de IA.

Con IA: engranaje del coach → **IA (opcional)** → proveedor, clave, **Probar conexión**, **Guardar y activar**.

Pruebas automáticas en el navegador (Playwright con Chromium; con `npx vite preview --port 4173` corriendo):
```bash
node scripts/e2e-alfred.cjs
```
```bash
node scripts/e2e-byok.cjs
```
`e2e-alfred.cjs`: pistas 1–3, error grave, el rival espera, "¿Por qué?", Retroceder + felicitación, Seguir, 0 peticiones a otros orígenes. `e2e-byok.cjs`: ver §4.

## 8b. Integración de la v1.1 (rama `release/v1.1`, 2026-11-02)

Orden: `feat/game-experience` → `feat/rival-personalities` → `feat/coach-ux`.
- **Enganche rival ↔ clasificación**: en `App.jsx`, `onRivalMoveClassified` (de `useMoveLedger`) llama a `rivalVoice.notifyRivalMove`, así el rival presume de sus buenas jugadas (`isRivalGoodMove` en `src/rivals/voice.js`). El interruptor «El rival habla» va en `levelSelectorPanel`.
- **Arreglo de la integración**: en la disposición en columna (pantallas bajas y anchas, p. ej. el portátil del dueño a 1004×508) el globo del rival ocupaba sitio y empujaba tu barra por debajo del tablero; ahora flota (`RivalSpeech`, contenedor de altura 0 con el globo absoluto) y tu barra queda alineada con el borde inferior.
- **Verificación**: 409 tests; lint y build limpios; Playwright contra el build: e2e-alfred, e2e-byok (28/28), e2e-rival-voice, e2e-import, e2e-puzzles, e2e-tabs, e2e-layout, e2e-bars, e2e-feel, e2e-avatars y e2e-game-experience (build `npm run build:e2e`): todos correctos, 0 errores de consola.

## 8c. Idiomas: español e inglés (rama `feat/i18n`, 2026-11-02)

Plan, decisiones y detalle de cada parte en **[docs/I18N.md](I18N.md)** (lista de casillas: es el punto de retorno).
- **Cómo funciona**: `src/i18n/` (sin dependencias). Idioma = elección del menú (`escaque:lang` en localStorage) o, en Automático, el primero de `navigator.languages` que empiece por `es`/`en`; si ninguno, inglés. `useI18n()` da `{ t, lang }`; fuera de React, `getT(lang)`. Plurales `{ one, other }` con `Intl.PluralRules`; números, fechas y duraciones con `Intl`.
- **Patrón**: lo que se guarda en el estado son **claves o datos**, no textos, y se traduce al pintar (coach, puzles, globo del rival, mensajes de importación, resultado de la partida). Por eso cambiar de idioma traduce al momento lo que ya se ve. Los datos guardados (IndexedDB, localStorage) no cambian de formato.
- **Qué hay en cada idioma**: interfaz, coach (plantillas, voces de Alfred/Kairós/Ariadna y prompt de la IA `prompt.en.js`, `PROMPT_VERSION` = `coach-v4`), 390 frases de rivales (`personalities.en.js`, mismos índices y `{move}` en el mismo sitio), puzles y generador, Mis partidas (errores de importación con `textKey`), Análisis/Stats, `licenses.html`.
- **No se traduce**: nombres propios (Escaque, coaches, rivales), notación SAN (inglés en ambos idiomas) y las etiquetas técnicas Best/Mistake… del panel clásico.
- **Reglas al tocar textos**: toda clave nueva va en `es.js` **y** `en.js` con las mismas variables; si cambias una frase de rival en español, adapta la inglesa en el mismo índice; si cambias `licencias.html`, cambia `licenses.html`. Los tests lo vigilan: `src/i18n/i18n.test.js` (paridad, claves usadas en el código, sin español en `en.js`) y `src/rivals/personalities.test.js` (paridad de frases).
- **Pruebas**: `scripts/e2e-i18n.cjs` (navegador en/es/fr, selector que se recuerda, barrido de pestañas en inglés buscando texto en español), `e2e-rival-voice-en.cjs`, y secciones en inglés dentro de `e2e-puzzles.cjs` (7b) y `e2e-import.cjs` (8b). El resto de e2e fija `locale: 'es-ES'`.
- **Verificación**: 445 tests unitarios; lint y build limpios; todos los e2e con Playwright pasan (alfred, avatars, bars, byok 28/28, feel, layout, tabs, i18n, import, puzzles, rival-voice, rival-voice-en y game-experience), 0 errores de consola. Pendiente: PR de `feat/i18n` a `main` cuando el dueño lo pida.

## 9. Siguientes pasos sugeridos

1. Jugar con la clave real y comparar el panel de consumo con la estimación (§4b y COACH_DESIGN §7.8); medir la latencia de la respuesta con `why` frente al timeout de 4,5 s.
2. Revisar el tono y las probabilidades de las frases de los rivales tras unas partidas (`src/rivals/`).
3. **T10**: resumen narrado de fin de partida. Ya existen las estadísticas (`src/coach/summary.js`, `GameSummary.jsx`, v1.1); `validateOutput` ya valida `game_summary`; faltan los 3 momentos clave y el texto del coach.
4. **T12**: arnés de evaluación de prompts con los fixtures de `shared/coach-contract/fixtures/` (+18 más).
5. **T11**: calibración de niveles del rival.
6. Mejoras: respuesta a la pregunta abierta de `stillWinning` (§4.2 del diseño).


## P1 · Partidas de Entrenar guardadas (2026-11-02)

- `src/storage/trainingGame.js` construye un registro Game `source: escaque`, PGN con rival/nivel/color/ritmo/resultado/terminación y tiempos, y datos por ply. Reutiliza el ledger y los registros del coach; no pide búsquedas. Los datos pendientes quedan en null y se completan mientras llegue el ledger de esa sesión.
- IndexedDB v2 añade `moves`, keyPath `gameId`, con `{ gameId, moves: [...] }`. Se eligió almacén propio para separar la telemetría del entrenamiento del contrato de análisis de partidas importadas. `saveTrainingGame` escribe Game y moves en una transacción; la migración conserva v1. `clearAllGames` elimina también moves y conserva puzles y preferencias como antes.
- App captura identidad/nombre/rival/ritmo al inicio y la foto final al terminar. Guarda inmediatamente y actualiza la misma clave con las clasificaciones existentes; el identificador UUID evita colisiones entre sesiones/pestañas. Las escrituras se serializan; borrar invalida las encoladas. Un mate/tablas deshechos retira el registro terminado y el mismo id se reutiliza al finalizar de nuevo. Si falla IndexedDB se ofrece reintentar.
- `useCoach` expone sus registros y cuenta pistas/retrocesos por posición. La línea final guarda sus interacciones; `Game.retractedMoves` conserva los intentos que el coach retiró, con su clasificación, sin mezclarlos con los plies del PGN. Sin jugadas no se guarda nada. Mis partidas ya usa `data-testid=game-row`; fuente Escaque traducida en es/en.
- Verificación: tests de construcción, migración v1→v2, escritura atómica y borrado/notificaciones; `scripts/e2e-training-save.cjs` prueba persistencia y navegación en ambos idiomas.

P1: verificados `npm ci`, 470 tests (36 archivos), ESLint estricto y build. E2E de guardado aprobado en es/escritorio bajo/claro y en/móvil/oscuro: incluye clasificaciones completas, deshacer/repetir mate, recarga, borrado y pistas. Análisis reconstruye desde el FEN inicial del PGN.

## P5 · Repaso espaciado de puzles fallados

`src/puzzles/review.js` implementa Leitner simplificado con fecha inyectada: tras un fallo, 1 día; al resolver sin fallar, 3, 7, 14, 30 y 60 días (tope). Otro fallo reinicia a 1 día. Se elige frente a SM-2 porque solo tenemos acierto/fallo, no una puntuación subjetiva de dificultad. Los días son intervalos de 24 h para evitar cambios de horario.

El mapa `reviews` (`box`, `dueAt` por id) amplía el progreso existente en `escaque:puzzles`; se conserva localStorage por ser una ampliación pequeña del historial ya existente, sin migrar ni duplicar sus resultados. Los fallos antiguos se consideran pendientes desde el día siguiente a su fecha; la migración de ids antiguos también alcanza `reviews`. Elo, rachas y resultado original siguen contando solo el primer intento. `PuzzleTrainer` registra los fallos y aciertos de cada intento, incluye «Repaso de hoy» con cola independiente de los filtros y elimina de ella los puzles borrados. Saltar no marca acierto ni cambia la fecha. El contador se actualiza cada minuto. Tests en `review.test.js`; atributos `puzzle-review*` para navegador.

## P6. Coronación en Puzles (2026-11-02)

`PuzzleTrainer.jsx` reutiliza el `PromotionPicker` de `ChessBoard` para clic y arrastre: la posición no cambia hasta elegir; Esc/clic fuera cancela. El selector está ligado al id, FEN y paso del puzle y se descarta al reiniciar o revelar. `checkMove` exige la pieza exacta de la solución para coronaciones, incluso si otra pieza también da mate; no deduce una pieza omitida. El Elo sigue usando el primer resultado existente. Sin textos ni dependencias nuevos. Tests de blancas/negras, capturas, subcoronaciones y pasos intermedios en `puzzleLogic.test.js`. `scripts/e2e-puzzle-promotion.cjs` cubre cancelación con Esc/clic fuera, pieza incorrecta, subcoronación, Elo y ausencia de overflow en es/claro/1004×508 y en/oscuro/390 px.

## P2 · Métricas de progreso (2026-11-02)

`src/progress/metrics.js` recibe snapshots de games/analysis/moves y filtros; no accede al motor ni a IndexedDB. Reutiliza clasificaciones locales o deriva las importadas de scores/bestMoves guardados con classifyMove y accuracy.js. Mantiene huecos sin evaluación y muestra cobertura; las tasas por fase usan solo jugadas clasificadas. Calcula media móvil de diez partidas, aperturas separadas por color, conversión (posiciones Win% ≥80, solo resultados terminados), relojes PGN y tres debilidades con evidencia por gameId/ply. Puntuación = frecuencia × gravedad media (1/2/4) × recencia con semivida de 30 días. Los motivos solo se infieren en errores con respuesta legal conocida; el resto queda desconocido. Los relojes son tiempo restante tras la jugada, según la convención PGN.

`loadData.js` lee un snapshot consistente en una transacción y descarta derivados huérfanos, sin generar análisis. Esta rama depende de P1 (IndexedDB v2 y movimientos guardados); P3 consumirá estos módulos. Tests deterministas cubren filtros, negras, datos vacíos/parciales, aperturas, conversión, relojes y ranking.


## P3 · Pantalla Progreso (2026-11-02)

Progreso (`nav-progress`) sustituye Stats y conserva resultados y Elo filtrables por ritmo. `ProgressScreen.jsx` pinta las tarjetas, filtros y cobertura con textos es/en. `useProgressData` recarga el snapshot al guardar/borrar o completar generación; `useProgressMetrics` calcula en un Worker dedicado (`metrics.worker.js`), cancelándolo cuando cambian filtros/datos o se desmonta la pantalla. Los vacíos ofrecen jugar/importar y los análisis pendientes llevan al generador existente en Puzles, sin iniciar búsquedas por sorpresa. Tasas y precisión explicitan su cobertura; todos los filtros y tarjetas tienen data-testid. Los e2e que navegaban a Stats se actualizan a Progreso. Rama encadenada sobre P2/P1.

## P4 · Plan de entrenamiento (2026-11-02)

`src/progress/plan.js` genera hasta tres acciones deterministas a partir de las debilidades filtradas de P2, sin IA ni análisis nuevo. Solo enlaza a puzles existentes del motivo y partidas de la evidencia; las revisiones apuntan a errores graves concretos y muestran botones para cada objetivo. La práctica de apertura exige errores en al menos tres partidas con el mismo nombre/color y selecciona Héctor/nivel6 y el color; no fuerza una línea de apertura. Se deduplican revisiones equivalentes. Sin análisis/evidencia no recomienda acciones.

`TrainingPlan` traduce las plantillas en es/en. App conecta navegación, posición exacta en Análisis y preselección de Entrenar (protege la partida activa). PuzzleTrainer recibe `initialTarget` y limita la sesión a los ids y motivo recomendados; volver desde el menú abre la biblioteca completa. El snapshot derivado de P2 conserva nombres de apertura reconocidos sin mutar los registros originales. Rama encadenada sobre P3/P2/P1.

## Lanzamiento (rama `feat/launch-ready`, 2026-11-03)

Objetivo: dejar la app lista para el público. Sin pagos (los hará otro agente) y sin tocar `src/rewards/` (Codex). En `App.jsx` solo: importaciones de pantallas diferidas, `Suspense` alrededor de Puzles/Mis partidas/Progreso/editor de avatar, el bloque de bienvenida (marcado `--- Bienvenida ---`) y `onAbout` del menú.

- **PWA** (`src/pwa/`, `build-tools/pwa.js`): manifiesto por idioma (`public/manifest.webmanifest`, `manifest.en.webmanifest`; `documentMeta.js` cambia el `<link rel=manifest>`), iconos 192/512/maskable/apple-touch y `favicon.svg` generados desde `Logo.jsx` (`scripts/gen-brand-images.cjs`), `theme-color` claro/oscuro (`useTheme.js`). Service worker propio sin dependencias: la plantilla `src/pwa/sw-template.js` se copia a `dist/sw.js` con la lista de archivos y una versión = hash del contenido del build. Dos cachés: `escaque-shell-<build>` y `escaque-engine-<hash del motor>`. Cache-first para el mismo origen fuera de `/api`; navegaciones sin red → `index.html`; toda respuesta con COOP/COEP. Registro tras `load` **y** motor «Listo» (`src/startup.js`, tope 20 s); el motor se toma de la caché HTTP comprobando el SHA-256 (en wrangler dev: 1 descarga de `stockfish.wasm` + 1 revalidación 304). Sin `skipWaiting` en install: `UpdateToast.jsx` muestra «Nueva versión disponible — Actualizar» y manda `SKIP_WAITING`. Botón «Instalar app» en el menú con `beforeinstallprompt`; en iOS, instrucciones.
- **Rendimiento**: `src/screens.js` (React.lazy) para Progreso (con Recharts; `ProgressPage.jsx`), Puzles, Mis partidas, editor de avatar, ajustes de IA y bienvenida; se descargan en segundo plano tras «Listo». `openings_map.json` en su propio chunk (`src/data/openings.js`, pedido al arrancar; antes de llegar no se reconoce apertura); el Worker de Progreso (`metrics.js`) lo importa directo.
  - Chunk inicial: **1.358,31 kB (gzip 378,18) → 628,27 kB (gzip 206,02)**, −54 % (−46 % gzip). Lo que queda es sobre todo react-dom (≈561 kB sin minificar), chess.js, dnd-kit, diccionarios y voces de rivales.
  - `vite preview` local (2 núcleos, sin limitar red, 7 cargas en frío, mediana): DOMContentLoaded 222 → 149 ms; «Listo» 1.267 → 1.204 ms (lo domina arrancar Stockfish). Con la red limitada a 10 Mbit/s (3 cargas): DOMContentLoaded 563 → 395 ms; «Listo» 7.607 → 7.478 ms (lo domina descargar los 7 MB del motor).
- **SEO**: `<title>`, description, Open Graph y Twitter Card en `index.html` (español) y al idioma activo con `src/seo/documentMeta.js`; `public/og-image.png` 1200×630. `SITE_URL` en `src/appInfo.js` / `VITE_SITE_URL`; `build-tools/site.js` sustituye `%SITE_URL%` en `index.html` y genera `robots.txt` y `sitemap.xml` (URLs sin `.html`, como las sirve Cloudflare).
- **Bienvenida**: `src/welcome/` (`escaque:welcomeSeen` en localStorage). Los e2e antiguos la saltan con `scripts/lib/welcome.cjs`.
- **Legales**: `public/privacidad|privacy|terminos|terms.html`, borradores con cabecera de aviso. `%CONTACT_EMAIL%` y los bloques `<!--analytics:on/off-->` los resuelve `site.js` en `dist/`. Si cambia algo de lo que la app envía fuera (importación, IA, pagos), actualizar ambas políticas.
- **Analítica y comentarios**: `VITE_CF_ANALYTICS_TOKEN` (vacío = nada) y `VITE_FEEDBACK_URL` (por defecto, los issues del repo público `Omar8485/escaque`).
- **Pendiente del dueño**: `SITE_URL`, `CONTACT_EMAIL`, revisión legal (incluida ley aplicable en términos §8), decidir analítica y `FEEDBACK_URL`. Ver README → «Publicación».
- **Notas**: con analítica activada, el script de Cloudflare debe servirse con CORS para cargar bajo COEP `require-corp`; si no, el navegador lo bloquea y la app sigue igual (no comprobado contra Cloudflare real desde el sandbox). El SW no se registra en `npm run dev` (solo en el build).
- **Verificación**: `npm ci`, 523 tests (44 archivos), ESLint `--max-warnings 0`, `vite build`, `build:e2e`, `wrangler deploy --dry-run`. Contra `wrangler dev`: `e2e-pwa` (42 OK: manifiestos e iconos, SW, recarga sin conexión con Stockfish «Listo», `crossOriginIsolated`, rival juega sin red, legales sin red, instalar), `e2e-launch` (47 OK), `e2e-pwa-update` (12 OK). Contra `vite preview :4681`: e2e-tabs, e2e-layout, e2e-i18n, e2e-puzzles y e2e-alfred correctos.

## Cuentas, Premium y sincronización (rama `feat/accounts-premium`, 2026-11-02)

Decisiones del dueño: freemium cauteloso, cuentas desde el lanzamiento, cobro con **Polar** (comerciante registrado), código GPLv3. **La cuenta es opcional**: sin ella todo funciona como antes, en el navegador.

- **Worker** (`worker/`): `auth/` OIDC Google + Microsoft (solo cuentas personales, tenant `9188040d-…`), authorization code + PKCE S256 + state/nonce en cookie firmada; id_token validado a mano (firma JWKS RS256, iss, aud, exp, iat, nonce). Sesión en D1 (solo hash del token), cookie `__Host-escaque_sid` HttpOnly/Secure/SameSite=Lax 30 días. CSRF: mismo origen + `X-CSRF-Token` (HMAC de la sesión, lo da `/api/me`). `billing/`: checkout, portal y productos de Polar sin SDK; webhook Standard Webhooks (prueba la clave nueva y la antigua de Polar), idempotente por `webhook-id`, ordenado por `modified_at`. `sync/`: push/pull por cursor `seq`, LWW por `updatedAt`, lápidas, cupos. `lib/`: cabeceras de seguridad en toda respuesta `/api` (COOP/COEP incluidos), límites por IP/usuario (binding Rate Limiting o memoria). Proveedor OIDC y Polar **simulados** solo con `AUTH_TEST_MODE=1` en localhost.
- **D1**: `migrations/0001_accounts.sql` (users, sessions, entitlements, webhook_events, sync_items, sync_state). Tests con un doble sobre `node:sqlite` que aplica las migraciones reales (`worker/test/d1.js`).
- **Cliente**: IndexedDB **v3** añade `changes` (registro de cambios con `updatedAt`, `deleted`, `dirty`); toda escritura de `db.js` lo anota en la misma transacción. Migración v2→v3 sin tocar datos; los registros antiguos se anotan al activar la sincronización (`bootstrapChanges`, updatedAt = 1 → la copia del servidor gana los empates). `src/sync/`: motor, preferencias de localStorage que viajan (puzles, perfil, coach, tablero, voz del rival; **nunca** `escaque:ia`) y programador (tras cambios, cada 5 min, al volver la red/pestaña; Web Locks entre pestañas).
- **Límites**: `src/premium/limits.js` (único archivo a tocar), reglas en `gate.js`, estado en `planStore.js` (caché 7 días sin red, nunca más allá del período). Aplicados en Progreso (30 días, 5 tarjetas), plan (1 acción), Mis partidas e importación (50), generador (50), temas de tablero (azul/arena Premium). Jugar y el coach nunca se limitan. Las recompensas de Codex (`src/rewards/`, claves en `meta`) se sincronizan solas si usan `setMeta`.
- **UI**: `src/account/AccountSection.jsx` montado en un solo punto de `SideMenu`; `PremiumScreen.jsx` en un portal. Cambios en App.jsx: 2 líneas (prop `gameInProgress` y lectura de temas).
- **Pruebas**: `worker/*.test.js`, `src/sync/engine.test.js` (dos dispositivos contra el Worker real), `src/premium/premium.test.js`, `src/storage/db.v3.test.js`; e2e `scripts/e2e-accounts.cjs` (arranca su `wrangler dev`).
- **Dueño**: ver [DEPLOY-ACCOUNTS.md](DEPLOY-ACCOUNTS.md) y [LEGAL-NOTES.md](LEGAL-NOTES.md).

## R1 · XP y niveles

`src/rewards/` separa eventos, cálculo puro, persistencia y UI. XP_RULES centraliza valores: partida 30+3×nivel, victoria 20, sin errores graves 15, puzle 10 (+5 primera vez a la primera), repaso 20, corrección 10 y meta 25 (R2). El nivel L empieza en 50×(L−1)×L XP; el siguiente cuesta 100×L. Un registro de premios en meta.rewards deduplica cada componente por id estable de partida, puzle, posición corregida o día local. Abandonar tras como máximo una jugada propia no da XP, aunque el rival ya haya respondido; repetir un mate con el mismo id tampoco. El bonus sin errores graves espera todas las clasificaciones propias, sin búsquedas nuevas. Repetir un puzle nunca genera más XP; los fallos previos impiden bonus de primera vez.

El runtime escucha el bus y los guardados de P1 para enriquecer partidas recién terminadas. No otorga XP por historial previo. Serializa escrituras y utiliza Web Locks entre pestañas, más BroadcastChannel para actualizar la cabecera; todo en getMeta/setMeta, sin cambiar DB_VERSION. El repaso solo recompensa si se intentaron todos sus puzles (saltar no cuenta). Se monta un único RewardsRoot junto al avatar, con barra/nivel y aviso breve que respeta reduced-motion. App conserva discardedTrainingIdRef y solo añade emisión de fin y montaje; los demás puntos de juego emiten eventos sin lógica de recompensas.

## R2 · Racha y meta diaria

`rewards/daily.js` usa fechas civiles de la zona local (Intl), no bloques de 24 h, con fecha/zona inyectables en tests. Una actividad real abre el día: partida terminada (no abandono tras la primera jugada propia), intento de puzle o repaso verificado. El comodín cubre automáticamente el primer día perdido de cada semana local lunes–domingo, atribuido a la semana de la fecha faltante; un segundo día consecutivo rompe la racha aunque cruce semanas. Los días protegidos cuentan en la longitud de la racha, no conceden XP/meta. El historial deriva usos de comodín y mejor racha sin reponerlos al dejar pasar más días.

Meta configurable por defecto 1 partida + 3 puzles resueltos; los fallos cuentan para entrenar/racha, no para los puzles de la meta. IDs únicos por día; el enriquecimiento tardío de una partida se atribuye al primer premio para no sumar dos días. Meta 0+0 no se permite. Cumplirla concede 25 XP una vez por fecha local incluso si cambias la configuración después. RewardsDaily es visible en Progreso y en el panel de cabecera; un portal desde el único montaje evita tocar los archivos reservados al otro agente. El aviso de meta cumplida es discreto y las preferencias/progreso viven en meta.rewards, sin cambio de esquema.

## R3 · Logros

Catálogo de 21 logros en `rewards/achievements.js`: primera partida; victoria contra cada uno de los 10 rivales y Atenea especial; partida sin errores graves; precisión≥90%; conversión de posición ganada; 10 puzles seguidos a la primera; 7 días de racha; primera importación/generación; 10 correcciones reales y primer repaso completado. No se incluye un logro de plan semanal: hoy P4 registra recomendaciones/navegación, no la finalización semanal; se eligió primer repaso para premiar un hecho comprobable sin inventar evidencia.

La pantalla Logros es una sección nueva dentro de Progreso, junto a la racha/meta, porque reúne el seguimiento en un lugar y evita competir con SideMenu/App reservados. Un portal desde el único montaje permite esa integración. Bloqueados en gris y fecha al desbloquear; avisos no bloqueantes y campanilla breve de ganancia 0,035 solo si el sonido está activo. Los cambios de preferencia no reproducen avisos anteriores y reduced-motion evita animaciones.

Al instalar, un Worker reconoce el historial guardado una sola vez: partidas Escaque/ledger, importaciones, puzles y progreso previo. Backfill de fechas reales de partidas para racha; los datos antiguos sin hora no inventan orden de intentos. No se concede XP ni se muestran avisos retroactivos. Nuevos eventos enriquecen los logros de calidad solo con cobertura completa. La primera generación se observa desde rewards/ mediante el estado del generador, sin editarlo; la importación y correcciones usan el bus. El identificador de puzle evita farmear rachas de aciertos y cualquier fallo real rompe la cadena, también si se repite un puzle anterior. No se cambia DB_VERSION ni se alteran los contratos motif/moveMotif o discardedTrainingIdRef.

## Integración v1.3 (rama `release/v1.3`, 2026-11-03)

Integrador y verificador: Claude. Sin PR ni fusión a `main` (lo decide el dueño).

**Orden:** `feat/launch-ready` (base) → `feat/accounts-premium` → `codex/R3-logros` (contiene R1 y R2: `git merge-base --is-ancestor` comprobado para `codex/R1-xp` y `codex/R2-racha`).

**Conflictos resueltos (se conserva la funcionalidad de ambos lados):**
- `vite.config.js`: configuración por modo del lanzamiento (`site.js`, `pwa.js`, `loadEnv`) + proxy `/api` de cuentas (200 en texto si no hay Worker), ahora también en `preview`.
- `src/App.jsx`: `onAbout` (bienvenida) y `gameInProgress` (cuenta) en `SideMenu`; pantallas diferidas de `src/screens.js` en lugar de las importaciones estáticas de R3; de Codex solo `RewardsRoot` (un montaje) y `emitRewardEvent` (una línea en `finishGame`).
- `src/components/SideMenu.jsx`: botón Instalar, Acerca de y comentarios + `AccountSection`.
- `scripts/e2e-progress.cjs`, `e2e-training-plan.cjs`: `skipWelcome` + plan Premium simulado.
- `docs/HANDOFF.md`: secciones de Lanzamiento, Cuentas y R1–R3.

**Ajustes de integración (Claude):**
- **Service worker y `/api`:** ya no interceptaba `/api` (comprobado). Nuevas pruebas: `build-tools/pwa.test.js` ejecuta el `sw.js` generado y verifica que ninguna ruta `/api` (login, callbacks, webhooks, sync, me; navegación, fetch o POST) pasa por `respondWith`; `e2e-accounts` inicia sesión con la página ya controlada por el SW, comprueba que todas las respuestas de `/api` vienen de la red y que `/api` sin red no sale de la caché. El login es `location.assign` (navegación completa, compatible con COOP y con la PWA instalada).
- **Carga diferida:** `PremiumScreen` pasa a `src/screens.js` (Suspense en `AccountSection`): −11 kB en el chunk inicial. Chunk inicial: lanzamiento 628,27 kB → con cuentas 680,08 → con recompensas 716,71 → final **713,12 kB (gzip 237,47)**. `useGeneratePuzzles` (≈10 kB) quedó en el inicial por `AccountSection`/`RewardsRoot`; no compensa separarlo.
- **Cuenta sin red:** si la app se abre sin conexión (PWA), el plan sale de la caché sin token CSRF y la sincronización no arrancaba hasta recargar; ahora `AccountSection` consulta `/api/me` con el evento `online`.
- **Legales:** `public/privacidad|privacy|terminos|terms.html` incorporan `docs/LEGAL-NOTES.md` (cuenta, datos sincronizados incluidas las recompensas, cookies, Polar, base jurídica, derechos; términos de cuenta, Premium/gratis, pagos, sincronización, GPLv3), siguen marcadas «Borrador — pendiente de revisión legal» y los pendientes del dueño van en `<mark>`. La pantalla Premium enlaza a términos y privacidad.
- **e2e adaptados a la carga diferida y la bienvenida:** `e2e-import` (esperaba Progreso sin esperar a que cargara: fallaba 3/3), `e2e-accounts` (bienvenida, pantallas diferidas, puntero en el borde que abre el menú y vuelta del pago: intermitente, ver abajo), e2e de recompensas de Codex (`skipWelcome`).

**Revisión de Codex (R1–R3) y correcciones:** cumple §1 (sin dependencias, `src/rewards/` puro con tests, `t()` en es/en, `data-testid`, Worker para el historial, sin subir `DB_VERSION`, sin tocar `codex_task.md` ni `worker/`) y §2b (bus de una línea, `getMeta/setMeta`, id estable: deshacer un mate no da XP dos veces —probado en `xp.test.js` y `e2e-rewards`—, día civil local con zona inyectable y DST probados). Tests significativos (curva, deduplicación, comodín, cambio de año, abandono tras la primera jugada). Problemas encontrados y corregidos:
1. **Pérdida de recompensas entre dispositivos (grave).** Todo iba en un registro `meta/rewards` con «última escritura gana»: un navegador nuevo que inicia sesión escribe su estado vacío (más reciente) y lo subía encima del del otro dispositivo (prueba: 10 XP → 0). Arreglo: `src/rewards/merge.js` (unión de premios por clave estable, días, logros con la fecha más antigua, marcas; la meta gana por `goalSetAt`) aplicado por `src/sync/local.js` al bajar; si la fusión aporta algo, queda pendiente de subir.
2. **El registro crecía sin límite (grave para Premium).** ≈2 KB por día con la meta por defecto: 214 KB en 100 días; la sincronización no sube registros de más de 120 KB, así que a los ~2 meses las recompensas dejaban de sincronizarse. Arreglo: `src/rewards/store.js` guarda un resumen acotado (`rewards`) + `rewards:day:AAAA-MM-DD` (solo se añaden claves); 100 días → cada día < 6 KB, resumen < 4 KB. El modelo en memoria y los reductores de Codex no cambian; un registro antiguo se lee igual y se reparte al escribir.
3. **Lectura y escritura no atómicas.** `runtime.js` leía y escribía en transacciones separadas (la sincronización u otra pestaña podían colarse) y el reconocimiento del historial reemplazaba los logros por los suyos. Arreglo: `updateMetaGroup` en `db.js` (una transacción) y fusión con lo último guardado.
4. **La cabecera no veía lo sincronizado** hasta otro evento o recargar: `AccountSection` emite `escaque:data-synced` y el runtime relee.
5. `startColor` no se emitía al terminar una partida desde un FEN con negras al turno (misma línea de `App.jsx`).
6. Textos: bloque `rewards` de `es.js`/`en.js` con claves entre comillas e indentación rota (reescrito, mismo contenido); la regla de la racha decía «una media jugada» cuando la regla es «tras tu primera jugada»; «Practice» → «Training»; README («Progreso:21», y las recompensas ahora se sincronizan).

**Observaciones sin cambio (decisiones de diseño, para el dueño):** abandonar tras 2 jugadas propias ya da la XP base (cumple §2b, pero permite sumar ~33–60 XP por partida corta); si se deshace un mate y luego se pierde, la XP de victoria y el logro del rival se conservan (no se duplican); el comodín cuenta el día perdido en la mejor racha aunque la racha se rompa al día siguiente; Logros se monta en Progreso por portal (`RewardsProgress.jsx`, evitaba tocar archivos de otro agente) y podría integrarse en `ProgressScreen` cuando convenga.

**Pruebas nuevas:** `src/rewards/merge.test.js`, `store.test.js`, `runtime.sync.test.js`, caso de recompensas en `src/sync/engine.test.js`, `build-tools/pwa.test.js` (SW y `/api`), `build-tools/site.test.js` (legales) y `scripts/e2e-rewards-sync.cjs` (A Premium → sin red: recarga servida por el SW, partida real contra Ícaro, XP y racha → vuelve la red → B en otro navegador recibe XP, racha y partida y actualiza la cabecera sin recargar; A conserva lo suyo).

**Verificación final (commit `d1e921a`):** `npm ci` (328 paquetes; 6 avisos moderados de `npm audit`, como antes), `npm test` **665 tests en 59 archivos**, `npx eslint . --max-warnings 0` limpio, `npx vite build` y `npm run build:e2e` correctos, `npx wrangler deploy --dry-run` 67,27 KiB (gzip 18,06).
- Contra `wrangler dev` con D1 local y `AUTH_TEST_MODE=1`: `e2e-accounts` 47/47 (intermitente por carreras del propio script: pasó 3 veces durante la integración y luego falló 3 seguidas en la batería final —menú abierto por el puntero en el borde a 390 px y comprobación en plena navegación tras el pago—; tras el arreglo, 3 de 3 correctas), `e2e-pwa` 42/42, `e2e-launch` 47/47, `e2e-pwa-update` 12/12 (servidor propio), `e2e-rewards-sync` 19/19.
- Recompensas de Codex contra `vite --mode e2e` (importan módulos de `src/`, no funcionan contra un build): `e2e-rewards` 4/4, `e2e-rewards-daily` 2/2, `e2e-achievements` 4/4.
- Contra `vite preview` (build e2e para `training-save` y `game-experience`): training-save 2/2, game-experience 48/48, progress 2/2, training-plan 2/2, review 2/2, puzzle-promotion 2/2, tabs 17/17, i18n 18/18, alfred correcto (sin errores de consola), import 29/29, puzzles 33/33, layout 33/33.

**Pendiente antes de publicar:** lo del dueño en §Lanzamiento y en `DEPLOY-ACCOUNTS.md` (`SITE_URL`, `CONTACT_EMAIL`, D1 real y migraciones, secretos OIDC/Polar, productos de Polar, `POLAR_SERVER=production`), revisión legal de los borradores (ley aplicable, reembolsos, «Fundador» si el servicio cierra, borrado de datos sincronizados sin Premium, edad mínima); probar el login de Google/Microsoft en la PWA instalada en un móvil real (iOS abre los orígenes externos en una vista de Safari: comprobar que vuelve con la sesión); decidir las observaciones de diseño de las recompensas; `npm audit` (6 moderadas, de desarrollo).

## Legal, consentimiento y precios (rama `feat/legal-pricing`, 2026-11-07)

Decisiones aceptadas por el dueño (sin abogado; revisión del marco legal por Claude): ver [LEGAL-NOTES.md](LEGAL-NOTES.md) (decisiones, tabla sección → norma, revisión de coherencia con el código y límites).

- **Páginas legales 1.0** vigentes desde 2026-11-07, es/en, sin borrador: responsable el titular de Escaque (nombre desde `VITE_CONTROLLER_NAME` en el build) (Quito), `escaque.ec@gmail.com` (`DEFAULT_CONTACT_EMAIL`). LOPDP de Ecuador + RGPD como referencia.
- **Versión en un solo sitio**: `shared/legal.js` (`TERMS_VERSION`). La usan el Worker y la app; las páginas la repiten y `build-tools/site.test.js` lo comprueba.
- **Consentimiento**: casilla obligatoria antes del primer login (`ProviderButtons` + `Consent.jsx`); la versión viaja en la cookie firmada del login; el callback no crea usuarios sin ella; `users.terms_version`/`consent_at` (migración `0002`); cuentas con versión vieja o sin versión → aviso en la app y `POST /api/me/consent`; mientras falte, sin sincronización ni compras (sí cancelar, borrar datos o cuenta).
- **Borrar cuenta** también desde el menú; confirmación que explica servidor vs. navegador y avisa de suscripción y Fundador.
- **Precios** (en Polar): 2,99 / 19,99 / 49,99 USD; Fundador limitado por `FOUNDER_LIMIT` (500): plazas reales en `/api/billing/products`, 409 `founder_sold_out` al agotarse. Pantalla Premium: Mensual · Anual («Mejor valor», equivalente mensual y % de ahorro calculados con los precios de Polar) · Fundador (plazas o «Agotado»), nota de reembolso con enlaces.
- **Limpieza**: el login borra sesiones caducadas de todos y avisos de Polar de más de 30 días.
- **Dueño**: aplicar la migración 0002 en D1 remoto antes de desplegar y crear los productos en Polar ([DEPLOY-ACCOUNTS.md](DEPLOY-ACCOUNTS.md) §1, §5 y §5.4).

## Repositorio público (2026-11-07)

- **Código público:** `https://github.com/Omar8485/escaque` (GPLv3), publicado como una instantánea limpia de `main` **sin historial** y con autor `Omar8485 <…@users.noreply.github.com>`. `coach_chess` sigue **privado**: su historial contiene datos personales del dueño (nombre en commits viejos de las páginas legales y su correo personal como autor), por eso no se hace público.
- **Sin datos personales en el código:** las páginas legales dicen «el titular de Escaque» (el dueño decidió **no** usar `VITE_CONTROLLER_NAME`); los fixtures de Lichess del dueño se anonimizaron (`jugador_demo`, IDs `Demo0001…`; archivos `demo-lichess.pgn` y `demo-recent20.json`).
- **Enlaces:** términos, `worker/proxy.js` (User-Agent) y el menú «Enviar comentarios» apuntan a `Omar8485/escaque` (issues).
- **Sincronizar:** al publicar una versión nueva, copiar el árbol de `main` (sin `.git`) a `escaque` y hacer un commit con el autor noreply; antes, `git grep -i` de nombre/correo personal debe salir vacío.

## Actualizaciones de la PWA (2026-11-07)

Tras desplegar los términos 1.0, el dueño vio en su navegador la app antigua (de la caché del SW) contra el Worker nuevo: la sincronización daba 403 `consent_required` y, tras Ctrl+Shift+R, los términos seguían saliendo de la caché antigua (fechados el 3 de noviembre). Arreglos:
- `src/pwa/sw-template.js`: páginas legales y de licencias **primero a la red** (caché solo sin conexión).
- `src/pwa/pwa.js`: si la página no está controlada y hay un SW esperando, se activa en silencio.
- `scripts/e2e-pwa-update.cjs`: comprueba términos de la red con el SW antiguo y de la caché sin conexión (verificado: falla con el SW anterior).
