/* Пишет тексты и фото из data.js прямо в text.html обычным HTML, чтобы их видели Google и ИИ-поисковики
   (они часто не запускают JavaScript). Запуск из папки сайта после правок в data.js:
     node tools/build-text.mjs
   Скрипт меняет только то, что стоит между метками <!--build:...--> в text.html. */
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("..", import.meta.url).pathname;
const ctx = { window: {}, location: { search: "", hash: "" }, navigator: { language: "en" } };
vm.runInNewContext(fs.readFileSync(root + "data.js", "utf8"), ctx);
const S = ctx.window.SITE, lang = "en", T = S.TEXT[lang];

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const two = n => (n < 10 ? "0" : "") + n;
const last = Math.max(...S.ITEMS.filter(i => i.stop != null).map(i => i.stop));

function figure(p) {
  const alt = esc((p.alt && p.alt[lang]) || ""), c = (p.caption && p.caption[lang]) || "", d = p.date || "";
  const cap = c && d ? c + " · " + d : (c || d);
  const media = p.video
    ? `<video controls muted loop playsinline preload="none" poster="${esc(p.poster)}" src="${esc(p.src)}" aria-label="${alt}"></video>`
    : `<img loading="lazy" decoding="async" alt="${alt}" sizes="(min-width:680px) 600px, 92vw" srcset="${esc(S.small(p.src))} 800w, ${esc(p.src)} 1600w" src="${esc(p.src)}">`;
  return `<figure>${media}${cap ? `<figcaption>${esc(cap)}</figcaption>` : ""}</figure>`;
}
function block(id, tag) {
  const it = T.items[id];
  return `<${tag}>${esc(it[0])}</${tag}>` + (S.PHOTOS[id] || []).slice(0, 3).map(figure).join("") + it[1].map(t => `<p>${esc(t)}</p>`).join("");
}

let html = "", open = false;
for (const i of S.ITEMS) {
  if (i.id === "overview") continue;
  if (i.stop != null) { if (open) html += "</section>\n"; html += `<section><div class="num">${two(i.stop)} / ${two(last)}</div>` + block(i.id, "h2"); open = true; }
  else html += block(i.id, "h3");
}
if (open) html += "</section>\n";

const file = root + "text.html";
let page = fs.readFileSync(file, "utf8");
const put = (name, content) => {
  const re = new RegExp(`<!--build:${name}-->[\\s\\S]*?<!--/build:${name}-->`);
  if (!re.test(page)) throw new Error("marker build:" + name + " not found in text.html");
  page = page.replace(re, `<!--build:${name}-->${content}<!--/build:${name}-->`);
};
put("stops", "\n" + html);
put("credit", esc(S.CREDIT[lang] || ""));
fs.writeFileSync(file, page);
console.log("text.html: " + S.ITEMS.length + " items written");
