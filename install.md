# Сборка Paseo под macOS на этой машине

Персональный runbook для локальной сборки десктопного приложения. Машинно-специфичный —
в upstream не отправлять, в `docs/` не переносить. Только то, что нужно, чтобы собрать с первого
раза именно здесь.

Канонические знания проекта о smoke-харнессе упакованного приложения — в
[docs/testing.md](docs/testing.md) («Packaged desktop app smoke»). Здесь — локальные дополнения
к нему, а не замена.

## Одна команда

```bash
cd /Users/max/Dev/paseo
CSC_IDENTITY_AUTO_DISCOVERY=false \
  npm run build:desktop -- --publish never --mac --arm64 -c.mac.hardenedRuntime=false
```

Оба оверрайда обязательны — без них сборка формально пройдёт, но приложение **не запустится**.
Почему именно так — в разделе «Почему нужны оверрайды».

Команда прогнана на этой машине целиком 2026-08-06 на `0.3.0-beta.2`: сборка завершилась с кодом
`0`, smoke-тест прошёл, размеры и вывод проверок ниже — фактические, а не ожидаемые.

Результат в `packages/desktop/release/`:

| Файл                        | Размер  |
| --------------------------- | ------- |
| `Paseo-<version>-arm64.dmg` | ~141 МБ |
| `Paseo-<version>-arm64.zip` | ~136 МБ |
| `mac-arm64/Paseo.app`       | ~405 МБ |

## Сколько ждать

Долгие паузы без вывода — норма, не считать зависанием и не перезапускать:

| Стадия                                           | Время                    | Как выглядит                             |
| ------------------------------------------------ | ------------------------ | ---------------------------------------- |
| `build:app-deps:clean` + expo export             | ~4 мин                   | заканчивается строкой `Exported: dist`   |
| `build:server:clean`                             | ~2 мин                   | сборка protocol → client → server → cli  |
| electron-builder packaging                       | ~1 мин                   | `• packaging platform=darwin arch=arm64` |
| **`• signing file=release/mac-arm64/Paseo.app`** | **~4 мин полной тишины** | `codesign` обходит ~10 тыс. файлов       |
| zip + dmg + blockmap                             | ~1.5 мин                 | `• building target=DMG`                  |
| **Итого**                                        | **~11–12 мин**           |                                          |

Только перепаковка (когда TS и Expo-бандл уже собраны) — ~4–5 мин:

```bash
cd packages/desktop && rm -rf release && \
  CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --config electron-builder.yml \
  --publish never -c.mac.hardenedRuntime=false
```

Запускать в фоне с логом в файл, иначе упрётесь в таймаут инструмента:

```bash
... > /tmp/paseo-mac-build.log 2>&1
```

## Проверка, что приложение реально работает

Штатный smoke-гейт проекта — тот же, что гоняет CI; описан в
[docs/testing.md](docs/testing.md). **Обязателен**: проверка подписи его не заменяет (см. ниже).
Локальный рецепт в testing.md дан для Linux (`--dir`), поэтому macOS-вариант ниже.

```bash
NO_PROXY="127.0.0.1,localhost,::1" no_proxy="127.0.0.1,localhost,::1" \
  PASEO_DESKTOP_SMOKE_ARTIFACT_DIR=/tmp/paseo-smoke-artifacts \
  node packages/desktop/e2e/packaged-app-smoke.js \
    --app packages/desktop/release/mac-arm64/Paseo.app
```

`NO_PROXY` здесь **не опционален** — см. «Ловушка 3».

Занимает ~50 секунд. Успех выглядит так:

```
Packaged desktop smoke: cold-starting daemon through bundled CLI shim
Packaged desktop smoke: launching .../Paseo.app/Contents/MacOS/Paseo
Packaged desktop smoke: real app renderer and preload bridge loaded
Packaged desktop smoke: renderer-started desktop daemon reported running
Packaged desktop smoke: running bundled CLI shim daemon status
Packaged desktop smoke: creating terminal through bundled CLI shim
Packaged desktop smoke: terminal hook command completed
Packaged desktop smoke passed: ...
```

Тест работает в одноразовых `PASEO_HOME` на случайных портах — демон на `6767` не трогает.
При падении в `/tmp/paseo-smoke-artifacts` появятся `failure.txt`, `daemon.log`, скриншот рендерера;
при успехе директории не будет вовсе.

Если тест оборвался, убрать хвосты перед повторным запуском:

```bash
pkill -9 -f "paseo/packages/desktop/release"
```

## Проверки безопасности и ожидаемый результат

