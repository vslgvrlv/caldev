---
type: reference
project: Paintball TeamHub
project_id: PBTH
status: active
owner: Vasiliy
created: 2026-03-22
updated: 2026-03-22
tags: [brand, design, icons, pwa, capacitor, native]
summary: Снимок brand-страницы PBTH: основные цвета, логотип и практический способ забирать SVG и иконки для PWA и native packs
confidentiality: private
source: agent
source_url: https://ais-dev-7g3gds5mwb2h2r2mxxn2rb-38519418499.europe-west3.run.app/brand
---

# Brand Identity

## Источник
- Снимок снят 2026-03-22 (MSK) с `brand`-страницы PBTH через авторизованную браузерную сессию.
- Практически это значит, что для повторного доступа к тем же данным нужен Google-authenticated браузер.

## Основная палитра

| Token | Hex | Назначение |
| --- | --- | --- |
| Neon Strike | `#00E676` | Primary actions, highlights |
| Tactical Blue | `#24A1DE` | Accents, Telegram integration |
| Deep Void | `#0F0F0F` | Main background |
| Steel Surface | `#1E1E2E` | Cards, modals, surfaces |

## Дополнительные theme tokens

Ниже не отдельные карточки брендбука, а цвета, которые дополнительно зашиты во встроенный theme config страницы:

- `#39FF14` — secondary accent
- `#FFFFFF` — main text
- `#A0A0B0` — subtext
- `#FF6D00` — warning
- `#FFEA00` — highlight
- `#FF1744` — danger

## Типографика
- Primary: `Inter`
- Secondary: `JetBrains Mono`

## Что уже есть на странице
- Отдельная CTA-кнопка: `Скачать логотип (SVG)`.
- Основная логомарка `The Hub Concept`:
  - скругленный квадрат с градиентом `#00E676 -> #24A1DE`
  - белый контурный шестиугольник в центре
- Вторая логомарка `Grid/Team Management`:
  - черный скругленный квадрат
  - неоново-зеленая сетка `2x2` внутри
- Несколько готовых inline SVG-мотивов для визуального языка: glow/lightning, grid, target.
- Служебные UI-иконки на странице рендерятся как inline SVG; часть из них явно идет из `lucide-react`.

## Как забирать готовые иконки

### Вариант 1. Канонический путь для app icon pack
1. Открыть `brand`-страницу в браузере с активной авторизацией.
2. Нажать `Скачать логотип (SVG)`.
3. Использовать скачанный SVG как source of truth для всех app-icon export'ов.

Рекомендуемый набор файлов для PBTH:
- `public/icons/icon-192.png`
- `public/icons/icon-512.png`
- `public/icons/icon-maskable-192.png`
- `public/icons/icon-maskable-512.png`
- `public/icons/apple-touch-icon.png`
- `assets/app-icon-1024.png` для App Store / Play Console master asset

Рекомендация по использованию:
- `The Hub Concept` использовать как primary app icon / основной бренд-знак.
- `Grid/Team Management` использовать как secondary mark для админки, внутренних инструментов, management-mode экранов или альтернативных product surfaces.

### Вариант 2. Забрать любой inline SVG прямо со страницы
1. Открыть DevTools.
2. Выбрать нужную карточку или иконку.
3. Найти нужный узел `<svg>`.
4. Сделать `Copy -> Copy outerHTML`.
5. Сохранить содержимое как отдельный `.svg`.

Это подходит для:
- hero icon variations;
- motif icons из раздела visual elements;
- отдельных utility icons, если нужен exact same SVG, а не библиотечный эквивалент.

### Вариант 3. Не скрапить generic UI icons, а брать их из библиотеки
Если нужен не уникальный PBTH-логотип, а обычная UI-иконка, лучше не вынимать ее из DOM вручную, а импортировать соответствующую иконку из `lucide-react`. На brand-странице эта библиотека уже используется, поэтому так проще поддерживать единый стиль без копипаста SVG.

## Практика экспорта для PWA / native

Базовые рекомендации:
- фон app icon: `#0F0F0F`
- основной акцент: `#00E676`
- secondary accent / campaign gradient: `#00E676 -> #24A1DE`

Пример экспорта из канонического `logo.svg`:

```bash
magick logo.svg -background '#0F0F0F' -resize 192x192 public/icons/icon-192.png
magick logo.svg -background '#0F0F0F' -resize 512x512 public/icons/icon-512.png
magick logo.svg -background '#0F0F0F' -gravity center -extent 192x192 public/icons/icon-maskable-192.png
magick logo.svg -background '#0F0F0F' -gravity center -extent 512x512 public/icons/icon-maskable-512.png
cp public/icons/icon-192.png public/icons/apple-touch-icon.png
```

## Важное ограничение
- Явно downloadable asset на странице — это логотип `SVG`.
- Остальные иконки на странице уже присутствуют как inline SVG, но не выглядят как отдельный downloadable icon pack.
- Поэтому для production-friendly процесса лучше считать `SVG logo -> generate icon pack` основным путем, а DOM extraction использовать для дополнительных icon variations.
