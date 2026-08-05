/* German Study — the single lesson catalogue.
 *
 * The hub (index.html) and the admin panel (admin.html) both read this, so the two can
 * never drift apart. Loaded as a plain script; it defines one global: LESSONS.
 *
 * Fields: stage, n (display number), file, id (YouTube id), slug, title, de, tag.
 *   - `slug` is the PERMANENT identity used for de.<slug>.* storage/sync keys and for the
 *     admin visibility list. Never change or reuse one — see CLAUDE.md.
 *   - `n` and `file` are display/navigation only; reordering them is progress-safe.
 */
window.LESSONS = [
  // ---- Stufe 1 · Foundations ----
  {stage:1,n:1,file:"01_alphabet_pronunciation.html",id:"hAkxKMlYUI4",slug:"alphabet",title:"Alphabet & Pronunciation",de:"Das deutsche Alphabet",tag:"Letters · sounds · umlauts"},

  // ---- Stufe 2 · Vocabulary (concrete nouns & scenes) ----
  {stage:2,n:2,file:"02_tea_kitchen.html",id:"WBtiAYV-Dfw",slug:"tea",title:"Making Tea",de:"Ich mache mir einen Tee",tag:"Kitchen nouns · der/die/das"},
  {stage:2,n:3,file:"03_kitchen.html",id:"XETfpbtc2rY",slug:"kitchen",title:"In the Kitchen",de:"Die Küche",tag:"Kitchen tour · stehen/hängen/liegen"},
  {stage:2,n:4,file:"04_hands_fingers.html",id:"awscSvqsS9U",slug:"hands",title:"Hands & Fingers",de:"Die Hände und die Finger",tag:"Body · left/right · verbs"},
  {stage:2,n:5,file:"05_tram.html",id:"HiiF1kDnYt4",slug:"tram",title:"On the Tram",de:"In der Straßenbahn",tag:"Transport · getting on/off"},
  {stage:2,n:6,file:"06_cat_table.html",id:"dnmT-utNxDs",slug:"cattable",title:"The Cat on the Table",de:"Die Katze schläft",tag:"Fur · soft/hard · aus Holz/Metall"},
  {stage:2,n:7,file:"07_photo_scene.html",id:"Qk8nNN7Volg",slug:"photo",title:"Describing a Photo",de:"Wir schauen ein Bild an",tag:"Objects · thick/thin · clock"},
  {stage:2,n:8,file:"08_houses.html",id:"zjSNHlrBOII",slug:"houses",title:"The Three Houses",de:"Die drei Häuser",tag:"Roof/chimney · zwischen · plurals"},
  {stage:2,n:9,file:"09_child_dog.html",id:"pew42Zq8y1E",slug:"childdog",title:"Child, Dog & Flower",de:"Das Kind und der Hund",tag:"über/unter · scene"},
  {stage:2,n:10,file:"10_living_room.html",id:"rkF5r9vAeoQ",slug:"livingroom",title:"The Living Room",de:"Das Wohnzimmer",tag:"Furniture · neben/auf/an · ja/nein"},
  {stage:2,n:11,file:"11_beach.html",id:"F_mGqap-_t4",slug:"beach",title:"Three Women at the Beach",de:"Drei Frauen am Strand",tag:"Colours as adjectives · links/rechts"},
  {stage:2,n:12,file:"12_apple.html",id:"zO4k4n9fL44",slug:"apple",title:"Cutting an Apple",de:"Ich schneide einen Apfel",tag:"Knife · peel/core · whole/half"},
  {stage:2,n:13,file:"13_pencil_case.html",id:"ycogsUe24FM",slug:"pencilcase",title:"The Pencil Case",de:"Mein Mäppchen",tag:"Pens · same/different · caps"},
  {stage:2,n:14,file:"14_weather_week.html",id:"nLq5hdGQuHw",slug:"weatherweek",title:"Weather & the Week",de:"Das Wetter & die Woche",tag:"Days · weather · gestern/heute/morgen"},
  {stage:2,n:15,file:"15_winter_girl.html",id:"tzJqBfvTlQI",slug:"wintergirl",title:"The Girl in Winter",de:"Das Mädchen im Winter",tag:"Clothing · tragen · colours"},

  // ---- Stufe 2 (continued) · the body, people & the everyday world ----
  {stage:2,n:16,file:"16_body_parts.html",id:"Ngy_6VW1JOE",slug:"koerper",title:"Parts of the Body",de:"Der Körper und die Körperteile",tag:"Head to toe · what each part does"},
  {stage:2,n:17,file:"17_face_parts.html",id:"mns-P8FB37s",slug:"gesicht",title:"Parts of the Face",de:"Das Gesicht",tag:"Eyes/ears/nose · the five senses"},
  {stage:2,n:18,file:"18_describing_people.html",id:"TI70A-ZobXo",slug:"personen",title:"Describing People",de:"Personen beschreiben",tag:"Tall/slim · hair & eyes · character · jobs"},
  {stage:2,n:19,file:"19_family.html",id:"E8gJks0PKd0",slug:"familie",title:"Emma's Family",de:"Emmas Familie",tag:"Parents · siblings · aunts, uncles, cousins"},
  {stage:2,n:20,file:"20_counting.html",id:"fYyaK2_C9yw",slug:"zaehlen",title:"Let's Count",de:"Wir zählen auf Deutsch",tag:"Numbers 1-30 · how many? · counting things"},
  {stage:2,n:21,file:"21_home_rooms.html",id:"lK9ef5fftW4",slug:"zuhause",title:"Describing Your Home",de:"Emmas Haus",tag:"Six rooms · furniture · the garden"},
  {stage:2,n:22,file:"22_daily_things.html",id:"DXih53xUERU",slug:"jedentag",title:"Things We Do Every Day",de:"Dinge, die wir jeden Tag machen",tag:"Sleep/wake/eat/walk · everyday verbs"},
  {stage:2,n:23,file:"23_emmas_week.html",id:"2ehaFqxDxtM",slug:"woche",title:"Emma's Week: Hobbies & Days",de:"Emmas Woche",tag:"Mon-Sun · hobbies · morgens/abends"},
  {stage:2,n:24,file:"24_bag_contents.html",id:"XIYsmkoHoPI",slug:"tasche",title:"Things I Carry in My Bag",de:"Was ist in meiner Tasche?",tag:"Everyday objects · wallet, keys, tissues"},
  {stage:2,n:25,file:"25_funny_animals.html",id:"0Yel0i3tpEo",slug:"tiernamen",title:"Funny Animal Names",de:"Lustige Tiernamen",tag:"Rhino, skunk, raccoon, slug, sloth · compounds"},
  {stage:2,n:26,file:"26_green_animals.html",id:"EMEnR6WQ250",slug:"gruenetiere",title:"Green Animals — Guess Which",de:"Grüne Tiere",tag:"Turtle, croc, frog, snake, dino · describing"},
  {stage:2,n:27,file:"27_love_hate.html",id:"nsjNxiQ3470",slug:"liebehasse",title:"Things I Love vs Things I Hate",de:"Dinge, die ich liebe und hasse",tag:"lieben/hassen · opinions · summer & mountains"},
  {stage:2,n:28,file:"28_creepy_things.html",id:"a_Tp7qTa5Jk",slug:"gruselig",title:"Things We Find Creepy",de:"Gruselige Dinge",tag:"finden + adjective · dolls, fog, caves, clowns"},
  {stage:2,n:29,file:"29_snow_activities.html",id:"VH-ckQhjy1E",slug:"schnee",title:"Things to Do in the Snow",de:"Was man im Schnee machen kann",tag:"Snowball fight · snowman · sledging"},
  {stage:2,n:30,file:"30_christmas.html",id:"fnKkltPH4QU",slug:"weihnachten",title:"Christmas Vocabulary",de:"Weihnachtsvokabeln",tag:"Advent calendar · tree · presents · Santa"},

  // ---- Stufe 3 · Grammar ----
  {stage:3,n:31,file:"31_articles_intro.html",id:"oeWqRNO02k4",slug:"articles",title:"der / die / das — Intro",de:"Die Artikel",tag:"Gender basics · adjectives"},
  {stage:3,n:32,file:"32_word_gender.html",id:"cyRDSqopIyA",slug:"gender",title:"Guessing a Word's Gender",de:"Das Geschlecht der Nomen",tag:"Ending rules · -ung -chen -ismus"},
  {stage:3,n:33,file:"33_sentence_structure.html",id:"qDrgJz9V2Yk",slug:"satzbau",title:"Sentence Structure",de:"Der Satzbau",tag:"Verb-second · TMP · Nebensatz"},
  {stage:3,n:34,file:"34_questions.html",id:"1WT_cuee12Y",slug:"fragen",title:"Asking Questions",de:"Fragen stellen",tag:"W-words · yes/no · word order"},
  {stage:3,n:35,file:"35_prepositions_an_auf_in.html",id:"2ooxcrMJXjI",slug:"prep",title:"an / auf / in (Dativ & Akkusativ)",de:"Lokale Präpositionen",tag:"wo? vs wohin? · contractions"},
  {stage:3,n:36,file:"36_aus_vs_von.html",id:"iog_s5I6idA",slug:"ausvon",title:"aus vs. von",de:"aus oder von?",tag:"Where you came from · dative"},

  // ---- Stufe 4 · Speaking about yourself ----
  {stage:4,n:37,file:"37_introduce_yourself.html",id:"huwi-cjPPXU",id2:"Yaelm87PTvg",slug:"vorstellen",title:"Introduce Yourself",de:"Sich vorstellen",tag:"Name · age · home · hobbies"},

  // ---- Stufe 5 · Stories & longer input ----
  {stage:5,n:38,file:"38_felix_park.html",id:"omHq0j5MGb4",slug:"felixpark",title:"Felix at the Park",de:"Felix im Park",tag:"A short story · past-tense feel · climbing & jumping"},
  {stage:5,n:39,file:"39_peter_rabbit.html",id:"8sIfpXZ86kQ",slug:"peterhase",title:"Peter Rabbit — Describing Pictures",de:"Peter Hase",tag:"Clothing · running & hiding · a picture book"},
  {stage:5,n:40,file:"40_snow_white.html",id:"dMaIgKKNFCY",slug:"schneewittchen",title:"Snow White & the Seven Dwarfs",de:"Schneewittchen",tag:"Fairy tale · the magic mirror · poisoned apple"},
  {stage:5,n:41,file:"41_struwwelpeter.html",id:"-y1rxt6wd2c",slug:"friedrich",title:"The Story of Wicked Frederick",de:"Die Geschichte vom bösen Friedrich",tag:"Struwwelpeter · a cruel boy gets his comeuppance"},
  {stage:5,n:42,file:"42_guess_character.html",id:"AxGUGDQaFyQ",slug:"figuren",title:"Guess the Fictional Character",de:"Kannst du die Person erraten?",tag:"A guessing game · describing people again"},
  {stage:5,n:43,file:"43_guess_movie.html",id:"D5uPm7d3Udg",slug:"filme",title:"Guess the Movie",de:"Kannst du den Film erraten?",tag:"Longer input · Home Alone & Shrek"},
  {stage:5,n:44,file:"44_tennis_match.html",id:"v9C44PCDNkw",slug:"tennisspiel",title:"A1 Story: The Tennis Match",de:"Das Tennisspiel",tag:"A full A1 story · arguing, a bet, the museum"},
  {stage:5,n:45,file:"45_felix_school.html",id:"xS3uDVuz6fU",slug:"felixschule",title:"Felix at School",de:"Felix in der Schule",tag:"School day · falling asleep in class · food fight"},
  {stage:5,n:46,file:"46_cookie_thief.html",id:"EcP0sZwwd8w",slug:"keksdieb",title:"The Cookie Thief — a Poem with a Twist",de:"Der Keksdieb",tag:"Airport story · a twist ending · höflich/unhöflich"},
  {stage:5,n:47,file:"47_princess_innkeeper.html",id:"T_ldqPVqWwc",slug:"wuerttemberg",title:"The Princess & the Innkeeper",de:"Die Prinzessin und der Wirt",tag:"A German legend · how Württemberg got its name"},

  // ---- Stufe 6 · Culture, opinions & real-world German ----
  {stage:6,n:48,file:"48_things_i_like.html",id:"4Uz6TXh9OUU",slug:"ichmag",title:"Things I Like",de:"Dinge, die ich mag",tag:"Fruit & veg · music · instruments · travel"},
  {stage:6,n:49,file:"49_uk_things.html",id:"N-4U01hBLko",slug:"grossbritannien",title:"Things I Like About the UK",de:"Was ich an Großbritannien mag",tag:"Language · accents · humour · landscape · pubs"},
  {stage:6,n:50,file:"50_polite_impolite.html",id:"zDxlhYwSU-0",slug:"hoeflich",title:"Polite vs Impolite in Germany",de:"Höflich und unhöflich",tag:"Guten Appetit · punctuality · shoes off · Sunday quiet"},
  {stage:6,n:51,file:"51_st_martin.html",id:"bfG4FAil2Pk",slug:"martinstag",title:"St. Martin's Day & the Lantern Walk",de:"Der Sankt-Martins-Tag",tag:"A German tradition · lanterns · the shared cloak"},
  {stage:6,n:52,file:"52_fashion_trends.html",id:"LER7gJi5hWg",slug:"mode",title:"Fashion Trends from School Days",de:"Modetrends aus meiner Schulzeit",tag:"Clothing revisited · trousers, tops, bags, earrings"},
  {stage:6,n:53,file:"53_cassette_tapes.html",id:"qNzVwfBXyDE",slug:"kassetten",title:"Childhood Cassette Tapes",de:"Meine Kassetten als Kind",tag:"Bibi Blocksberg · Hui Buh · TKKG · describing series"},
  {stage:6,n:54,file:"54_guess_country.html",id:"eB8hOHsP1GQ",slug:"laender",title:"Guess the Country",de:"Kannst du das Land erraten?",tag:"Countries · flags · geography · a guessing game"},
  {stage:6,n:55,file:"55_german_numbers.html",id:"4guODmVfzhw",slug:"deutschzahlen",title:"The German Language in Numbers",de:"Die deutsche Sprache in Zahlen",tag:"Who speaks German & where · big numbers"},
  {stage:6,n:56,file:"56_germany_facts.html",id:"EqLYcBlyrjo",slug:"deutschlandfakten",title:"Germany in Facts & Figures",de:"Deutschland in Zahlen und Fakten",tag:"Population · rivers · mountains · geography"},
  {stage:6,n:57,file:"57_autobahn.html",id:"aMQ88JhVbuI",slug:"autobahn",title:"10 Facts About the Autobahn",de:"Zehn Fakten über die Autobahn",tag:"Speed limits · Rettungsgasse · longest & shortest"}
];
