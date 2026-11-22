// Personalidad y frases de cada rival (los 10 personajes de src/engine/rivalLevels.js).
// Solo datos: aquí se editan las frases. Las reglas de cuándo habla el rival están en voice.js.
//
// Reglas de estilo (las comprueban los tests de personalities.test.js):
// - Español neutro, tuteo, aptas para todo público; humor amable, sin insultos ni burlas hirientes.
// - Breves: como mucho MAX_LINE_LENGTH caracteres (con `{move}` ya sustituido por una jugada larga).
// - Al menos 4 frases por evento obligatorio y rival, sin frases repetidas en todo el archivo.
// - Única variable: `{move}`, la jugada en SAN inglés (p. ej. "Qxh7+"). En `rival_good_move` es la
//   jugada del rival; en `player_*`, la tuya. Una frase con `{move}` solo se usa si hay jugada.
// - Inglés: personalities.en.js adapta cada frase (misma personalidad, mismo número de frases por
//   evento y `{move}` en los mismos índices). Si cambias una frase aquí, adapta la inglesa.
import { PERSONALITIES_EN } from './personalities.en.js';

/** Eventos a los que reacciona el rival. */
export const RIVAL_EVENTS = Object.freeze([
  'game_start', // al empezar la partida
  'rival_good_move', // su jugada fue Mejor/Excelente y le da ventaja clara (o es táctica)
  'player_mistake', // tu jugada fue un error
  'player_blunder', // tu jugada fue un error grave
  'rival_wins', // gana el rival (mate, tiempo o abandono): frases que sirven para los tres
  'rival_loses', // ganas tú
  'draw', // tablas
  'player_good_move', // opcional: elogio ocasional a una buena jugada tuya
]);

/** Eventos que todo rival debe cubrir. `player_good_move` es opcional. */
export const REQUIRED_EVENTS = Object.freeze(RIVAL_EVENTS.filter((e) => e !== 'player_good_move'));

/** Longitud máxima de una frase (con `{move}` sustituido). */
export const MAX_LINE_LENGTH = 90;

/**
 * @typedef {'game_start'|'rival_good_move'|'player_mistake'|'player_blunder'|'rival_wins'|'rival_loses'|'draw'|'player_good_move'} RivalEvent
 * @typedef {{ level:number, name:string, trait:string, lines: Record<RivalEvent, readonly string[]> }} RivalPersonality
 */

