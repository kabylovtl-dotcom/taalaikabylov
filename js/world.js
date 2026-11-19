/* ============================================================
   МИР ТААЛАЯ, версия 3. 3D-мир (three.js r160 из папки vendor/).

   ПЛАН
   Метры, Y вверх. Север это -Z (вверх по склону), юг это +Z (долина).
   Зоны (X,Z): A мастерская 12 x 7.5 в (0,0): общий стол, фузор, полка,
   доска, верстак; B угол разговоров; H кресло у печки; C юрта (-17,-1);
   D круг (-11,13.5); E труба WASYS (17.2,3.6); F подъёмник (11,-17);
   G развилка (2,34).
   Сцена: небо, рельеф (одна сетка, считается в воркере), статика слита
   по материалу ВНУТРИ каждой зоны (deck, table, fusor, shelf, study,
   corner, hearth, yurt, circle, pipe, slope, fork), инстансы (ели, следы,
   фонари, лампочки, обувь, карточки, кресла, лыжники), динамика (разряды,
   пар, дым, снег, светодиоды), невидимые коробки для клика и DOM-метки.
   Остановки: 0 обзор, 1 стол, 2 фузор, 3 двигатель (+дрон, +ящик),
   4 A-Levels (+верстак), 5 угол (+плед), 6 юрта, 7 круг, 8 WASYS,
   9 Shumkar (+санки), 10 последняя страница, 11 развилка.

   ЗАГРУЗКА (версия 3; замер на Intel UHD 630, Chrome, окно 1280x800, первый заход без кэша шейдеров)
   - было: первый кадр через 4,6 с, весь мир через 8,3 с. Почти всё это время видеокарта собирала
     шейдеры: около 15 освещённых, по полсекунды каждый, по очереди, а на компьютере ещё и второй
     комплект при первом кадре через composer.
   - стало: первый кадр и весь мир через 1,3 с (телефонный режим 1,4 с).
   - как: освещённых шейдеров четыре (см. SHADERS), они запускаются в самом начале одним вызовом
     и собираются, пока JS строит мир; текстуры дерева, снега и ткани считают воркеры, а не GPU;
     кадр на компьютере всегда идёт через composer, поэтому второй комплект шейдеров не нужен.
   - кадр: 14-15 мс при 1600x1000 на той же видеокарте (60 fps), тени PCF вместо PCFSoft.
   - НЕ проверено: телефон вживую, Safari. Смотри ?debug=1; ?debug=1&cold=1 повторяет первый заход.
   Параметры: ?q=low|med|high  ?debug=1  ?debug=1&cold=1  ?edit=1  ?shot=1  ?lang=en|ru
   ============================================================ */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PI=Math.PI, V3=THREE.Vector3, UI=window.__ui, SITE=window.SITE;
const TR=self.TERRAIN, H=TR.H, fbm=TR.fbm, ZONE=TR.ZONE, PATHS=TR.PATHS;
const canvas=document.getElementById('gl'), stage=document.getElementById('stage');
const REDUCE=matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOBILE=matchMedia('(pointer: coarse)').matches||Math.min(innerWidth,innerHeight)<700;
const DEBUG=SITE.flag('debug')==='1', SHOT=UI.SHOT, EDIT=UI.EDIT;

/* quality levels; chosen by ?q=, else by device, then corrected after the first 90 frames */
const TIERS={ high:{ao:true,shadow:2048,trees:170,snow:520,prMax:1.5}, med:{ao:false,shadow:2048,trees:170,snow:420,prMax:1.25}, low:{ao:false,shadow:1024,trees:60,snow:200,prMax:1} };
const qp=({low:'low',med:'med',medium:'med',high:'high'})[SITE.flag('q')||''];
let tier=qp||(MOBILE?'med':'high'); const tierLocked=!!qp||SHOT;
const POST=!MOBILE;                       /* desktop: composer with SMAA (and AO at rest); phone: plain MSAA */
const COLD=DEBUG&&SITE.flag('cold')==='1';   /* ?debug=1&cold=1: every shader is unique, so the browser's shader cache cannot help (a first visit) */
/* the post-processing files start downloading now, next to everything else */
const postP=POST?Promise.all([import('three/addons/postprocessing/EffectComposer.js'),import('three/addons/postprocessing/RenderPass.js'),import('three/addons/postprocessing/GTAOPass.js'),import('three/addons/postprocessing/OutputPass.js'),import('three/addons/postprocessing/SMAAPass.js')]).catch(()=>null):null;
const DPR=window.devicePixelRatio||1;
let PXR=SHOT?1:Math.min(DPR,TIERS[tier].prMax,MOBILE?1:1.25);

/* the terrain grid is computed off the main thread */
const GRID=MOBILE?140:200;
const groundP=new Promise(res=>{ try{ const w=new Worker('js/terrain-worker.js'); w.onmessage=e=>{ res(e.data); w.terminate(); }; w.onerror=()=>res(TR.build(GRID)); w.postMessage({N:GRID}); }catch(e){ res(TR.build(GRID)); } });
/* surface textures: three more workers, one per part, so none of them holds the others up */
const noiseJobs=['wood','snow','small'].map(part=>new Promise(res=>{ try{ const w=new Worker('js/terrain-worker.js'); w.onmessage=e=>{ res(e.data); w.terminate(); }; w.onerror=()=>res(TR.textures(part)); w.postMessage({tex:part}); }catch(e){ res(TR.textures(part)); } }));

let renderer;
try{ renderer=new THREE.WebGLRenderer({canvas,antialias:!POST,powerPreference:'high-performance',preserveDrawingBuffer:SHOT}); }
catch(e){ UI.fail(); throw e; }
renderer.setPixelRatio(PXR);
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFShadowMap;      /* half the texture reads of PCFSoft on every lit pixel; softness comes from shadow.radius */
renderer.shadowMap.autoUpdate=false;       /* the scene is static: shadows are drawn once */
renderer.info.autoReset=false;

/* give the browser a turn between build steps, and report the stage */
const STEPS=[], LOG=[]; let _pt=performance.now(), _gpu=0;      /* how long each build step held the main thread (shader compile time kept apart) */
const pause=(key,frac)=>{ STEPS.push(Math.round(performance.now()-_pt-_gpu)); LOG.push([key||'-',frac||0,Math.round(performance.now()),STEPS[STEPS.length-1],Math.round(_gpu)]); _gpu=0; if(key) UI.progress(key,frac); return new Promise(r=>setTimeout(()=>{ _pt=performance.now(); r(); },0)); };
UI.progress('start',.04);
if(COLD) THREE.ShaderChunk.common=THREE.ShaderChunk.common.replace('#define EPSILON 1e-6','#define EPSILON '+(1e-6*(1+Math.random()*.02)).toExponential(8));

/* ============================================================ scene and camera */
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(45,1,.08,14000);
const deckY=H(0,0)+.3;

/* SHADERS. A lit shader takes the GPU about half a second to build on a first visit, so the whole world
   is drawn with four of them: the snow field, one for every solid thing (std), one for see-through things
   (glass and footprints) and one for instanced things and cut-out cards (INST: lift chairs, spruces, yurt lattice).
   That is why every std material carries the same set of maps: where a material has no picture of its own
   it gets a 1x1 texture. Give a material a different set of maps and it becomes a fifth shader. */
const px1=(r,g,b,srgb)=>{ const t=new THREE.DataTexture(new Uint8Array([r,g,b,255]),1,1); t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace; t.wrapS=t.wrapT=THREE.RepeatWrapping; t.needsUpdate=true; return t; };
const WHITE=px1(255,255,255,true), FLATN=px1(128,128,255,false), ORM=px1(0,255,255,false);
const DS=THREE.DoubleSide;
const std=o=>new THREE.MeshStandardMaterial(Object.assign({vertexColors:true,side:DS,map:WHITE,normalMap:FLATN,roughnessMap:ORM,metalnessMap:ORM,emissive:0x000000,emissiveMap:WHITE},o));
const solid={shadowSide:THREE.BackSide};      /* closed shapes: only back faces go into the shadow map */
const INST=o=>new THREE.MeshStandardMaterial(Object.assign({map:WHITE,alphaTest:.45},o));   /* instanced things (lift chairs, skiers) and cut-out cards (spruces, lattice); each mesh also gets per-instance colours */
/* start building shaders for everything in `root`, for the render target the frames really use
   (through the composer the scene is drawn into a buffer, and that is a different shader than drawing to the screen) */
function compileFor(root,target){ const prev=renderer.getRenderTarget(); let p=null; renderer.setRenderTarget(composer?composer.renderTarget1:null);
  try{ p=renderer.compileAsync(root,camera,target||null); }catch(e){} renderer.setRenderTarget(prev); return p?p.catch(()=>{}):Promise.resolve(); }
const warmGeo=(()=>{ const g=new THREE.BufferGeometry(), z3=new Float32Array(9); g.setAttribute('position',new THREE.BufferAttribute(z3,3)); g.setAttribute('normal',new THREE.BufferAttribute(z3.slice(),3)); g.setAttribute('color',new THREE.BufferAttribute(z3.slice(),3)); g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(6),2)); return g; })();
const stub=(m,inst)=>{ let o; if(inst){ o=new THREE.InstancedMesh(warmGeo,m,1); o.setColorAt(0,new THREE.Color(1,1,1)); } else o=new THREE.Mesh(warmGeo,m); o.frustumCulled=false; return o; };
const white=g=>{ g.setAttribute('color',new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*3).fill(1),3)); return g; };

/* ============================================================ sky, fog, light */
const sky=new Sky(); const SU=sky.material.uniforms;
SU.turbidity.value=4.5; SU.rayleigh.value=2.4; SU.mieCoefficient.value=.0035; SU.mieDirectionalG.value=.88;
const sunDir=new V3(-.5,Math.sin(-1.4*PI/180),.84).normalize(); SU.sunPosition.value.copy(sunDir);
{ const pm=new THREE.PMREMGenerator(renderer), es=new THREE.Scene(); sky.scale.setScalar(50); es.add(sky); scene.environment=pm.fromScene(es,0,.1,1000).texture; pm.dispose(); }
sky.scale.setScalar(9000); scene.add(sky);
scene.fog=new THREE.FogExp2(0x56608a,.00042);

/* twilight key from the bright part of the sky: cool, long soft shadows, tight on the workshop */
const twi=new THREE.DirectionalLight(0x9db4ee,.55);
twi.position.set(-14,22,26); twi.target.position.set(0,deckY,0); scene.add(twi,twi.target);
twi.castShadow=true; twi.shadow.mapSize.set(TIERS[tier].shadow,TIERS[tier].shadow); twi.shadow.radius=2.5; twi.shadow.bias=-.0004; twi.shadow.normalBias=.03;
Object.assign(twi.shadow.camera,{left:-11,right:11,top:9,bottom:-9,near:1,far:70}); twi.shadow.camera.updateProjectionMatrix();

/* four warm lights and no more: the lamp over the table (static shadow), one for the garland,
   the stove, the yurt. Everything else that glows is emissive, a sprite, or baked into the snow. */
const LAMP=new V3(-.9,deckY+2.25,-.3);
const LIGHTS={};
{ const sl=new THREE.SpotLight(0xffc98f,62,9,1.05,.9,1.6); sl.position.copy(LAMP); sl.target.position.set(LAMP.x,deckY,LAMP.z); sl.castShadow=true; sl.shadow.mapSize.set(1024,1024); sl.shadow.bias=-.001; sl.shadow.radius=2; scene.add(sl,sl.target); LIGHTS.lamp=sl;
  LIGHTS.garland=new THREE.PointLight(0xffb070,62,15,1.6); LIGHTS.garland.position.set(-.6,deckY+2.85,1.0); scene.add(LIGHTS.garland);
  LIGHTS.stove=new THREE.PointLight(0xff7a30,7,6,1.8); LIGHTS.stove.position.set(5.0,deckY+.5,2.35); scene.add(LIGHTS.stove);
  LIGHTS.yurt=new THREE.PointLight(0xffb070,15,3.6,1.2); LIGHTS.yurt.position.set(ZONE.yurt[0],H(ZONE.yurt[0],ZONE.yurt[1])+1.9,ZONE.yurt[1]); scene.add(LIGHTS.yurt); }

/* the snow field; its maps are drawn further down and put in then */
const groundMat=new THREE.MeshStandardMaterial({vertexColors:true,map:WHITE,normalMap:FLATN,normalScale:new THREE.Vector2(.55,.55),roughness:.86,emissive:0xffffff,emissiveMap:WHITE,emissiveIntensity:.5});
groundMat.onBeforeCompile=s=>{   /* small glints on the snow crust, near the camera only */
  s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vWp;').replace('#include <begin_vertex>','#include <begin_vertex>\nvWp=(modelMatrix*vec4(transformed,1.0)).xyz;');
  s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vWp;').replace('#include <opaque_fragment>',
   'vec2 sg=floor(vWp.xz*70.0); float sh=fract(sin(dot(sg,vec2(12.9898,78.233)))*43758.5453); vec3 vd=normalize(cameraPosition-vWp);\n float spk=step(0.9982,fract(sh*31.7+dot(vd,vec3(3.1,1.7,2.3))*1.5))*smoothstep(45.0,2.0,distance(cameraPosition,vWp));\n outgoingLight+=spk*vec3(0.85,0.9,1.0)*0.5;\n#include <opaque_fragment>');
};

/* ============================================================ post (desktop): AO at rest only, tone map, SMAA */
let composer=null, aoPass=null, smaaPass=null;
if(POST){ try{
  const [a,b,c,d,e]=await postP;
  composer=new a.EffectComposer(renderer); composer.addPass(new b.RenderPass(scene,camera));
  const ao=new c.GTAOPass(scene,camera,innerWidth,innerHeight); ao.updateGtaoMaterial({radius:.45,distanceExponent:1.4,thickness:1.2,scale:1.25,samples:8});
  { const ss=ao.setSize.bind(ao); ao.setSize=(w,h)=>ss(Math.max(2,Math.round(w*.5)),Math.max(2,Math.round(h*.5))); }        /* half resolution */
  { const ov=ao.overrideVisibility.bind(ao); ao.overrideVisibility=function(){ ov(); for(const o of [TREES,sky,...NOAO]) if(o) o.visible=false; }; }
  ao.enabled=false; ao.blendIntensity=0; aoPass=ao; composer.addPass(ao);
  composer.addPass(new d.OutputPass()); smaaPass=new e.SMAAPass(innerWidth,innerHeight); composer.addPass(smaaPass);
}catch(err){ composer=null; aoPass=null; smaaPass=null; } }

/* every lit shader starts compiling now, all at once, while the JS below goes on building the workshop */
const warmG=new THREE.Group(); warmG.visible=false; scene.add(warmG);
warmG.add(stub(groundMat),stub(std()),stub(std({transparent:true,depthWrite:false})),stub(INST({roughness:.8}),true),stub(new THREE.MeshBasicMaterial({vertexColors:true,side:DS})));
const warmP=(()=>{ const t0=performance.now(), p=compileFor(scene); p.then(()=>{ if(DEBUG) window.__warm=Math.round(performance.now()-t0); }); return p; })();
await pause('start',.06);