```bash
cd packages/desktop/release/mac-arm64
codesign -dv --verbose=2 Paseo.app          # flags=0x2(adhoc), Signature=adhoc
codesign --verify --deep --strict Paseo.app # exit 0, ~2 мин
codesign -d --entitlements :- Paseo.app     # allow-jit, allow-unsigned-executable-memory, audio-input
spctl -a -vvv -t exec Paseo.app             # rejected — ЭТО НОРМА
```

`spctl` **всегда** отдаёт `rejected` на этой машине: нет сертификата Apple Developer ID, значит нет
и нотаризации. Запуску это не мешает — самостоятельно собранные артефакты не получают атрибут
`com.apple.quarantine`, поэтому Gatekeeper их не гейтит. Ожидать `accepted` здесь бессмысленно.

## Почему нужны оверрайды

### Ловушка 1 — `CSC_IDENTITY_AUTO_DISCOVERY=false`

В keychain лежит `MyDictate Self-Signed` от постороннего проекта. Автопоиск идентичности у
electron-builder не ограничен Paseo, поэтому он молча подписывает `Paseo.app` этим сертификатом:

```
• signing  identityName=MyDictate Self-Signed identityHash=B79B03BE...
```

Правильная строка при верной сборке:

```
• falling back to ad-hoc signature for macOS application code signing
• signing  identityName=- identityHash=none
```

### Ловушка 2 — `-c.mac.hardenedRuntime=false`

`hardenedRuntime: true` в `electron-builder.yml` включает library validation, которая требует
одинакового Team ID у главного бинарника и всех вложенных Mach-O. У ad-hoc и самоподписанных
сертификатов Team ID нет вообще, поэтому `dyld` отказывается грузить фреймворк, и падают все
процессы — приложение, хелперы и CLI-шим:

```
dyld: Library not loaded: @rpath/Electron Framework.framework/Electron Framework
  Reason: ... not valid for use in process: mapping process and mapped file
          (non-platform) have different Team IDs
```

**Проверка подписи это не ловит.** `codesign --verify --deep --strict` спокойно рапортует
`valid on disk` и `satisfies its Designated Requirement` на бандле, который умирает при старте.
Ловит только smoke-тест или ручной запуск.

Не «чинить» это добавлением `com.apple.security.cs.disable-library-validation` в
`packages/desktop/build/entitlements.mac.plist`: это ослабит поставляемое приложение ради обхода
ограничения сборочной машины. В CI проблемы нет — Developer ID даёт всем бинарникам общий Team ID.

### Ловушка 3 — `NO_PROXY` для smoke-теста

В окружении задан `HTTP_PROXY=http://localhost:8080` (и `HTTPS_PROXY`). С 2026-08-06 `NO_PROXY`
в окружении уже выставлен, так что ловушка сама по себе не срабатывает — но передавать его явно
всё равно стоит, окружение может смениться. Если `NO_PROXY` пропадёт, Playwright учтёт заглавные
переменные и погонит CDP-запрос через прокси, который отвечает `400`:

```
browserType.connectOverCDP: Unexpected status 400 when connecting to
http://127.0.0.1:PORT/json/version/
```

Запрос до Electron не доходит вообще. Диагностику маскирует `curl`: он игнорирует заглавный
`HTTP_PROXY`, поэтому ручная проверка эндпоинта отдаёт `200` и приложение выглядит здоровым,
пока харнесс продолжает падать. Не идти по ложному следу «сломан DevTools» — просто выставить
`NO_PROXY`.

## Состояние машины (проверено 2026-08-06)

|                        |                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------- |
| macOS                  | 26.5.1 (build 25F80), arm64                                                     |
| Node / npm             | v25.9.0 / 11.12.1                                                               |
| Xcode                  | не установлен, только Command Line Tools — сборке достаточно                    |
| Apple Developer ID     | **отсутствует**                                                                 |
| Сертификаты в keychain | только `MyDictate Self-Signed` (посторонний)                                    |
| Прокси                 | `HTTP_PROXY` / `HTTPS_PROXY` = `http://localhost:8080`, `NO_PROXY` теперь задан |

Собирается только `arm64` — это хост-архитектура. Для `x64` нужен Intel-раннер, как в
`.github/workflows/desktop-release.yml`.

## Если появится Apple Developer ID

Оба оверрайда становятся не нужны, команда сокращается до `npm run build:desktop -- --mac --arm64`,
а `spctl` начнёт отдавать `accepted` (после нотаризации, одной подписи мало). Нужны переменные
окружения `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
— их раскладку по секретам GitHub смотреть в `.github/workflows/desktop-release.yml:150-167`.

## Чего не делать

- Не запускать `npm run test` целиком и не гонять полный набор тестов — машина зависнет.
- Не перезапускать демон на порту `6767` — он ведёт все живые агенты.
- Не считать таймаут поводом для перезапуска: стадия `signing` молчит несколько минут штатно.
