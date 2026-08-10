/* German Study — the everyday-speech frequency list behind the hub's coverage bar.
 *
 * Loaded as a plain script; defines one global: FREQ. Read by stats.js only.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND HOW HONEST THE NUMBER IS
 * ---------------------------------------------------------------------------
 * The familiar claim is that a small core of German words accounts for most of
 * what people actually say — the top ~700-1000 lemmas cover roughly 80% of the
 * running words in everyday speech. That is the bar we draw.
 *
 * `words` below is that core, in rough frequency-rank order: the function words,
 * pronouns, auxiliaries and modal verbs that carry conversation, plus the highest
 * -frequency everyday nouns, verbs and adjectives. Rank order follows standard
 * spoken-German frequency studies (Leipzig-corpus-style ordering, as reflected in
 * the usual A1/A2 frequency lists).
 *
 * `s` is each lemma's SHARE of everyday running speech. Coverage is the SUM of `s`
 * over the lemmas the learner knows — deliberately not a raw count, because a raw
 * count would claim that knowing two rare nouns is worth as much as knowing "und"
 * and "ich", which is badly false. The shares are a Zipfian fit (s ∝ 1/(rank+β)),
 * normalised so the whole list sums to TOTAL_SHARE below.
 *
 * So: the ORDER is empirical, the individual per-word shares are a smooth model
 * rather than measured counts, and the total is the conventional figure such a
 * list is credited with. That is why the UI says "≈" and calls it an estimate.
 * It is a motivational gauge that moves for the right reasons — a learner who
 * picks up core function words sees it move much faster than one who picks up
 * the same number of rare nouns — not a corpus measurement.
 *
 * Adding a word here can only make an existing learner's percentage go DOWN
 * slightly (the normalisation spreads the same total over more lemmas), never
 * invalidate their progress. Nothing here is stored per user.
 */
