/* Считает вне главного потока сетку рельефа ({N:200}) или текстуры поверхностей ({tex:"wood"}, "snow" или "small") и отдаёт массивы без копирования. */
importScripts("terrain.js");
onmessage=function(e){ var r=e.data.tex?self.TERRAIN.textures(e.data.tex):self.TERRAIN.build(e.data.N), list=[]; for(var k in r) list.push(r[k].buffer); postMessage(r,list); };
