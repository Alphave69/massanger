// Запуск одной кнопкой (его вызывает start.bat): обновление → зависимости → сервер + клиент.
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

const say = (text = '') => console.log(text)
const run = (cmd) => spawnSync(cmd, { shell: true, stdio: 'inherit' }).status

say()
say('  ●  Nuntius')
say()

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 20 || (major === 20 && minor < 19) || (major === 22 && minor < 12)) {
  say(`  ✖ Нужен Node.js 22 или новее, а стоит ${process.versions.node}.`)
  say('    Скачай LTS-версию с https://nodejs.org, установи и запусти start.bat снова.')
  process.exit(1)
}

// 1. Подтягиваем свежую версию с GitHub (если проект скачан через git)
const hasGit = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0
if (existsSync('.git') && hasGit) {
  say('  1/3  Проверяю обновления...')
  if (run('git pull --ff-only') !== 0) say('       Не удалось обновиться — запускаю текущую версию.')
} else {
  say('  1/3  Обновления пропущены (проект скачан не через git).')
}

// 2. Зависимости
say('  2/3  Проверяю зависимости...')
if (run('npm install --no-audit --no-fund --loglevel=error') !== 0) {
  say()
  say('  ✖ Не получилось установить зависимости. Пришли текст ошибки выше.')
  process.exit(1)
}

// 3. Сервер + клиент
say('  3/3  Запускаю. Браузер откроется сам: http://localhost:5173')
say('       НЕ ЗАКРЫВАЙ это окно, пока пользуешься приложением.')
say()
const code = spawnSync(process.execPath, ['scripts/dev.mjs'], { stdio: 'inherit' }).status ?? 0
if (code !== 0) {
  say()
  say('  ✖ Nuntius остановился с ошибкой. Пришли скриншот этого окна.')
}
process.exit(code)
