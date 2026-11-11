# vendor/ui-kit

Закреплённая копия ui-kit (vslgvrlv/ui-kit), по одному каталогу на версию. Руками не правится.

## 0.43.0 — копия из ветки до выпуска

Тема `pbth` выходит в 0.43.0 (vslgvrlv/ui-kit#76), на момент копирования запрос не вмёржен и тега `v0.43.0` нет. Копия снята командой `bun scripts/sync.js 0.43.0 <pbth> --theme pbth` из рабочей копии ветки `theme-pbth` (коммит `8bf3e31`). Файлы `dist/` совпадают с веткой побайтно, `guard.js` — с `scripts/guard.js` ветки.

После выпуска версии пересинхронизировать из чекаута тега:

```
bun scripts/sync.js 0.43.0 <путь>/pbth --theme pbth
```

и убедиться, что `git diff` по `pbth/vendor/ui-kit/0.43.0` пуст или содержит только правки выпуска.

## Подключение

`pbth/index.tsx` импортирует `ui-kit.css`, `themes/pbth-fonts.css` и `themes/pbth.css`. JS и спрайт значков берёт `pbth/ui/uikit.ts`; версия указана только там и в `index.tsx`.