window.FREQ = (function () {
  // The share of everyday running speech that this whole list is credited with.
  var TOTAL_SHARE = 0.80;

  /* The core, in rough frequency order. Lower-case lemmas, no articles: nouns are
     matched against the learner's vocabulary after the article is stripped, so
     "der Mann" here would never match. Verbs are infinitives. */
  var CORE = [
    // --- the top of every German frequency list: function words & pronouns ---
    'der', 'die', 'das', 'und', 'sein', 'in', 'ein', 'zu', 'haben', 'ich',
    'werden', 'sie', 'von', 'nicht', 'mit', 'es', 'sich', 'auch', 'auf', 'für',
    'an', 'er', 'so', 'dass', 'können', 'dies', 'als', 'ihr', 'ja', 'wie',
    'bei', 'oder', 'wir', 'aber', 'dann', 'man', 'da', 'sein', 'noch', 'nach',
    'was', 'schon', 'wenn', 'nur', 'müssen', 'sagen', 'um', 'aus', 'immer', 'sehr',
    'wollen', 'mehr', 'durch', 'über', 'kein', 'wo', 'jetzt', 'hier', 'doch', 'vor',
    'du', 'mein', 'wieder', 'ganz', 'eigentlich', 'weil', 'gut', 'viel', 'mal', 'gehen',
    'machen', 'kommen', 'sollen', 'wissen', 'geben', 'alle', 'sehen', 'lassen', 'stehen', 'finden',
    'bleiben', 'liegen', 'heißen', 'denken', 'nehmen', 'tun', 'dürfen', 'glauben', 'halten', 'nennen',
    'zwei', 'unter', 'ohne', 'zwischen', 'gegen', 'bis', 'seit', 'schön', 'neu', 'erst',
    'groß', 'klein', 'alt', 'jung', 'lang', 'hoch', 'gering', 'weit', 'früh', 'spät',

    // --- pronouns & determiners in their spoken forms ---
    'mich', 'mir', 'dich', 'dir', 'ihn', 'ihm', 'uns', 'euch', 'ihnen', 'wer',
    'wen', 'wem', 'welcher', 'jeder', 'manche', 'einige', 'viele', 'wenige', 'beide', 'andere',
    'dein', 'unser', 'euer', 'niemand', 'jemand', 'etwas', 'nichts', 'alles', 'selbst', 'einander',

    // --- the everyday verbs conversation actually runs on ---
    'arbeiten', 'spielen', 'leben', 'wohnen', 'essen', 'trinken', 'schlafen', 'laufen', 'fahren', 'fliegen',
    'sprechen', 'reden', 'fragen', 'antworten', 'hören', 'lesen', 'schreiben', 'lernen', 'verstehen', 'erklären',
    'kaufen', 'zahlen', 'kosten', 'bringen', 'holen', 'tragen', 'legen', 'setzen', 'stellen', 'öffnen',
    'schließen', 'anfangen', 'aufhören', 'warten', 'suchen', 'brauchen', 'helfen', 'zeigen', 'treffen', 'besuchen',
    'lieben', 'mögen', 'hassen', 'gefallen', 'freuen', 'lachen', 'weinen', 'spielen', 'tanzen', 'singen',
    'kochen', 'backen', 'waschen', 'putzen', 'aufräumen', 'bauen', 'malen', 'zeichnen', 'schneiden', 'reparieren',
    'aufstehen', 'aufwachen', 'anziehen', 'ausziehen', 'mitnehmen', 'ankommen', 'abfahren', 'einsteigen', 'aussteigen', 'umsteigen',
    'sitzen', 'aufmachen', 'zumachen', 'anschauen', 'ansehen', 'aussehen', 'gehören', 'passieren', 'werfen', 'fangen',
    'springen', 'klettern', 'schwimmen', 'reiten', 'wandern', 'joggen', 'rennen', 'ziehen', 'drücken', 'halten',

    // --- time: the highest-frequency nouns in any spoken corpus ---
    'zeit', 'jahr', 'tag', 'stunde', 'minute', 'woche', 'monat', 'morgen', 'abend', 'nacht',
    'mittag', 'uhr', 'heute', 'gestern', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag',
    'sonntag', 'wochenende', 'sommer', 'winter', 'frühling', 'herbst', 'januar', 'dezember', 'anfang', 'ende',

    // --- people & family ---
    'mensch', 'mann', 'frau', 'kind', 'leute', 'freund', 'freundin', 'familie', 'mutter', 'vater',
    'eltern', 'sohn', 'tochter', 'bruder', 'schwester', 'geschwister', 'oma', 'opa', 'großmutter', 'großvater',
    'onkel', 'tante', 'cousin', 'baby', 'junge', 'mädchen', 'herr', 'name', 'person', 'nachbar',

    // --- home & everyday objects ---
    'haus', 'wohnung', 'zimmer', 'küche', 'bad', 'badezimmer', 'schlafzimmer', 'wohnzimmer', 'garten', 'tür',
    'fenster', 'tisch', 'stuhl', 'bett', 'sofa', 'schrank', 'regal', 'lampe', 'boden', 'wand',
    'dach', 'treppe', 'schlüssel', 'tasche', 'geld', 'handy', 'telefon', 'computer', 'buch', 'papier',
    'stift', 'brief', 'bild', 'foto', 'zeitung', 'karte', 'glas', 'flasche', 'tasse', 'teller',
    'messer', 'gabel', 'löffel', 'topf', 'pfanne', 'kühlschrank', 'herd', 'wasserhahn', 'spiegel', 'uhr',

    // --- food & drink ---
    'wasser', 'kaffee', 'tee', 'milch', 'saft', 'bier', 'wein', 'brot', 'brötchen', 'butter',
    'käse', 'ei', 'fleisch', 'fisch', 'gemüse', 'obst', 'apfel', 'banane', 'kartoffel', 'tomate',
    'salat', 'suppe', 'reis', 'nudeln', 'zucker', 'salz', 'kuchen', 'schokolade', 'eis', 'essen',

    // --- body & health ---
    'körper', 'kopf', 'haar', 'gesicht', 'auge', 'ohr', 'nase', 'mund', 'zahn', 'hals',
    'arm', 'hand', 'finger', 'bein', 'fuß', 'knie', 'rücken', 'bauch', 'herz', 'blut',
    'haut', 'schmerz', 'arzt', 'krank', 'gesund', 'müde', 'hunger', 'durst',

    // --- out in the world ---
    'stadt', 'dorf', 'land', 'straße', 'weg', 'platz', 'park', 'schule', 'universität', 'büro',
    'arbeit', 'beruf', 'geschäft', 'laden', 'markt', 'restaurant', 'hotel', 'bahnhof', 'flughafen', 'zug',
    'bus', 'auto', 'fahrrad', 'straßenbahn', 'flugzeug', 'schiff', 'welt', 'himmel', 'sonne', 'mond',
    'stern', 'wetter', 'regen', 'schnee', 'wind', 'wolke', 'baum', 'blume', 'wald', 'berg',
    'see', 'meer', 'fluss', 'strand', 'feld', 'tier', 'hund', 'katze', 'vogel', 'pferd',

    // --- adjectives that carry description ---
    'schnell', 'langsam', 'stark', 'schwach', 'warm', 'kalt', 'heiß', 'kühl', 'nass', 'trocken',
    'hell', 'dunkel', 'laut', 'leise', 'sauber', 'schmutzig', 'voll', 'leer', 'schwer', 'leicht',
    'richtig', 'falsch', 'einfach', 'schwierig', 'wichtig', 'interessant', 'langweilig', 'lustig', 'traurig', 'glücklich',
    'freundlich', 'nett', 'böse', 'ruhig', 'weich', 'hart', 'rund', 'dick', 'dünn', 'breit',
    'schmal', 'tief', 'kurz', 'teuer', 'billig', 'frei', 'fertig', 'offen', 'zu', 'möglich',
    'rot', 'blau', 'grün', 'gelb', 'schwarz', 'weiß', 'braun', 'grau', 'orange', 'rosa',

    // --- adverbs & connectors that hold sentences together ---
    'oben', 'unten', 'links', 'rechts', 'vorne', 'hinten', 'innen', 'außen', 'dort', 'überall',
    'oft', 'manchmal', 'nie', 'selten', 'gleich', 'zusammen', 'allein', 'wirklich', 'vielleicht', 'natürlich',
    'bestimmt', 'genau', 'fast', 'ziemlich', 'besonders', 'endlich', 'plötzlich', 'zuerst', 'danach', 'trotzdem',
    'deshalb', 'also', 'denn', 'obwohl', 'damit', 'bevor', 'nachdem', 'während', 'seitdem', 'falls',
    'bitte', 'danke', 'entschuldigung', 'hallo', 'tschüss', 'nein', 'gern', 'los', 'weg', 'her',

    // --- numbers: extremely high frequency in speech ---
    'eins', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf',
    'zwölf', 'zwanzig', 'dreißig', 'hundert', 'tausend', 'million', 'erste', 'zweite', 'letzte', 'nächste',

    // --- abstractions that show up constantly ---
    'sache', 'ding', 'teil', 'stück', 'art', 'weise', 'grund', 'frage', 'antwort', 'problem',
    'idee', 'plan', 'wort', 'satz', 'sprache', 'geschichte', 'musik', 'film', 'spiel', 'sport',
    'farbe', 'form', 'größe', 'seite', 'mitte', 'nummer', 'beispiel', 'unterschied', 'möglichkeit', 'meinung'
  ];

  /* Dedupe while KEEPING first (= highest-frequency) position. A few lemmas appear
     twice above because they belong to two sense-groups (e.g. "sein", "spielen",
     "zu"); the first occurrence is the one that counts. */
  var words = [], seen = {};
  for (var i = 0; i < CORE.length; i++) {
    var w = CORE[i];
    if (!seen[w]) { seen[w] = true; words.push(w); }
  }

  /* Zipfian shares: s ∝ 1/(rank + BETA), normalised to TOTAL_SHARE. BETA flattens
     the head a little so the very top words don't swamp everything — without it,
     "der" alone would be worth ~3% and the bar would jump absurdly on lesson one. */
  var BETA = 40;
  var raw = [], sum = 0;
  for (var r = 0; r < words.length; r++) {
    var v = 1 / (r + 1 + BETA);
    raw.push(v); sum += v;
  }
  var entries = [];
  for (var j = 0; j < words.length; j++) {
    entries.push({ w: words[j], r: j + 1, s: (raw[j] / sum) * TOTAL_SHARE });
  }

  /* Surface forms that appear in our card fronts but are not the lemma the list
     carries. Everything here is lower-case and article-free; stats.js applies this
     map BEFORE its generic plural/umlaut stripping, so it is only needed for forms
     that the generic rules cannot reach. */
  var lemma = {
    // irregular plurals whose singular the generic rules cannot recover
    'hände': 'hand', 'häuser': 'haus', 'bücher': 'buch', 'männer': 'mann', 'frauen': 'frau',
    'kinder': 'kind', 'väter': 'vater', 'mütter': 'mutter', 'brüder': 'bruder', 'söhne': 'sohn',
    'töchter': 'tochter', 'schwestern': 'schwester', 'füße': 'fuß', 'köpfe': 'kopf', 'bäume': 'baum',
    'wälder': 'wald', 'berge': 'berg', 'städte': 'stadt', 'länder': 'land', 'wörter': 'wort',
    'zähne': 'zahn', 'ärzte': 'arzt', 'gläser': 'glas', 'töpfe': 'topf', 'stühle': 'stuhl',
    'schränke': 'schrank', 'tische': 'tisch', 'betten': 'bett', 'zimmer': 'zimmer', 'fenster': 'fenster',
    'türen': 'tür', 'straßen': 'straße', 'plätze': 'platz', 'züge': 'zug', 'autos': 'auto',
    'räder': 'rad', 'vögel': 'vogel', 'hunde': 'hund', 'katzen': 'katze', 'pferde': 'pferd',
    'blumen': 'blume', 'äpfel': 'apfel', 'eier': 'ei', 'gärten': 'garten', 'dächer': 'dach',
    'arme': 'arm', 'beine': 'bein', 'augen': 'auge', 'ohren': 'ohr', 'nasen': 'nase',
    'finger': 'finger', 'haare': 'haar', 'namen': 'name', 'leute': 'leute', 'eltern': 'eltern',
    'geschwister': 'geschwister', 'ferien': 'ferien', 'nudeln': 'nudeln', 'tassen': 'tasse',
    'teller': 'teller', 'messer': 'messer', 'gabeln': 'gabel', 'löffel': 'löffel', 'flaschen': 'flasche',
    'taschen': 'tasche', 'stifte': 'stift', 'bilder': 'bild', 'fotos': 'foto', 'karten': 'karte',
    'schlüssel': 'schlüssel', 'lampen': 'lampe', 'wände': 'wand', 'böden': 'boden', 'treppen': 'treppe',
    'wolken': 'wolke', 'sterne': 'stern', 'flüsse': 'fluss', 'seen': 'see', 'strände': 'strand',
    'felder': 'feld', 'tiere': 'tier', 'stunden': 'stunde', 'minuten': 'minute', 'wochen': 'woche',
    'monate': 'monat', 'jahre': 'jahr', 'tage': 'tag', 'nächte': 'nacht', 'abende': 'abend',
    'freunde': 'freund', 'familien': 'familie', 'wohnungen': 'wohnung', 'küchen': 'küche',
    'schulen': 'schule', 'sachen': 'sache', 'dinge': 'ding', 'teile': 'teil', 'stücke': 'stück',
    'fragen': 'frage', 'antworten': 'antwort', 'probleme': 'problem', 'ideen': 'idee', 'sätze': 'satz',
    'sprachen': 'sprache', 'geschichten': 'geschichte', 'filme': 'film', 'spiele': 'spiel',
    'farben': 'farbe', 'formen': 'form', 'seiten': 'seite', 'nummern': 'nummer', 'meinungen': 'meinung',

    // spoken/contracted forms and common variants
    'is': 'sein', 'bin': 'sein', 'ist': 'sein', 'sind': 'sein', 'war': 'sein', 'waren': 'sein',
    'hat': 'haben', 'hab': 'haben', 'habe': 'haben', 'hatte': 'haben',
    'wird': 'werden', 'wurde': 'werden', 'geht': 'gehen', 'kommt': 'kommen', 'macht': 'machen',
    'kann': 'können', 'muss': 'müssen', 'will': 'wollen', 'darf': 'dürfen', 'soll': 'sollen',
    'weiß': 'wissen', 'gibt': 'geben', 'sieht': 'sehen', 'nimmt': 'nehmen',
    'am': 'an', 'im': 'in', 'ins': 'in', 'zum': 'zu', 'zur': 'zu', 'vom': 'von',
    'beim': 'bei', 'ans': 'an', 'aufs': 'auf', 'fürs': 'für', 'übers': 'über',
    'eine': 'ein', 'einen': 'ein', 'einem': 'ein', 'einer': 'ein', 'eines': 'ein',
    'den': 'der', 'dem': 'der', 'des': 'der', 'diese': 'dies', 'dieser': 'dies', 'dieses': 'dies',
    'keine': 'kein', 'keinen': 'kein', 'meine': 'mein', 'meinen': 'mein',
    'großmama': 'großmutter', 'großpapa': 'großvater', 'mama': 'mutter', 'papa': 'vater',
    'fahrräder': 'fahrrad', 'handys': 'handy', 'babys': 'baby', 'omas': 'oma', 'opas': 'opa'
  };

  return {
    version: 1,
    total: entries.length,
    totalShare: TOTAL_SHARE,
    words: entries,
    lemma: lemma
  };
})();
