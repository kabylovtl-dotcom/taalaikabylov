/* ============================================================
   МИР ТААЛАЯ. Интерфейс: вход, тур, панель с фото, лайтбокс.
   Работает без WebGL: тогда остаётся ссылка на текстовую версию.
   ============================================================ */
(function(){
"use strict";
var REDUCE=matchMedia("(prefers-reduced-motion: reduce)").matches;
var S=window.SITE, TEXT=S.TEXT, ITEMS=S.ITEMS, PHOTOS=S.PHOTOS;
var STOPS=ITEMS.filter(function(i){return i.stop!=null;}), LAST=STOPS.length-1;
var byId={}; ITEMS.forEach(function(i){byId[i.id]=i;});
var $=function(id){return document.getElementById(id);};
var EDIT=S.flag("edit")==="1", SHOT=S.flag("shot")==="1";
var lang=S.pickLang(), cur="overview", open=true, touched=false, entered=false, firstReady=false;
if(SHOT) document.body.classList.add("shot");

function L(){ return TEXT[lang]; }
function stopOf(id){ var it=byId[id]; return it.stop!=null?it.stop:it.parent; }
function two(n){ return (n<10?"0":"")+n; }
function photosOf(id){ return (PHOTOS[id]||[]).slice(0,3); }
function capOf(p){ var c=(p.caption&&p.caption[lang])||"", d=p.date||""; return c&&d?c+" · "+d:(c||d); }

/* ---------- panel ---------- */
var shotIdx=0;
function sizeShots(){
  var strip=$("strip"), panel=$("panel"); if($("shots").hidden) return;
  var wide=window.innerWidth>=860, W=strip.clientWidth-10, maxH=wide?250:Math.max(90,Math.min(window.innerHeight*.58*.45,230));
  Array.prototype.forEach.call(strip.children,function(f){ var r=f._ratio||1.5, h=Math.min(maxH,W/r), b=f.firstChild; b.style.height=Math.round(h+10)+"px"; b.style.width=Math.round(h*r+10)+"px"; });
}
function renderShots(){
  var list=photosOf(cur), box=$("shots"), strip=$("strip"), dots=$("dots"), ui=L().ui; strip.textContent=""; dots.textContent=""; shotIdx=0;
  var show=list.length>0||(EDIT&&cur!=="overview"); box.hidden=!show; $("panel").classList.toggle("has-photo",show&&open);
  if(!show) return;
  if(!list.length){ var f=document.createElement("figure"); f.className="shot empty"; f._ratio=1.6; var b=document.createElement("button"); b.type="button"; b.disabled=true; b.textContent=ui.editHint+cur; f.appendChild(b); strip.appendChild(f); }
  list.forEach(function(p,i){
    var f=document.createElement("figure"); f.className="shot"; f._ratio=(p.w&&p.h)?p.w/p.h:1.5;
    var b=document.createElement("button"); b.type="button"; b.setAttribute("aria-label",ui.photoOpen);
    if(p.video){ var v=document.createElement("video"); v.muted=true; v.loop=true; v.playsInline=true; v.setAttribute("playsinline",""); v.preload="metadata"; v.poster=p.poster;
      v.setAttribute("aria-label",(p.alt&&p.alt[lang])||""); if(!REDUCE) v.autoplay=true; v.src=p.src;
      v.onloadedmetadata=function(){ if(!(p.w&&p.h)&&v.videoWidth){ f._ratio=v.videoWidth/v.videoHeight; sizeShots(); } };
      b.appendChild(v); }
    else { var im=document.createElement("img"); im.decoding="async"; im.loading="lazy"; if(p.w){ im.width=p.w; im.height=p.h; }
    im.alt=(p.alt&&p.alt[lang])||""; im.sizes="(min-width:860px) 330px, 92vw"; im.srcset=S.small(p.src)+" 800w, "+p.src+" 1600w"; im.src=p.src;
    im.onerror=function(){ if(im.srcset){ im.removeAttribute("srcset"); im.src=p.src; } };
    im.onload=function(){ if(!(p.w&&p.h)&&im.naturalWidth){ f._ratio=im.naturalWidth/im.naturalHeight; sizeShots(); } };
    b.appendChild(im); } b.addEventListener("click",function(){ openLb(cur,i,b); }); f.appendChild(b);
    var c=capOf(p); if(c){ var fc=document.createElement("figcaption"); fc.textContent=c; f.appendChild(fc); }
    strip.appendChild(f);
    if(list.length>1){ var d=document.createElement("button"); d.type="button"; d.setAttribute("aria-label",ui.photo+" "+(i+1)+" "+ui.photoOf+" "+list.length); d.addEventListener("click",function(){ goShot(i); }); dots.appendChild(d); }
  });
  $("shl").hidden=$("shr").hidden=list.length<2; $("shl").setAttribute("aria-label",ui.photoPrev); $("shr").setAttribute("aria-label",ui.photoNext);
  strip.scrollLeft=0; markDot(); sizeShots();
  /* warm up the next stop's first photo while this one is being read */
  var nx=ITEMS[(at()+1)%ITEMS.length], np=photosOf(nx.id)[0]; if(np){ var pre=new Image(); pre.decoding="async"; pre.src=np.video?np.poster:(window.innerWidth<700?S.small(np.src):np.src); }
}
function markDot(){ Array.prototype.forEach.call($("dots").children,function(d,i){ d.setAttribute("aria-current",i===shotIdx?"true":"false"); }); }
function goShot(i){ var strip=$("strip"), n=strip.children.length; shotIdx=(i+n)%n; strip.scrollTo({left:shotIdx*strip.clientWidth,behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"}); markDot(); }
$("strip").addEventListener("scroll",function(){ var s=$("strip"), i=Math.round(s.scrollLeft/Math.max(1,s.clientWidth)); if(i!==shotIdx){ shotIdx=i; markDot(); } },{passive:true});
$("shl").addEventListener("click",function(){ goShot(shotIdx-1); });
$("shr").addEventListener("click",function(){ goShot(shotIdx+1); });
window.addEventListener("resize",sizeShots);

function render(){
  var ui=L().ui, it=L().items[cur], n=stopOf(cur);
  document.documentElement.lang=lang;
  $("count").textContent=two(n)+" / "+two(LAST);
  $("title").textContent=it[0];
  var box=$("text"); box.textContent="";
  it[1].forEach(function(p){ var el=document.createElement("p"); el.textContent=p; box.appendChild(el); });
  box.scrollTop=0;
  $("prev").textContent=ui.prev; $("prev").disabled=at()===0;
  $("next").textContent=(at()===ITEMS.length-1)?ui.restart:ui.next;
  $("close").setAttribute("aria-label",ui.close);
  $("panel").classList.toggle("shut",!open);
  renderShots();
  /* entry screen */
  $("iname").textContent=ui.name; $("itag").textContent=ui.tagline; $("ihow").textContent=ui.how;
  var own=(S.INTRO[lang]||"").trim(); $("iown").hidden=!own; $("iown").textContent=own;
  $("enter").textContent=ui.enter; $("totext").textContent=ui.textVersion; $("totext").href="text.html";
  $("icredit").textContent=S.CREDIT[lang]||"";
  $("slow").innerHTML=""; $("slow").appendChild(document.createTextNode(ui.slow+" ")); var u=document.createElement("u"); u.textContent=ui.textVersion; $("slow").appendChild(u); $("slow").href="text.html";
  stageLabel();
  if(window.__world){ window.__world.setCurrent(cur,open); window.__world.relabel(); }
}
function show(id){ cur=id; open=true; render(); if(window.__world) window.__world.fly(id); }
function close(){ if(!open) return; open=false; render(); if(window.__world) window.__world.fly("overview"); }
/* Next and Back walk through every interactive point in order, the small ones inside a stop included */
function at(){ return ITEMS.indexOf(byId[cur]); }
function next(){ var i=at(); show(ITEMS[i===ITEMS.length-1?0:i+1].id); }
function prev(){ var i=at(); if(i>0) show(ITEMS[i-1].id); }
$("next").addEventListener("click",next);
$("prev").addEventListener("click",prev);
$("close").addEventListener("click",close);

/* ---------- entry screen and loading ---------- */
var stageKey="start", failed=false;
function stageLabel(){ var ui=L().ui; $("stagename").textContent=failed?"":(firstReady&&stageKey==="done"?ui.ready:ui.loading+" · "+(ui.stages[stageKey]||"")); }
function enter(){ if(entered||!firstReady) return; entered=true; document.body.classList.add("in"); $("intro").classList.add("gone"); $("panel").hidden=false; render(); setTimeout(function(){ $("intro").hidden=true; },700); if(window.__world&&window.__world.entered) window.__world.entered(); $("gl").focus({preventScroll:true}); }
$("enter").addEventListener("click",enter);

/* ---------- lightbox ---------- */
var lb={id:null,i:0,from:null};
function lbShow(){ var p=photosOf(lb.id)[lb.i], im=$("lbi"), lv=$("lbv"), n=photosOf(lb.id).length, ui=L().ui; $("lbc").textContent=capOf(p);
  /* in the big view a clip gets its controls and its sound back */
  if(p.video){ im.hidden=true; im.removeAttribute("src"); lv.hidden=false; lv.poster=p.poster; lv.src=p.src; lv.setAttribute("aria-label",(p.alt&&p.alt[lang])||""); var pl=lv.play(); if(pl&&pl.catch) pl.catch(function(){}); }
  else { lv.pause(); lv.removeAttribute("src"); lv.hidden=true; im.hidden=false; im.src=p.src; im.alt=(p.alt&&p.alt[lang])||""; }
  $("lbp").hidden=$("lbn").hidden=n<2; $("lbx").setAttribute("aria-label",ui.close); $("lbp").setAttribute("aria-label",ui.photoPrev); $("lbn").setAttribute("aria-label",ui.photoNext); }
function openLb(id,i,from){ lb={id:id,i:i,from:from}; $("lb").hidden=false; lbShow(); $("lbx").focus(); }
function closeLb(){ if($("lb").hidden) return; $("lb").hidden=true; $("lbi").removeAttribute("src"); $("lbv").pause(); $("lbv").removeAttribute("src"); if(lb.from&&lb.from.focus) lb.from.focus(); }
function lbStep(d){ var n=photosOf(lb.id).length; if(n<2) return; lb.i=(lb.i+d+n)%n; lbShow(); }
$("lbx").addEventListener("click",closeLb); $("lbp").addEventListener("click",function(e){ e.stopPropagation(); lbStep(-1); }); $("lbn").addEventListener("click",function(e){ e.stopPropagation(); lbStep(1); });
$("lb").addEventListener("click",function(e){ if(e.target===$("lb")) closeLb(); });
$("lbi").draggable=false;
(function(){ var sx=null; $("lb").addEventListener("pointerdown",function(e){ sx=e.clientX; }); $("lb").addEventListener("pointercancel",function(){ sx=null; }); $("lb").addEventListener("pointerup",function(e){ if(sx==null) return; var dx=e.clientX-sx; sx=null; if(Math.abs(dx)>44) lbStep(dx<0?1:-1); }); })();

window.addEventListener("keydown",function(e){
  if(e.altKey||e.ctrlKey||e.metaKey) return;
  if(!$("lb").hidden){
    if(e.key==="Escape") closeLb(); else if(e.key==="ArrowRight") lbStep(1); else if(e.key==="ArrowLeft") lbStep(-1);
    else if(e.key==="Tab"){ var f=[$("lbx"),$("lbp"),$("lbn")].filter(function(b){return !b.hidden;}), i=f.indexOf(document.activeElement); e.preventDefault(); f[(i+(e.shiftKey?-1:1)+f.length)%f.length].focus(); }
    return;
  }
  if(!entered){ if(e.key==="Enter"&&document.activeElement!==$("totext")){ enter(); e.preventDefault(); } return; }
  if(e.key==="ArrowRight"){ next(); e.preventDefault(); }
  else if(e.key==="ArrowLeft"){ prev(); e.preventDefault(); }
  else if(e.key==="Escape"){ close(); }
  else if(e.key==="Enter"&&document.activeElement&&document.activeElement.id==="gl"){ show(cur); }
});

/* ---------- API for the 3D part ---------- */
window.__ui={
  ITEMS:ITEMS, EDIT:EDIT, SHOT:SHOT,
  title:function(id){ return L().items[id][0]; },
  photo:function(id){ return photosOf(id)[0]||null; },
  pick:function(id){ if(entered) show(id); },
  empty:function(){ close(); },
  moved:function(){ if(!touched&&entered){ touched=true; if(cur==="overview"&&open){ open=false; render(); } } },
  state:function(){ return {cur:cur,open:open,entered:entered}; },
  progress:function(key,frac){ stageKey=key; $("bar").style.transform="scaleX("+Math.max(0,Math.min(1,frac)).toFixed(3)+")"; stageLabel(); },
  ready:function(kind){ if(kind==="first"){ firstReady=true; $("enter").disabled=false; if(SHOT){ entered=true; document.body.classList.add("in"); $("intro").hidden=true; } } else { stageKey="done"; $("bar").style.transform="scaleX(1)"; stageLabel(); setTimeout(function(){ $("load").style.visibility="hidden"; },900); } },
  fail:function(){ failed=true; $("load").hidden=true; $("enter").hidden=true; $("ihow").textContent=L().ui.fail; var o=TEXT; TEXT.ru.ui.how=TEXT.ru.ui.fail; TEXT.en.ui.how=TEXT.en.ui.fail; },
  slow:function(){ if(entered) $("slow").hidden=false; }
};
render();
setTimeout(function(){ if(!window.__world&&!firstReady) window.__ui.fail(); },15000);
})();