/* ---------- helpers: random ---------- */
let _seed=20261114;
function rng(){ _seed|=0; _seed=_seed+0x6D2B79F5|0; let t=Math.imul(_seed^_seed>>>15,1|_seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }
function withSeed(s,fn){ const keep=_seed; _seed=s; try{ return fn(); } finally{ _seed=keep; } }
const rr=(a,b)=>a+(b-a)*rng();
const lerp=(a,b,t)=>a+(b-a)*t;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const sstep=(a,b,x)=>{ const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };

/* ---------- helpers: canvas textures ---------- */
function cv(w,h){ const c=document.createElement('canvas'); c.width=w; c.height=h; return [c,c.getContext('2d')]; }
function tex(c,srgb=true,rep=true){ const t=new THREE.CanvasTexture(c); t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace; if(rep) t.wrapS=t.wrapT=THREE.RepeatWrapping; t.anisotropy=4; renderer.initTexture(t); return t; }
function normalFrom(hd,W,Hh,str){ const [c,g]=cv(W,Hh), id=g.createImageData(W,Hh), d=id.data;
  for(let y=0;y<Hh;y++) for(let x=0;x<W;x++){ const l=hd[y*W+((x-1+W)%W)], r=hd[y*W+((x+1)%W)], u=hd[((y-1+Hh)%Hh)*W+x], dn=hd[((y+1)%Hh)*W+x];
    let nx=(l-r)*str, ny=(dn-u)*str, nz=1; const k=1/Math.hypot(nx,ny,nz), i=(y*W+x)*4; d[i]=(nx*k*.5+.5)*255; d[i+1]=(ny*k*.5+.5)*255; d[i+2]=(nz*k*.5+.5)*255; d[i+3]=255; }
  g.putImageData(id,0,0); return c; }

/* ---------- surface textures: computed in workers (js/terrain.js). The texture objects exist at once, so the
   materials and the workshop can be built; the pixels are put in when a worker answers, before the first frame. ---------- */
const dtex=(size,srgb)=>{ const t=new THREE.DataTexture(null,size,size,THREE.RGBAFormat); t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace; t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.generateMipmaps=true; t.minFilter=THREE.LinearMipmapLinearFilter; t.magFilter=THREE.LinearFilter; t.anisotropy=4; return t; };
const woodT=dtex(512,true), woodN=dtex(512,false), snowN=dtex(512,false), groundN=dtex(512,false), weaveN=dtex(256,false), feltT=dtex(256,true), scratchT=dtex(256,false);
const NTEX={woodT:[woodT],woodN:[woodN],snowN:[snowN,groundN],weaveN:[weaveN],feltT:[feltT],scratchT:[scratchT]};
const noiseP=Promise.all(noiseJobs.map(j=>j.then(r=>{ for(const k in r) for(const t of NTEX[k]){ t.image.data=r[k]; t.needsUpdate=true; renderer.initTexture(t); } })));
groundN.repeat.set(70,70); weaveN.repeat.set(3,3);
await pause('start',.08);

const HAND='"Caveat","Segoe Script","Bradley Hand","Comic Sans MS",cursive';
const SERIF='"Prata",Georgia,"Times New Roman",serif';
/* text canvases are drawn at once with fallback fonts and redrawn when the web fonts arrive */
const fontJobs=[];
if(document.fonts&&document.fonts.load){ Promise.all([document.fonts.load('40px Caveat'),document.fonts.load('40px Prata')]).then(async()=>{ for(const j of fontJobs){ j.fn(); j.tex.needsUpdate=true; await pause(); } }).catch(()=>{}); }

/* Tian Shan spruce: narrow column, drooping branches, snow on the upper side */
const treeT=(()=>{ const [c,g]=cv(256,1024); g.translate(128,0); g.lineCap='round';
  g.fillStyle='#1c1410'; g.fillRect(-4,120,8,904);
  for(let i=0;i<1300;i++){ const t=Math.pow(rng(),.85), y=18+t*985, half=(5+86*Math.pow(t,.7))*(.72+.28*Math.sin(t*46)), side=rng()<.5?-1:1, len=half*rr(.3,1);
    g.strokeStyle=`hsl(${rr(150,170)},${rr(22,36)}%,${rr(7,16)}%)`; g.lineWidth=rr(4,9);
    g.beginPath(); g.moveTo(side*len*.05,y-len*.22); g.quadraticCurveTo(side*len*.6,y-len*.12,side*len,y+len*.3); g.stroke(); }
  for(let i=0;i<230;i++){ const t=Math.pow(rng(),.8), y=14+t*960, half=(5+86*Math.pow(t,.7))*(.72+.28*Math.sin(t*46)), side=rng()<.5?-1:1, a=rr(.15,.8)*half, l=rr(5,16);
    g.strokeStyle=`rgba(${rr(175,205)},${rr(190,215)},${rr(225,245)},${rr(.55,.9)})`; g.lineWidth=rr(3,6);
    g.beginPath(); g.moveTo(side*a,y-2+a*.08); g.lineTo(side*(a+l),y+l*.28+a*.08); g.stroke(); }
  const t=tex(c,true,false); t.generateMipmaps=false; t.minFilter=THREE.LinearFilter; return t; })();
await pause('start',.1);

const glowT=(()=>{ const [c,g]=cv(64,64), gr=g.createRadialGradient(32,32,0,32,32,32); gr.addColorStop(0,'rgba(255,255,255,1)'); gr.addColorStop(.25,'rgba(255,255,255,.5)'); gr.addColorStop(1,'rgba(255,255,255,0)'); g.fillStyle=gr; g.fillRect(0,0,64,64); return tex(c,true,false); })();

/* fake handwriting: wavy strokes in word-sized bursts */
function scribble(g,x,y,w,h,o){ const lh=o.lh||16; g.save(); g.beginPath(); g.rect(x,y,w,h); g.clip(); g.strokeStyle=o.ink; g.lineWidth=o.lw||1.3; g.lineCap='round';
  for(let ly=y+lh+ (o.top||0); ly<y+h-6; ly+=lh){ let px=x+(o.ml||10); const end=x+w-(o.mr||10)-rr(0,w*.3)*(rng()<.25?1:0);
    while(px<end){ const ww=rr(10,38); if(px+ww>end) break; g.beginPath(); const ph=rr(0,6), f=rr(.5,.9)*(o.f||1), am=rr(1.6,3.4)*(o.a||1);
      for(let t=0;t<=ww;t+=1.5){ const yy=ly-am-Math.sin(t*f+ph)*am*(.5+.5*Math.sin(t*.21+ph)), xx=px+t+(yy-ly)*(o.slant||0); if(t===0) g.moveTo(xx,yy); else g.lineTo(xx,yy); } g.stroke(); px+=ww+rr(5,9); } }
  g.restore(); }
function bars(g,x,y,w,h,o){ g.save(); g.fillStyle=o.c||'#9a9aa2'; const lh=o.lh||10; for(let ly=y; ly<y+h-lh*.5; ly+=lh){ const ww=w*(rng()<.2?rr(.3,.7):rr(.85,1)); g.fillRect(x,ly,ww,(o.t||3)); } g.restore(); }

/* atlas A: printed and handwritten things (lit by the scene) */
const RA=(x,y,w,h)=>[x/1024,1-(y+h)/1024,(x+w)/1024,1-y/1024];
const UA={ hwA:RA(0,0,256,340), hwB:RA(256,0,256,340), hwC:RA(512,0,256,340), past:RA(768,0,256,340), tin:RA(0,340,512,128), tag:RA(512,340,256,128),
  gauge:RA(768,340,200,200), sp0:RA(0,480,256,48), sp1:RA(0,528,256,48), sp2:RA(0,576,256,48), sp3:RA(0,624,256,48), plac:RA(256,480,256,96), badge:RA(512,480,128,96),
  stop:RA(256,576,128,128), meter:RA(384,576,128,128), doc:RA(768,560,256,340), blank:RA(520,600,100,100), ksma:RA(256,712,240,300) };
const [atlasAC,atlasAG]=cv(1024,1024);
function drawA(){ const c=atlasAC, g=atlasAG; g.fillStyle='#efe9dc'; g.fillRect(0,0,1024,1024);
  const page=(x,ruled)=>{ g.fillStyle='#f2ecdf'; g.fillRect(x,0,256,340); if(ruled){ g.strokeStyle='rgba(120,150,200,.35)'; g.lineWidth=1; for(let y=22;y<340;y+=16){ g.beginPath(); g.moveTo(x,y); g.lineTo(x+256,y); g.stroke(); } } };
  page(0,true); scribble(g,0,0,256,340,{ink:'#27408a',slant:-.35,lh:16,top:6});
  page(256,true); scribble(g,256,0,256,340,{ink:'#1c1c1c',slant:0,lh:16,top:6,f:1.5,a:.7,lw:1.1});
  page(512,false); scribble(g,512,0,256,200,{ink:'#555',slant:-.15,lh:20,a:1.3,lw:1.6}); g.strokeStyle='#555'; g.lineWidth=1.5; g.strokeRect(560,220,150,90); g.beginPath(); g.moveTo(560,310); g.lineTo(635,240); g.lineTo(710,310); g.stroke();
  /* past paper with red pen */
  g.fillStyle='#f7f5ef'; g.fillRect(768,0,256,340); g.fillStyle='#222'; g.fillRect(788,16,120,8); g.fillStyle='#777'; g.fillRect(788,30,70,4);
  for(let q=0;q<4;q++){ const y=52+q*72; g.fillStyle='#222'; g.fillRect(788,y,8,8); bars(g,804,y,200,40,{c:'#8c8c92',lh:9,t:3}); }
  g.strokeStyle='#c22a2a'; g.lineWidth=2.4; g.lineCap='round';
  for(const y of [66,138,282]){ g.beginPath(); g.moveTo(990,y); g.lineTo(997,y+9); g.lineTo(1012,y-10); g.stroke(); }
  g.beginPath(); g.ellipse(880,222,60,16,-.05,0,2*PI); g.stroke(); scribble(g,800,300,200,36,{ink:'#c22a2a',lh:16,slant:-.3,ml:4,lw:1.6});
  /* tin label on masking tape */
  g.fillStyle='#d9c9a3'; g.fillRect(0,340,512,128); g.fillStyle='rgba(120,100,60,.12)'; for(let i=0;i<40;i++) g.fillRect(rr(0,512),340,rr(1,3),128);
  g.fillStyle='#22201c'; g.font=`500 62px ${HAND}`; g.textAlign='center'; g.textBaseline='middle';
  /* tube bag tag */
  g.fillStyle='#f6f3ea'; g.fillRect(512,340,256,128); g.fillStyle='#22201c'; g.font=`500 44px ${HAND}`; g.textAlign='left'; g.fillText('lab:',528,392,150);
  g.strokeStyle='#22201c'; g.lineWidth=2; g.beginPath(); g.moveTo(528,440); g.lineTo(752,440); g.stroke();
  /* vacuum gauge, needle near 150 on a 0..1000 micron scale */
  g.fillStyle='#16171a'; g.fillRect(768,340,200,200); g.fillStyle='#f3f1ea'; g.beginPath(); g.arc(868,440,92,0,2*PI); g.fill();
  g.strokeStyle='#222'; g.fillStyle='#222'; g.font='600 13px Arial'; g.textAlign='center';
  for(let i=0;i<=20;i++){ const a=(-225+i*13.5)*PI/180, r0=i%5===0?66:74; g.lineWidth=i%5===0?2.5:1.2; g.beginPath(); g.moveTo(868+Math.cos(a)*r0,440+Math.sin(a)*r0); g.lineTo(868+Math.cos(a)*84,440+Math.sin(a)*84); g.stroke(); if(i%5===0) g.fillText(String(i*50),868+Math.cos(a)*52,444+Math.sin(a)*52); }
  g.font='11px Arial'; g.fillText('microns',868,494);
  { const a=(-225+3*13.5)*PI/180; g.strokeStyle='#b3261e'; g.lineWidth=3; g.beginPath(); g.moveTo(868-Math.cos(a)*14,440-Math.sin(a)*14); g.lineTo(868+Math.cos(a)*76,440+Math.sin(a)*76); g.stroke(); g.fillStyle='#222'; g.beginPath(); g.arc(868,440,7,0,2*PI); g.fill(); }
  /* book spines */
  [['SARTRE','#5d2727'],['CAMUS','#27384f'],['KAFKA','#33342f'],['NIETZSCHE','#55431f']].forEach((s,i)=>{ const y=480+i*48; g.fillStyle=s[1]; g.fillRect(0,y,256,48); g.fillStyle='rgba(255,255,255,.06)'; for(let k=0;k<14;k++) g.fillRect(rr(0,256),y,rr(1,2),48);
    g.strokeStyle='rgba(228,206,160,.7)'; g.lineWidth=1.5; g.beginPath(); g.moveTo(18,y+6); g.lineTo(18,y+42); g.moveTo(238,y+6); g.lineTo(238,y+42); g.stroke();
    g.fillStyle='#e4cea0'; g.font=`26px ${SERIF}`; g.textAlign='center'; g.textBaseline='middle'; g.fillText(s[0],128,y+26); });
  /* MUN placard with unreadable text, badge, printout */
  g.fillStyle='#f4f2ec'; g.fillRect(256,480,256,96); g.fillStyle='rgba(30,40,70,.55)'; g.fillRect(300,512,168,30); g.fillStyle='rgba(244,242,236,.55)'; for(let i=0;i<9;i++) g.fillRect(306+i*18+rr(0,4),512,rr(3,7),30);
  g.fillStyle='#f4f2ec'; g.fillRect(512,480,128,96); g.fillStyle='#b66a3a'; g.fillRect(512,480,128,20); bars(g,528,516,96,44,{c:'#8c8c92',lh:14,t:6});
  g.fillStyle='#f7f5ef'; g.fillRect(768,560,256,340); bars(g,790,584,212,290,{c:'#9b9ba3',lh:11,t:4}); g.fillStyle='rgba(240,205,90,.45)'; g.fillRect(788,648,150,12); g.fillRect(788,770,190,12); scribble(g,930,600,90,120,{ink:'#c22a2a',lh:15,ml:2,mr:2,slant:-.3});
  /* stopwatch and multimeter faces */
  g.fillStyle='#d8d8d8'; g.fillRect(256,576,128,128); g.fillStyle='#fafafa'; g.beginPath(); g.arc(320,640,56,0,2*PI); g.fill(); g.strokeStyle='#222'; for(let i=0;i<60;i++){ const a=i*PI/30; g.lineWidth=i%5?1:2.5; g.beginPath(); g.moveTo(320+Math.cos(a)*(i%5?50:44),640+Math.sin(a)*(i%5?50:44)); g.lineTo(320+Math.cos(a)*54,640+Math.sin(a)*54); g.stroke(); } g.lineWidth=2; g.beginPath(); g.moveTo(320,640); g.lineTo(350,604); g.stroke();
  g.fillStyle='#d79a1e'; g.fillRect(384,576,128,128); g.fillStyle='#9fae9a'; g.fillRect(398,588,100,34); g.fillStyle='#2a2f2a'; g.fillRect(430,594,12,22); g.fillRect(448,594,12,22); g.fillRect(470,594,12,22); g.fillStyle='#222'; g.beginPath(); g.arc(448,664,28,0,2*PI); g.fill(); g.strokeStyle='#ddd'; g.lineWidth=3; g.beginPath(); g.moveTo(448,664); g.lineTo(462,642); g.stroke();
  g.fillStyle='#f5f2e8'; g.fillRect(520,600,100,100);
  /* our debate club's green flag */
  g.fillStyle='#8fcfa6'; g.fillRect(256,712,240,300); g.strokeStyle='#2c6a45'; g.lineWidth=13; g.beginPath(); g.arc(376,840,82,0,2*PI); g.stroke();
  g.lineWidth=15; g.lineCap='round'; g.beginPath(); g.moveTo(414,808); g.bezierCurveTo(380,772,330,800,340,846); g.bezierCurveTo(350,892,412,890,416,858); g.bezierCurveTo(420,832,382,826,372,850); g.stroke();
  g.fillStyle='#2c6a45'; g.beginPath(); g.arc(420,800,10,0,2*PI); g.fill(); g.font='600 30px Arial'; g.textAlign='center'; g.textBaseline='middle'; g.fillText('DC KSMA',376,960); }
withSeed(101,drawA); const atlasA=tex(atlasAC,true,false); fontJobs.push({fn:()=>withSeed(101,drawA),tex:atlasA});
await pause('start',.11);

/* atlas E: screens (emissive) */
const UE={ lap1:RA(0,0,512,320), lap2:RA(512,0,512,320), pend:RA(0,320,384,256), ar:RA(384,320,384,256), phone:RA(768,320,128,256) };
const atlasE=(()=>{ const [c,g]=cv(1024,1024); g.fillStyle='#000'; g.fillRect(0,0,1024,1024);
  const doc=(x,hl)=>{ g.fillStyle='#2a2d36'; g.fillRect(x,0,512,320); g.fillStyle='#e9e7df'; g.fillRect(x+40,22,330,298); bars(g,x+62,48,286,262,{c:'#8d8d95',lh:13,t:5});
    g.fillStyle='rgba(240,200,80,.55)'; hl.forEach(y=>g.fillRect(x+60,y,rr(140,260),11));
    for(let i=0;i<3;i++){ const y=46+i*88+rr(0,20); g.fillStyle='#f3e6c4'; g.fillRect(x+384,y,112,58); bars(g,x+392,y+10,96,42,{c:'#8a7a55',lh:10,t:4}); g.strokeStyle='#c9a24a'; g.lineWidth=1.5; g.beginPath(); g.moveTo(x+384,y+12); g.lineTo(x+352,y+12); g.stroke(); } };
  doc(0,[100,204,256]); doc(512,[74,165]);
  /* pendulum lab, no text */
  g.fillStyle='#0f1826'; g.fillRect(0,320,384,256); g.strokeStyle='#5d6b85'; g.lineWidth=3; g.beginPath(); g.moveTo(80,350); g.lineTo(250,350); g.stroke();
  g.strokeStyle='rgba(180,200,235,.25)'; g.lineWidth=2; g.beginPath(); g.arc(165,350,140,PI*.3,PI*.7); g.stroke();
  g.strokeStyle='#dfe6f5'; g.lineWidth=2.5; g.beginPath(); g.moveTo(165,350); g.lineTo(225,476); g.stroke(); g.fillStyle='#f0b06a'; g.beginPath(); g.arc(225,476,15,0,2*PI); g.fill();
  g.strokeStyle='#39465e'; g.lineWidth=1; g.strokeRect(270,470,100,90); g.strokeStyle='#7fd0c0'; g.lineWidth=2; g.beginPath(); for(let t=0;t<=96;t+=2){ const y=515-Math.sin(t*.2)*30*Math.exp(-t*.006); if(t===0) g.moveTo(272+t,y); else g.lineTo(272+t,y); } g.stroke();
  g.fillStyle='#2b3850'; g.fillRect(20,540,150,6); g.fillRect(20,556,150,6); g.fillStyle='#dfe6f5'; g.beginPath(); g.arc(90,543,7,0,2*PI); g.fill(); g.beginPath(); g.arc(128,559,7,0,2*PI); g.fill();
  /* AR view (Flux Lab): a solenoid and its field lines over a real desk */
  { const gr=g.createLinearGradient(0,320,0,576); gr.addColorStop(0,'#3a3d44'); gr.addColorStop(.6,'#8d9096'); gr.addColorStop(1,'#d9d6cf'); g.fillStyle=gr; g.fillRect(384,320,384,256);
    g.fillStyle='#1b1c20'; g.fillRect(430,334,292,110);
    const cx=576, cy=430; g.lineWidth=1.8;
    for(let k=0;k<7;k++){ g.strokeStyle=k%2?'rgba(230,60,170,.9)':'rgba(250,120,205,.85)'; g.beginPath(); g.ellipse(cx,cy,22+k*13,64+k*8,0,0,2*PI); g.stroke(); }
    g.strokeStyle='#eef0f2'; g.lineWidth=4; for(let i=0;i<6;i++){ g.beginPath(); g.ellipse(cx,cy-50+i*20,26,7,0,0,2*PI); g.stroke(); }
    g.fillStyle='#f4d03f'; for(const [x,y,d] of [[cx-60,cy-30,1],[cx+60,cy+20,-1],[cx-30,cy-75,1],[cx+34,cy+70,-1],[cx,cy-5,1]]){ g.beginPath(); g.moveTo(x,y-7*d); g.lineTo(x-5,y+4*d); g.lineTo(x+5,y+4*d); g.closePath(); g.fill(); }
    g.fillStyle='rgba(16,17,22,.92)'; g.fillRect(400,520,352,50); g.strokeStyle='#33d1c4'; g.lineWidth=4; g.beginPath(); g.moveTo(420,545); g.lineTo(590,545); g.stroke(); g.strokeStyle='#555a66'; g.beginPath(); g.moveTo(590,545); g.lineTo(730,545); g.stroke(); g.fillStyle='#fff'; g.beginPath(); g.arc(590,545,8,0,2*PI); g.fill(); }
  /* Shumkar: slope map with skier dots (the SOS dot is a separate blinking mesh) */
  g.fillStyle='#0e1a30'; g.fillRect(768,320,128,256); g.strokeStyle='rgba(235,240,250,.85)'; g.lineWidth=7; g.lineCap='round';
  g.beginPath(); g.moveTo(800,340); g.bezierCurveTo(860,390,780,440,830,520); g.stroke(); g.lineWidth=5; g.beginPath(); g.moveTo(842,345); g.bezierCurveTo(880,400,850,470,872,520); g.stroke();
  g.setLineDash([4,5]); g.lineWidth=1.5; g.strokeStyle='#8fa0c0'; g.beginPath(); g.moveTo(784,520); g.lineTo(822,336); g.stroke(); g.setLineDash([]);
  [[812,362,'#7fd0c0'],[838,418,'#f0b06a'],[806,452,'#e8ecf5'],[862,404,'#7fd0c0'],[868,492,'#e8ecf5']].forEach(p=>{ g.fillStyle=p[2]; g.beginPath(); g.arc(p[0],p[1],5,0,2*PI); g.fill(); });
  g.fillStyle='#b3261e'; g.beginPath(); g.roundRect?g.roundRect(792,536,80,28,14):g.rect(792,536,80,28); g.fill(); g.fillStyle='#fff'; g.font='600 15px Arial'; g.textAlign='center'; g.textBaseline='middle'; g.fillText('SOS',832,551);
  return tex(c,true,false); })();
await pause('start',.13);

/* blackboard: real formulas in chalk */
const [boardC,boardG]=cv(1024,512);
function drawBoard(){ const c=boardC, g=boardG;
  g.fillStyle='#24302b'; g.fillRect(0,0,1024,512);
  for(let i=0;i<26;i++){ const x=rr(0,1024), y=rr(0,512), r=rr(40,150), gr=g.createRadialGradient(x,y,0,x,y,r); gr.addColorStop(0,`rgba(215,225,215,${rr(.03,.09)})`); gr.addColorStop(1,'rgba(215,225,215,0)'); g.fillStyle=gr; g.fillRect(x-r,y-r,2*r,2*r); }
  g.fillStyle='rgba(236,238,230,.92)'; g.strokeStyle='rgba(236,238,230,.92)'; g.lineCap='round'; g.textBaseline='alphabetic';
  const rich=(s,x,y,size,draw=true)=>{ let i=0; while(i<s.length){ let mode=0; if((s[i]==='_'||s[i]==='^')&&s[i+1]==='{'){ mode=s[i]==='_'?1:2; const e=s.indexOf('}',i); const sub=s.slice(i+2,e); g.font=`500 ${size*.62}px ${HAND}`; if(draw) g.fillText(sub,x,y+(mode===1?size*.2:-size*.42)); x+=g.measureText(sub).width+1; i=e+1; continue; }
      let j=i; while(j<s.length&&!((s[j]==='_'||s[j]==='^')&&s[j+1]==='{')) j++; const part=s.slice(i,j); g.font=`500 ${size}px ${HAND}`; if(draw) g.fillText(part,x,y); x+=g.measureText(part).width; i=j; } return x; };
  const frac=(num,den,x,y,size)=>{ const wn=rich(num,0,0,size,false), wd=rich(den,0,0,size,false), w=Math.max(wn,wd)+14; rich(num,x+(w-wn)/2,y-size*.42,size); rich(den,x+(w-wd)/2,y+size*.78,size); g.lineWidth=2.6; g.beginPath(); g.moveTo(x,y-size*.12); g.lineTo(x+w,y-size*.14); g.stroke(); return x+w; };
  /* Paschen's law */
  let x=rich('V_{b} = ',44,112,44); frac('B p d','ln(A p d) − ln[ ln(1 + 1/γ) ]',x,104,36);
  /* pendulum */
  x=rich('T = 2π',640,108,48); g.lineWidth=2.8; g.beginPath(); g.moveTo(x+4,96); g.lineTo(x+12,126); g.lineTo(x+26,50); g.lineTo(x+96,48); g.stroke(); frac('L','g',x+38,100,36);
  /* Brayton cycle with its efficiency */
  x=rich('η = 1 − ',44,318,44); x=frac('1','r_{p}^{(γ−1)/γ}',x,310,36); rich('r_{p} = p_{2} / p_{1}',44,420,34);
  g.lineWidth=2.2; g.beginPath(); g.moveTo(370,440); g.lineTo(370,270); g.moveTo(370,440); g.lineTo(560,440); g.stroke();
  g.beginPath(); g.moveTo(520,420); g.quadraticCurveTo(430,400,405,310); g.lineTo(450,300); g.quadraticCurveTo(490,380,548,392); g.closePath(); g.stroke();
  rich('p',352,286,26); rich('V',550,466,26); rich('1',524,438,22); rich('2',388,314,22); rich('3',452,294,22); rich('4',552,388,22);
  /* Lawson criterion */
  x=rich('n τ_{E} ≥ ',640,318,44); frac('12 k_{B} T','E_{ch} ⟨σv⟩',x,310,36);
  rich('D-T:  n T τ_{E} ≥ 3·10^{21} keV·s/m^{3}',640,420,30);
  /* wiped areas */
  for(let i=0;i<7;i++){ const x0=rr(60,900), y0=rr(150,480), gr=g.createLinearGradient(x0,y0,x0+rr(80,200),y0+rr(-20,20)); gr.addColorStop(0,'rgba(36,48,43,0)'); gr.addColorStop(.5,'rgba(60,74,68,.5)'); gr.addColorStop(1,'rgba(36,48,43,0)'); g.strokeStyle=gr; g.lineWidth=rr(18,34); g.beginPath(); g.moveTo(x0,y0); g.lineTo(x0+rr(80,200),y0+rr(-14,14)); g.stroke(); }
}
withSeed(202,drawBoard); const boardT=tex(boardC,true,false); fontJobs.push({fn:()=>withSeed(202,drawBoard),tex:boardT});
await pause('start',.15);


/* two painted boards in one texture: the top half for the arch, the bottom half for the post */
const [signC,signG]=cv(512,256);
function drawSign(){ const g=signG; g.fillStyle='#8f7150'; g.fillRect(0,0,512,256); for(let i=0;i<140;i++){ g.fillStyle=`rgba(${rng()<.5?60:150},${rng()<.5?40:110},${rng()<.5?20:70},${rr(.05,.16)})`; g.fillRect(0,rr(0,256),512,rr(.6,2.4)); }
  g.fillStyle='#1d140c'; g.font=`52px ${SERIF}`; g.textAlign='center'; g.textBaseline='middle'; g.fillText('HANOVER, NH',256,68,470);
  g.fillText('ONLY WAY',236,196,380); g.beginPath(); g.moveTo(452,170); g.lineTo(474,198); g.lineTo(460,198); g.lineTo(460,222); g.lineTo(444,222); g.lineTo(444,198); g.lineTo(430,198); g.closePath(); g.fill(); }
withSeed(303,drawSign); const signT=tex(signC,true,false); fontJobs.push({fn:()=>withSeed(303,drawSign),tex:signT});

/* the childhood blanket: faded, worn, one big elephant across it */
const bearT=(()=>{ const [c,g]=cv(512,384); g.fillStyle='#d6cdb8'; g.fillRect(0,0,512,384);
  g.strokeStyle='#b9ad93'; g.lineWidth=10; g.strokeRect(14,14,484,356); g.strokeStyle='#c5b99f'; g.lineWidth=3; g.strokeRect(30,30,452,324);
  const body='#7f8fa3', dark='#6b7a8e', ear='#93a2b4';
  g.fillStyle=dark; for(const x of [176,236,322,378]){ g.beginPath(); g.roundRect?g.roundRect(x,222,44,104,12):g.rect(x,222,44,104); g.fill(); }          /* legs */
  g.strokeStyle=dark; g.lineWidth=7; g.lineCap='round'; g.beginPath(); g.moveTo(420,170); g.quadraticCurveTo(452,190,440,236); g.stroke();                /* tail */
  g.fillStyle=body; g.beginPath(); g.ellipse(300,186,128,86,0,0,2*PI); g.fill();                                                                         /* body */
  g.beginPath(); g.arc(168,150,72,0,2*PI); g.fill();                                                                                                     /* head */
  g.strokeStyle=body; g.lineWidth=34; g.beginPath(); g.moveTo(118,176); g.bezierCurveTo(84,214,84,270,112,300); g.stroke();                               /* trunk */
  g.lineWidth=22; g.beginPath(); g.moveTo(112,300); g.quadraticCurveTo(124,318,146,310); g.stroke();
  g.fillStyle=ear; g.beginPath(); g.ellipse(206,150,50,66,.15,0,2*PI); g.fill(); g.strokeStyle=dark; g.lineWidth=3; g.beginPath(); g.ellipse(206,150,50,66,.15,0,2*PI); g.stroke();   /* ear */
  g.fillStyle='#2b3038'; g.beginPath(); g.arc(138,132,6,0,2*PI); g.fill(); g.fillStyle='#efe9da'; g.beginPath(); g.moveTo(128,196); g.quadraticCurveTo(112,214,122,230); g.quadraticCurveTo(134,214,140,198); g.fill();   /* eye, tusk */
  g.fillStyle='rgba(206,202,192,.26)'; g.fillRect(0,0,512,384);                                  /* washed out */
  for(let i=0;i<34;i++){ const x=rr(0,512), y=rr(0,384), r=rr(24,90), gr=g.createRadialGradient(x,y,0,x,y,r), l=rng()<.5; gr.addColorStop(0,l?`rgba(214,210,200,${rr(.12,.3)})`:`rgba(120,112,100,${rr(.05,.14)})`); gr.addColorStop(1,l?'rgba(214,210,200,0)':'rgba(120,112,100,0)'); g.fillStyle=gr; g.fillRect(x-r,y-r,2*r,2*r); }
  return tex(c); })();

/* yurt lattice (kerege): crossing slats with gaps */
const latticeT=(()=>{ const [c,g]=cv(128,128); g.clearRect(0,0,128,128); g.strokeStyle='#7a4a2c'; g.lineWidth=9; for(let i=-2;i<4;i++){ g.beginPath(); g.moveTo(i*64,0); g.lineTo(i*64+128,128); g.stroke(); g.beginPath(); g.moveTo(i*64+128,0); g.lineTo(i*64,128); g.stroke(); } const t=tex(c); return t; })();

/* footprints: T is Taalai's sole (chevrons), O another adult (bars), K small (dots) */
function printTex(kind){ const W=128,Hh=256, hd=new Float32Array(W*Hh);
  const [cc,g]=cv(W,Hh), id=g.createImageData(W,Hh), d=id.data;
  for(let y=0;y<Hh;y++) for(let x=0;x<W;x++){ const dx=x-64;
    const e=Math.min(Math.hypot(dx/40,(y-88)/72),Math.hypot(dx/27,(y-150)/62),Math.hypot(dx/32,(y-208)/38))-1;
    const m=sstep(.1,-.12,e); let tr;
    if(kind==='T') tr=((Math.abs(dx)*.9+y)%24)<10?1:0; else if(kind==='O') tr=(y%20)<9?1:0; else tr=(Math.hypot((x%22)-11,(y%22)-11)<6)?1:0;
    hd[y*W+x]=1-m*(.75-.4*tr); const i=(y*W+x)*4; const sh=255-m*30*(1-tr); d[i]=d[i+1]=d[i+2]=sh; d[i+3]=m*215; }
  g.putImageData(id,0,0); return { map:tex(cc,true,false), nrm:tex(normalFrom(hd,W,Hh,6),false,false) }; }


await pause('terrain',.17);

/* ============================================================ scene, materials, batching */

const MATS={
  wood:std({map:woodT,normalMap:woodN,normalScale:new THREE.Vector2(.7,.7),roughness:.82,...solid}),
  metal:std({metalness:1,roughness:1,roughnessMap:scratchT,metalnessMap:scratchT}),
  paint:std({roughness:.62}),
  gloss:std({roughness:.22}),
  fabric:std({roughness:1,normalMap:weaveN}),
  felt:std({roughness:1,map:feltT}),
  paper:std({roughness:.92}),
  snow:std({roughness:.92,normalMap:snowN,normalScale:new THREE.Vector2(.5,.5),...solid}),
  print:std({map:atlasA,roughness:.88}),
  screen:std({roughness:.25,emissive:0xffffff,emissiveMap:atlasE,emissiveIntensity:1.0}),
  board:std({map:boardT,roughness:.95,...solid}),
  sign:std({map:signT,roughness:.85,emissive:0xffffff,emissiveMap:signT,emissiveIntensity:.5}),
  bear:std({map:bearT,roughness:1,normalMap:weaveN,...solid}),
  ember:new THREE.MeshBasicMaterial({vertexColors:true,side:DS}),
  glass:std({transparent:true,opacity:.2,roughness:.03,depthWrite:false}),
  clear:std({transparent:true,opacity:.28,roughness:.18,depthWrite:false}),
  water:std({roughness:.04,metalness:.75})
};
const NOSHADOW={glass:1,clear:1,water:1,screen:1,ember:1};
const batches={}; for(const k in MATS) batches[k]=[];
const TICK=[], STEAM=[], GLOWS=[], NOAO=[], REG={}, PRINTS={}, ZG={};

let M4=new THREE.Matrix4(); const _stack=[];
const _e=new THREE.Euler(), _q=new THREE.Quaternion(), _col=new THREE.Color();
function mat4(x,y,z,ry=0,rx=0,rz=0,sx=1,sy=1,sz=1){ _e.set(rx,ry,rz,'YXZ'); _q.setFromEuler(_e); return new THREE.Matrix4().compose(new V3(x,y,z),_q.clone(),new V3(sx,sy,sz)); }
function push(x,y,z,ry=0,rx=0,rz=0){ _stack.push(M4); M4=M4.clone().multiply(mat4(x,y,z,ry,rx,rz)); }
function pop(){ M4=_stack.pop(); }
function W(x,y,z){ return new V3(x,y,z).applyMatrix4(M4); }

/* put: bake one primitive into the current zone's batch for its material */
function put(mat,geo,x,y,z,c=0xffffff,o={}){
  let g=geo; if(geo.index){ g=geo.toNonIndexed(); geo.dispose(); }
  g.applyMatrix4(mat4(x,y,z,o.ry,o.rx,o.rz,o.sx,o.sy,o.sz).premultiply(M4));
  const n=g.attributes.position.count, col=new Float32Array(n*3); _col.set(c);
  for(let i=0;i<n;i++){ col[i*3]=_col.r; col[i*3+1]=_col.g; col[i*3+2]=_col.b; }
  g.setAttribute('color',new THREE.BufferAttribute(col,3));
  if(!g.attributes.uv) g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(n*2),2));
  if(o.uv){ const a=g.attributes.uv; for(let i=0;i<n;i++) a.setXY(i,a.getX(i)*o.uv[0]+(o.uv[2]||0),a.getY(i)*o.uv[1]+(o.uv[3]||0)); }
  for(const k of Object.keys(g.attributes)) if(k!=='position'&&k!=='normal'&&k!=='uv'&&k!=='color') g.deleteAttribute(k);
  batches[mat].push(g); return g;
}
/* flush: merge what was put since the last flush into one mesh per material, for this zone only.
   Each zone is its own group, so frustum culling works and only the workshop goes into the shadow pass.
   Nothing is compiled here: the shaders were all started at once in warm(). */
