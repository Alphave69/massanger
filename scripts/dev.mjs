// Запускает сервер и клиент одновременно (замена пакету concurrently).
import { spawn, spawnSync } from 'node:child_process'

const isWin = process.platform === 'win32'

// На Linux/macOS каждый запускается в своей группе процессов, чтобы потом остановить её целиком
const procs = ['server', 'client'].map((name) =>
  spawn(`npm run dev -w ${name}`, { shell: true, stdio: 'inherit', detached: !isWin }),
)

let stopping = false
function stopAll(code = 0) {
  if (stopping) return
  stopping = true
  for (const p of procs) {
    try {
      if (isWin) spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' })
      else process.kill(-p.pid, 'SIGTERM')
    } catch {
      // процесс уже завершился
    }
  }
  process.exit(code)
}

for (const p of procs) p.on('exit', (code) => stopAll(code ?? 0))
process.on('SIGINT', () => stopAll(0))
process.on('SIGTERM', () => stopAll(0))
