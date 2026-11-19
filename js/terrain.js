/* ============================================================
   МИР ТААЛАЯ. Рельеф: высота H(x,z) и сборка сетки.
   Один файл для страницы и для воркера (terrain-worker.js).
   Метры, Y вверх, север это -Z (вверх по склону), юг это +Z (долина).
   ============================================================ */
(function(g){
"use strict";
var lerp=function(a,b,t){return a+(b-a)*t;}, clamp=function(v,a,b){return Math.min(b,Math.max(a,v));};
var sstep=function(a,b,x){ var t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
function hash2(ix,iy){ var h=Math.imul(ix,374761393)+Math.imul(iy,668265263); h=Math.imul(h^(h>>>13),1274126177); return ((h^(h>>>16))>>>0)/4294967295; }
function vnoise(x,y){ var xi=Math.floor(x), yi=Math.floor(y), xf=x-xi, yf=y-yi, u=xf*xf*(3-2*xf), v=yf*yf*(3-2*yf);
  return lerp(lerp(hash2(xi,yi),hash2(xi+1,yi),u),lerp(hash2(xi,yi+1),hash2(xi+1,yi+1),u),v); }
function fbm(x,y,oct){ var a=.5,f=1,s=0,n=0; for(var i=0;i<(oct||4);i++){ s+=a*vnoise(x*f+i*13.7,y*f-i*7.3); n+=a; a*=.5; f*=2; } return s/n; }
function ridged(x,y,oct){ var a=.5,f=1,s=0,n=0; for(var i=0;i<(oct||5);i++){ var v=1-Math.abs(vnoise(x*f+17.3+i*31,y*f-9.1+i*17)*2-1); s+=a*v*v; n+=a; a*=.5; f*=2.03; } return s/n; }

var ZONE={ yurt:[-17,-1], circle:[-11,13.5], pipe:[17.2,3.6], lift:[11,-17], fork:[2,34] };
var PATHS={
  yurt:[[-6.6,.4],[-9.5,.1],[-12,-.6],[-13.6,-1]],
  pipe:[[6.6,1],[9.5,1.6],[12.5,2.6],[15.4,3.9]],
  circle:[[-3.2,4.4],[-5,7],[-7.3,9.8],[-9,11.4]],
  lift:[[3.2,-4.4],[4.5,-8],[6.8,-12.3],[9.2,-15.2]],
  fork:[[.6,4.4],[.9,10],[1.6,18],[2,26],[2,33]],
  road:[[2,34.5],[2.2,40],[2.5,48],[2.6,58],[2.4,70]]      /* past the sign there is only one road */
};
function rawH(x,z){
  var zc=z<50?z:50+(z-50)*.3, h=-.07*zc;
  var n=Math.min(600,Math.max(0,-z-14)); h+=.17*n*(n/(n+25));
  h-=2.4*Math.exp(-Math.pow((x-(21+.15*z))/3.2,2));
  h+=(fbm(x*.02+3.1,z*.02+7.7,4)-.5)*3+(fbm(x*.11,z*.11,3)-.5)*.3;
  var r=Math.hypot(x,z);
  if(r>140){ var m=sstep(140,2200,r), ds=z/r, vf=1-.78*sstep(.5,.95,ds)*(1-sstep(1700,2600,r)); h+=m*vf*(ridged(x*.0009,z*.0009,5)*680+90*sstep(300,2000,r)); }
  return h;
}
var PADS=[[0,0,8.5,15],[ZONE.yurt[0],ZONE.yurt[1],4.6,8.5],[ZONE.circle[0],ZONE.circle[1],4.4,8],[ZONE.lift[0]-1,ZONE.lift[1]+1,3.6,7],[ZONE.fork[0],ZONE.fork[1],2.6,6]].map(function(p){ return {x:p[0],z:p[1],r0:p[2],r1:p[3],h:rawH(p[0],p[1])}; });
function H(x,z){ var h=rawH(x,z); for(var i=0;i<PADS.length;i++){ var p=PADS[i], d=Math.hypot(x-p.x,z-p.z); if(d<p.r1) h+=(p.h-h)*(1-sstep(p.r0,p.r1,d)); } return h; }

/* One warped grid: dense near the workshop, sparse out to 3 km. Returns typed arrays. */
function build(N){
  var warp=function(u){ var a=Math.abs(u); return (u<0?-1:1)*(70*a+2930*Math.pow(a,5)); };
  var V=(N+1)*(N+1), pos=new Float32Array(V*3), nor=new Float32Array(V*3), col=new Float32Array(V*3), uv=new Float32Array(V*2), idx=new Uint32Array(N*N*6), i,j,k;
  for(j=0;j<=N;j++){ var z=warp(j/N*2-1); for(i=0;i<=N;i++){ var x=warp(i/N*2-1); k=j*(N+1)+i; pos[k*3]=x; pos[k*3+1]=H(x,z); pos[k*3+2]=z; uv[k*2]=x/160+.5; uv[k*2+1]=1-(z/160+.5); } }
  var q=0; for(j=0;j<N;j++) for(i=0;i<N;i++){ var a=j*(N+1)+i, b=a+1, c=a+N+1, d=c+1; idx[q++]=a; idx[q++]=c; idx[q++]=b; idx[q++]=b; idx[q++]=c; idx[q++]=d; }
  for(q=0;q<idx.length;q+=3){ var A=idx[q]*3, B=idx[q+1]*3, C=idx[q+2]*3;
    var e1x=pos[B]-pos[A], e1y=pos[B+1]-pos[A+1], e1z=pos[B+2]-pos[A+2], e2x=pos[C]-pos[A], e2y=pos[C+1]-pos[A+1], e2z=pos[C+2]-pos[A+2];
    var nx=e1y*e2z-e1z*e2y, ny=e1z*e2x-e1x*e2z, nz=e1x*e2y-e1y*e2x;
    nor[A]+=nx; nor[A+1]+=ny; nor[A+2]+=nz; nor[B]+=nx; nor[B+1]+=ny; nor[B+2]+=nz; nor[C]+=nx; nor[C+1]+=ny; nor[C+2]+=nz; }
  /* linear-light colours of snow, rock and far forest */
  var s2l=function(v){ v/=255; return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4); }, rgb=function(r,g2,b){ return [s2l(r),s2l(g2),s2l(b)]; };
  var cs=rgb(0xe6,0xec,0xf8), cr=rgb(0x3b,0x40,0x52), cf=rgb(0x16,0x24,0x2a), y0=H(0,0);
  for(k=0;k<V;k++){ var X=pos[k*3], Y=pos[k*3+1], Z=pos[k*3+2], l=Math.hypot(nor[k*3],nor[k*3+1],nor[k*3+2])||1; nor[k*3]/=l; nor[k*3+1]/=l; nor[k*3+2]/=l;
    var nyy=nor[k*3+1], r=Math.hypot(X,Z), rock=sstep(.74,.56,nyy)*sstep(120,420,r)*.9, forest=sstep(.47,.58,fbm(X*.004+9,Z*.004+2,3))*sstep(150,380,r)*(1-sstep(260,620,Y-y0))*sstep(.55,.82,nyy)*.88;
    for(var t=0;t<3;t++){ var v=lerp(cs[t],cf[t],forest); col[k*3+t]=lerp(v,cr[t],rock); } }
  return {pos:pos,nor:nor,col:col,uv:uv,idx:idx};
}

/* ---------- surface textures: wood grain, snow ripples, weave, felt, brushed metal ----------
   Plain arrays of pixels (RGBA, row 0 at the bottom), made here so the worker can do it off the main thread.
   They used to be drawn by the GPU, but on a first visit that cost six shader builds, close to a second. */
function fr(x){ return x-Math.floor(x); }
function md(a,b){ return a-b*Math.floor(a/b); }
function th(x,y){ x=fr(x*123.34); y=fr(y*456.21); var d=x*(x+45.32)+y*(y+45.32); return fr((x+d)*(y+d)); }
function tvn(x,y,per){ var ix=Math.floor(x), iy=Math.floor(y), fx=x-ix, fy=y-iy; fx=fx*fx*(3-2*fx); fy=fy*fy*(3-2*fy);
  var x0=md(ix,per), x1=md(ix+1,per), y0=md(iy,per), y1=md(iy+1,per), a=th(x0,y0), b=th(x1,y0), c=th(x0,y1), d=th(x1,y1);
  return (a+(b-a)*fx)+((c+(d-c)*fx)-(a+(b-a)*fx))*fy; }
function tfbm(x,y,per){ var a=.5,s=0,n=0; for(var i=0;i<4;i++){ s+=a*tvn(x+i*17,y+i*17,per); n+=a; a*=.5; x*=2; y*=2; per*=2; } return s/n; }
var KNOTS=[[120,140],[380,330],[250,470]];
function wood(u,v){ var x=u*512, y=(1-v)*512, yy=y, kd=0;
  for(var i=0;i<3;i++){ var dx=x-KNOTS[i][0], dy=y-KNOTS[i][1]; yy+=20*Math.exp(-(dx*dx*.2+dy*dy)/600)*(dy/(Math.abs(dy)+6)); kd=Math.max(kd,Math.exp(-(dx*dx+dy*dy)/80)); }
  var ring=Math.sin(yy*.42+5*tfbm(x*8/512,yy*.03,8)), fine=tfbm(x*16/512,yy*.6,16);
  return (.74+.13*(.5+.5*ring)*(.6+.4*fine)+(fine-.5)*.14)*(1-.5*kd); }
function snowH(u,v){ return tfbm(u*8,v*16,8)+.22*Math.sin(6.2832*(1-v)*5+5*tfbm(u*4,v*4,4))+.12*tfbm(u*64,v*64,64); }
function weaveH(u,v){ return (.5+.5*Math.sin(u*6.2832*48))*(.5+.5*Math.sin(v*6.2832*48))+.5*tfbm(u*32,v*32,32); }
function field(S,fn){ var h=new Float32Array(S*S); for(var j=0;j<S;j++) for(var i=0;i<S;i++) h[j*S+i]=fn((i+.5)/S,(j+.5)/S); return h; }
function normals(h,S,str){ var o=new Uint8Array(S*S*4);
  for(var j=0;j<S;j++) for(var i=0;i<S;i++){ var l=h[j*S+(i+S-1)%S], r=h[j*S+(i+1)%S], d=h[((j+S-1)%S)*S+i], u=h[((j+1)%S)*S+i];
    var nx=(l-r)*str, ny=(d-u)*str, k=1/Math.sqrt(nx*nx+ny*ny+1), q=(j*S+i)*4; o[q]=(nx*k*.5+.5)*255; o[q+1]=(ny*k*.5+.5)*255; o[q+2]=(k*.5+.5)*255; o[q+3]=255; }
  return o; }
/* part: "wood", "snow" or "small"; without it, everything (the fallback when workers are not available) */
function textures(part){
  var S=512, s=256, i, q, out={}, c8=function(v){ return Math.max(0,Math.min(255,Math.round(v*255))); };
  if(!part||part==="wood"){ var wh=field(S,wood), woodT=new Uint8Array(S*S*4);
    for(i=0;i<S*S;i++){ q=i*4; woodT[q]=c8(wh[i]*262/255); woodT[q+1]=c8(wh[i]*240/255); woodT[q+2]=c8(wh[i]*212/255); woodT[q+3]=255; }
    out.woodT=woodT; out.woodN=normals(wh,S,5); }
  if(!part||part==="snow") out.snowN=normals(field(S,snowH),S,3.2);
  if(!part||part==="small"){ var felt=new Uint8Array(s*s*4), scratch=new Uint8Array(s*s*4);
    for(var j=0;j<s;j++) for(i=0;i<s;i++){ var u=(i+.5)/s, v=(j+.5)/s; q=(j*s+i)*4;
      var f=c8(.8+.2*tfbm(u*32,v*32,32)); felt[q]=felt[q+1]=felt[q+2]=f; felt[q+3]=255;
      var g2=(95+70*tfbm(u*16,v*16,16))/255+(tvn(u*8,v*256,256)-.5)*.16+(tvn(u*200,v*6,200)-.5)*.1; scratch[q]=0; scratch[q+1]=c8(g2); scratch[q+2]=255; scratch[q+3]=255; }
    out.weaveN=normals(field(s,weaveH),s,.7); out.feltT=felt; out.scratchT=scratch; }
  return out;
}
g.TERRAIN={H:H,rawH:rawH,fbm:fbm,ZONE:ZONE,PATHS:PATHS,build:build,textures:textures};
})(typeof self!=="undefined"?self:this);