function flush(name,shadow){
  const grp=new THREE.Group(); grp.name=name;
  for(const k in batches){ const list=batches[k]; if(!list.length) continue; const g=mergeGeometries(list,false); for(const t of list) t.dispose(); list.length=0;
    const m=new THREE.Mesh(g,MATS[k]); m.castShadow=!!shadow&&!NOSHADOW[k]; m.receiveShadow=!!shadow&&k!=='ember'&&k!=='screen'; if(k==='glass'||k==='clear') m.renderOrder=3; grp.add(m); }
  scene.add(grp); ZG[name]=grp; shadowsDirty();
}
function shadowsDirty(){ renderer.shadowMap.needsUpdate=true; }

function bx(mat,w,h,d,x,y,z,c,o={}){ if(mat==='wood'&&!o.uv){ const L=Math.max(w,h,d); o=Object.assign({uv:[L/1.3,rr(.25,.45),rng(),rng()]},o); } return put(mat,new THREE.BoxGeometry(w,h,d),x,y,z,c,o); }
function cy(mat,rt,rb,h,x,y,z,c,o={}){ return put(mat,new THREE.CylinderGeometry(rt,rb,h,o.seg||16,1,!!o.open),x,y,z,c,o); }
function sp(mat,r,x,y,z,c,o={}){ return put(mat,new THREE.SphereGeometry(r,o.seg||14,o.seg2||10),x,y,z,c,o); }
function tr(mat,R,r,x,y,z,c,o={}){ return put(mat,new THREE.TorusGeometry(R,r,8,o.seg||20,o.arc||2*PI),x,y,z,c,o); }
function lt(mat,prof,x,y,z,c,o={}){ return put(mat,new THREE.LatheGeometry(prof.map(p=>new THREE.Vector2(p[0],p[1])),o.seg||20),x,y,z,c,o); }
function tb(mat,pts,rad,c,o={}){ const cur=new THREE.CatmullRomCurve3(pts.map(p=>new V3(p[0],p[1],p[2]))); return put(mat,new THREE.TubeGeometry(cur,o.seg||Math.max(8,pts.length*6),rad,o.rs||6,false),0,0,0,c,o); }
/* quad with a rectangle of an atlas; faces +Z, pass rx:-PI/2 to lay it flat */
function qd(mat,w,h,rect,x,y,z,o={}){ const g=new THREE.PlaneGeometry(w,h), a=g.attributes.uv; for(let i=0;i<a.count;i++) a.setXY(i,lerp(rect[0],rect[2],a.getX(i)),lerp(rect[1],rect[3],a.getY(i))); return put(mat,g,x,y,z,o.c||0xffffff,o); }

/* picking and tour registry; anchor: where a stop's main photo hangs in the world as a small print */
function reg(id,o){ REG[id]={cam:W(...o.cam),look:W(...o.look),m:W(...o.m),boxC:W(o.box[0],o.box[1],o.box[2]),boxS:new V3(o.box[3],o.box[4],o.box[5]),via:o.via?W(...o.via):null}; if(pendingFly===id) fly(id); }
function anchor(id,x,y,z,ry=0,rx=0,size=.15){ PRINTS[id]={m:M4.clone().multiply(mat4(x,y,z,ry,rx)),size,pos:W(x,y,z),mesh:null,state:0}; }

function gnormal(x,z){ const e=.4; return new V3(H(x-e,z)-H(x+e,z),2*e,H(x,z-e)-H(x,z+e)).normalize(); }
const curveOf=pts=>new THREE.CatmullRomCurve3(pts.map(p=>new V3(p[0],0,p[1])));
const sample=(pts,step)=>{ const c=curveOf(pts), n=Math.max(2,Math.round(c.getLength()/step)); return c.getSpacedPoints(n); };

REG.overview={cam:new V3(12,deckY+4.6,27),look:new V3(0,deckY+2.6,-1)};

/* lantern posts along every trail */
const LANT=[];
for(const k in PATHS){ const c=curveOf(PATHS[k]), L=c.getLength(), n=Math.floor(L/7); for(let i=1;i<=n;i++){ const t=i*7/L; if(t>.98) continue; const p=c.getPointAt(t), tg=c.getTangentAt(t), s=i%2?1:-1; LANT.push([p.x-tg.z*s*1.15,p.z+tg.x*s*1.15]); } }

/* trail map (snow gets darker and smoother where people walk) and baked light pools:
   lanterns, the yurt door, the signpost. These replace real lights. */
const toPx=v=>(v/160+.5)*1024;
const trailT=(()=>{ const [c,g]=cv(1024,1024); g.fillStyle='#fff'; g.fillRect(0,0,1024,1024); g.lineCap='round'; g.lineJoin='round';
  const soft=(draw)=>{ for(const [w,a] of [[2.6,.07],[1.7,.11],[1,.17]]){ g.strokeStyle=g.fillStyle=`rgba(150,164,198,${a})`; draw(w*6.4); } };
  for(const k in PATHS){ const p=sample(PATHS[k],.8); soft(w=>{ g.lineWidth=w; g.beginPath(); p.forEach((q,i)=>{ const X=toPx(q.x), Y=toPx(q.z); if(i) g.lineTo(X,Y); else g.moveTo(X,Y); }); g.stroke(); }); }
  const blob=(x,z,r)=>{ for(const [k,a] of [[1.25,.06],[1,.09],[.75,.12]]){ g.fillStyle=`rgba(150,164,198,${a})`; g.beginPath(); g.arc(toPx(x),toPx(z),r*k*6.4,0,2*PI); g.fill(); } };
  for(let i=0;i<26;i++){ const a=i/26*2*PI; blob(Math.cos(a)*6.9,Math.sin(a)*4.6,1.5); }
  blob(ZONE.circle[0],ZONE.circle[1],4.2); blob(-13.3,-1,2.2); blob(9.6,-15.4,3); blob(2,34,2.4); blob(15.6,4,1.7);
  return tex(c,true,false); })();
const poolT=(()=>{ const [c,g]=cv(1024,1024); g.fillStyle='#000'; g.fillRect(0,0,1024,1024);
  const pool=(x,z,r,a)=>{ const X=toPx(x), Y=toPx(z), R=r*6.4, gr=g.createRadialGradient(X,Y,0,X,Y,R); gr.addColorStop(0,`rgba(255,176,98,${a})`); gr.addColorStop(.35,`rgba(255,160,80,${a*.42})`); gr.addColorStop(1,'rgba(255,150,70,0)'); g.fillStyle=gr; g.fillRect(X-R,Y-R,2*R,2*R); };
  for(const l of LANT) pool(l[0],l[1],3.4,.95);
  g.save(); g.translate(toPx(ZONE.yurt[0]+5.4),toPx(ZONE.yurt[1])); g.scale(1.9,1); const gr=g.createRadialGradient(0,0,0,0,0,15); gr.addColorStop(0,'rgba(255,170,95,.95)'); gr.addColorStop(.5,'rgba(255,160,80,.4)'); gr.addColorStop(1,'rgba(255,150,70,0)'); g.fillStyle=gr; g.fillRect(-16,-16,32,32); g.restore();
  pool(ZONE.fork[0],ZONE.fork[1]+.2,3.2,.8);
  return tex(c,true,false); })();
await pause('terrain',.2);

groundMat.map=trailT; groundMat.normalMap=groundN; groundMat.emissiveMap=poolT;
{ const d=await groundP, g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(d.pos,3)); g.setAttribute('normal',new THREE.BufferAttribute(d.nor,3)); g.setAttribute('color',new THREE.BufferAttribute(d.col,3)); g.setAttribute('uv',new THREE.BufferAttribute(d.uv,2)); g.setIndex(new THREE.BufferAttribute(d.idx,1));
  g.computeBoundingSphere(); const ground=new THREE.Mesh(g,groundMat); ground.receiveShadow=true; ground.frustumCulled=false; scene.add(ground); }
await pause('sky',.26);

/* a few faint stars high up, away from the glow */
{ const n=160, a=new Float32Array(n*3); for(let i=0;i<n;i++){ const th=rr(0,2*PI), ph=rr(.05,1.0), R=8000; a[i*3]=R*Math.sin(ph)*Math.cos(th); a[i*3+1]=R*Math.cos(ph); a[i*3+2]=-Math.abs(R*Math.sin(ph)*Math.sin(th)); }
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(a,3)); const st=new THREE.Points(g,new THREE.PointsMaterial({color:0xdfe6ff,size:1.4,sizeAttenuation:false,fog:false,transparent:true,opacity:.5,depthWrite:false})); st.frustumCulled=false; scene.add(st); }

/* ============================================================ spruces (instanced alpha cards) */
let TREES=null;
{
  const pos=[],uv=[],nor=[],idx=[]; for(let k=0;k<3;k++){ const a=k*PI/3, cx=Math.cos(a)*.5, sz=Math.sin(a)*.5, b=pos.length/3; pos.push(-cx,0,-sz, cx,0,sz, cx,1,sz, -cx,1,-sz); uv.push(0,0,1,0,1,1,0,1); for(let i=0;i<4;i++) nor.push(0,1,0); idx.push(b,b+1,b+2,b,b+2,b+3,b,b+2,b+1,b,b+3,b+2); }
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); g.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3)); g.setIndex(idx);
  const m=INST({map:treeT,alphaTest:.45,roughness:1});
  const NT=TIERS.high.trees, im=new THREE.InstancedMesh(g,m,NT); const pathPts=[]; for(const k in PATHS) sample(PATHS[k],2).forEach(p=>pathPts.push(p));
  let n=0, guard=0; const c=new THREE.Color();
  while(n<NT&&guard++<6000){ const a=rr(0,2*PI), r=40+Math.pow(rng(),1.4)*170, x=Math.cos(a)*r, z=Math.sin(a)*r;
    if(fbm(x*.02+40,z*.02+11,2)<.47) continue;
    if(z<-10&&Math.abs(x-(19-z*.15))<17) continue;                      /* keep the piste open */
    if(Math.abs(x-(21+.15*z))<4.5) continue;                             /* gully */
    if(z>6&&Math.abs(x-2)<5+z*.42) continue;                             /* the view down the road */
    let ok=true; for(const p of pathPts) if(Math.hypot(p.x-x,p.z-z)<5){ ok=false; break; } for(const k in ZONE) if(Math.hypot(ZONE[k][0]-x,ZONE[k][1]-z)<9) ok=false; if(!ok) continue;
    const h=rr(8,15), w=h*rr(.24,.31); im.setMatrixAt(n,mat4(x,H(x,z)-.25,z,rr(0,PI),0,0,w,h,w)); c.setHSL(.42,.1,rr(.55,.95)); im.setColorAt(n,c); n++; }
  im.userData.full=n; im.count=Math.min(n,TIERS[tier].trees); im.instanceMatrix.needsUpdate=true; im.frustumCulled=false; scene.add(im); TREES=im;
}
/* glows for lamps (points, so the AO pass ignores them); called again as more lamps appear */
function makeGlows(){ const groups={}; for(const g of GLOWS){ const k=g[1]+'_'+g[2]; (groups[k]=groups[k]||[]).push(g[0]); } GLOWS.length=0;
  for(const k in groups){ const [size,col]=k.split('_').map(Number), a=new Float32Array(groups[k].length*3); groups[k].forEach((p,i)=>{ a[i*3]=p.x; a[i*3+1]=p.y; a[i*3+2]=p.z; });
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(a,3)); g.computeBoundingSphere(); scene.add(new THREE.Points(g,new THREE.PointsMaterial({map:glowT,color:col,size,transparent:true,opacity:.55,blending:THREE.AdditiveBlending,depthWrite:false,sizeAttenuation:true}))); } }
/* lantern posts */
{ const posts=LANT.map(l=>[l[0],H(l[0],l[1]),l[1]]);
  for(const p of posts){ cy('paint',.035,.045,1.15,p[0],p[1]+.575,p[2],0x4a3423,{seg:8}); bx('paint',.13,.02,.13,p[0],p[1]+1.3,p[2],0x2a2a2e); sp('ember',.05,p[0],p[1]+1.22,p[2],0xffd9a0,{seg:10,seg2:8}); }
  flush('trails',false);
  posts.forEach(p=>GLOWS.push([new V3(p[0],p[1]+1.22,p[2]),1.0,0xffb070]));
  GLOWS.push([new V3(ZONE.yurt[0]+3,H(ZONE.yurt[0],ZONE.yurt[1])+1.0,ZONE.yurt[1]),2.2,0xffa860]);
  GLOWS.push([LAMP.clone().add(new V3(0,.02,0)),.8,0xffc98f]); makeGlows(); }

await pause('workshop',.3);

/* ============================================================ camera, controls */
const controls=new OrbitControls(camera,canvas);
controls.enableDamping=true; controls.dampingFactor=.07; controls.minDistance=1.1; controls.maxDistance=60; controls.maxPolarAngle=PI/2-.02;
controls.rotateSpeed=.6; controls.zoomSpeed=.8; controls.screenSpacePanning=false;
controls.autoRotate=false; controls.autoRotateSpeed=.35;
camera.position.copy(REG.overview.cam); controls.target.copy(REG.overview.look);

let flyS=null, flyFrom='overview', pendingFly=null, lastInput=performance.now();
function fly(id){ const r=REG[id]; if(!r){ pendingFly=id; return; } pendingFly=null; if(id!=='overview'||flyS||!controls.autoRotate) controls.autoRotate=false; lastInput=performance.now();
  /* a stop inside something (the yurt) has a door: the camera goes in through it, and comes out through it on the way to the next stop */
  const via=r.via||(REG[flyFrom]&&REG[flyFrom].via)||null; flyFrom=id;
  if(REDUCE){ camera.position.copy(r.cam); controls.target.copy(r.look); flyS=null; return; }
  flyS={p0:camera.position.clone(),t0:controls.target.clone(),p1:r.cam,t1:r.look,via,d:via?2100:1500,s:performance.now()}; }
controls.addEventListener('start',()=>{ flyS=null; controls.autoRotate=false; UI.moved(); });
for(const ev of ['pointerdown','pointermove','wheel','keydown','touchstart']) window.addEventListener(ev,()=>{ lastInput=performance.now(); },{passive:true});

