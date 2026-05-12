# Security Rules

Источник: [Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) · [Developer Policies](https://docs.obsidian.md/Developer+policies)

## Модель разрешений

- Плагины наследуют **полный доступ** хост-приложения (файловая система, сеть, запуск программ).
- Granular permissions отсутствуют — техническое ограничение Obsidian.
- Restricted Mode: установленные плагины игнорируются при выполнении.

## Требования

- Код без известных уязвимостей — проверяется автоматически при каждом Release.
- Malware-сканирование при каждом обновлении.
- Соответствие [Developer Policies](https://docs.obsidian.md/Developer+policies).

## Автоматическое ревью

- Сканирование при первичной публикации **и** при каждом обновлении.
- Провал ревью → плагин убирают из поиска в течение 24 часов.
- Разработчик и пользователи видят scorecard проверок.

## Закрытый код

- Obsidian **не принимает** новые closed-source плагины в Community Directory.
- Существующие closed-source плагины продолжают работать до отдельного уведомления.
