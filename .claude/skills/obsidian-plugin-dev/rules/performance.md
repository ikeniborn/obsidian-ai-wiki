# Performance Rules

Источники: [Framework Integration](https://deepwiki.com/obsidianmd/obsidian-developer-docs/2.5-releasing-and-publishing-your-plugin) · [Plugin Performance Discussion](https://forum.obsidian.md/t/call-for-plugin-performance-optimization-especially-for-plugin-startup/32321)

## Startup

- Startup-время видимо пользователям: Settings → Community Plugins.
- Тяжёлая инициализация — лениво, только по требованию.

## Выбор UI-фреймворка

| Фреймворк | Вес | Когда использовать |
|-----------|-----|-------------------|
| Vanilla HTML/CSS | ~0 | Простые интерфейсы |
| Svelte | ~10 KB | Performance-critical UI, компилируется в vanilla JS |
| React | 40+ KB | Сложное состояние с множеством обновлений |

Предпочтительный порядок: Vanilla → Svelte → React.

## Размер бандла

Официальных лимитов нет. Практическое правило — минимально необходимое; не включать тяжёлые зависимости без причины.