/* ============================================================ markers, hover, picking */
const marksEl=document.getElementById('marks'), tipEl=document.getElementById('tip'), panelEl=document.getElementById('panel');
const MARKS=[], proxies=[], proxyRoot=new THREE.Group();
function buildMarkers(){ for(const it of UI.ITEMS){ const r=REG[it.id]; if(!r||it.id==='overview') continue;
  const b=document.createElement('button'); b.type='button'; b.className='mk'+(it.parent!=null?' sub':''); const i=document.createElement('i'); if(it.stop!=null) i.textContent=it.stop; b.appendChild(i);
  b.addEventListener('click',ev=>{ ev.stopPropagation(); UI.pick(it.id); }); marksEl.appendChild(b); MARKS.push({id:it.id,el:b,p:r.m});
  const px=new THREE.Mesh(new THREE.BoxGeometry(1,1,1)); px.position.copy(r.boxC); px.scale.copy(r.boxS); px.userData.id=it.id; proxyRoot.add(px); proxies.push(px); }
  proxyRoot.updateMatrixWorld(true); relabel(); setCurrent(UI.state().cur); camDirty=true; }
function relabel(){ for(const m of MARKS) m.el.setAttribute('aria-label',UI.title(m.id)); }
let curId='overview';
function setCurrent(id){ curId=id; for(const m of MARKS) m.el.setAttribute('aria-current',m.id===id?'true':'false'); }

const ray=new THREE.Raycaster(), ndc=new THREE.Vector2();
function hit(x,y){ const r=canvas.getBoundingClientRect(); ndc.set((x-r.left)/r.width*2-1,-((y-r.top)/r.height*2-1)); ray.setFromCamera(ndc,camera); const h=ray.intersectObjects(proxies,false); return h.length?h[0].object.userData.id:null; }
let down=null, mouse=null;
function hover(){ if(!mouse){ tipEl.style.opacity=0; return; } const id=hit(mouse.x,mouse.y); canvas.style.cursor=id?'pointer':'grab';
  if(id){ tipEl.textContent=UI.title(id); tipEl.style.transform=`translate(${mouse.x+14}px,${mouse.y+16}px)`; tipEl.style.opacity=1; } else tipEl.style.opacity=0; }
canvas.addEventListener('pointerdown',e=>{ down={x:e.clientX,y:e.clientY,t:performance.now()}; });
canvas.addEventListener('pointerup',e=>{ if(!down) return; const still=Math.hypot(e.clientX-down.x,e.clientY-down.y)<7&&performance.now()-down.t<450; down=null; if(!still) return;
  const id=hit(e.clientX,e.clientY); if(id) UI.pick(id); else { const s=UI.state(); if(s.open&&s.cur!=='overview') UI.empty(); } });
canvas.addEventListener('pointermove',e=>{ if(e.pointerType!=='mouse'||e.buttons){ mouse=null; tipEl.style.opacity=0; return; } mouse={x:e.clientX,y:e.clientY}; hover(); });
canvas.addEventListener('pointerleave',()=>{ mouse=null; tipEl.style.opacity=0; });

/* ============================================================ sizing: keep the subject clear of the panel */
let VW=1,VH=1, offX=0,offY=0, camDirty=true;
function applySize(){ renderer.setPixelRatio(PXR); renderer.setSize(VW,VH,false); if(composer){ composer.setPixelRatio(PXR); composer.setSize(VW,VH); } }
function resize(){ if(SHOT){ VW=1200; VH=630; canvas.style.width='1200px'; canvas.style.height='630px'; } else { VW=stage.clientWidth||1; VH=stage.clientHeight||1; } applySize(); camera.aspect=VW/VH; camera.fov=VW<VH?58:44; camera.updateProjectionMatrix(); camDirty=true; }
if(window.ResizeObserver) new ResizeObserver(resize).observe(stage); else addEventListener('resize',resize); resize();
function panelOffset(dt){ if(SHOT||panelEl.hidden){ if(offX||offY){ offX=offY=0; camera.clearViewOffset(); } return; }
  const r=panelEl.getBoundingClientRect(), wide=VW>=860, open=!panelEl.classList.contains('shut');
  const tx=wide&&open?(VW-r.left)/2:0, ty=wide?0:(VH-r.top)/2, k=REDUCE?1:Math.min(1,dt*5);
  if(Math.abs(tx-offX)<.3&&Math.abs(ty-offY)<.3) return;
  offX+=(tx-offX)*k; offY+=(ty-offY)*k;
  if(Math.abs(offX)<.5&&Math.abs(offY)<.5) camera.clearViewOffset(); else camera.setViewOffset(VW,VH,offX,offY,VW,VH); }

/* ============================================================ photo prints inside the world */
const texLoader=new THREE.TextureLoader();
function printMesh(pr,map,ratio){ const w=ratio>=1?pr.size:pr.size*ratio, h=ratio>=1?pr.size/ratio:pr.size, g=new THREE.Group();
  const back=new THREE.Mesh(white(new THREE.BoxGeometry(w+.014,h+.014,.0012)),std({color:0xefeadf,roughness:.9})); g.add(back);
  if(map){ const ph=new THREE.Mesh(white(new THREE.PlaneGeometry(w,h)),std({map,roughness:.55})); ph.position.z=.001; g.add(ph); }
  g.matrixAutoUpdate=false; g.matrix.copy(pr.m).multiply(new THREE.Matrix4().makeTranslation(0,h/2+.007,0)); scene.add(g); pr.mesh=g; shadowsDirty(); }
function updatePrints(){ for(const id in PRINTS){ const pr=PRINTS[id]; if(pr.state) continue; const p=UI.photo(id);
    if(!p){ if(EDIT){ pr.state=2; printMesh(pr,null,1.5); } else pr.state=3; continue; }
    if(camera.position.distanceTo(pr.pos)>8&&curId!==id) continue;
    /* the small copy if there is one, else the photo itself */
    const ok=t=>{ t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=4; pr.state=2; printMesh(pr,t,(p.w&&p.h&&!p.video)?p.w/p.h:(t.image.width/t.image.height)); };
    const src=p.video?p.poster:p.src;           /* a clip hangs in the world as its still frame */
    pr.state=1; texLoader.load(p.video?src:SITE.small(src),ok,undefined,()=>texLoader.load(src,ok,undefined,()=>{ pr.state=3; })); } }

/* ============================================================ pacing: resolution, quality level, idle */
const perf={n:0,sum:0,cpu:0,sec:performance.now(),warm:0,warmSum:0,good:0,hold:0,ceil:9,fps:0,ms:0,slowHits:0};
function setTier(t){ if(t===tier) return; tier=t; const T=TIERS[t]; TREES.count=Math.min(TREES.userData.full,T.trees); if(SNOW) SNOW.geometry.setDrawRange(0,T.snow);
  if(twi.shadow.mapSize.x!==T.shadow){ twi.shadow.mapSize.set(T.shadow,T.shadow); if(twi.shadow.map){ twi.shadow.map.dispose(); twi.shadow.map=null; } shadowsDirty(); }
  if(PXR>T.prMax){ PXR=T.prMax; applySize(); } camDirty=true; }
function govern(dtMs,cpuMs){
  if(SHOT) return;
  if(dtMs>250) return;                               /* the browser is holding frames back (background tab, power saving) or one frame hiccuped: that says nothing about this device */
  perf.n++; perf.sum+=dtMs; perf.cpu+=cpuMs;
  if(!tierLocked&&built&&perf.warm<90&&UI.state().entered){ perf.warm++; perf.warmSum+=dtMs; if(perf.warm===90){ const a=perf.warmSum/90; if(a>26) setTier(tier==='high'?'med':'low'); if(a>40&&tier!=='low'){ perf.warm=0; perf.warmSum=0; } } }
  const now=performance.now(); if(now-perf.sec<1000) return;
  const avg=perf.sum/perf.n, cpu=perf.cpu/perf.n; perf.fps=1000/avg; perf.ms=avg; perf.sec=now; perf.n=0; perf.sum=0; perf.cpu=0;
  if(idle) return;                                   /* at 30 fps on purpose: do not read that as slowness */
  const max=Math.min(DPR,TIERS[tier].prMax,perf.ceil);
  if(avg>18&&PXR>.75){ if(perf.good>0) perf.ceil=PXR-.125; PXR=Math.max(.75,PXR-.125); perf.good=0; perf.hold=now+20000; applySize(); camDirty=true; }
  else if((avg<12||(avg<17.4&&cpu<7))&&PXR<max){ perf.good++; if(perf.good>=3&&now>perf.hold){ PXR=Math.min(max,PXR+.125); perf.good=0; applySize(); camDirty=true; } }
  else perf.good=0;
  if(avg>45&&tier==='low'&&PXR<=.75){ if(++perf.slowHits===4) UI.slow(); }
  else if(avg>30&&!tierLocked&&tier!=='low'&&PXR<=.75) setTier(tier==='high'?'med':'low');
}
const dbgEl=document.getElementById('dbg'); if(DEBUG){ dbgEl.hidden=false; window.__dbg={THREE,LOG,REG,tick:()=>tick(),scene,renderer,camera,controls,get composer(){ return composer; },ZG,LIGHTS,twi}; }

/* ============================================================ loop */
const clock=new THREE.Clock(), _v=new V3(), lastCam=new Float32Array(32);
let idle=false, lastRender=0, moving=0, aoFade=0, SNOW=null, running=false, built=false, aoWarm=false;
function camChanged(){ const a=camera.matrixWorld.elements, b=camera.projectionMatrix.elements; let ch=camDirty; for(let i=0;i<16;i++){ if(Math.abs(a[i]-lastCam[i])>1e-5||Math.abs(b[i]-lastCam[16+i])>1e-6) ch=true; lastCam[i]=a[i]; lastCam[16+i]=b[i]; } camDirty=false; return ch; }
function tick(){
  const now=performance.now();
  idle=!flyS&&!controls.autoRotate&&now-lastInput>6000;
  if(idle&&now-lastRender<30) return;                 /* nothing is happening: 30 fps is enough */
  const dtMs=lastRender?now-lastRender:16.7; lastRender=now;
  const dt=Math.min(.05,clock.getDelta()), t=clock.elapsedTime;
  if(flyS){ const k=Math.min(1,(now-flyS.s)/flyS.d), e=k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2;
    if(flyS.via){ const u=1-e; camera.position.set(0,0,0).addScaledVector(flyS.p0,u*u).addScaledVector(flyS.via,2*u*e).addScaledVector(flyS.p1,e*e); } else camera.position.lerpVectors(flyS.p0,flyS.p1,e);
    controls.target.lerpVectors(flyS.t0,flyS.t1,e); if(k>=1) flyS=null; }
  controls.update();
  /* stay inside the world and above the snow */
  const tg=controls.target, tr2=Math.hypot(tg.x,tg.z); if(tr2>60){ tg.x*=60/tr2; tg.z*=60/tr2; } tg.y=clamp(tg.y,H(tg.x,tg.z)-.5,H(tg.x,tg.z)+14);
  const fl=H(camera.position.x,camera.position.z)+.35; if(camera.position.y<fl) camera.position.y=fl;
  panelOffset(dt); camera.updateMatrixWorld();
  const changed=camChanged();
  if(!REDUCE) for(const f of TICK) f(t,dt);
  /* AO only when the camera rests: off while moving, back 0.3 s after it stops, faded in over 0.4 s */
  if(aoPass){ if(changed) moving=now; const rest=now-moving, want=TIERS[tier].ao&&aoWarm&&(rest>300||SHOT);
    if(!want){ aoPass.enabled=false; aoFade=0; } else { aoPass.enabled=true; aoFade=SHOT?1:Math.min(1,aoFade+dt/.4); aoPass.blendIntensity=aoFade; } }
  renderer.info.reset();
  /* with a composer every frame goes through it, on every level: drawing straight to the screen would need a second set of shaders */
  if(composer){ smaaPass.enabled=tier!=='low'; composer.render(dt); } else renderer.render(scene,camera);
  if(changed){
    for(const m of MARKS){ _v.copy(m.p).project(camera); const ok=_v.z<1&&Math.abs(_v.x)<1.05&&Math.abs(_v.y)<1.05;
      if(!ok){ if(m.vis!==false){ m.el.style.display='none'; m.vis=false; } continue; }
      if(m.vis!==true){ m.el.style.display='block'; m.vis=true; }
      const d=camera.position.distanceTo(m.p); m.el.style.opacity=clamp(1.15-d/60,.3,.95).toFixed(2);
      m.el.style.transform=`translate(${((_v.x*.5+.5)*VW).toFixed(1)}px,${((-_v.y*.5+.5)*VH).toFixed(1)}px)`; }
    if(mouse) hover();
    updatePrints();
  }
  const cpu=performance.now()-now; govern(dtMs,cpu);
  if(DEBUG){ const r=renderer.info.render; dbgEl.textContent=`${perf.fps.toFixed(0)} fps  ${perf.ms.toFixed(1)} ms${idle?'  idle':''}\ncalls ${r.calls}  tris ${(r.triangles/1000).toFixed(0)}k\npr ${PXR.toFixed(3)}  q ${tier}${aoPass&&aoPass.enabled?'  ao':''}\nbuild step max ${Math.max(...STEPS)} ms`; }
}
function startLoop(){ if(running) return; running=true; clock.getDelta(); lastRender=0; renderer.setAnimationLoop(tick); }
document.addEventListener('visibilitychange',()=>{ if(!running) return; if(document.hidden) renderer.setAnimationLoop(null); else { clock.getDelta(); lastRender=0; renderer.setAnimationLoop(tick); } });

/* the workshop is ready: show the first frame and let the visitor in while the far zones are still being built */
async function firstFrame(){
  const t0=performance.now(); await Promise.all([warmP,noiseP]); scene.remove(warmG); _gpu+=performance.now()-t0;
  shadowsDirty(); startLoop();
  window.__world={ fly, setCurrent:id=>{ setCurrent(id); camDirty=true; }, relabel, entered:()=>{ if(!REDUCE&&UI.state().cur==='overview') controls.autoRotate=true; lastInput=performance.now(); } };
  UI.ready('first'); window.__perf={first:Math.round(performance.now()),steps:STEPS};
}
/* ?shot=1: one clean 1200x630 frame of the overview, saved as PNG (for og.jpg) */
function shoot(){ camera.position.copy(REG.overview.cam); controls.target.copy(REG.overview.look); controls.update(); camera.clearViewOffset(); camera.updateMatrixWorld(); shadowsDirty();
  for(let i=0;i<3;i++){ renderer.info.reset(); if(composer) composer.render(.016); else renderer.render(scene,camera); }
  try{ const a=document.createElement('a'); a.download='og.png'; a.href=canvas.toDataURL('image/png'); document.body.appendChild(a); a.click(); a.remove(); }catch(e){}
  window.__shot=true; }

/* ============================================================ zones and props */
const PR={T:[],O:[],K:[]};
const WD={deck:0x6b4c32,dark:0x4a3423,table:0x9a7650,pale:0xb99872,chair:0x8a6a48};
const tint=(c,v=.1)=>{ _col.set(c).multiplyScalar(1+rr(-v,v)); return _col.getHex(); };
const vb=(w,h,d,x,y,z,c,o={})=>bx('wood',h,w,d,x,y,z,c,Object.assign({rz:PI/2},o));   /* upright timber, grain running up */

function mug(x,y,z,c,o={}){ push(x,y,z,o.ry||rr(0,6));
  cy('gloss',.04,.036,.09,0,.045,0,c,{open:true}); cy('gloss',.036,.036,.004,0,.002,0,c); tr('gloss',.022,.006,.05,.048,0,c);
  if(o.level!==0) cy('gloss',.036,.036,.002,0,o.level||.074,0,o.tea||0x6e4a2a); if(o.steam!==false) STEAM.push(W(0,.11,0)); pop(); }
function jacket(c,sy){ sp('fabric',1,0,sy+.3,-.27,c,{sx:.27,sy:.27,sz:.06}); sp('fabric',1,0,sy+.36,-.14,c,{sx:.25,sy:.17,sz:.05});
  cy('fabric',.065,.065,.5,0,sy+.5,-.2,c,{rz:PI/2}); cy('fabric',.062,.05,.44,-.29,sy+.27,-.23,c,{rz:-.1}); cy('fabric',.062,.05,.4,.29,sy+.29,-.23,c,{rz:.12});
  tr('fabric',.07,.028,0,sy+.56,-.2,tint(c,.2),{rx:PI/2,sx:1.5}); }
function chair(x,z,ry,o={}){ const k=o.k||1, sy=.45*k, W0=tint(WD.chair,.08); push(x,0,z,ry+rr(-.22,.22));
  for(const [lx,lz] of [[-.19,-.19],[.19,-.19],[-.19,.19],[.19,.19]]) vb(.04,sy,.04,lx,sy/2,lz,W0);
  bx('wood',.44,.035,.44,0,sy+.017,0,W0); vb(.04,.5,.035,-.19,sy+.25,-.2,W0); vb(.04,.5,.035,.19,sy+.25,-.2,W0);
  bx('wood',.42,.09,.022,0,sy+.44,-.2,W0); bx('wood',.42,.055,.022,0,sy+.24,-.2,W0);
  if(o.jacket!=null) jacket(o.jacket,sy);
  if(o.bear){ bx('bear',.46,.36,.026,0,sy+.33,-.24,0xffffff,{rx:.03}); bx('fabric',.46,.2,.026,0,sy+.42,-.17,0xcfc6b2,{rx:-.03}); cy('fabric',.036,.036,.46,0,sy+.515,-.205,0xcfc6b2,{rz:PI/2}); }
  pop(); }
function stool(x,z){ push(x,0,z,rr(0,6)); cy('wood',.17,.17,.035,0,.5,0,tint(WD.pale),{seg:20}); for(let i=0;i<3;i++){ const a=i*2.094; cy('wood',.02,.022,.5,Math.cos(a)*.11,.25,Math.sin(a)*.11,WD.dark,{rz:Math.cos(a)*.12,rx:-Math.sin(a)*.12}); } pop(); }
function laptop(x,y,z,ry,rect){ push(x,y,z,ry); bx('metal',.32,.014,.22,0,.007,0,0x8d9096); bx('paint',.28,.002,.11,0,.0145,-.03,0x15161a);
  push(0,.014,-.11,0,-.28); bx('metal',.32,.2,.008,0,.1,-.004,0x8d9096); qd('screen',.3,.186,rect,0,.1,.001); pop(); pop(); }
function book(x,y,z,ry,c,spine){ push(x,y,z,ry); bx('paint',.2,.03,.14,0,.015,0,c); bx('paper',.19,.022,.135,.003,.015,0,0xe9e2d0); if(spine) qd('print',.2,.03,spine,0,.015,.0705); pop(); }
function sheet(rect,x,y,z,ry,w=.21,h=.297){ if(rect) qd('print',w,h,rect,x,y,z,{rx:-PI/2,ry}); else bx('paper',w,.001,h,x,y,z,0xf5f2e8,{ry}); }
function ribbon(mat,pts,c){ const pos=[],nor=[],uv=[]; for(let i=0;i<pts.length-1;i++){ const a=pts[i], b=pts[i+1], dx=b[0]-a[0], dz=b[2]-a[2], L=Math.hypot(dx,dz)||1, nx=-dz/L, nz=dx/L, wa=a[3]/2, wb=b[3]/2;
    const A=[a[0]-nx*wa,a[1],a[2]-nz*wa], B=[a[0]+nx*wa,a[1],a[2]+nz*wa], C=[b[0]-nx*wb,b[1],b[2]-nz*wb], D=[b[0]+nx*wb,b[1],b[2]+nz*wb];
    pos.push(...A,...B,...C,...B,...D,...C); for(let k=0;k<6;k++){ nor.push(0,1,0); uv.push(0,0); } }
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); g.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3)); g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); put(mat,g,0,0,0,c); }

/* ---------------- A: the workshop ---------------- */
push(0,deckY,0);
bx('paint',11.9,.24,7.4,0,-.17,0,0x17120f);
for(let i=0;i<39;i++) bx('wood',12,.045,.185,0,-.0225,-3.75+.096+i*.1925,tint(WD.deck,.14));
bx('wood',12.04,.28,.05,0,-.16,3.76,WD.dark); bx('wood',12.04,.28,.05,0,-.16,-3.76,WD.dark); bx('wood',7.5,.28,.05,6.0,-.16,0,WD.dark,{ry:PI/2}); bx('wood',7.5,.28,.05,-6.0,-.16,0,WD.dark,{ry:PI/2});
for(const [sx,sz,ry] of [[.6,4.05,0],[-3.2,4.05,0],[3.2,-4.05,0],[-6.3,.4,PI/2],[6.3,1,PI/2]]) bx('wood',1.2,.12,.5,sx,-.24,sz,tint(WD.deck),{ry});
for(const [x,z,h] of [[-5.75,-3.5,2.95],[5.75,-3.5,2.95],[-5.75,3.5,3.3],[5.75,3.5,3.3]]){ vb(.16,h,.16,x,h/2,z,WD.dark); bx('wood',.5,.08,.08,x-Math.sign(x)*.22,h-.3,z,WD.dark,{rz:Math.sign(x)*.8}); }
push(0,3.12,0,0,-.05);
  bx('wood',12.3,.14,.12,0,0,3.5,WD.dark); bx('wood',12.3,.14,.12,0,0,-3.5,WD.dark);
  for(let i=0;i<9;i++) bx('wood',7.7,.12,.06,-5.75+i*1.4375,.13,0,tint(WD.dark),{ry:PI/2});
  for(let i=0;i<27;i++) bx('wood',12.7,.025,.288,0,.205,-3.9+.15+i*.2925,tint(0x7a5a3c,.14));
  bx('snow',12.6,.13,7.8,0,.285,0,0xe9eef8,{uv:[5,3]});
