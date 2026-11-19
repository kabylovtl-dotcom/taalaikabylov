# Мир Таалая

Сайт из обычных файлов, без сборщика. `index.html` это 3D-мир, `text.html` это быстрая текстовая версия. Обе страницы берут тексты и фото из одного файла `data.js`.

```
index.html          3D-мир
text.html           текстовая версия
data.js             ТЕКСТЫ, ФОТО, ВСТУПЛЕНИЕ: правишь только его
js/                 код мира (world.js), интерфейса (ui.js), рельефа (terrain.js + воркер)
vendor/             three.js r160 и нужные аддоны, лежат локально
photos/             готовые фото (webp)
photos-raw/         исходники фото, в git не попадают
tools/photos.mjs    скрипт, который готовит фото
og.jpg              превью для мессенджеров, 1200x630
favicon.svg
```

## 1. Открыть у себя

Двойным щелчком не откроется (браузер не пускает модули и воркер с диска). Нужен простой сервер. В папке сайта:

```
python3 -m http.server 8000
```

Потом открой `http://localhost:8000/`. Сайт только на английском.

## 2. Фото

### Сначала приватность

- Скрипт ниже убирает из фото EXIF: GPS, дату, модель телефона. Клади в `photos/` только то, что прошло через скрипт.
- Лица детей (школьники в юрте, ученики) и всех, кто не давал согласия, размой **до** скрипта, в любом редакторе. Код этого не делает.
- На фото не должно быть читаемых чужих эссе, переписок, документов.
- Папка `photos-raw/` записана в `.gitignore`, исходники на GitHub не уйдут.

### Самый простой способ

1. Положи фото в папку `photos/` (jpg, png или webp). Имя латиницей: `fusor-1.jpg`.
2. Открой `data.js`, найди `PHOTOS` и впиши имя файла в кавычках рядом с нужным предметом:

```js
fusor: ["photos/fusor-1.jpg"],
yurt:  ["photos/yurt-1.jpg", "photos/yurt-2.jpg"],
```

Фото можно дать любому предмету, до 3 штук. Короткий ролик тоже можно: `photos/x.mp4` играет в панели без звука по кругу, рядом нужен его кадр `photos/x.jpg` (в мире висит он). Первое фото ещё и стоит маленьким отпечатком в самом мире, рядом с предметом. Чтобы увидеть все места под фото, открой `http://localhost:8000/?edit=1`: в панелях появятся пунктирные рамки, а в мире пустые карточки.

Так EXIF из фото не убирается. Если на снимке могут быть GPS или дата, прогони его через скрипт ниже.

### Со скриптом (убирает EXIF и делает лёгкую копию для телефона)

1. Поставь Node.js (nodejs.org, версия LTS). Один раз в папке сайта: `npm install sharp`
2. Положи исходники в `photos-raw/` и запусти: `node tools/photos.mjs`
3. Скрипт положит в `photos/` по два файла на фото (`fusor-1.webp` и `fusor-1-800.webp`) и напечатает готовые строки для `data.js`.

Подпись и описание пишутся в полной записи:

```js
fusor: [
  { src: "photos/fusor-1.webp", date: "2025",
    caption: { ru: "", en: "" }, alt: { ru: "", en: "" } }
],
```

`alt` лучше заполнить: одно предложение о том, что на снимке.

## 3. Вступление и подпись

В `data.js`:
- `INTRO.en` и `INTRO.ru`: 2-3 предложения от первого лица на первом экране. Сейчас пусто, и строки на экране нет. Пишешь сам.
- `CREDIT`: строка внизу первого экрана о том, как сделан сайт.

## 4. Выложить на GitHub Pages

1. Зайди на github.com, нажми **New repository**. Имя, например, `workshop`. Public. Create.
2. На странице репозитория: **uploading an existing file**. Перетащи туда всё содержимое этой папки (кроме `photos-raw` и `node_modules`). Commit changes.
3. **Settings → Pages**. Source: **Deploy from a branch**. Branch: `main`, папка `/ (root)`. Save.
4. Через минуту-две там же появится адрес вида `https://ТВОЙ-ЛОГИН.github.io/workshop/`.
5. Ссылка для приёмной комиссии: `https://ТВОЙ-ЛОГИН.github.io/workshop/`

В папке лежит пустой файл `.nojekyll`: он нужен, чтобы GitHub отдал файлы как есть.

Превью в мессенджерах (`og.jpg`) заработает лучше, если в `index.html` и `text.html` заменить `content="og.jpg"` на полный адрес: `content="https://ТВОЙ-ЛОГИН.github.io/workshop/og.jpg"`. Часть мессенджеров относительный путь не понимает.

## 5. Параметры в адресе

| Параметр | Что делает |
|---|---|
| `?q=low` / `med` / `high` | уровень качества вручную |
| `?debug=1` | счётчик в углу: fps, время кадра, draw calls, треугольники, pixelRatio, уровень |
| `?debug=1&cold=1` | то же, но шейдеры собираются заново, как при первом заходе |
| `?edit=1` | пустые рамки там, где ждут фото |
| `?shot=1` | рендерит обзорный кадр 1200x630 без интерфейса и скачивает `og.png` |