/** @type {readonly RivalPersonality[]} */
export const PERSONALITIES = Object.freeze(
  [
    {
      level: 1,
      name: 'Ícaro',
      trait: 'Impulsivo y fanfarrón: vuela muy alto y se derrumba en cuanto algo sale mal.',
      lines: {
        game_start: [
          '¡Despego ya! Esta la gano antes de que se derrita la cera.',
          'Mi padre dice que no vuele tan alto. Mi padre no juega ajedrez.',
          '¿Listo? Yo nací listo. Bueno, nací con alas, que es casi lo mismo.',
          'Voy directo al sol… digo, a tu rey.',
          'Prometo atacar desde la primera jugada. Pensar es para los que caminan.',
        ],
        rival_good_move: [
          '¡{move}! ¿Viste qué alto vuelo?',
          'Esa jugada brilla más que el sol. Y yo de soles sé bastante.',
          '¡Ja! Ni Dédalo lo habría pensado mejor.',
          'Siento el viento a favor. ¡Más alto, más alto!',
          'Esto ya es un vuelo rasante sobre tu posición.',
        ],
        player_mistake: [
          '¿{move}? Hasta yo lo vi, y eso ya es decir.',
          'Uy, se te despegó una pluma.',
          'Interesante… le das alas a mi ataque.',
          'Ese no fue tu mejor vuelo, amigo.',
          '¡Ajá! Una corriente de aire a mi favor.',
        ],
        player_blunder: [
          '¿¡{move}!? ¡Gracias, gracias! Voy por ella antes de que te arrepientas.',
          '¡Una pieza gratis! Hoy el sol me sonríe.',
          '¡Te caíste del cielo! Ah, no, ese suelo ser yo.',
          '¡Eso sí que es un regalo! Lo acepto sin pensar, como todo.',
          'Ni yo cometo esos… bueno, a veces sí. ¡Pero hoy no!',
        ],
        rival_wins: [
          '¡Toqué el sol y no me quemé! Esto no pasa seguido.',
          '¡Gané! Quiero esto pintado en un vaso griego.',
          'Voy a contárselo a mi padre. Dos veces.',
          '¡Victoria! Hoy las alas aguantaron.',
          '¿Ves? Volar alto sí funciona… a veces.',
        ],
        rival_loses: [
          'Sentí calor… y luego todo fue caída. Como siempre.',
          'Se derritió la cera. Otra vez. Bien jugado.',
          'Mi padre me lo advirtió. No se lo cuentes, por favor.',
          'Volé demasiado alto. Tú volaste justo lo necesario.',
          '¡Plaf! Ese fue el sonido de mi partida.',
        ],
        draw: [
          '¿Tablas? Ni subí ni caí. Qué raro se siente.',
          'Quedamos flotando en el aire. Empate.',
          'Un vuelo sin aterrizaje. ¡La próxima subo más!',
          'Tablas… al menos mi cera sobrevivió.',
          'Ni sol ni mar: nos quedamos a media altura.',
        ],
        player_good_move: [
          'Oye, eso estuvo bien. No me gusta, pero estuvo bien.',
          '¡Vaya vuelo el tuyo con {move}!',
          'Esa no la vi venir. Casi nunca veo nada venir.',
          'Bonita jugada. Me haces sudar la cera.',
        ],
      },
    },
    {
      level: 2,
      name: 'Narciso',
      trait: 'Vanidoso: se admira a sí mismo más que al tablero.',
      lines: {
        game_start: [
          'Empecemos. Intenta no distraerte con mi perfil.',
          '¿Jugamos? Dame un segundo, que me arreglo el peinado.',
          'Qué suerte: hoy juegas contra el rival más guapo del Olimpo.',
          'Prometo mirar el tablero… cuando deje de mirarme.',
          'Mi reflejo me dijo que hoy gano. Él nunca miente.',
        ],
        rival_good_move: [
          '{move}. Elegante, como todo lo que hago.',
          '¿Viste esa jugada? Casi tan bonita como yo.',
          'Debería verme jugar en un espejo.',
          'Perfecta. Ojalá alguien la estuviera pintando.',
          'Brillante. Igual que mi sonrisa.',
        ],
        player_mistake: [
          '¿{move}? Calma, mi presencia deslumbra a cualquiera.',
          'Eso pasa cuando me miras a mí y no al tablero.',
          'Mmm, esa jugada no te favorece. Esa luz tampoco.',
          'No pasa nada: no todos pueden ser perfectos como yo.',
          'Ups. Hasta mi reflejo hizo una mueca.',
        ],
        player_blunder: [
          '¡Oh! ¿Me regalas eso? Sabía que me admirabas.',
          '{move}… Un obsequio digno de mi belleza. Gracias.',
          'Creo que te distrajo mi perfil. Pasa mucho.',
          'Qué generoso. Lo pondré junto a mi espejo.',
          'Hasta yo lo vi, y eso que estaba mirándome.',
        ],
        rival_wins: [
          'Gané. Era inevitable: el universo ama lo bello.',
          'Victoria. Iré a contemplarla en el estanque.',
          'Partida perfecta, como mi perfil izquierdo.',
          '¿Una foto con el ganador? Claro, ponte a mi lado.',
          'Gané sin despeinarme. Bueno, casi.',
        ],
        rival_loses: [
          '¿Perdí? Seguro que fue la iluminación.',
          'Me distraje con mi reflejo. Mérito tuyo, igual.',
          'Bien jugado. Casi tan bien como me veo yo.',
          'Esto no lo vio nadie, ¿verdad? ¿Verdad?',
          'Perdí, pero con mucho estilo. Eso cuenta.',
        ],
        draw: [
          'Tablas. Al menos salgo igual de guapo.',
          'Empate. El espejo dice que gané en presencia.',
          'Ni tú ni yo. Aunque yo me veo mejor.',
          'Tablas: un final simétrico, como mi rostro.',
          'Empatamos. Lo acepto, porque me queda bien.',
        ],
        player_good_move: [
          'Hmm, bonita jugada. No tanto como yo, pero bonita.',
          '{move}. Hasta mi reflejo aplaudió.',
          'Eso tuvo estilo. Se nota que me observas.',
          'Vaya, por un momento miré el tablero y no a mí.',
        ],
      },
    },
    {
      level: 3,
      name: 'Perseo',
      trait: 'Aprendiz con suerte de héroe: entusiasta, humilde y algo sorprendido de sus aciertos.',
      lines: {
        game_start: [
          'Hola. Traigo sandalias aladas y mucha suerte. Lo demás, lo aprendo.',
          'Mi maestro dice que mire el tablero como un escudo pulido.',
          'No sé si soy un héroe, pero tengo buen presentimiento.',
          'Vamos allá. Si me pierdo, que los dioses me echen una mano.',
          'Regla del héroe: no mirar a Medusa. Y desarrollar las piezas.',
        ],
        rival_good_move: [
          '¿{move} fue buena? ¡Lo sabía! Bueno, lo intuía.',
          '¡Los dioses me prestaron su espada para esa!',
          'Creo que acabo de hacer algo heroico. ¿Sí?',
          '¡Funcionó! Tengo que anotar cómo lo hice.',
          'Con este escudo veo todo lo que tramas.',
        ],
        player_mistake: [
          '¿{move}? Hasta un aprendiz como yo lo notó.',
          'Uy, creo que eso me ayuda. ¿Seguro?',
          'Esa jugada me dio una oportunidad. ¡Gracias, Atenea!',
          'Ajá, una grieta en tu armadura.',
          'No te preocupes, yo cometo esas a diario.',
        ],
        player_blunder: [
          '¿De verdad me dejas eso? ¡Qué suerte la mía!',
          '¡Hermes debe estar de mi lado hoy!',
          'Esto me lo dio la fortuna, no el talento. Lo acepto igual.',
          '¡Una pieza libre! Así se siente ser héroe.',
          'Te quedaste de piedra con {move}, ¿no?',
        ],
        rival_wins: [
          '¡Gané! ¿Gané? ¡Gané! Que alguien lo cante.',
          'Suerte de principiante… o de héroe. ¡Las dos sirven!',
          'Victoria. Mi madre va a estar orgullosa.',
          'Lo logré. Prometo seguir entrenando, de verdad.',
          'Hoy fui un poco más héroe que ayer.',
        ],
        rival_loses: [
          'Perdí, pero aprendí un montón. Gracias por la lección.',
          'Se me acabó la suerte. ¡La próxima traigo más!',
          'Bien jugado. Así juegan los verdaderos héroes.',
          'Mi escudo no te vio venir. Felicidades.',
          'Me derrotaste. Voy a pedirle consejo a Atenea.',
        ],
        draw: [
          '¡Tablas! Para un aprendiz, eso es casi una victoria.',
          'Empatamos. Los dioses no se decidieron.',
          'Tablas. Me quedo con la mitad del tesoro.',
          'Nadie perdió. Eso me parece muy heroico.',
          'Un empate digno. Lo anoto en mi diario de aventuras.',
        ],
        player_good_move: [
          '¡Qué jugada! ¿Me enseñas a hacer eso?',
          '{move}… Eso es nivel de héroe de verdad.',
          'Guau. Voy a copiar esa idea.',
          'Eso fue muy bueno. Me dejaste de piedra.',
        ],
      },
    },
    {
      level: 4,
      name: 'Jasón',
      trait: 'Aventurero: cada partida es una travesía en busca del vellocino de oro.',
      lines: {
        game_start: [
          '¡Argonautas, a los remos! Empieza la travesía.',
          'En algún lugar de este tablero hay un vellocino. Lo voy a encontrar.',
          'Nueva aventura, nuevo rival. ¡Que sople buen viento!',
          'Preparé el barco y la tripulación. ¿Zarpamos?',
          'Cada partida es un viaje. Esta promete tormentas.',
        ],
        rival_good_move: [
          '¡{move}! Creo que vi brillar el vellocino.',
          '¡Tierra a la vista! Mi plan va viento en popa.',
          'Esa jugada merece una canción de los argonautas.',
          'Remo a remo, la ventaja ya es mía.',
          '¡Ahí está! Sabía que esta ruta llevaba a algo.',
        ],
        player_mistake: [
          '¿{move}? Me abres una ruta que no estaba en el mapa.',
          'Hmm, dejaste un puerto sin vigilar.',
          'Corriente favorable a la vista. Gracias.',
          'Esa jugada huele a tormenta para ti.',
          'Mis argonautas acaban de señalar algo interesante…',
        ],
        player_blunder: [
          '¡Botín inesperado! Que lo suban al Argo.',
          '¿{move}? ¡Eso es un tesoro flotando a mi lado!',
          'Ni Medea me habría preparado mejor el camino.',
          'Rumbo directo a esa pieza. ¡Todos a los remos!',
          'Las sirenas te distrajeron, ¿verdad? Le pasa a cualquiera.',
        ],
        rival_wins: [
          '¡El vellocino es mío! Qué travesía.',
          'Victoria. Volvemos a casa con el tesoro.',
          'Gran aventura. Gracias por ser un rival tan bravo.',
          '¡Lo encontré! Esta vez sí había vellocino.',
          'La tripulación celebra. Tú también remaste fuerte.',
        ],
        rival_loses: [
          'Esta vez el vellocino se escapó. Volveré a buscarlo.',
          'Naufragué con honor. Bien navegado.',
          'Tu flota fue mejor hoy. Te lo reconozco.',
          'Me perdí entre las rocas. Gran partida.',
          'Sin tesoro, pero con una historia para contar.',
        ],
        draw: [
          'Tablas. Volvemos al puerto sin vellocino ni naufragio.',
          'Mar en calma: nadie gana. Gran viaje igual.',
          'Empate. Repartimos el botín a partes iguales.',
          'Tablas. El viaje valió la pena.',
          'Ni tesoro ni tormenta. Otra aventura será.',
        ],
        player_good_move: [
          '¡Buena maniobra! Tienes alma de argonauta.',
          '{move}. Eso sí que es navegar contra el viento.',
          'Me gustaría tenerte en mi tripulación.',
          'Bien jugado. Esta aventura se pone interesante.',
        ],
      },
    },
    {
      level: 5,
      name: 'Teseo',
      trait: 'Metódico: recorre la partida como un laberinto, paso a paso y con el hilo de Ariadna.',
      lines: {
        game_start: [
          'Ato el hilo a la entrada. Empecemos con calma.',
          'Todo laberinto tiene salida. Toda posición, un plan.',
          'Paso a paso. Así se cruzan laberintos y partidas.',
          'Revisé el mapa del tablero. Estoy listo.',
          'Sin prisa: primero las piezas, luego el Minotauro.',
        ],
        rival_good_move: [
          '{move}. Encontré el pasillo correcto.',
          'Seguí el hilo y me llevó justo aquí.',
          'Giro a la izquierda, luego recto… y llegué.',
          'Paso firme. Este camino lo tengo bien medido.',
          'El laberinto se aclara. Sé por dónde ir.',
        ],
        player_mistake: [
          '{move}… Creo que doblaste en el pasillo equivocado.',
          'Esa ruta tiene una pared al final, me temo.',
          'Te alejaste del hilo. Con cuidado.',
          'Un paso en falso. Lo anoto en mi mapa.',
          'Ahí se abre un pasadizo para mí.',
        ],
        player_blunder: [
          '¿{move}? Ese pasillo daba directo al Minotauro.',
          'Uy, te perdiste en el laberinto. Y yo tengo el hilo.',
          'Esa casilla no tenía salida. Lo siento por tu pieza.',
          'Callejón sin salida. Voy a aprovecharlo con método.',
          'Error de cartografía. Me lo llevo con gusto.',
        ],
        rival_wins: [
          'Salí del laberinto. Método, paciencia y un buen hilo.',
          'Victoria. Ariadna estará contenta.',
          'El Minotauro cayó. Gracias por el recorrido.',
          'Camino completado. Fue un buen laberinto.',
          'Gané, paso a paso. Así me gusta.',
        ],
        rival_loses: [
          'Me perdí en mi propio laberinto. Bien jugado.',
          'Se me cortó el hilo. Tú encontraste la salida.',
          'Encontraste el camino antes que yo. Felicidades.',
          'Hoy el Minotauro fui yo. Buena partida.',
          'Revisaré mi mapa: me llevaste directo a una pared.',
        ],
        draw: [
          'Tablas. Los dos salimos del laberinto a la vez.',
          'Empate: cada uno encontró su salida.',
          'Recorrimos todo el laberinto y nadie ganó. Justo.',
          'Tablas. Ningún Minotauro esta vez.',
          'Llegamos al centro y nos dimos la mano. Tablas.',
        ],
        player_good_move: [
          'Buen camino. Conoces bien estos pasillos.',
          '{move}. Lo trazaste como en un mapa.',
          'Esa jugada tiene hilo propio. Bien.',
          'Me cerraste un pasillo. Elegante.',
        ],
      },
    },
    {
      level: 6,
      name: 'Héctor',
      trait: 'Noble y firme: defiende sus murallas con honor y respeta al rival.',
      lines: {
        game_start: [
          'Que gane quien mejor juegue. Defenderé mis murallas con honor.',
          'Te saludo, rival. Que sea una partida limpia.',
          'Troya no cae fácil. Mi rey tampoco.',
          'Las murallas están firmes. Adelante, cuando quieras.',
          'Por mi familia y por mi ciudad: a jugar.',
        ],
        rival_good_move: [
          '{move}. Firme como las murallas de Troya.',
          'Un buen golpe, sin trampas. Así juego yo.',
          'Defiendo y contraataco. Esa es la ley de Troya.',
          'Esta jugada la habría aprobado Príamo.',
          'Paso al frente. Ahora te toca a ti responder.',
        ],
        player_mistake: [
          '{move} deja una brecha en tu muralla. Te aviso con respeto.',
          'Esa jugada te debilita. Pero la partida sigue.',
          'Un descuido. A todos nos pasa en batalla.',
          'Hay una grieta en tu defensa. La aprovecharé.',
          'Mmm, mis centinelas vieron algo.',
        ],
        player_blunder: [
          'Lo tomaré, aunque no me gusta ganar así.',
          '{move}… Un error grave. Ánimo, guerrero.',
          'Tu puerta quedó abierta. Es mi deber entrar.',
          'Mal momento para bajar el escudo.',
          'Eso cuesta caro. Pero levántate y sigue luchando.',
        ],
        rival_wins: [
          'Troya resiste hoy. Luchaste con valor.',
          'Victoria. Te honro como a un rival digno.',
          'Las murallas aguantaron. Gracias por la batalla.',
          'Gané, pero aprendí de tu ataque. Buena partida.',
          'Que los cantores recuerden tu valentía también.',
        ],
        rival_loses: [
          'Caen las murallas. Lo acepto con honor.',
          'Fuiste mejor hoy. Te doy la mano.',
          'Peleé hasta el final. Tú peleaste mejor.',
          'Troya cae ante un rival digno. Felicidades.',
          'Hoy no fue mi día. Mañana defenderé otra vez.',
        ],
        draw: [
          'Tablas. Una batalla honrosa para ambos.',
          'Empate. Ni tus tropas ni las mías cedieron.',
          'Tregua justa. Volvamos a vernos en el campo.',
          'Las murallas siguen en pie y tú también. Tablas.',
          'Un empate digno. Lo respeto.',
        ],
        player_good_move: [
          'Buena jugada. Así se lucha con honor.',
          '{move}. Golpe certero, lo reconozco.',
          'Bien hecho. Eres un rival digno.',
          'Esa me hizo retroceder un paso. Bravo.',
        ],
      },
    },
    {
      level: 7,
      name: 'Odiseo',
      trait: 'Astuto y burlón: siempre insinúa una trampa y disfruta del ingenio (el tuyo también).',
      lines: {
        game_start: [
          'Hola, amigo. Te traje un regalo… es un caballo. De madera.',
          'Prometo jugar limpio. Bueno, casi siempre.',
          'Me llaman Nadie. Recuérdalo cuando te pregunten quién te ganó.',
          'Tardé diez años en volver a casa; esta partida será más rápida.',
          'Te advierto: tengo más planes que piezas.',
        ],
        rival_good_move: [
          '{move}. Y eso que aún no viste la trampa.',
          '¿Notas algo raro? Es mi caballo de madera.',
          'Paciencia, que lo mejor del plan viene después.',
          'Una jugada sencilla… para quien sabe mirar.',
          'Todo va según lo previsto. Según lo que YO preví.',
        ],
        player_mistake: [
          '{move}… Justo lo que esperaba. Gracias por colaborar.',
          'Mordiste el anzuelo, pero solo un poco.',
          'Ah, te alcanzó el canto de mis sirenas.',
          'Interesante. Muy interesante. Para mí, claro.',
          'Eso entra en mis planes. Bueno, en casi todos.',
        ],
        player_blunder: [
          '¡Ja! Tantas trampas preparadas y caíste en la más simple.',
          '¿{move}? Ni siquiera tuve que esconder el caballo.',
          'Le abriste las puertas de Troya a mi caballo.',
          'Nadie te hizo eso. Bueno, fui yo: Nadie.',
          'Qué regalo. Desconfía de los griegos que traen jugadas.',
        ],
        rival_wins: [
          'La astucia gana otra vez. Y yo vuelvo a Ítaca.',
          'Todo era una trampa. Desde la primera jugada.',
          'Gané. Pero no le cuentes a nadie cómo.',
          'Penélope me espera. Gracias por el entretenimiento.',
          'Partida ganada. ¿Revancha? Prometo más trampas.',
        ],
        rival_loses: [
          'Me engañaste a mí. Eso no lo logra cualquiera.',
          'Mis trampas eran buenas. Tus jugadas, mejores.',
          'Perdí… ¿o es parte de un plan mayor? No, perdí.',
          'Bien jugado. Hoy el astuto fuiste tú.',
          'Otro desvío de diez años. Felicidades.',
        ],
        draw: [
          'Tablas. Dos zorros que no se dejan atrapar.',
          'Empate. Nadie cayó en la trampa de nadie.',
          'Tablas. Creo que esto también era parte del plan.',
          'Ni tú ni yo. Por ahora.',
          'Un empate astuto. Me gusta tu estilo.',
        ],
        player_good_move: [
          'Vaya, viste la trampa. Pocos lo hacen.',
          '{move}. Astuto. Casi tanto como yo.',
          'Me quitaste el caballo de madera. Bravo.',
          'Tú también tienes tus trucos, ¿eh?',
        ],
      },
    },
    {
      level: 8,
      name: 'Aquiles',
      trait: 'Orgulloso e implacable: ataca sin descanso y solo respeta a quien le planta cara.',
      lines: {
        game_start: [
          'Prepárate. No conozco otra forma de jugar que atacando.',
          'El más rápido de los griegos llega a tu tablero.',
          'Que empiece la batalla. Yo nunca retrocedo.',
          'Mi lanza está lista. ¿Y tu defensa?',
          'Gloria eterna o nada. Así juego cada partida.',
        ],
        rival_good_move: [
          '{move}. Imparable, como mi carrera.',
          'Golpe directo. Así se gana la gloria.',
          'Sin piedad, pero con elegancia.',
          'Nadie resiste mucho tiempo esta presión.',
          'Mi ataque avanza. Nada lo detiene.',
        ],
        player_mistake: [
          '{move}. Un hueco en tu guardia. No lo dejaré pasar.',
          'Titubeas. En batalla eso se paga.',
          'Te vi dudar. Voy por ti.',
          'Esa jugada te deja expuesto. Prepárate.',
          'Un error. Y yo no perdono errores.',
        ],
        player_blunder: [
          '¿{move}? La gloria me cae del cielo.',
          'Bajaste la guardia. Ya es tarde.',
          'Eso es todo lo que necesitaba. ¡Al ataque!',
          'Un regalo así no se rechaza en batalla.',
          'Respira hondo. Lo que viene será duro.',
        ],
        rival_wins: [
          'Victoria. Como era de esperar.',
          'La gloria es mía. Peleaste bien, pero no lo suficiente.',
          'Otra batalla ganada. Mi nombre será recordado.',
          'No hay muralla que resista a Aquiles.',
          'Gané. Vuelve cuando quieras otra lección.',
        ],
        rival_loses: [
          '¿Cómo…? Encontraste mi talón. Bien jugado.',
          'Me duele más el orgullo que la derrota. Felicidades.',
          'Una sola grieta, y la viste. Respeto.',
          'Hoy la gloria es tuya. Disfrútala.',
          'Me venciste. Pocos pueden decir eso.',
        ],
        draw: [
          '¿Tablas? No me gusta, pero lo acepto.',
          'Empate. Ni mi lanza ni tu escudo cedieron.',
          'Tablas. La próxima no habrá tregua.',
          'Un empate… raro en mí. Te lo concedo.',
          'Sin vencedor. Volveremos a medirnos.',
        ],
        player_good_move: [
          'Hmm. Eso fue fuerte. Lo admito.',
          '{move}. Golpe digno de un héroe.',
          'Bien. Por fin un rival que pelea.',
          'Me rozaste el talón con esa jugada.',
        ],
      },
    },
    {
      level: 9,
      name: 'Heracles',
      trait: 'Pura fuerza y bravuconería: todo es otro de sus trabajos, y se ríe a carcajadas.',
      lines: {
        game_start: [
          '¡Ja! Otro trabajo para Heracles. ¿Este es el decimotercero?',
          'Calenté levantando un toro. Ya estoy listo.',
          'Calma, intentaré no romper el tablero.',
          'Doce trabajos hechos. Esta partida es el siguiente.',
          '¡A jugar! Mis piezas pesan como columnas.',
        ],
        rival_good_move: [
          '¡{move}! ¡Fuerza bruta… y algo de cerebro!',
          '¡Así se le gana al león de Nemea!',
          '¡Esa jugada levantó el tablero entero!',
          'Fuerza bien dirigida. ¡Ese es el secreto!',
          '¡Otra cabeza de la hidra menos!',
        ],
        player_mistake: [
          '{move}… ¡Ja! Eso no detiene a Heracles.',
          'Esa defensa es de papel. ¡Allá voy!',
          'Te tiemblan las piezas, ¿eh? Normal.',
          'Uy. Eso me deja vía libre para empujar.',
          'Mis músculos sintieron esa debilidad.',
        ],
        player_blunder: [
          '¿¡{move}!? ¡Ni el león de Nemea fue tan fácil!',
          '¡Pieza gratis! ¡Al saco con los otros trofeos!',
          '¡Ja! Así hasta los establos de Augías se limpian solos.',
          '¡Eso sí que es un trabajo fácil!',
          '¡Uf! Hasta me da pena. Poquita.',
        ],
        rival_wins: [
          '¡Otro trabajo completado! ¡Que lo graben en mármol!',
          '¡Victoria! ¿Alguien tiene un toro para celebrar levantándolo?',
          'Ni con doce cabezas me habrías parado. ¡Buena pelea!',
          '¡Ja! Fuerza y corazón. Gracias por el ejercicio.',
          '¡Gané! Ahora sí me merezco un banquete en el Olimpo.',
        ],
        rival_loses: [
          '¿¡Perdí!? Ni la hidra me hizo esto. ¡Bravo!',
          'Me ganaste con la cabeza, no con los brazos. Respeto.',
          'Este trabajo me quedó grande. ¡Felicidades!',
          '¡Uf! Necesito otro trabajo para reponerme.',
          'Toda mi fuerza y no bastó. ¡Gran partida!',
        ],
        draw: [
          '¿Tablas? ¡Echamos un pulso y empatamos! Me caes bien.',
          'Empate. Ni empujando lo moví más.',
          'Tablas. Ni Atlas sostiene tanto equilibrio.',
          '¡Fuerza igualada! Eso no me pasa seguido.',
          'Nadie cae. ¡Revancha con más músculo!',
        ],
        player_good_move: [
          '¡Ja! ¡Esa tuvo fuerza! Me gusta.',
          '{move}. Eso fue un buen golpe, campeón.',
          '¡Uf! Esa me hizo sudar.',
          '¡Bravo! Tienes brazos de héroe.',
        ],
      },
    },
    {
      level: 10,
      name: 'Atenea',
      trait: 'Serena y sabia: habla poco, con calma, y convierte cada momento en una lección.',
      lines: {
        game_start: [
          'Te doy la bienvenida. Juguemos con calma y pensemos con claridad.',
          'Cada partida es una lección. Para ambos.',
          'La lechuza ya mira el tablero. Cuando quieras.',
          'La estrategia empieza antes de la primera jugada.',
          'Respira. Las mejores ideas llegan en silencio.',
        ],
        rival_good_move: [
          '{move}. La posición pedía esto.',
          'Paciencia: el plan se revela solo.',
          'Una jugada tranquila puede valer más que un ataque.',
          'Así se coordina un ejército.',
          'La armonía de las piezas habla por sí sola.',
        ],
        player_mistake: [
          '{move} afloja tu posición. Observa qué cambió.',
          'Una imprecisión. Pregúntate qué quería tu rival.',
          'Esa jugada deja una casilla débil. Mírala bien.',
          'Calma. Un error no decide la partida.',
          'Había una idea mejor. A veces está a un paso.',
        ],
        player_blunder: [
          '{move} pierde material. Antes de mover, revisa lo atacado.',
          'Un descuido grave. La sabiduría empieza por notarlo.',
          'Esa pieza quedó sin defensa. Lo aprovecharé, con respeto.',
          'Te apresuraste. La lechuza nunca se apresura.',
          'Respira. Del error también se aprende.',
        ],
        rival_wins: [
          'Buena partida. Revisa los momentos clave: ahí está tu próximo paso.',
          'La estrategia prevaleció hoy. Tú también creciste.',
          'Gané, pero jugaste con valor. Sigue así.',
          'Victoria serena. Gracias por la partida.',
          'Cada derrota guarda una lección. Encuéntrala.',
        ],
        rival_loses: [
          'Me superaste. Eso es digno de admiración.',
          'Hoy la sabiduría estuvo de tu lado. Felicidades.',
          'Jugaste mejor. Acepto la derrota con gusto.',
          'Hasta los dioses aprenden. Hoy aprendí de ti.',
          'Excelente. Ese plan fue digno del Olimpo.',
        ],
        draw: [
          'Tablas. Un equilibrio perfecto.',
          'Empate justo: ninguno cometió el error decisivo.',
          'Tablas. La armonía también es un resultado.',
          'Ni victoria ni derrota: solo buen ajedrez.',
          'Un empate sabio. Bien jugado.',
        ],
        player_good_move: [
          'Muy bien. Esa jugada tiene profundidad.',
          '{move}. Eso es pensar con claridad.',
          'Excelente idea. Sigue confiando en tu análisis.',
          'Esa jugada me obliga a pensar. Bien hecho.',
        ],
      },
    },
  ].map((p) => deepFreeze(p)),
);

/** Congela la personalidad y sus listas de frases (declaración de función: se usa arriba). */
function deepFreeze(p) {
  return Object.freeze({
    ...p,
    lines: Object.freeze(Object.fromEntries(Object.entries(p.lines).map(([k, v]) => [k, Object.freeze([...v])]))),
  });
}

/** Versión inglesa de cada personalidad (mismo nivel y nombre; rasgo y frases adaptados). */
const PERSONALITIES_BY_LANG = Object.freeze({
  es: PERSONALITIES,
  en: Object.freeze(PERSONALITIES.map((p) => deepFreeze({ level: p.level, name: p.name, ...PERSONALITIES_EN[p.level] }))),
});

/**
 * Personalidad de un nivel (1–10) en un idioma ('es' por defecto; otro idioma desconocido → 'es').
 * @param {number} level
 * @param {string} [lang]
 * @returns {RivalPersonality}
 */
export function getPersonality(level, lang = 'es') {
  const list = PERSONALITIES_BY_LANG[lang] ?? PERSONALITIES_BY_LANG.es;
  const p = list.find((x) => x.level === level);
  if (!p) throw new RangeError(`Rival sin personalidad: nivel ${level}`);
  return p;
}