pop();
/* garland along the eaves */
{ const top=z=>3.12+z*.05-.16, spans=[]; for(let i=0;i<3;i++){ spans.push([[-5.75+i*3.833,3.5],[-5.75+(i+1)*3.833,3.5]]); spans.push([[-5.75+i*3.833,-3.5],[-5.75+(i+1)*3.833,-3.5]]); }
  for(let i=0;i<2;i++){ spans.push([[-5.75,-3.5+i*3.5],[-5.75,i*3.5]]); spans.push([[5.75,-3.5+i*3.5],[5.75,i*3.5]]); }
  for(const [a,b] of spans){ const pts=[], L=Math.hypot(b[0]-a[0],b[1]-a[1]), n=Math.round(L/.42); for(let i=0;i<=n;i++){ const t=i/n, x=lerp(a[0],b[0],t), z=lerp(a[1],b[1],t), y=top(z)-Math.sin(t*PI)*.24; pts.push([x,y,z]); if(i>0&&i<n){ sp('ember',.028,x,y-.04,z,0xffe2b4,{seg:8,seg2:6}); GLOWS.push([W(x,y-.04,z),.34,0xffb070]); } } tb('paint',pts,.005,0x101010,{seg:n*2,rs:4}); } }

await flush('deck',true);
makeGlows();
await pause('workshop',.36);
/* 1: the shared table */
push(-.9,0,-.3);
  bx('wood',3.6,.05,.95,0,.755,0,WD.table); bx('wood',3.6,.052,.045,0,.755,.455,0xbb9d78); bx('wood',3.6,.052,.045,0,.755,-.455,0xb79873);
  for(const x of [-1.45,1.45]){ vb(.07,.73,.07,x,.365,-.36,WD.dark,{rx:.0}); vb(.07,.73,.07,x,.365,.36,WD.dark); bx('wood',.07,.07,.8,x,.2,0,WD.dark); } bx('wood',2.9,.07,.05,0,.2,0,WD.dark);
  const seats=[[-1.2,-.85,0],[0,-.95,0,0x7a2f2a],[1.2,-1.1,0],[-1.2,.9,PI,0x2f4a66],[0,1.15,PI],[1.25,.88,PI],[-2.3,.05,PI/2,0xa8853a],[2.35,-.1,-PI/2]];
  for(const s of seats) chair(s[0],s[1],s[2],{jacket:s[3]});
  const T=.78;
  bx('paint',.14,.006,.09,-.15,T+.003,.02,0x1d5236,{ry:.3}); for(let i=0;i<4;i++) bx('paint',.022,.007,.022,-.19+i*.03,T+.009,.02+i*.012,0x101012,{ry:.3}); bx('metal',.05,.012,.008,-.11,T+.011,.055,0xc9c9c9,{ry:.3});
  bx('paint',.165,.01,.055,.12,T+.005,-.13,0xe6e2d6,{ry:-.2});
  tb('paint',[[-.1,T+.01,.03],[0,T+.05,-.04],[.09,T+.012,-.12]],.0025,0xb3261e); tb('paint',[[-.12,T+.01,.0],[-.02,T+.04,-.1],[.11,T+.012,-.14]],.0025,0x2a4f9a); tb('paint',[[-.18,T+.01,.04],[-.3,T+.03,.15],[-.42,T+.006,.1]],.0025,0xd6b23a);
  push(.5,T,.12,.4); bx('paint',.085,.035,.16,0,.0175,0,0xd79a1e); qd('print',.075,.075,UA.meter,0,.0355,.02,{rx:-PI/2}); pop();
  tb('paint',[[.46,T+.02,.04],[.3,T+.05,.0],[.05,T+.012,.05],[-.08,T+.012,.04]],.003,0xb3261e); tb('paint',[[.5,T+.02,.03],[.4,T+.04,-.1],[.2,T+.012,-.1]],.003,0x111111);
  cy('paint',.009,.009,.12,.85,T+.03,-.2,0x24509a,{rz:1.35,ry:.5}); cy('metal',.003,.002,.08,.76,T+.045,-.15,0xb0b0b0,{rz:1.35,ry:.5}); cy('metal',.03,.03,.012,.9,T+.006,-.22,0x555);
  cy('paint',.035,.035,.04,-.55,T+.02,-.25,0xb5651d); cy('paint',.02,.02,.045,-.55,T+.022,-.25,0x222);
  bx('paint',.31,.006,.215,-.85,T+.003,.12,0x26303e,{ry:.15}); sheet(UA.hwA,-.925,T+.008,.108,.15,.148,.21); sheet(UA.hwA,-.775,T+.008,.131,.15,.148,.21);
  cy('paint',.004,.004,.17,-.7,T+.012,.13,0xd6b23a,{rz:PI/2,ry:.9});
  sheet(UA.hwB,1.0,T+.002,-.18,-.3,.148,.21); sheet(UA.hwC,.95,T+.002,.22,.5,.148,.21); cy('paint',.004,.004,.15,1.12,T+.006,-.2,0x2a2a2a,{rz:PI/2,ry:-.4});
  mug(-1.25,T,-.3,0x9aa7b4); mug(-.1,T,-.32,0xd9d2c4); mug(1.15,T,-.33,0x7a2f2a); mug(-1.2,T,.3,0xd9d2c4); mug(.25,T,.33,0x4a5d4a,{level:.035,steam:false,tea:0x4a2f1a}); mug(1.3,T,.28,0xc9a25a); mug(-1.65,T,.02,0x9aa7b4); mug(1.62,T,-.05,0xd9d2c4);
  sp('fabric',1,.62,T+.02,.3,0x8a3a2e,{sx:.05,sy:.022,sz:.085,ry:.4}); sp('fabric',1,.72,T+.022,.27,0x8a3a2e,{sx:.05,sy:.022,sz:.085,ry:-.3}); sp('fabric',1,.585,T+.02,.26,0x8a3a2e,{sx:.02,sy:.016,sz:.035});
  cy('paint',.008,.008,.11,-.42,T+.008,-.3,0xb3261e,{rz:PI/2,ry:.2}); cy('metal',.003,.003,.1,-.52,T+.008,-.32,0xb0b0b0,{rz:PI/2,ry:.2});
  sp('fabric',1,1.7,.24,.62,0x39424e,{sx:.17,sy:.24,sz:.12}); sp('fabric',1,1.7,.18,.74,0x2f3742,{sx:.12,sy:.12,sz:.05}); tr('fabric',.11,.015,1.7,.3,.52,0x23292f,{ry:PI/2,sy:1.4});
  anchor('table',-.42,.78,.31,.3,-.24);
  reg('table',{cam:[1.7,2.45,3.9],look:[0,.6,-.1],m:[0,1.3,0],box:[0,.7,0,4.6,1.4,2.4]});
pop();
/* pendant lamp over the table */
cy('paint',.006,.006,.75,-.9,2.72,-.3,0x111); lt('metal',[[.03,.1],[.07,.08],[.2,0]],-.9,2.25,-.3,0x2d3a34); sp('ember',.04,-.9,2.27,-.3,0xffd9a0);

await flush('table',true); await pause('workshop',.42);
/* 2: fusor station (table along the west edge; local +z looks into the workshop) */
push(-5.25,0,.3,PI/2);
{ bx('wood',1.9,.045,.8,0,.74,0,WD.pale); for(const [x,z] of [[-.88,-.33],[.88,-.33],[-.88,.33],[.88,.33]]) vb(.06,.72,.06,x,.36,z,WD.dark); bx('wood',1.76,.05,.04,0,.3,-.33,WD.dark);
  const T=.7625;
  /* microwave shell, cover off, transformer gone */
  push(-.62,T,-.08); const mc=0xcfcabd; bx('paint',.46,.012,.34,0,.006,0,mc); bx('paint',.012,.27,.34,-.224,.135,0,mc); bx('paint',.012,.27,.34,.224,.135,0,mc); bx('paint',.46,.27,.012,0,.135,-.164,mc); bx('paint',.11,.27,.012,.17,.135,.164,0x2a2c30);
    bx('paint',.012,.25,.3,.1,.135,0,0xb9b4a6); bx('metal',.07,.07,.07,.165,.16,-.08,0x8a8f98); for(let i=0;i<5;i++) bx('metal',.09,.003,.07,.165,.125+i*.016,-.08,0xa9adb3);
    tb('paint',[[.16,.03,.05],[.13,.06,.1],[.15,.1,.12]],.003,0xb3261e,{seg:6}); tb('paint',[[.19,.03,.04],[.2,.07,.09]],.003,0x2a4f9a,{seg:4});
    push(-.23,0,.17,-2.0); bx('paint',.34,.26,.02,.17,.135,0,mc); bx('paint',.24,.16,.022,.17,.14,0,0x15171a); pop();
  pop();
  bx('paint',.46,.012,.3,-1.02,.22,.47,0xcfcabd,{rx:1.25,ry:.2});
  /* the transformer that came out of it */
  /* the high-voltage supply: a grey box with a black tube and red lamps */
  push(-.18,T,-.24,.1); bx('paint',.24,.05,.12,0,.025,0,0xbfc2c6); cy('paint',.03,.03,.18,0,.08,-.01,0x141416,{rz:PI/2,seg:16}); for(const x of [-.06,-.02]) sp('ember',.006,x,.051,.045,0xff3b30,{seg:8,seg2:6}); cy('paint',.012,.012,.008,.06,.054,.04,0x222222,{seg:10}); pop();
  push(-.2,T,.12,.3); bx('metal',.11,.095,.085,0,.0475,0,0x33363c); bx('metal',.075,.065,.125,0,.0475,0,0xb87333); bx('paint',.03,.03,.126,.0,.0475,0,0xcbb26a); pop();
  /* chamber */
  /* chamber, as it really is: a dark steel cylinder lying on its side, clamped between a plywood plate with a rough
     round hole (glass behind it) and a white plastic plate, on four threaded rods; the hole is turned to the visitor */
  const cx=.25, cz=-.05, PORT=.58, CY=.19;
  push(cx,T,cz,PORT);
    put('metal',new THREE.CylinderGeometry(.13,.13,.22,40,1,true),0,CY,0,0x2a2c31,{rx:PI/2});
    put('ember',new THREE.CylinderGeometry(.125,.125,.215,32,1,true),0,CY,0,0x2b1646,{rx:PI/2}); put('ember',new THREE.CircleGeometry(.125,28),0,CY,-.107,0x1c0e30);   /* inside it is lit violet by the discharge */
    bx('glass',.3,.3,.008,0,CY,.115,0x1c2a28);                                              /* glass plate */
    { const sh=new THREE.Shape(); sh.moveTo(-.19,-.19); sh.lineTo(.19,-.19); sh.lineTo(.19,.19); sh.lineTo(-.19,.19); sh.closePath();
      const hole=new THREE.Path(); for(let k=0;k<22;k++){ const a=-k/22*2*PI, r=.056+(k%2?.006:0)+Math.sin(k*7.3)*.003; if(k) hole.lineTo(Math.cos(a)*r,Math.sin(a)*r); else hole.moveTo(Math.cos(a)*r,Math.sin(a)*r); } hole.closePath(); sh.holes.push(hole);
      put('wood',new THREE.ExtrudeGeometry(sh,{depth:.016,bevelEnabled:false,curveSegments:4}),0,CY,.121,0xc79a5a,{uv:[2.2,2.2,.5,.5]}); }
    bx('paper',.38,.38,.01,0,CY,-.118,0xe9e7e0);                                             /* white plastic plate */
    for(const [x,y] of [[-.16,-.16],[.16,-.16],[-.16,.16],[.16,.16]]){ cy('metal',.006,.006,.36,x,CY+y,.005,0x8d9197,{rx:PI/2,seg:8}); for(const z of [.143,-.128]) cy('metal',.014,.014,.01,x,CY+y,z,0xb0b3b8,{rx:PI/2,seg:6}); }
    /* brass fitting on top, sealed with glue */
    cy('metal',.016,.016,.022,0,CY+.139,.02,0xb8923a,{seg:6}); cy('metal',.009,.009,.03,0,CY+.16,.02,0xb8923a,{seg:10}); sp('gloss',1,0,CY+.13,.02,0xe8eef0,{sx:.026,sy:.008,sz:.026});
    /* the wire comes in at the white plate, held with black tape; a spark at the rim */
    bx('fabric',.07,.02,.012,-.11,CY+.13,-.108,0x0c0c0e,{rz:.5}); bx('ember',.05,.004,.004,-.07,CY+.085,-.108,0xe9dcff,{rz:-.35}); GLOWS.push([W(-.075,CY+.085,-.105),.16,0xb99cff]);
    /* the inner grid: seen through the hole it is a dark star */
    for(let k=0;k<10;k++){ const a=k/10*2*PI+.2, L=k%2?.05:.078; bx('paint',.006,L,.006,Math.cos(a)*L/2,CY+Math.sin(a)*L/2,0,0x141416,{rz:a-PI/2}); }
    sp('paint',.01,0,CY,0,0x141416,{seg:8,seg2:6});
    /* glass on both sides */
    for(const x of [-.17,.17]) bx('glass',.008,.3,.25,x,CY,.0,0xe6f2ee);
    /* a heart drawn on the steel in white marker */
    { const hs=new THREE.Shape(), ho=new THREE.Path(), heart=(P,k)=>{ P.moveTo(0,-.03*k); P.bezierCurveTo(-.048*k,0,-.034*k,.034*k,0,.016*k); P.bezierCurveTo(.034*k,.034*k,.048*k,0,0,-.03*k); };
      heart(hs,1); heart(ho,.78); hs.holes.push(ho); const g=new THREE.ShapeGeometry(hs,10), P=g.attributes.position, N=g.attributes.normal, R=.1318, a0=1.15;
      for(let i=0;i<P.count;i++){ const a=a0+P.getX(i)/R, z=-P.getY(i); P.setXYZ(i,Math.cos(a)*R,CY+Math.sin(a)*R,z); N.setXYZ(i,Math.cos(a),Math.sin(a),0); }
      put('paper',g,0,0,0,0xf0f0ee); }
  pop();
  tb('paint',[[-.2,T+.1,.12],[-.1,T+.42,.02],[.04,T+.4,-.14],[.1,T+.33,-.2]],.004,0x2a4f9a);
  tb('paint',[[-.17,T+.02,.17],[0,T+.012,.22],[.14,T+.012,.1]],.003,0x111111);
  /* gauge, needle near 150 */
  push(.66,T,-.2,-.25); cy('metal',.012,.012,.07,0,.035,0,0x8a8f98); cy('paint',.06,.06,.035,0,.115,0,0x18191b,{rx:PI/2,seg:24}); qd('print',.108,.108,UA.gauge,0,.115,.0185); pop();
  /* rotary vane pump on a drip tray, oil under it */
  tb('clear',[[cx+.012,T+CY+.17,cz+.017],[cx+.04,T+.52,cz+.02],[cx+.3,T+.5,cz],[.78,T+.12,-.06],[1.02,T-.15,-.02],[1.22,.24,.08]],.009,0xe8f2f4,{seg:40,rs:8});   /* clear vacuum hose to the pump */
  bx('metal',.52,.012,.38,1.32,.006,.1,0x7b8088); bx('metal',.52,.03,.012,1.32,.02,.29,0x7b8088); bx('metal',.52,.03,.012,1.32,.02,-.09,0x7b8088); bx('metal',.012,.03,.38,1.06,.02,.1,0x7b8088); bx('metal',.012,.03,.38,1.58,.02,.1,0x7b8088);
  cy('gloss',.1,.1,.002,1.43,.0135,.2,0x0b0907,{sz:.6}); cy('gloss',.05,.05,.002,1.22,.0135,.02,0x0b0907);
  cy('paint',.085,.085,.24,1.2,.115,.1,0x2f6fb8,{rz:PI/2,seg:20}); bx('paint',.15,.16,.14,1.42,.1,.1,0xd8dbe0);   /* the blue vacuum pump */ cy('gloss',.02,.02,.01,1.42,.09,.172,0xb9822a,{rx:PI/2}); cy('metal',.018,.018,.07,1.45,.215,.1,0x8a8f98); tr('metal',.05,.008,1.3,.21,.1,0x33363c,{arc:PI});
  stool(-.25,.86); stool(.52,.92);
  /* two pairs of goggles, two pairs of gloves */
  for(const [gx,gz,r] of [[-.1,.3,.3],[.52,.31,-.4]]){ push(gx,T,gz,r); for(const s of [-1,1]){ cy('clear',.022,.022,.016,s*.027,.024,0,0xdfe8ff,{rx:PI/2}); tr('paint',.023,.004,s*.027,.024,.008,0x1c1c1e); } tr('fabric',.07,.006,0,.022,-.055,0x1c1c1e,{rx:PI/2,sy:.8}); pop(); }
  for(const [gx,gz,r] of [[.07,.31,.2],[.76,.3,-.5]]){ push(gx,T,gz,r); for(const s of [0,1]){ sp('fabric',1,s*.06,.016+s*.012,s*.02,0xb08a55,{sx:.045,sy:.016,sz:.085,ry:s*.5}); sp('fabric',1,s*.06-.045,.016+s*.012,s*.02-.02,0xb08a55,{sx:.018,sy:.013,sz:.035,ry:.6}); } pop(); }
  /* a small elephant by the chamber */
  push(.5,T,.02,-.6); const ec=0x8d93a0; sp('gloss',1,0,.04,0,ec,{sx:.036,sy:.028,sz:.024}); sp('gloss',.02,.04,.052,0,ec); tb('gloss',[[.055,.052,0],[.07,.035,0],[.068,.012,0]],.006,ec,{seg:6}); sp('gloss',1,.036,.056,.02,ec,{sx:.012,sy:.018,sz:.005}); sp('gloss',1,.036,.056,-.02,ec,{sx:.012,sy:.018,sz:.005});
    for(const [lx,lz] of [[-.02,.013],[.02,.013],[-.02,-.013],[.02,-.013]]) cy('gloss',.008,.008,.026,lx,.013,lz,ec); pop();
  anchor('fusor',-.38,T,.3,.25,-.24);
  reg('fusor',{cam:[1.2,1.22,1.45],look:[.3,.93,0],m:[cx,1.28,cz],box:[.15,.95,0,1.1,.9,2.2]});
}
const FUS=W(.25,.7625+.19,-.05);
pop();

await flush('fusor',true); await pause('workshop',.48);
/* 3: the salvage shelf */
push(-4.3,0,-3.25);
{ for(const [x,z] of [[-.87,-.2],[.87,-.2],[-.87,.2],[.87,.2]]) bx('metal',.035,1.95,.035,x,.975,z,0x4a4d52);
  for(const y of [.12,.72,1.28,1.82]) bx('wood',1.76,.03,.45,0,y,0,tint(WD.pale));
  /* jet engine, as in the photo: a silver can with a propane valve, riding on a blue toy car */
  push(0,.735,.02);
    const TB=0x49b3d6; bx('paint',.3,.02,.13,0,.05,0,TB); bx('paint',.12,.03,.1,.02,.075,0,TB); bx('paint',.04,.025,.13,-.13,.07,0,TB);
    for(const [x,z] of [[-.1,-.075],[.1,-.075],[-.1,.075],[.1,.075]]){ cy('paint',.042,.042,.035,x,.042,z,0x18181a,{rx:PI/2,seg:18}); cy('paint',.026,.026,.037,x,.042,z,0xc7262e,{rx:PI/2,seg:14}); }
    for(const x of [-.06,.06]) cy('metal',.006,.006,.06,x,.115,0,0xb0b3b8,{seg:8});
    cy('metal',.048,.048,.2,0,.17,0,0xc8ccd2,{rz:PI/2,seg:28}); for(const x of [-.07,.06]) cy('metal',.05,.05,.012,x,.17,0,0x9a9ea4,{rz:PI/2,seg:28});
    cy('metal',.048,.034,.04,.12,.17,0,0x7b7f86,{rz:PI/2,seg:24,open:true}); cy('paint',.034,.034,.002,.139,.17,0,0x0c0c0e,{rz:PI/2,seg:20});
    cy('paint',.03,.03,.002,-.101,.17,0,0x2a2c30,{rz:PI/2,seg:20});
    cy('metal',.012,.012,.03,-.07,.225,0,0xb8923a,{seg:10}); cy('paint',.018,.018,.02,-.07,.247,0,0xf2c418,{seg:14});
    tb('paint',[[-.13,.06,.05],[-.17,.08,.08],[-.19,.03,.09]],.003,0xb3261e,{seg:5}); tb('paint',[[-.13,.06,.06],[-.18,.07,.1],[-.2,.02,.1]],.003,0x111111,{seg:5});
    push(-.3,0,.02,.3); bx('paint',.08,.04,.06,0,.02,0,0x1b1b1d); bx('paint',.06,.012,.045,0,.046,0,0xf2c418); pop();   /* the drill battery */
  pop();
  /* a small drone frame with an ESP32 board */
  push(.3,1.295,.04,.6); bx('paint',.3,.012,.025,0,.03,0,0x1b1b1d,{ry:PI/4}); bx('paint',.3,.012,.025,0,.03,0,0x1b1b1d,{ry:-PI/4}); for(const [a,b] of [[1,1],[1,-1],[-1,1],[-1,-1]]){ cy('metal',.014,.014,.022,a*.106,.045,b*.106,0x8a8f98); cy('clear',.055,.055,.002,a*.106,.058,b*.106,0xdfe8ff); cy('paint',.004,.004,.03,a*.106,.015,b*.106,0x1b1b1d); }
    bx('paint',.05,.008,.028,0,.042,0,0x6b3fa8); bx('metal',.016,.004,.014,-.012,.048,0,0xc9c9c9); bx('paint',.03,.004,.03,-.03,.05,.035,0x2f6db5); bx('paint',.018,.004,.018,-.03,.054,.035,0xc9b78a); sp('ember',.003,.02,.05,-.01,0xff3b30,{seg:6,seg2:4}); bx('paint',.045,.014,.024,0,.017,0,0x2f4a66); tb('paint',[[.02,.04,0],[.05,.05,.02],[.09,.046,.09]],.0015,0xb3261e,{seg:5}); pop();
  bx('paint',.3,.18,.16,-.45,1.385,0,0x4d4a3f); cy('paint',.05,.05,.004,-.5,1.39,.082,0x1b1b1d,{rx:PI/2}); bx('paint',.1,.03,.004,-.38,1.42,.082,0xc9c2ad);
  tr('paint',.09,.02,-.1,1.31,.03,0x1b1b1d,{rx:PI/2}); cy('clear',.04,.04,.1,.62,1.345,-.05,0xdfe8ff); cy('metal',.036,.036,.04,.62,1.315,-.05,0x7b7f86);
  tr('paint',.07,.016,-.3,1.851,0,0x23292f,{rx:PI/2}); cy('metal',.03,.03,.05,-.3,1.86,0,0x8a8f98);   /* top shelf: a coil of cable, a spare motor */
  bx('wood',.36,.2,.3,.45,1.935,0,tint(WD.pale)); bx('paint',.22,.12,.2,.05,1.895,-.05,0x5d6b4a);
  cy('metal',.07,.07,.1,.6,.785,0,0x6b6f76,{rz:PI/2}); cy('metal',.03,.03,.14,.6,.785,0,0x8a8f98,{rz:PI/2}); bx('paint',.15,.085,.14,.36,.777,-.05,0x8d9096);
  /* open toolbox, half of the tools taken */
  push(-.28,.135,.02,.08); const tc=0x8a2f25; bx('paint',.48,.012,.22,0,.006,0,tc); bx('paint',.48,.15,.012,0,.075,.104,tc); bx('paint',.48,.15,.012,0,.075,-.104,tc); bx('paint',.012,.15,.22,-.234,.075,0,tc); bx('paint',.012,.15,.22,.234,.075,0,tc);
    push(0,.15,-.11,0,-1.9); bx('paint',.48,.012,.22,0,0,.11,tc); pop();
    bx('paint',.45,.01,.19,0,.12,0,0x1a1b1e); for(let i=0;i<6;i++) bx('paint',.055,.004,.15,-.185+i*.074,.126,0,0x3a3c42);
    cy('metal',.008,.008,.15,-.185,.134,0,0xb0b3b8,{rx:PI/2}); bx('metal',.025,.01,.03,-.185,.134,.07,0xb0b3b8); cy('paint',.011,.011,.07,.037,.136,-.03,0xd79a1e,{rx:PI/2}); cy('metal',.003,.003,.08,.037,.136,.04,0xb0b3b8,{rx:PI/2});
  pop();
  bx('wood',.4,.24,.3,.5,.255,0,tint(WD.dark)); tr('paint',.1,.022,.5,.4,.02,0x23292f,{rx:PI/2});
  anchor('jet',.55,.735,.12,-.15,-.2,.13);
  reg('jet',{cam:[.55,1.25,1.95],look:[0,.84,0],m:[0,1.02,.2],box:[0,.86,0,.8,.3,.5]});
  anchor('drone',.02,1.295,.15,-.1,-.2,.11); anchor('toolbox',.1,.135,.17,.1,-.2,.12);
  reg('drone',{cam:[.72,1.55,.78],look:[.3,1.34,.04],m:[.3,1.5,.1],box:[.3,1.36,.04,.42,.2,.42]});
  reg('toolbox',{cam:[.45,1.1,1.7],look:[-.28,.28,0],m:[-.28,.5,.2],box:[-.28,.3,0,.62,.4,.5]});
}
pop();