Текущий `og.jpg` я снял этим режимом. Захочешь другой кадр: `?shot=1`, потом пересохрани PNG как `og.jpg`.

## 6. Замеры: загрузка и плавность

Мерил на твоём Mac (видеокарта Intel UHD 630), Chrome, окно 1280x800. «Первый заход» значит без кэша шейдеров в браузере, как у человека, который открыл ссылку впервые. Повторить: `?debug=1&cold=1`.

| | было (v2) | стало (v3) |
|---|---|---|
| Первый кадр, первый заход | 4,6 с | 1,3 с |
| Весь мир построен, первый заход | 8,3 с | 1,3 с |
| Первый кадр, повторный заход | 0,9 с | 0,9 с |
| Освещённых шейдеров | около 15, собирались по очереди | 4, собираются одновременно |
| Время кадра, обзор, 1600x1000 | 14 мс | 14-15 мс (60 fps) |

Почему было долго: видеокарта при первом заходе собирает каждый шейдер примерно полсекунды. Их было около 15, они шли по очереди, а на компьютере при первом кадре собирался ещё и второй комплект. Теперь шейдеров четыре, сборка стартует в самом начале и идёт, пока код строит мир. Текстуры дерева, снега и ткани считаются в фоновых потоках, а не на видеокарте.

**Не проверено:** настоящий телефон и Safari. Телефонный режим в Chrome (375x812) даёт 1,4 с и 60 fps, но это тот же Mac. Проверь сам: открой `?debug=1`, покрути сцену и посмотри на fps и `pr`.

Что ещё изменилось в картинке ради скорости:
- Тени считаются более простым фильтром (PCF вместо PCFSoft), на вид почти так же.
- Вместо четырёх ламп гирлянды один источник; края настила чуть темнее.
- У фузора нет своего источника света, осталось свечение. В ТЗ он включался ближе 4 м, но смена числа источников заставляет видеокарту пересобирать шейдеры, а это рывок.
- Свет из двери юрты и у указателя на дороге в Хановер запечён в снег.
- AO включается через 0,3 с после остановки камеры.
- На уровне `low` на десктопе нет сглаживания.
- Панель с фото на телефоне занимает до 58% экрана, а не 40%: иначе на текст оставалось две строки.

## 7. Английский: что я поменял, проверь

Факты и цифры те же. Слева было, справа стало.

| Где | Было | Стало |
|---|---|---|
| Обзор | Turn the scene, zoom in, tap any object. Or go in order with Next. | Drag to look around, zoom in, tap any object. Or walk through in order with Next. |
| Стол | Everything on this slope lay here at some point. | Everything on this slope has been on this table at some point. |
| Фузор | …for about 100 dollars. The transformer comes from a broken microwave. | …for about $100. The transformer came out of a broken microwave. |
| Двигатель | Age 15, 9th grade, the school Science Week. Combustion chamber from an oil filter can, compressor from a fan, propane for fuel. | Age 15, ninth grade, the school's Science Week. An oil filter can for a combustion chamber, a fan for a compressor, propane for fuel. |
| Ящик | At Science Week he helped other teams. | At Science Week he helped the other teams. |
| A-Levels | No lessons, on his own. | Self-taught, without a single lesson. |
| Верстак | One of his recommendation letters for Dartmouth was written… | One of his Dartmouth recommendation letters was written… |
| Угол, заголовок | Pay what I helped | Pay what my help was worth |
| Угол | The price is named by the person who was helped. Right now he is guiding a 9th grader… | The person he helped names the price. Right now he is mentoring a ninth grader… |
| Плед | From childhood, with little bears. About how small things need care too. | From his childhood, with little bears on it. It is about small things deserving care too. |
| Юрта | …in place of expensive equipment. 523 students, grades went up for 43% of them. 10th place out of 400… | …instead of expensive equipment. 523 students, and 43% of them improved their grades. 10th out of 400… |
| Круг | four sides. More than 60 beginners he trained… Six MUNs in the chair, the first MUN at his school. | four teams. He trained more than 60 beginners… He chaired six MUN conferences and started the first one at his school. |
| WASYS | …you can see what people are sick with and what they use. …There is no lab in Kyrgyzstan for the analysis. He is looking. | …they show what people are sick with and what they are using. …No lab in Kyrgyzstan can run the analysis. He is still looking. |
| Shumkar | An app: where each skier is… An SOS button. On skis since the age of five. First milk tea and kurut… | An app that shows where every skier is… It has an SOS button. He has skied since he was five. Milk tea and kurut first… |
| Санки | Green Generation, co-founder. | Co-founder of Green Generation. |
| Страница | Two books begun | Two books started |
| Развилка | (старый текст) | текст из ТЗ, дословно |
| Кнопка | To the start | Back to start |

Два места, где перевод чуть отходит от русского, реши сам:
- «Круг»: в русском «четыре стороны», в английском «four teams». Так в формате это и называется.
- «WASYS»: «Он ищет» стало «He is still looking».

На банке в мире надпись осталась по-русски («плати, сколько я помог»), как и «лаборатория: ____» на бирке. Это предметы, а не интерфейс.

## 8. Чего на сайте нет

Аналитики, трекеров и cookies нет. Шрифты грузятся с Google Fonts; если хочешь совсем без внешних запросов, скажи, положу их рядом.
