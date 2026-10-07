import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// Шрифты лежат в проекте — не зависим от Google Fonts (из РФ они бывают недоступны)
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/unbounded/500.css'
import '@fontsource/unbounded/700.css'
import './styles/global.css'
import './styles/auth.css'
import './styles/app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