await flush('shelf',true); await pause('workshop',.52);
/* 4: blackboard, past papers, the carpenter's bench */
push(1.3,0,-3.2);
{ bx('board',2.4,1.2,.02,0,1.5,0,0xffffff); bx('wood',2.5,.05,.04,0,2.125,0,WD.pale); bx('wood',2.5,.05,.04,0,.875,0,WD.pale); vb(.05,1.3,.04,-1.225,1.5,0,WD.pale); vb(.05,1.3,.04,1.225,1.5,0,WD.pale);
  for(const s of [-1,1]){ vb(.06,2.15,.05,s*1.1,1.075,-.04,WD.dark); bx('wood',.6,.05,.06,s*1.1,.025,-.02,WD.dark,{ry:PI/2}); }
  bx('wood',2.3,.02,.07,0,.86,.05,WD.pale); for(const [x,l] of [[-.5,.07],[-.38,.04],[.6,.08]]) cy('paper',.006,.006,l,x,.877,.05,0xf4f4f0,{rz:PI/2,ry:rr(-.3,.3)}); bx('fabric',.12,.03,.05,.2,.885,.05,0x2a2a2e); bx('wood',.12,.012,.05,.2,.905,.05,WD.pale);
  push(1.75,0,.25); bx('wood',.62,.03,.5,0,.7,0,WD.pale); for(const [x,z] of [[-.27,-.21],[.27,-.21],[-.27,.21],[.27,.21]]) vb(.04,.69,.04,x,.345,z,WD.dark);
    bx('paper',.21,.07,.297,-.08,.75,0,0xefece2,{ry:.1}); sheet(UA.past,-.08,.786,0,.1); sheet(UA.past,.18,.717,.06,-.35); cy('paint',.005,.005,.14,.2,.724,-.12,0xb3261e,{rz:PI/2,ry:.7}); pop();
  anchor('alevels',1.98,.717,.4,-.3,-.24);
  reg('alevels',{cam:[.35,1.6,3.9],look:[.35,1.25,0],m:[0,2.3,.05],box:[.3,1.3,.1,3.6,1.7,.7]});
}
pop();
push(4.75,0,-3.05);
{ const bc=0xa58560; bx('wood',1.5,.09,.55,0,.84,0,bc); for(const [x,z] of [[-.62,-.2],[.62,-.2],[-.62,.2],[.62,.2]]) vb(.09,.8,.09,x,.4,z,tint(bc)); bx('wood',1.24,.08,.04,0,.25,-.2,bc); bx('wood',1.24,.08,.04,0,.25,.2,bc); bx('wood',1.4,.12,.03,0,.74,.262,bc);
  bx('wood',.2,.14,.06,-.55,.8,.33,tint(bc)); cy('metal',.012,.012,.2,-.55,.78,.4,0x55595f,{rx:PI/2}); cy('wood',.01,.01,.18,-.55,.78,.5,WD.dark);
  push(.1,.885,.02,.3); bx('wood',.24,.055,.06,0,.0275,0,0x8a5a34); bx('metal',.004,.075,.045,.02,.062,0,0x9a9da4,{rz:-.7}); bx('wood',.03,.07,.03,-.08,.085,0,0x7a4a2a,{rz:.2}); bx('wood',.035,.035,.03,.08,.07,0,0x7a4a2a); pop();
  for(let i=0;i<16;i++){ const on=i<9; tr('wood',rr(.012,.022),.0035,on?rr(-.3,.5):rr(-.5,.8),on?.893:.012,on?rr(-.18,.2):rr(.35,.75),tint(0xe2c9a0),{arc:rr(3.5,5.6),rx:PI/2+rr(-.5,.5),ry:rr(0,6),sy:rr(.6,1),seg:12}); }
  tr('metal',.012,.003,.3,.74,.28,0x7b7f86,{arc:PI,rz:PI}); cy('paint',.004,.004,.16,.3,.75,.283,0xc8a23a,{rz:1.25});
  bx('paper',.148,.004,.105,-.4,.887,.06,0xf3f0e6,{ry:.2}); bx('paper',.148,.002,.1,-.4,.892,.058,0xf7f4ea,{ry:.2,rx:.05});
  bx('wood',.09,.07,.14,.5,.92,-.12,0x8a5a34); cy('wood',.014,.014,.26,.5,.92,.06,0x9a7650,{rx:PI/2}); bx('metal',.2,.003,.03,-.1,.887,-.18,0x9a9da4); bx('wood',.03,.012,.12,-.19,.891,-.13,0x7a4a2a);
  cy('wood',.011,.011,.1,.12,.895,.19,0x7a4a2a,{rz:PI/2}); bx('metal',.11,.003,.016,.22,.895,.19,0xb0b3b8);
  anchor('carpenter',-.62,.885,-.14,.3,-.2);
  reg('carpenter',{cam:[-.95,1.65,1.95],look:[0,.88,0],m:[0,1.3,0],box:[0,.6,0,1.7,1.3,.9]});
}
pop();

await flush('study',true); await pause('workshop',.57);
/* the workshop is built; the first frame goes out as soon as the shaders are ready, and the far zones keep being built meanwhile */
const firstP=firstFrame();
await pause('corner',.6);
/* 5: the psychology corner */
push(2.9,0,1.7);
{ cy('wood',.6,.6,.04,0,.74,0,WD.table,{seg:36,uv:[1,1]}); cy('wood',.05,.06,.7,0,.37,0,WD.dark); cy('wood',.3,.32,.03,0,.015,0,WD.dark,{seg:24});
  const T=.76, ch=[[.69,.69,{k:.82,bear:true}],[-.7,.72,{}],[-.72,-.68,{}],[.7,-.66,{jacket:0x4a5d4a}]];
  for(const c of ch) chair(c[0]*1.05,c[1]*1.05,Math.atan2(-c[0],-c[1]),c[2]);
  /* a candle in a glass and a box of tissues */
  cy('clear',.035,.03,.07,0,T+.035,.02,0xdfe8f0,{seg:20}); cy('paper',.027,.025,.035,0,T+.02,.02,0xefe6d2,{seg:16}); sp('ember',1,0,T+.05,.02,0xffc070,{sx:.006,sy:.014,sz:.006}); GLOWS.push([W(0,T+.052,.02),.22,0xffb070]);
  bx('paint',.2,.07,.11,-.27,T+.035,.22,0x8fa6b4,{ry:.5}); sp('paper',1,-.27,T+.085,.22,0xf6f3ea,{sx:.035,sy:.03,sz:.02,ry:.5});
  mug(.33,T,.27,0xd9d2c4); mug(-.38,T,.02,0x9aa7b4); mug(.2,T,-.36,0x7a2f2a); mug(-.12,T,-.44,0xc9a25a);
  sp('gloss',1,.38,T+.07,.0,0x56707c,{sx:.085,sy:.07,sz:.085}); cy('gloss',.03,.035,.02,.38,T+.14,.0,0x56707c); tb('gloss',[[.45,T+.07,.0],[.51,T+.09,.01],[.53,T+.13,.015]],.012,0x56707c,{seg:6}); tr('gloss',.045,.008,.29,T+.08,-.01,0x56707c,{arc:PI,rz:PI/2}); STEAM.push(W(.53,T+.15,.015));
  sheet(UA.hwC,.36,T+.002,.42,-.75,.148,.21); cy('paint',.004,.004,.15,.47,T+.008,.35,0x3a3a3a,{rz:PI/2,ry:.9});
  sheet(UA.hwB,-.05,T+.002,-.4,.2,.148,.21); bx('paint',.15,.012,.21,-.3,T+.006,-.25,0x3a3228,{ry:-.4}); sheet(UA.hwA,-.3,T+.0125,-.25,-.4,.146,.205); cy('paint',.004,.004,.14,-.2,T+.018,-.2,0x27408a,{rz:PI/2,ry:.8});
  book(.02,T,-.5,2.5,0x3c4c5c); book(.04,T+.03,-.49,2.7,0x6a4a2f);
  anchor('psych',.22,T,-.4,.15,-.22,.13);
  reg('psych',{cam:[.12,1.9,2.2],look:[0,.8,0],m:[0,1.25,0],box:[0,.85,0,1.25,.4,1.25]});
  anchor('blanket',.08,T,.44,.3,-.22,.11);
  reg('blanket',{cam:[1.8,1.25,1.72],look:[.76,.64,.76],m:[.86,1.0,.86],box:[.84,.6,.84,.55,.75,.55]});
}
pop();

await flush('corner',true); await pause('corner',.64);
/* stove, firewood */
push(5.15,0,2.8);
{ cy('metal',.27,.27,.62,0,.47,0,0x1b1b1e,{seg:24}); cy('metal',.29,.29,.03,0,.795,0,0x222226,{seg:24}); cy('metal',.28,.28,.03,0,.175,0,0x222226,{seg:24});
  for(let i=0;i<3;i++){ const a=i*2.094+.5; cy('metal',.02,.02,.17,Math.cos(a)*.2,.085,Math.sin(a)*.2,0x1b1b1e); }
  push(0,.42,0,-2.75); bx('metal',.2,.18,.02,0,0,.265,0x26262a); for(const y of [-.045,0,.045]) bx('ember',.15,.022,.006,0,y,.277,0xffa648); cy('metal',.008,.008,.06,.08,0,.29,0x8a8f98); GLOWS.push([W(0,0,.3),.9,0xff8a3a]); pop();
  cy('metal',.07,.07,3.0,0,2.3,-.08,0x26262a,{seg:14}); lt('metal',[[.07,0],[.13,.03],[0,.12]],0,3.8,-.08,0x26262a);
  sp('metal',1,.05,.885,.06,0x8a8f98,{sx:.09,sy:.075,sz:.09}); tb('metal',[[.12,.88,.06],[.17,.9,.06],[.19,.94,.06]],.009,0x8a8f98,{seg:5}); tr('metal',.055,.005,.05,.95,.06,0x33363c,{arc:PI}); STEAM.push(W(.19,.96,.06));
  for(let r=0;r<3;r++) for(let i=0;i<4-r;i++) cy('wood',.055,.055,.4,.42+r*.03,.065+r*.1,.42-i*.115-r*.057,tint(0x9a7b55,.15),{rx:PI/2,ry:.4,seg:10});
}
const STOVE=W(-.15,.5,-.45), SMOKE=W(0,3.95,-.08);
pop();

/* 10: armchair, books, two manuscripts */
push(5.0,0,1.0,-PI/2);
{ const fc=0x5b4a3c; bx('fabric',.78,.3,.74,0,.23,0,fc); sp('fabric',1,0,.42,.05,0x6a5646,{sx:.3,sy:.08,sz:.3}); bx('fabric',.78,.64,.18,0,.66,-.3,fc,{rx:-.08}); for(const s of [-1,1]){ bx('fabric',.14,.3,.7,s*.34,.5,.0,fc); cy('fabric',.075,.075,.7,s*.34,.65,0,fc,{rx:PI/2}); }
  for(const [x,z] of [[-.33,-.3],[.33,-.3],[-.33,.3],[.33,.3]]) cy('wood',.025,.02,.08,x,.04,z,WD.dark);
  const pc=0x9a9282; bx('fabric',.6,.5,.03,.06,.78,-.2,pc,{rx:-.08}); cy('fabric',.035,.035,.6,.06,1.01,-.3,pc,{rz:PI/2}); bx('fabric',.6,.4,.03,.06,.82,-.42,pc,{rx:-.06}); for(const y of [.62,.78,.92]) bx('fabric',.602,.03,.032,.06,y,-.2+ (y-.78)*.08,0x5a5348,{rx:-.08});
  [0x5d2727,0x27384f,0x33342f,0x55431f].forEach((c,i)=>book(-.34,.725+i*.031,.08,rr(-.12,.12),c,UA['sp'+i]));
  bx('paint',.15,.036,.21,.34,.743,.05,0x232325,{ry:.25}); bx('paper',.142,.03,.205,.343,.743,.05,0xe9e2d0,{ry:.25}); bx('fabric',.008,.038,.212,.39,.743,.04,0x7a2f2a,{ry:.25});
  /* a manuscript left open on the seat */
  bx('paper',.148,.018,.21,-.076,.505,.1,0xefece2,{ry:.1}); bx('paper',.148,.01,.21,.076,.5,.086,0xefece2,{ry:.1}); sheet(UA.hwA,-.076,.5145,.1,.1,.146,.208); sheet(UA.hwA,.076,.5055,.086,.1,.146,.208);
  /* crate with the other one; its last page is empty */
  push(-.78,0,.38,.15); for(let i=0;i<4;i++){ bx('wood',.46,.085,.02,0,.05+i*.1,.2,tint(WD.pale)); bx('wood',.46,.085,.02,0,.05+i*.1,-.2,tint(WD.pale)); bx('wood',.38,.085,.02,.22,.05+i*.1,0,tint(WD.pale),{ry:PI/2}); bx('wood',.38,.085,.02,-.22,.05+i*.1,0,tint(WD.pale),{ry:PI/2}); }
    bx('wood',.48,.02,.44,0,.405,0,WD.pale);
    bx('paper',.148,.03,.21,-.076,.43,0,0xefece2); bx('paper',.148,.004,.21,.076,.417,0,0xf6f3ea); sheet(UA.hwA,-.076,.4455,0,0,.146,.208);
    cy('paint',.0045,.0045,.14,.11,.424,.03,0x1c1c1e,{rz:PI/2,ry:.5}); pop();
  anchor('page',-.78,.415,.2,.3,-.2,.13);
  reg('page',{cam:[-1.4,1.42,1.5],look:[-.42,.52,.25],m:[-.78,.72,.38],box:[-.35,.6,.2,1.5,1.2,1.4]});
}
pop();

pop();
await flush('hearth',true); await pause('yurt',.68);

/* ---------------- C: the yurt ---------------- */
let HOLO=null;
{ const [yx,yz]=ZONE.yurt, y0=H(yx,yz); push(yx,y0,yz);
  const ts=PI/2+.19, tl=2*PI-.38, cylA=(r,h)=>new THREE.CylinderGeometry(r,r,h,56,1,true,ts,tl);
  cy('felt',2.96,2.96,.05,0,.025,0,0x7b3b30,{seg:40}); cy('felt',1.7,1.7,.055,0,.03,0,0x9a7b4a,{seg:32}); cy('felt',1.0,1.0,.06,0,.033,0,0x6a2f2a,{seg:28});
  put('felt',cylA(3,1.7),0,.85,0,0xcfc6b6,{uv:[6,1]});
  { /* the lattice is a cut-out card like the spruces, so it shares their shader; it is seen from inside only */
    const g=cylA(2.94,1.62).toNonIndexed(), p=g.attributes.position, nn=g.attributes.normal, u=g.attributes.uv;
    for(let i=0;i<p.count;i+=3){ for(const a of [p,nn,u]){ const s=a.itemSize, t=a.array.slice((i+1)*s,(i+2)*s); a.array.copyWithin((i+1)*s,(i+2)*s,(i+3)*s); a.array.set(t,(i+2)*s); } }
    for(let i=0;i<nn.count;i++){ nn.setXYZ(i,-nn.getX(i),-nn.getY(i),-nn.getZ(i)); u.setXY(i,u.getX(i)*26,u.getY(i)*2.4); }
    g.applyMatrix4(mat4(0,.83,0).premultiply(M4));
    const im=new THREE.InstancedMesh(g,INST({map:latticeT,alphaTest:.5,roughness:.85}),1); im.setMatrixAt(0,new THREE.Matrix4()); im.setColorAt(0,new THREE.Color(1,1,1)); im.frustumCulled=false; scene.add(im); }
  put('fabric',cylA(3.02,.2),0,1.58,0,0x7a2f2a); put('fabric',cylA(3.015,.07),0,1.0,0,0x3a3f5a); put('fabric',cylA(3.015,.07),0,.45,0,0x3a3f5a);
  lt('felt',[[3.12,1.66],[2.5,2.2],[1.6,2.72],[.7,3.08]],0,0,0,0xd6cdbd,{seg:56,uv:[6,1]}); lt('snow',[[2.25,2.4],[1.6,2.75],[.74,3.1]],0,.015,0,0xe9eef8,{seg:56,uv:[8,2]});
  tr('wood',.68,.05,0,3.1,0,0x7a2f2a,{rx:PI/2,seg:28}); for(const s of [-.14,.14]){ tb('wood',[[-.66,3.1,s],[0,3.3,s],[.66,3.1,s]],.018,0x7a2f2a,{seg:8}); tb('wood',[[s,3.1,-.66],[s,3.3,0],[s,3.1,.66]],.018,0x7a2f2a,{seg:8}); }
  cy('ember',.64,.64,.01,0,3.05,0,0xb5733a,{seg:24});
  for(let i=0;i<30;i++){ const a=i/30*2*PI, c=Math.cos(a), s=Math.sin(a); tb('wood',[[c*2.95,1.68,s*2.95],[c*1.9,2.5,s*1.9],[c*.68,3.07,s*.68]],.02,0x8c3a2c,{seg:4,rs:5}); }
  for(let i=0;i<8;i++){ const a=i/8*2*PI+.4, c=Math.cos(a), s=Math.sin(a); tb('fabric',[[c*3.14,1.62,s*3.14],[c*2.52,2.21,s*2.52],[c*1.62,2.74,s*1.62],[c*.74,3.1,s*.74]],.012,0x3d342b,{seg:6,rs:4}); }
  for(const s of [-1,1]) vb(.09,1.72,.1,3.0,.86,s*.55,0x7a3a26); bx('wood',.1,.1,1.2,3.0,1.74,0,0x7a3a26); bx('wood',.12,.05,1.1,3.0,.025,0,0x7a3a26);
  push(3.04,0,.52,-2.05); bx('wood',.035,1.55,.5,0,.84,-.25,0x7a3226); bx('wood',.04,.5,.3,0,1.15,-.25,0x8c4030); bx('wood',.04,.5,.3,0,.5,-.25,0x8c4030); pop();
  push(3.04,0,-.52,2.05); bx('wood',.035,1.55,.5,0,.84,.25,0x7a3226); bx('wood',.04,.5,.3,0,1.15,.25,0x8c4030); bx('wood',.04,.5,.3,0,.5,.25,0x8c4030); pop();
  cy('felt',.09,.09,1.15,3.08,1.86,0,0xcfc6b6,{rx:PI/2});
  /* low desks with tablets, cushions */
  const desks=[[-.7,-1.0,PI/2+.3,UE.pend],[.5,1.15,PI/2-.35,UE.ar],[-1.2,.75,PI/2-.1,null],[.75,-1.2,PI/2+.5,null]];
  for(const d of desks){ push(d[0],.05,d[1],d[2]); bx('wood',.75,.03,.42,0,.32,0,tint(WD.pale)); for(const [x,z] of [[-.33,-.17],[.33,-.17],[-.33,.17],[.33,.17]]) vb(.04,.31,.04,x,.155,z,WD.dark);
    if(d[3]){ push(0,.335,-.04,0,-.45); bx('paint',.25,.17,.008,0,.085,-.004,0x15161a); qd('screen',.236,.158,d[3],0,.085,.001); pop(); bx('wood',.1,.08,.02,0,.37,-.1,WD.dark,{rx:.5}); }
    else { bx('paint',.25,.008,.17,-.1,.339,.02,0x15161a,{ry:.3}); sheet(UA.hwC,.2,.337,.03,-.2,.148,.21); }
    cy('paint',.004,.004,.14,.26,.34,.12,0xd6b23a,{rz:PI/2,ry:rr(0,3)});
    for(const s of [-.2,.22]) sp('fabric',1,s,.05,.48,[0x7a2f2a,0x2f4a66,0xa8853a,0x4a5d4a][Math.floor(rr(0,4))],{sx:.2,sy:.06,sz:.2}); pop(); }
  bx('wood',1.3,.5,.5,-2.3,.3,0,0x6a2a22,{ry:PI/2}); for(let i=0;i<4;i++) bx('fabric',.48,.09,1.2,-2.3,.6+i*.09,0,[0x7a2f2a,0x2f4a66,0xa8853a,0x8a8577][i]);
  /* shoes left at the door: many small pairs, one adult pair */
  bx('fabric',.7,.02,2.4,3.75,.01,1.9,0x4a4036);
  const sc=[0x7a2f2a,0x2f4a66,0x3a3a3a,0xa8853a,0x4a5d4a,0x8a5a6a,0x2a2a2e,0x5a6a7a,0x7a5a3a];
  const shoeG=mergeGeometries([new THREE.BoxGeometry(.095,.02,.27).translate(0,.01,0),new THREE.SphereGeometry(.05,10,8).scale(.95,.9,2.3).translate(0,.055,-.015),new THREE.CylinderGeometry(.042,.046,.08,10).translate(0,.1,-.07)]);
  const shoe=(x,z,ry,s,c)=>put('paint',shoeG.clone(),x,.02,z,c,{ry,sx:s,sy:s,sz:s});
  for(let i=0;i<9;i++){ const z=.95+i*.22+rr(-.02,.02), x=3.72+rr(-.06,.06), r=PI/2+rr(-.2,.2), s=rr(.62,.74); for(const o of [-.045,.045]) shoe(x,z+o,r+rr(-.08,.08),s,sc[i]); }
  for(const o of [-.06,.06]) shoe(3.74,3.0+o,PI/2+rr(-.05,.05),1.05,0x3a2d22);
  shoeG.dispose();
  /* a hologram projector in the middle; the hologram itself is built with the things that move */
  cy('metal',.3,.34,.08,0,.04,0,0x2a2c31,{seg:32}); tr('metal',.3,.012,0,.08,0,0x55595f,{rx:PI/2,seg:32}); cy('ember',.24,.24,.006,0,.083,0,0x5fe0ff,{seg:32});
  HOLO=W(0,0,0);
  anchor('yurt',-2.72,1.15,-.95,PI/2,0,.34);
  reg('yurt',{cam:[2.4,1.42,-.05],look:[0,1.0,0],via:[5.4,1.55,-.25],m:[3.1,2.45,0],box:[0,1.6,0,6.6,3.3,6.6]});
  pop(); }

