---
wiki_sources: [docs/superpowers/plans/2026-04-28-obsidian-review-fixes.md]
wiki_updated: 2026-05-05
wiki_status: stub
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [community-plugin-fixes, review-fixes]
---
# ObsidianReviewBot Required Fixes

Набор механических исправлений, необходимых для прохождения проверки Obsidian Community Plugin Store.

## Основные характеристики

- **Regex escape**: специальные символы в регулярных выражениях экранируются корректно
- **Union type simplification**: избыточные union-типы упрощаются
- **Async removal**: `async` убирается с методов, не использующих `await`
- **CSS class вместо style.display**: `el.style.display = "none"` → CSS-класс `llm-wiki-hidden`
- **i18n → English**: пользовательские строки переводятся на английский (требование Community Plugin Store)
- **console.debug**: отладочные `console.log` заменяются на `console.debug`
- **void для unhandled promises**: `Promise` без обработки оборачиваются в `void`

## Изменения CSS

```css
.llm-wiki-hidden { display: none !important; }
```

Класс добавляется в `styles.css` и используется вместо прямого управления `style.display`.
