/* ============================================================
   МИР ТААЛАЯ. Общие данные для index.html и text.html.
   Здесь всё, что читает посетитель: тексты, фото, вступление.
   lvr правит только этот файл.
   ============================================================ */
(function(){
"use strict";

/* ---------- ФОТО ----------
   Фото можно дать ЛЮБОМУ предмету. Ключ совпадает с id предмета, у предмета 0, 1 или до 3 фото.

   Самый простой способ: положи файл в папку photos/ и впиши его имя в кавычках:

     fusor: ["photos/fusor-1.jpg"],
     yurt:  ["photos/yurt-1.jpg", "photos/yurt-2.jpg"],

   Годятся jpg, png, webp и короткие ролики mp4 (играют без звука по кругу; рядом нужен кадр
   с тем же именем и .jpg, например photos/alevels-1.mp4 и photos/alevels-1.jpg).
   Первое фото предмета ещё и стоит маленьким отпечатком в самом мире.

   Полная запись, если нужна подпись (обе формы можно смешивать):

   { src: "photos/fusor-1.webp",
     date: "2025",                      // как на снимке; можно не писать
     caption: { ru: "", en: "" },       // коротко, только факт; можно не писать
     alt:     { ru: "", en: "" } }      // что на фото, для скринридера

   Если рядом лежит уменьшенная копия photos/fusor-1-800.webp (её делает tools/photos.mjs),
   сайт возьмёт её на телефоне. Если копии нет, возьмёт само фото. */
var PHOTOS={
  table:[
    { src:"photos/table-1.jpg", alt:{ en:"Me at a workbench pointing at the steel fusor chamber, parts spread across the table" } }
  ],
  fusor:[
    { src:"photos/fusor-1.mp4", alt:{ en:"Violet glow and the star-shaped grid seen through the hole in the plywood" } },
    { src:"photos/fusor-2.jpg", alt:{ en:"The fusor: dark steel cylinder, glass plate, brass fitting with a clear hose, a spark at the edge" } },
    { src:"photos/fusor-3.jpg", alt:{ en:"Me and Arafat outside school" } }
  ],
  jet:[
    { src:"photos/jet-1.jpg", alt:{ en:"A silver jet engine on a blue toy car, on a table outside the school" } }
  ],
  drone:[
    { src:"photos/drone-1.jpg", alt:{ en:"ESP32 and a GPS module on a breadboard next to a laptop showing 5 satellites and a 3D fix" } }
  ],
  toolbox:[],
  alevels:[
    { src:"photos/alevels-1.mp4", alt:{ en:"Friends laughing in the school bathroom" } }
  ],
  carpenter:[],
  psych:[],
  blanket:[],
  yurt:[
    { src:"photos/yurt-1.jpg", alt:{ en:"The Flux Lab app in AR: magnetic field lines of a solenoid over a real desk" } },
    { src:"photos/yurt-2.mp4", alt:{ en:"The Flux Lab app: picking a simulation from the catalog, then a beating heart placed in AR on a carpet" } }
  ],
  circle:[
    { src:"photos/circle-1.jpg", alt:{ en:"Debating at a table covered with our green club flag" } },
    { src:"photos/circle-2.jpg", alt:{ en:"Our debate club with the green flag after a tournament" } },
    { src:"photos/circle-3.jpg", alt:{ en:"Our debate club on stage with the green flag and a cup" } }
  ],
  wasys:[],
  shumkar:[
    { src:"photos/shumkar-1.jpg", alt:{ en:"Me and my dad in the mountains in winter" } }
  ],
  sled:[],
  page:[
    { src:"photos/page-1.jpg", alt:{ en:"Cover of my manuscript, Mathematical Entanglement" } }
  ],
  fork:[]
};

/* ---------- ВСТУПЛЕНИЕ НА ПЕРВОМ ЭКРАНЕ ----------
   2-3 предложения от первого лица. Пишет lvr сам.
   Пока строка пустая, на экране её нет. */
var INTRO={ en:"" };

/* Строка внизу первого экрана: как сделан сайт. */
var CREDIT={
  en:"I built this with AI coding tools. The facts, the photos and the choice of what to show are mine."
};

/* ---------- ТЕКСТЫ ---------- */
var TEXT={
 en:{
  ui:{name:"Taalai Kabylov",tagline:"A workshop without walls",
      how:"Drag to look around, tap anything, or just hit Next.",
      enter:"Enter",textVersion:"Text version",open3d:"Open the 3D world",
      next:"Next",prev:"Back",restart:"Back to start",close:"Close",
      photo:"Photo",photoOpen:"Open photo",photoPrev:"Previous photo",photoNext:"Next photo",photoOf:"of",
      editHint:"photo goes here: PHOTOS.",
      loading:"Loading",ready:"Ready",
      stages:{start:"textures",terrain:"terrain",sky:"sky",workshop:"workshop",corner:"psychology corner",yurt:"yurt",circle:"circle",pipe:"outfall",slope:"slope",fork:"the road",traces:"footprints"},
      fail:"The scene needs WebGL, and it is not available here. Everything is also in the text version.",
      slow:"The scene is heavy for this device. The text version opens instantly."},
  items:{
   overview:["A workshop without walls",["Drag to look around, tap anything, or just hit Next."]],
   table:["The table",["Everything starts here. Usually in pieces."]],
   fusor:["Fusor",["Built with Arafat. The transformer came from a dead microwave.","No neutrons yet."]],
   jet:["Jet engine",["Propane, an oil filter can, and a toy car for wheels."]],
   drone:["Drone brain",["5 satellites, 3D fix locked. Small wins."]],
   toolbox:["Toolbox",["Half the tools are missing. Science Week, the other teams needed them more."]],
   alevels:["A-Levels",["Right before A levels cooked us. Cooked us hard."]],
   carpenter:["The carpenter",["One of my letters is from him."]],
   psych:["Psychology corner",["Strong black tea. You don't have to talk."]],
   blanket:["The blanket",["One elephant. Please don't offend him."]],
   yurt:["Yurt lab",["For schools that only have chalk."]],
   circle:["Debate",["Four teams, one podium. The green flag comes everywhere with us."]],
   wasys:["WASYS",["A clear box, an ESP32 and a tiny pump. Still looking for a lab."]],
   shumkar:["The slope",["My dad put me on skis at five, before I could even hold my own mug. Shumkar started with him."]],
   sled:["Sled",["120 of us, 5 tons of trash."]],
   page:["The last page",["Poems, and a book about math. The last page is still empty."]],
   fork:["The only way",["Only one road from here, and it goes to Hanover. Fingers crossed."]]
  }
 }
};

/* Порядок тура. stop: пронумерованная остановка, parent: отдельная точка внутри остановки. */
var ITEMS=[
 {id:"overview",stop:0},
 {id:"table",stop:1},
 {id:"fusor",stop:2},
 {id:"jet",stop:3},{id:"drone",parent:3},{id:"toolbox",parent:3},
 {id:"alevels",stop:4},{id:"carpenter",parent:4},
 {id:"psych",stop:5},{id:"blanket",parent:5},
 {id:"yurt",stop:6},
 {id:"circle",stop:7},
 {id:"wasys",stop:8},
 {id:"shumkar",stop:9},{id:"sled",parent:9},
 {id:"page",stop:10},
 {id:"fork",stop:11}
];

/* Язык: ?lang=en или ?lang=ru; без параметра русский только для русского браузера. */
function pickLang(){ return "en"; }   /* the site is in English only */
/* ?debug=1 в адресе; для debug и edit годится и #debug / #edit (так работает внутри встроенных просмотров) */
function flag(name){ var m=new RegExp("[?&]"+name+"=([^&#]*)").exec(location.search); if(m) return decodeURIComponent(m[1]); return location.hash==="#"+name?"1":null; }

/* короткая запись "photos/x.jpg" превращается в полную */
for(var k in PHOTOS) PHOTOS[k]=(PHOTOS[k]||[]).map(function(p){ p=typeof p==="string"?{src:p}:p;
  /* a short clip (.mp4) plays muted in a loop; its still frame lies next to it with the same name and .jpg */
  if(/\.mp4$/i.test(p.src)){ p.video=true; if(!p.poster) p.poster=p.src.replace(/\.mp4$/i,".jpg"); }
  return p; });

window.SITE={TEXT:TEXT,ITEMS:ITEMS,PHOTOS:PHOTOS,INTRO:INTRO,CREDIT:CREDIT,pickLang:pickLang,flag:flag,
  /* 800-пиксельная версия лежит рядом с тем же именем и суффиксом -800 */
  small:function(src){ return src.replace(/(\.\w+)$/,"-800$1"); }};
})();