await flush('yurt',false); await pause('circle',.74);
/* ---------------- D: the circle ---------------- */
{ const [cx,cz]=ZONE.circle; push(cx,H(cx,cz),cz);
  vb(.5,1.05,.4,0,.525,0,WD.dark); bx('wood',.58,.03,.48,0,1.075,.0,WD.pale,{rx:.2}); bx('wood',.58,.03,.03,0,1.04,.24,WD.pale);
  qd('print',.48,.6,UA.ksma,0,.64,.203);   /* our green club flag hangs on the podium */
  const bn=[[-1.9,-1.75,.12],[1.9,-1.75,-.12],[-1.9,1.75,-.12],[1.9,1.75,.12]];
  for(const b of bn){ push(b[0],0,b[1],b[2]); bx('wood',1.8,.05,.36,0,.44,0,tint(WD.pale)); for(const s of [-.7,.7]) bx('wood',.06,.42,.32,s,.21,0,WD.dark); pop(); }
  const T=.466;
  push(bn[0][0],T,bn[0][1],bn[0][2]); sheet(UA.hwA,-.5,.002,0,.2,.148,.21); sheet(UA.hwB,-.2,.002,.03,-.3,.148,.21); cy('metal',.03,.03,.012,.3,.006,.02,0xc9c9c9); qd('print',.052,.052,UA.stop,.3,.0125,.02,{rx:-PI/2}); cy('metal',.006,.006,.012,.3,.008,-.016,0xc9c9c9);
    qd('print',.09,.068,UA.badge,.62,.003,.03,{rx:-PI/2,ry:.3}); tr('fabric',.07,.004,.62,.004,-.07,0x2f4a66,{rx:PI/2,sy:1.3}); pop();
  push(bn[1][0],T,bn[1][1],bn[1][2]); sheet(UA.hwC,.3,.002,0,.4,.148,.21); sheet(UA.hwB,0,.002,-.02,-.1,.148,.21); sheet(UA.hwB,.05,.004,.01,.25,.148,.21); qd('print',.09,.068,UA.badge,-.5,.003,.02,{rx:-PI/2,ry:-.5}); tr('fabric',.07,.004,-.56,.004,.1,0x7a2f2a,{rx:PI/2,sy:1.3}); cy('paint',.004,.004,.14,.5,.006,.08,0x2a4f9a,{rz:PI/2,ry:.6}); pop();
  /* a tall stack of name cards for the beginners */
  push(bn[2][0],T,bn[2][1],bn[2][2]); for(let p=0;p<3;p++) for(let i=0;i<22;i++) bx('paper',.09,.004,.055,-.45+p*.16+rr(-.004,.004),.003+i*.0042,rr(-.004,.004),_col.set(0xf2efe6).multiplyScalar(1+.05*Math.sin(i*12.9+p*4.1)).getHex(),{ry:rr(-.12,.12)}); sheet(UA.hwA,.4,.002,0,-.2,.148,.21); qd('print',.09,.068,UA.badge,.1,.003,.05,{rx:-PI/2,ry:.2}); pop();
  push(bn[3][0],T,bn[3][1],bn[3][2]); sheet(UA.hwB,-.3,.002,0,.3,.148,.21); sheet(UA.hwC,.2,.002,.02,-.4,.148,.21); sp('fabric',1,.6,.03,0,0x4a5d4a,{sx:.06,sy:.03,sz:.1}); sp('fabric',1,.7,.03,.03,0x4a5d4a,{sx:.06,sy:.03,sz:.1,ry:.6}); pop();
  /* MUN country placards leaning by a bench, text unreadable */
  push(3.05,0,1.2,-.9); bx('wood',.5,.3,.34,0,.15,0,tint(WD.pale)); for(let i=0;i<5;i++){ push(-.15+i*.07,.3,.02+i*.012,rr(-.1,.1),-.28); bx('paint',.3,.11,.005,0,.055,0,0xf4f2ec); qd('print',.29,.1,UA.plac,0,.055,.003); pop(); } pop();
  anchor('circle',0,1.085,.06,0,-PI/2+.2,.16);
  reg('circle',{cam:[5.2,3.1,5.6],look:[0,.4,0],m:[0,1.7,0],box:[0,.6,0,5.8,1.3,4.6]});
  pop(); }

await flush('circle',false); await pause('pipe',.79);
/* ---------------- E: WASYS outfall ---------------- */
let LEDW;
{ const [px,pz]=ZONE.pipe, my=H(px+2.3,pz)+.72, cc=0x8b8d8a;
  put('paint',new THREE.CylinderGeometry(.5,.5,3,28,1,true),px+.3,my,pz,cc,{rz:PI/2}); put('paint',new THREE.CylinderGeometry(.42,.42,3,28,1,true),px+.3,my,pz,0x3a3b3c,{rz:PI/2});
  put('paint',new THREE.RingGeometry(.42,.5,28),px+1.8,my,pz,0x9a9c99,{ry:PI/2}); put('paint',new THREE.CircleGeometry(.42,20),px+.1,my,pz,0x040506,{ry:PI/2});
  bx('paint',.25,1.3,.7,px+1.3,my-.25,pz-.86,0x7d7f7c,{ry:.25}); bx('paint',.25,1.3,.7,px+1.3,my-.25,pz+.86,0x7d7f7c,{ry:-.25}); bx('paint',.28,.3,2.3,px+1.25,my+.62,pz,0x7d7f7c);
  sp('snow',1,px+1.15,my+.78,pz,0xe9eef8,{sx:.3,sy:.09,sz:1.2});
  const gx=z=>21+.15*z, wp=[[px+1.6,my-.4,pz,.4],[px+2.0,my-.44,pz,.4]]; { const cl=curveOf([[px+2.5,pz+.1],[px+3.4,pz+1.0],[gx(7),7],[gx(11),11],[gx(17),17],[gx(25),25],[gx(36),36],[gx(50),50]]).getSpacedPoints(70); cl.forEach((q,i)=>wp.push([q.x,H(q.x,q.z)+.04,q.z,.4+.5*i/70])); }
  ribbon('water',wp,0x243247); ribbon('paint',[[px+1.82,my-.38,pz,.4],[px+1.95,my-.75,pz,.5],[px+2.1,H(px+2.1,pz)+.05,pz,.55]],0x0c121c);
  /* the device itself, on a crate by the water: a clear container with an Arduino, a small pump and the chamber the sample is pumped into */
  const bxx=px+2.35, bz=pz+1.15, by=H(bxx,bz); push(bxx,by,bz,.47);
    bx('wood',.5,.34,.36,0,.17,0,tint(WD.pale)); bx('paint',.46,.008,.3,0,.344,0,0x9aa0a8); bx('clear',.46,.2,.3,0,.448,0,0xdfe8f0);
    for(const [x,z] of [[-.23,-.15],[.23,-.15],[-.23,.15],[.23,.15]]) bx('paint',.008,.2,.008,x,.448,z,0xcfd6dc);
    /* Arduino */
    bx('paint',.11,.005,.08,-.14,.351,.03,0x0f6b75); bx('paint',.085,.01,.006,-.135,.359,.066,0x111214); bx('paint',.085,.01,.006,-.135,.359,-.006,0x111214);
    bx('metal',.02,.014,.018,-.188,.361,.048,0xc9c9c9); bx('paint',.016,.012,.016,-.188,.36,.008,0x15171a); bx('paint',.05,.006,.012,-.125,.357,.03,0x15171a);
    /* pump and its wires */
    bx('paint',.075,.008,.06,.02,.352,-.005,0x33363c); cy('paint',.03,.03,.035,.02,.386,.02,0x2f3338,{rx:PI/2}); cy('metal',.024,.024,.06,.02,.386,-.03,0x8a8f98,{rx:PI/2});
    tb('paint',[[-.095,.36,.0],[-.05,.395,-.03],[.0,.39,-.058]],.002,0xb3261e,{seg:6}); tb('paint',[[-.095,.36,.012],[-.045,.385,-.02],[.04,.39,-.058]],.002,0x111111,{seg:6});
    /* sample chamber, half full */
    cy('clear',.05,.05,.15,.15,.425,0,0xdfe8f0,{seg:24}); cy('water',.046,.046,.07,.15,.386,0,0x3a4a5e,{seg:20}); cy('paint',.052,.052,.012,.15,.506,0,0x2a4f9a,{seg:24});
    tb('gloss',[[.02,.386,.04],[.05,.45,.07],[.11,.53,.04],[.15,.512,0]],.004,0xe8e2d2);
    tb('gloss',[[.035,.4,.03],[.1,.47,.09],[.2,.42,.11],[.262,.26,.08],[.5,.04,.0],[.9,-.02,-.1]],.004,0xe8e2d2);
    LEDW=W(-.105,.357,.05); anchor('wasys',0,.06,.185,0,0,.16);
  pop();
  /* cooler bag of sample tubes; the tag on the lid still has a blank */
  const cxx=px+1.55, czz=pz+1.7, cyy=H(cxx,czz); push(cxx,cyy,czz,.35);
    bx('fabric',.42,.26,.28,0,.13,0,0x3d566e); bx('paint',.38,.01,.24,0,.262,0,0x14171b);
    push(0,.26,-.14,0,-1.15); bx('fabric',.42,.04,.28,0,.02,-.14,0x3d566e); qd('print',.2,.1,UA.tag,.02,.0415,-.14,{rx:-PI/2}); pop();
    for(let i=0;i<10;i++){ const x=-.14+(i%5)*.07, z=-.035+Math.floor(i/5)*.07; cy('clear',.011,.011,.09,x,.275,z,0xdfe8f0); cy('paint',.0125,.0125,.016,x,.328,z,0x2a4f9a); cy('paper',.0116,.0116,.03,x,.29,z,0xf2efe6,{open:true}); }
    tb('fabric',[[-.21,.2,0],[-.3,.36,0],[0,.5,.05],[.3,.36,0],[.21,.2,0]],.012,0x23292f);
  pop();
  const gy=H(px,pz);
  REG.wasys={cam:new V3(bxx+.95,by+1.25,bz+1.75),look:new V3(bxx,by+.4,bz),m:new V3(bxx,by+.75,bz),boxC:new V3(px+1.7,gy+.3,pz+1.0),boxS:new V3(3.6,2.4,3.2)}; }

await flush('pipe',false); await pause('slope',.84);
/* ---------------- F: the slope, the lift, Shumkar ---------------- */
const LIFT={};
{ const S=new V3(ZONE.lift[0],0,ZONE.lift[1]), Tp=new V3(30,0,-150), d=Tp.clone().sub(S).normalize(), l=new V3(-d.z,0,d.x), phi=-Math.atan2(l.z,l.x);
  const at=t=>S.clone().lerp(Tp,t), ts=[0,.07,.26,.46,.66,.86,1], up=[], dn=[];
  ts.forEach((t,i)=>{ const p=at(t), g=H(p.x,p.z), h=(i===0||i===ts.length-1)?3.3:6.6;
    up.push(new V3(p.x+l.x*1.1,g+h,p.z+l.z*1.1)); dn.push(new V3(p.x-l.x*1.1,g+h,p.z-l.z*1.1));
    push(p.x,g,p.z,phi); if(i===0||i===ts.length-1){ cy('metal',.14,.18,3.3,0,1.65,0,0x3d4148); tr('metal',1.1,.05,0,3.3,0,0x55595f,{rx:PI/2,seg:28}); for(let k=0;k<3;k++) bx('metal',2.2,.04,.06,0,3.3,0,0x55595f,{ry:k*1.047}); bx('paint',1.0,.8,1.2,0,.4,-1.1,0x2f4a3e); bx('paint',1.2,.3,1.6,0,.15,0,0x7d7f7c); sp('snow',1,0,.85,-1.1,0xe9eef8,{sx:.6,sy:.1,sz:.7}); }
    else { cy('metal',.11,.16,6.7,0,3.35,0,0x3d4148,{seg:12}); bx('metal',2.7,.14,.14,0,6.7,0,0x3d4148); for(const s of [-1.1,1.1]) bx('metal',.1,.12,.7,s,6.62,0,0x55595f); } pop(); });
  for(const line of [up,dn]) put('paint',new THREE.TubeGeometry(new THREE.CatmullRomCurve3(line,false,'catmullrom',.01),60,.016,4,false),0,0,0,0x141416);
  LIFT.up=up; LIFT.dn=dn; LIFT.phi=phi;
  /* ski rack, bench, tea for two, kurut, the phone with the slope map */
  const rx0=9.4, rz0=-14.9, ry0=H(rx0,rz0); push(rx0,ry0,rz0,.45);
    for(const s of [-1,1]){ vb(.05,1.15,.05,s*.95,.56,-.2,WD.dark,{rx:.0}); vb(.05,1.15,.05,s*.95,.56,.2,WD.dark); bx('wood',.05,.05,.5,s*.95,.03,0,WD.dark); } bx('wood',2.0,.05,.05,0,1.12,0,WD.dark); bx('wood',2.0,.04,.04,0,.5,0,WD.dark);
    const skis=[[1.75,0x9b2a22],[1.62,0x2f4a66],[1.7,0x23292f],[1.22,0xa8853a],[1.02,0x4a7d6a]];
    skis.forEach((s,i)=>{ const x=-.72+i*.34; for(const o of [0,.09]){ bx('paint',.072,s[0],.012,x+o,s[0]/2+.02,.12+o*.2,s[1],{rx:-.085}); bx('paint',.072,.1,.012,x+o,s[0]+.06,.045+o*.2-s[0]*.085*.5+ .03,s[1],{rx:-.5}); } });
    for(const x of [-.86,.2,.86]){ cy('metal',.007,.007,1.2,x,.62,-.13,0x9a9da4,{rx:.09}); cy('paint',.03,.03,.004,x,.08,-.18,0x1b1b1d); cy('paint',.012,.012,.12,x,1.16,-.08,0x1b1b1d,{rx:.09}); }
    vb(.05,1.42,.05,1.25,.71,0,WD.dark); bx('paint',.09,.02,.03,1.25,1.25,.04,0x1b1b1d); bx('paint',.075,.155,.009,1.25,1.335,.045,0x101114,{rx:-.12}); qd('screen',.068,.142,UE.phone,1.25,1.335,.0505,{rx:-.12});
    LIFT.sos=W(1.25+.009,1.335+.012,.0525);
    push(.35,0,.95,-.15); bx('wood',1.5,.05,.36,0,.45,0,tint(WD.pale)); for(const s of [-.6,.6]) bx('wood',.06,.44,.32,s,.22,0,WD.dark);
      cy('paint',.042,.042,.26,-.45,.605,0,0x2f5a48); cy('metal',.044,.04,.05,-.45,.76,0,0xb0b3b8);
      for(const x of [-.2,.02]){ put('gloss',new THREE.SphereGeometry(.062,18,8,0,2*PI,PI*.52,PI*.48),x,.537,.03,0xe9e4d6); cy('gloss',.025,.03,.012,x,.481,.03,0xe9e4d6); cy('gloss',.052,.052,.002,x,.522,.03,0xc7a57c); STEAM.push(W(x,.55,.03)); }
      sp('fabric',1,.35,.51,.0,0xb8a98a,{sx:.095,sy:.05,sz:.085}); cy('paint',.06,.06,.003,.35,.552,0,0x3a3228,{sz:.8}); for(let i=0;i<9;i++) sp('paper',.014,.35+rr(-.04,.04),.562,rr(-.035,.035),0xf2efe6); sp('paper',.014,.47,.489,.06,0xf2efe6); sp('paper',.014,.5,.489,-.02,0xf2efe6);
      sp('fabric',1,-.62,.5,.05,0x7a2f2a,{sx:.09,sy:.04,sz:.09}); anchor('shumkar',-.3,.475,-.09,.2,-.22,.14); pop();
    reg('shumkar',{cam:[2.0,1.75,2.45],look:[.95,.95,.4],m:[1.25,1.62,.05],box:[.2,.8,.5,3.2,1.8,2.6]});
  pop();
  /* a sled of tied rubbish bags by the trail */
  const sx=7.6, sz=-8.6, sy=H(sx,sz); push(sx,sy,sz,.9);
    for(const s of [-.2,.2]){ bx('wood',1.05,.03,.03,0,.02,s,WD.dark); tr('wood',.12,.015,.52,.14,s,WD.dark,{arc:PI/2,rz:-PI/2}); for(const x of [-.35,.25]) vb(.03,.16,.03,x,.11,s,WD.dark); }
    for(let i=0;i<5;i++) bx('wood',.95,.015,.07,-.03,.2,-.2+i*.1,tint(WD.pale));
    for(const [x,z,c,k] of [[-.25,.0,0x15171a,1],[.18,-.03,0x1a1d22,.9],[-.02,.02,0x2c3b4f,.8]]){ const y=k<.85?.56:.36; sp('gloss',1,x,y,z,c,{sx:.2*k,sy:.17*k,sz:.19*k}); cy('gloss',.02,.05,.07,x,y+.18*k,z,c); tr('paint',.022,.004,x,y+.16*k,z,0xd9d4c8,{rx:PI/2}); }
    tb('fabric',[[.52,.14,.2],[.9,.05,.3],[1.3,.02,.1]],.006,0xb8a98a);
    anchor('sled',.35,.0,.5,0,-.25,.2);
    reg('sled',{cam:[-1.3,1.35,2.2],look:[0,.32,0],m:[0,1.0,0],box:[0,.4,0,1.5,1,1.3]});
  pop(); }

