import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Читаем server/.env (пароль от почты и прочие секреты — только на твоём компьютере, в git не попадает).
 * Свой маленький разборщик вместо process.loadEnvFile: Блокнот в Windows любит BOM и CRLF,
 * а люди — пробелы вокруг «=». Уже заданные переменные окружения не перезаписываем.
 */
const file = resolve(dirname(fileURLToPath(import.meta.url)), '../.env')

if (existsSync(file)) {
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '')
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}
