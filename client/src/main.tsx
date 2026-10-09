import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './lib/settings' // применяет сохранённые настройки до первой отрисовки
import { App } from './App'
// Шрифты лежат в проекте — не зависим от Google Fonts (из РФ они бывают недоступны)
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/unbounded/500.css'
import '@fontsource/unbounded/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './styles/global.css'
import './styles/auth.css'
import './styles/app.css'
import './styles/settings.css'
import './styles/voice.css'
import './styles/roles.css'
import './styles/badges.css'
import './styles/admin.css'
import './styles/eggs.css'
import './styles/landing.css'
import './styles/messages.css'
// последним: правки для телефона перекрывают остальное
import './styles/mobile.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
