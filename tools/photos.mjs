// МИР ТААЛАЯ: подготовка фото.
// Берёт всё из photos-raw/, кладёт в photos/ два файла на каждое фото:
//   имя.webp      длинная сторона 1600 px
//   имя-800.webp  длинная сторона 800 px
// Метаданные (EXIF, GPS, модель камеры) в готовые файлы не попадают.
// Запуск из корня сайта:   npm install sharp   (один раз)   и   node tools/photos.mjs
import { readdir, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const SRC = 'photos-raw', OUT = 'photos';
const OK = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.tif', '.tiff', '.avif']);

await mkdir(OUT, { recursive: true });
let files;
try { files = (await readdir(SRC)).filter(f => OK.has(path.extname(f).toLowerCase())).sort(); }
catch { console.error(`Нет папки ${SRC}/. Создай её и положи туда исходные фото.`); process.exit(1); }
if (!files.length) { console.error(`В ${SRC}/ нет фото.`); process.exit(1); }

console.log('\nГотово. Вставь нужные строки в PHOTOS в data.js:\n');
for (const f of files) {
  const name = path.basename(f, path.extname(f)).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const input = path.join(SRC, f);
  // .rotate() без аргументов поворачивает по EXIF, после чего sharp метаданные не сохраняет
  const big = await sharp(input).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(OUT, `${name}.webp`));
  await sharp(input).rotate().resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(OUT, `${name}-800.webp`));
  const kb = Math.round((await stat(path.join(OUT, `${name}.webp`))).size / 1024);
  console.log(`  { src: "photos/${name}.webp", w: ${big.width}, h: ${big.height}, date: "", caption: { ru: "", en: "" }, alt: { ru: "", en: "" } },   // ${kb} КБ${kb > 300 ? '  (больше 300 КБ: уменьши quality или обрежь кадр)' : ''}`);
}
console.log('\nПеред публикацией проверь: лица детей и людей без согласия размыты, чужих текстов на фото не видно.\n');
