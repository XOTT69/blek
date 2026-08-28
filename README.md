# Поруч

Mobile-first PWA для швидких анонімних повідомлень про світло, воду й зв’язок у районі, а також для пошуку відкритих точок поруч. Без Supabase вона працює з демоданими; з Supabase — з live-даними та Realtime.

## Запуск

Це статичний проєкт без залежностей. Для PWA-функцій відкрийте його через локальний сервер:

```sh
python3 -m http.server 8080
```

Потім відкрийте `http://localhost:8080`. Локально застосунок працює в деморежимі, а зміни зберігаються лише в `localStorage` браузера.

## Підключення Supabase

1. Створіть Supabase-проєкт у регіоні ЄС.
2. Увімкніть **Anonymous sign-ins**: Authentication → Providers → Anonymous.
3. Відкрийте SQL Editor, вставте та виконайте [supabase/schema.sql](./supabase/schema.sql).
4. Скопіюйте Project URL та publishable (або legacy anon) key з Settings → API.

## Деплой на Vercel

1. Імпортуйте GitHub-репозиторій у Vercel.
2. Додайте `SUPABASE_URL` і `SUPABASE_ANON_KEY` з [.env.example](./.env.example) до Environment Variables для Production, Preview та Development.
3. Натисніть Deploy. Vercel автоматично віддасть статичний PWA та `/api/config`.

Ніколи не додавайте `SUPABASE_SERVICE_ROLE_KEY` у Vercel або браузер. RLS-політики в схемі дозволяють користувачам лише створювати власні анонімні повідомлення.