await flush('slope',false); await pause('fork',.89);
/* ---------------- G: the only way ---------------- */
{ const fx=1.2, fz=34.6;   /* the post stands at the side of the road, so the arch stays clear */ push(fx,H(fx,fz),fz);
  vb(.11,2.3,.11,0,1.15,0,WD.dark); sp('snow',1,0,2.31,0,0xe9eef8,{sx:.09,sy:.04,sz:.09});
  /* one board, facing the visitor, pointing straight on */
  bx('wood',1.15,.26,.035,0,1.95,-.075,0x8a6a48); qd('sign',1.08,.22,[0,0,1,.5],0,1.95,-.094,{ry:PI});
  GLOWS.push([W(0,2.36,0),.9,0xffb070]);
  anchor('fork',0,1.05,-.062,PI,0,.22);
  reg('fork',{cam:[.75,2.15,-4.6],look:[.9,2.0,3.0],m:[0,2.55,0],box:[0,1.3,0,2.6,2.6,1.4]});
  pop();
  /* and a few steps on, a wooden arch over the road */
  const az=fz+3.4, ax=2.15, ay=H(ax,az);
  for(const s of [-1.25,1.25]){ const x=ax+s, y=H(x,az); vb(.16,ay+3.25-y,.16,x,(y+ay+3.25)/2-.1,az,WD.dark); sp('snow',1,x,ay+3.27,az,0xe9eef8,{sx:.11,sy:.04,sz:.11}); }
  bx('wood',3.0,.18,.2,ax,ay+3.2,az,WD.dark); bx('snow',2.9,.06,.18,ax,ay+3.32,az,0xe9eef8,{uv:[2,1]});
  for(const s of [-.85,.85]) cy('metal',.008,.008,.28,ax+s,ay+2.97,az,0x55595f,{seg:6});
  bx('wood',1.95,.44,.04,ax,ay+2.72,az,0x8a6a48); qd('sign',1.86,.38,[0,.5,1,1],ax,ay+2.72,az-.022,{ry:PI}); qd('sign',1.86,.38,[0,.5,1,1],ax,ay+2.72,az+.022);
  GLOWS.push([new V3(ax,ay+3.05,az-.12),.8,0xffb070]); }

await flush('fork',false); await pause('traces',.93);
/* ---------- footprints ---------- */
const SNOWP=0x8d9bc2, DECKP=0xb9b3ac;
function walk(pts,kind,o={}){ const c=curveOf(pts), L=c.getLength(), stride=(o.stride||.68)*(o.size||1), n=Math.floor(L*(o.t1||1)/stride), side=o.side||0;
  for(let i=Math.floor(L*(o.t0||0)/stride);i<n;i++){ const t=Math.min(1,i*stride/L), p=c.getPointAt(t), tg=c.getTangentAt(t), d=o.back?-1:1, lr=(i%2?1:-1)*.1*(o.size||1)+side;
    const x=p.x-tg.z*lr+rr(-.03,.03), z=p.z+tg.x*lr+rr(-.03,.03); PR[kind].push({x,z,yaw:Math.atan2(-tg.x*d,-tg.z*d)+rr(-.12,.12),s:o.size||1,deck:!!o.deck,a:(o.deck?.5:1)*(o.fade?1-sstep(.5,1,t):1)}); } }
/* Taalai walks every trail; almost everywhere someone walks beside him */
walk(PATHS.yurt,'T',{side:-.28}); walk(PATHS.yurt,'O',{side:.3,size:.95}); walk(PATHS.yurt,'T',{side:.05,back:true}); for(let i=0;i<7;i++) walk(PATHS.yurt,'K',{side:rr(-.9,.9),size:rr(.6,.72),stride:.5,back:i%2===0});
walk(PATHS.circle,'T',{side:-.3}); walk(PATHS.circle,'O',{side:.25}); walk(PATHS.circle,'O',{side:.6,size:.9,back:true}); walk(PATHS.circle,'K',{side:-.7,size:.82,back:true});
walk(PATHS.pipe,'T',{side:-.1}); walk(PATHS.pipe,'T',{side:.3,back:true});
walk(PATHS.lift,'T',{side:-.25}); walk(PATHS.lift,'O',{side:.28,size:1.02}); walk(PATHS.lift,'K',{side:.65,size:.8}); walk(PATHS.lift,'T',{side:.0,back:true});
walk(PATHS.fork,'T',{side:-.22}); walk(PATHS.fork,'O',{side:.3,t1:.8});
walk([[2,34],[2.2,40],[2.5,48],[2.6,58],[2.4,70]],'T',{fade:true});            /* past the signpost, straight on */
{ const [yx,yz]=ZONE.yurt; for(let i=0;i<70;i++){ const a=rr(-1.2,1.2), r=rr(3.5,6.2); PR.K.push({x:yx+Math.cos(a)*r,z:yz+Math.sin(a)*r,yaw:rr(0,6.3),s:rr(.6,.72),a:1}); }
  const [cx,cz]=ZONE.circle; for(let i=0;i<110;i++){ const a=rr(0,6.3), r=rr(.6,3.9), k=rng(); PR[k<.3?'T':k<.85?'O':'K'].push({x:cx+Math.cos(a)*r,z:cz+Math.sin(a)*r,yaw:rr(0,6.3),s:k<.85?rr(.88,1.05):.8,a:1}); }
  for(let i=0;i<40;i++){ const a=rr(0,6.3), r=rr(.3,2.4), k=rng(); PR[k<.5?'T':k<.8?'O':'K'].push({x:9.4+Math.cos(a)*r,z:-14.2+Math.sin(a)*r,yaw:rr(0,6.3),s:k<.8?1:.8,a:1}); }
  for(let i=0;i<14;i++) PR.T.push({x:ZONE.pipe[0]+rr(-1.2,.9),z:ZONE.pipe[1]+rr(.8,2.6),yaw:rr(0,6.3),s:1,a:1}); }
/* snowy prints on the deck: every trail ends at the shared table; a smaller pair goes to the low chair */
for(const [a,b] of [[[-5.9,.4],[-3.6,-.1]],[[5.9,1],[1.7,-.2]],[[-3.2,3.6],[-2.2,.9]],[[3.2,-3.6],[1.2,-1.6]],[[.6,3.6],[-.2,1.3]]]){ walk([a,[(a[0]+b[0])/2+rr(-.2,.2),(a[1]+b[1])/2],b],'T',{deck:true,fade:true}); walk([a,[(a[0]+b[0])/2+.3,(a[1]+b[1])/2+.2],b],'O',{deck:true,fade:true,side:.3,size:.95}); }
walk([[.9,3.6],[2.6,3.3],[3.9,3.0]],'O',{deck:true,size:.8,stride:.6}); walk([[.7,3.6],[1.6,3.2],[2.3,2.9]],'T',{deck:true,side:-.25});
/* each kind of sole is one plain mesh (four vertices a print) drawn with the see-through shader */
{ const up=new V3(0,1,0), qa=new THREE.Quaternion(), qb=new THREE.Quaternion(), c=new THREE.Color(), c2=new THREE.Color(), m4=new THREE.Matrix4(), v=new V3(), sc=new V3(), ps=new V3();
  const QP=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]], QU=[[0,1],[1,1],[1,0],[0,0]];
  for(let i=0;i<66;i++) rng();                       /* keeps the random layout of the prints the same as before */
  for(const k of ['T','O','K']){ const list=PR[k]; if(!list.length) continue; const t=printTex(k), n4=list.length*4;
    const m=std({map:t.map,normalMap:t.nrm,normalScale:new THREE.Vector2(1.6,1.6),transparent:true,depthWrite:false,roughness:.75,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3});
    const pos=new Float32Array(n4*3), nor=new Float32Array(n4*3), col=new Float32Array(n4*3), uv=new Float32Array(n4*2), idx=new Uint16Array(list.length*6);
    list.forEach((p,i)=>{ let y, n; if(p.deck){ y=deckY+.004; n=up; } else { y=H(p.x,p.z)+.012; n=gnormal(p.x,p.z); }
      qa.setFromUnitVectors(up,n); qb.setFromAxisAngle(up,p.yaw); qa.multiply(qb); m4.compose(ps.set(p.x,y,p.z),qa,sc.set(.115*p.s,1,.3*p.s));
      c.set(p.deck?DECKP:SNOWP); if(p.a<1) c.lerp(c2.set(p.deck?0x6b4c32:0xe6ecf8),1-p.a);
      for(let q=0;q<4;q++){ const o=i*4+q; v.set(QP[q][0],0,QP[q][1]).applyMatrix4(m4); pos[o*3]=v.x; pos[o*3+1]=v.y; pos[o*3+2]=v.z; nor[o*3]=n.x; nor[o*3+1]=n.y; nor[o*3+2]=n.z; col[o*3]=c.r; col[o*3+1]=c.g; col[o*3+2]=c.b; uv[o*2]=QU[q][0]; uv[o*2+1]=QU[q][1]; }
      idx.set([i*4,i*4+2,i*4+1,i*4,i*4+3,i*4+2],i*6); });
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(pos,3)); g.setAttribute('normal',new THREE.BufferAttribute(nor,3)); g.setAttribute('color',new THREE.BufferAttribute(col,3)); g.setAttribute('uv',new THREE.BufferAttribute(uv,2)); g.setIndex(new THREE.BufferAttribute(idx,1));
    const me=new THREE.Mesh(g,m); me.renderOrder=1; me.frustumCulled=false; scene.add(me); NOAO.push(me); await pause(); } }

await pause('traces',.97);
/* ============================================================ things that move */
/* fusor: thin violet glow of rarefied air, rare branching discharges */
{ const core=new THREE.Mesh(new THREE.SphereGeometry(.012,10,8),new THREE.MeshBasicMaterial({color:0xf2d6ff})); core.position.copy(FUS); scene.add(core);
  const gg=new THREE.BufferGeometry(); gg.setAttribute('position',new THREE.BufferAttribute(new Float32Array([FUS.x,FUS.y,FUS.z]),3));
  const haze=new THREE.Points(gg,new THREE.PointsMaterial({map:glowT,color:0xb86cf0,size:.34,transparent:true,opacity:.5,blending:THREE.AdditiveBlending,depthWrite:false})); haze.renderOrder=2; scene.add(haze);
  const N=40, arr=new Float32Array(N*6), ag=new THREE.BufferGeometry(); ag.setAttribute('position',new THREE.BufferAttribute(arr,3));
  const arcs=new THREE.LineSegments(ag,new THREE.LineBasicMaterial({color:0xe9c8ff,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false})); arcs.renderOrder=2; scene.add(arcs);
  function bolt(){ let k=0; const seg=(a,b)=>{ if(k>=N) return; arr.set([a.x,a.y,a.z,b.x,b.y,b.z],k*6); k++; };
    const th=Math.random()*6.283, end=new V3(Math.cos(th)*.1,(Math.random()-.5)*.14,Math.sin(th)*.1).add(FUS); let p=FUS.clone();
    for(let i=1;i<=9;i++){ const q=FUS.clone().lerp(end,i/9).add(new V3((Math.random()-.5)*.03,(Math.random()-.5)*.03,(Math.random()-.5)*.03)); seg(p,q);
      if(Math.random()<.35){ let b=q.clone(); for(let j=0;j<3;j++){ const b2=b.clone().add(new V3((Math.random()-.5)*.05,(Math.random()-.5)*.05,(Math.random()-.5)*.05)); seg(b,b2); b=b2; } } p=q; }
    for(;k<N;k++) arr.fill(0,k*6,k*6+6); ag.attributes.position.needsUpdate=true; }
  bolt(); arcs.visible=REDUCE; let next=1.5, until=0;
  TICK.push(t=>{ if(t>next){ bolt(); until=t+.09+Math.random()*.12; next=t+.9+Math.random()*3.2; } arcs.visible=t<until; const f=.8+.12*Math.sin(t*17)+.08*Math.sin(t*5.3)+(arcs.visible?.5:0); haze.material.opacity=.42*f; }); }
/* steam over cups and kettles, smoke from the chimney */
{ const per=4, n=STEAM.length*per, a=new Float32Array(n*3), ph=new Float32Array(n); for(let i=0;i<n;i++) ph[i]=Math.random();
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(a,3));
  scene.add(new THREE.Points(g,new THREE.PointsMaterial({map:glowT,color:0xdfe4ee,size:.075,transparent:true,opacity:.2,depthWrite:false})));
  const upd=t=>{ for(let i=0;i<n;i++){ const s=STEAM[Math.floor(i/per)], u=(t*.28+ph[i])%1; a[i*3]=s.x+Math.sin(u*5+ph[i]*20)*.018*u; a[i*3+1]=s.y+u*.2; a[i*3+2]=s.z+Math.cos(u*4+ph[i]*13)*.018*u; } g.attributes.position.needsUpdate=true; };
  upd(0); TICK.push(upd);
  const m=14, b=new Float32Array(m*3), g2=new THREE.BufferGeometry(); g2.setAttribute('position',new THREE.BufferAttribute(b,3));
  scene.add(new THREE.Points(g2,new THREE.PointsMaterial({map:glowT,color:0x8d93a6,size:.9,transparent:true,opacity:.16,depthWrite:false})));
  const upd2=t=>{ for(let i=0;i<m;i++){ const u=(t*.06+i/m)%1; b[i*3]=SMOKE.x+u*u*2.6+Math.sin(u*9+i)*.12; b[i*3+1]=SMOKE.y+u*3.6; b[i*3+2]=SMOKE.z+u*.9; } g2.attributes.position.needsUpdate=true; };
  upd2(0); TICK.push(upd2); }
TICK.push(t=>{ LIGHTS.stove.intensity=7*(.82+.12*Math.sin(t*9.1)+.08*Math.sin(t*23.7)); });
/* weather: thin snowfall around the camera */
{ const n=TIERS.high.snow, a=new Float32Array(n*3), R=22; for(let i=0;i<n;i++){ a[i*3]=(Math.random()-.5)*2*R; a[i*3+1]=Math.random()*14; a[i*3+2]=(Math.random()-.5)*2*R; }
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(a,3)); const pts=new THREE.Points(g,new THREE.PointsMaterial({map:glowT,color:0xe9eef8,size:.05,transparent:true,opacity:.7,depthWrite:false})); pts.frustumCulled=false; scene.add(pts); SNOW=pts; g.setDrawRange(0,TIERS[tier].snow);
  TICK.push((t,dt)=>{ const cx=camera.position.x, cz=camera.position.z, base=H(cx,cz)-1; for(let i=0;i<n;i++){ let x=a[i*3]+dt*(.35+.1*Math.sin(i)), y=a[i*3+1]-dt*(.55+.25*((i*7)%5)/5), z=a[i*3+2]+dt*.12;
      if(y<0) y+=14; if(x>R) x-=2*R; if(z>R) z-=2*R; a[i*3]=x; a[i*3+1]=y; a[i*3+2]=z; }
    pts.position.set(cx,base,cz); g.attributes.position.needsUpdate=true; }); }
/* the yurt: a hologram of what Flux Lab shows, a solenoid and its magnetic field, turning slowly */
{ const g=new THREE.Group(); g.position.copy(HOLO); scene.add(g); NOAO.push(g);
  const add=THREE.AdditiveBlending, C=1.05;
  const cone=new THREE.Mesh(new THREE.CylinderGeometry(.66,.24,1.8,32,1,true).translate(0,.09+.9,0),new THREE.MeshBasicMaterial({color:0x39c8ff,transparent:true,opacity:.06,blending:add,depthWrite:false,side:THREE.DoubleSide})); g.add(cone);
  const lineM=(c,o)=>new THREE.LineBasicMaterial({color:c,transparent:true,opacity:o,blending:add,depthWrite:false});
  const hp=[]; for(let i=0;i<=420;i++){ const t=i/420, a=t*2*PI*7; hp.push(new V3(Math.cos(a)*.15,C-.28+t*.56,Math.sin(a)*.15)); }
  const coilM=new THREE.MeshBasicMaterial({color:0xd8f6ff,transparent:true,opacity:.8,blending:add,depthWrite:false});
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hp),420,.006,5,false),coilM));
  const fm=lineM(0xff5fd2,.75), loops=[];
  for(let j=0;j<6;j++){ const ph=j/6*2*PI+.3; for(const [c,a,b] of [[.3,.24,.48],[.46,.4,.66]]){ const pts=[]; for(let i=0;i<=96;i++){ const t=i/96*2*PI, r=c+a*Math.cos(t); pts.push(new V3(Math.cos(ph)*r,C+b*Math.sin(t),Math.sin(ph)*r)); } loops.push(pts); g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),fm)); } }
  const NP=loops.length*3, pa=new Float32Array(NP*3), pg=new THREE.BufferGeometry(); pg.setAttribute('position',new THREE.BufferAttribute(pa,3));
  const dots=new THREE.Points(pg,new THREE.PointsMaterial({map:glowT,color:0xfff07a,size:.07,transparent:true,opacity:.95,blending:add,depthWrite:false})); dots.frustumCulled=false; g.add(dots);
  GLOWS.push([HOLO.clone().add(new V3(0,.12,0)),1.1,0x5fe0ff]);
  const upd=t=>{ g.rotation.y=t*.25; for(let i=0;i<NP;i++){ const L=loops[Math.floor(i/3)], u=(t*.11+(i%3)/3)%1, p=L[Math.floor(u*(L.length-1))]; pa[i*3]=p.x; pa[i*3+1]=p.y; pa[i*3+2]=p.z; } pg.attributes.position.needsUpdate=true;
    const f=.84+.1*Math.sin(t*7)+.06*Math.sin(t*23); fm.opacity=.75*f; coilM.opacity=.8*f; cone.material.opacity=.06*f; };
  upd(0); TICK.push(upd); compileFor(g,scene); }
/* WASYS: one LED blinking; Shumkar: one red dot blinking on the phone */
{ const led=new THREE.Mesh(new THREE.SphereGeometry(.004,6,5),new THREE.MeshBasicMaterial({color:0x7dffa0})); led.position.copy(LEDW); scene.add(led);
  const sos=new THREE.Mesh(new THREE.CircleGeometry(.0042,12),new THREE.MeshBasicMaterial({color:0xff3b30})); sos.position.copy(LIFT.sos); sos.rotation.set(-.12,.45,0,'YXZ'); scene.add(sos);
  TICK.push(t=>{ led.visible=(t%1.6)<.25; sos.visible=(t%1.1)<.6; }); }
/* lift chairs, and small figures only far up the slope */
{ const cg=mergeGeometries([new THREE.BoxGeometry(.05,2.3,.05).translate(0,-1.15,0),new THREE.BoxGeometry(1.1,.05,.42).translate(0,-2.3,0),new THREE.BoxGeometry(1.1,.42,.04).translate(0,-2.05,-.2),new THREE.BoxGeometry(.3,.08,.08).translate(0,0,0)]);
  const rg=mergeGeometries([-.25,.25].flatMap(x=>[new THREE.SphereGeometry(.11,8,6).translate(x,-1.45,-.05),new THREE.BoxGeometry(.34,.5,.24).translate(x,-1.86,-.06),new THREE.BoxGeometry(.3,.14,.5).translate(x,-2.2,.16),new THREE.BoxGeometry(.3,.45,.12).translate(x,-2.45,.38)]));
  const NC=14, chairs=new THREE.InstancedMesh(cg,INST({roughness:.6,metalness:.4}),NC), riders=new THREE.InstancedMesh(rg,INST({roughness:.9}),NC);
  { const ca=new THREE.Color(0x2a2c30), cb=new THREE.Color(0x1d2230); for(let i=0;i<NC;i++){ chairs.setColorAt(i,ca); riders.setColorAt(i,cb); } }
  scene.add(chairs,riders);
  const cu=new THREE.CatmullRomCurve3(LIFT.up,false,'catmullrom',.01), cd=new THREE.CatmullRomCurve3(LIFT.dn,false,'catmullrom',.01), p=new V3(), z0=new THREE.Matrix4().makeScale(0,0,0);
  const upd=t=>{ for(let i=0;i<NC;i++){ const u=((i/NC)*2+t*.006)%2, upLine=u<1; (upLine?cu:cd).getPointAt(upLine?u:2-u,p); const m=mat4(p.x,p.y,p.z,LIFT.phi+(upLine?PI:0)+PI/2); chairs.setMatrixAt(i,m);
      riders.setMatrixAt(i,(upLine&&i%3!==0&&Math.hypot(p.x,p.z)>70)?m:z0); } chairs.instanceMatrix.needsUpdate=true; riders.instanceMatrix.needsUpdate=true; };
  upd(0); TICK.push(upd);
  const sg=mergeGeometries([new THREE.CapsuleGeometry(.2,.75,4,8).translate(0,.85,0),new THREE.SphereGeometry(.13,8,6).translate(0,1.55,0),new THREE.BoxGeometry(.3,.03,1.5).translate(0,.02,0)]);
  const NS=7, sk=new THREE.InstancedMesh(sg,INST({roughness:.9}),NS), cc=new THREE.Color(); [0x1d2230,0x4a1f1c,0x1f3340,0x2b2b30,0x3d341f,0x1d2230,0x33202c].forEach((c,i)=>{ cc.set(c); sk.setColorAt(i,cc); }); scene.add(sk);
  const upd3=t=>{ for(let i=0;i<NS;i++){ const u=(t*.035*(1+.2*((i*3)%4)/4)+i/NS)%1, z=-150+u*86, x=19-z*.15+Math.sin(z*.07+i*2.1)*8, s=sstep(0,.06,u)*sstep(1,.93,u); sk.setMatrixAt(i,mat4(x,H(x,z),z,Math.cos(z*.07+i*2.1)*.5,0,0,s,s,s)); } sk.instanceMatrix.needsUpdate=true; };
  upd3(0); TICK.push(upd3); }

/* ============================================================ everything is built */
await firstP;
makeGlows(); buildMarkers(); shadowsDirty();
if(pendingFly) fly(pendingFly);
built=true; perf.warm=0; perf.warmSum=0;
UI.ready('all'); STEPS.push(Math.round(performance.now()-_pt-_gpu)); if(window.__perf) window.__perf.all=Math.round(performance.now());
/* the ambient-occlusion shaders are built last and in the background; AO stays off until they are ready */
let aoP=Promise.resolve();
if(aoPass){ const quads=new THREE.Group(), over=new THREE.Group();
  for(const m of [aoPass.gtaoMaterial,aoPass.pdMaterial,aoPass.depthRenderMaterial,aoPass.copyMaterial,aoPass.blendMaterial]) if(m) quads.add(stub(m));
  over.add(stub(aoPass.normalMaterial),stub(aoPass.normalMaterial,true));
  aoP=Promise.all([compileFor(quads),compileFor(over,scene)]).then(()=>{ aoWarm=true; camDirty=true; }); }
if(SHOT){ await aoP; await pause(); await pause(); shoot(); }
