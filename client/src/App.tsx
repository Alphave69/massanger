import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, getToken, setToken, type Me } from './lib/api'
import { startGlowTracking } from './lib/fx'
import { isInstalledApp } from './lib/platform'
import { registerServiceWorker } from './lib/install'
import { AuthPage } from './components/AuthPage'
import { Shell } from './components/Shell'
import { ParticleSphere } from './components/ParticleSphere'
import { MiniSphere } from './components/MiniSphere'
import { Landing } from './components/landing/Landing'
import { DownloadPage } from './components/landing/DownloadPage'
import { AuthBack } from './components/landing/AuthBack'
import { goBack, navigate, useRoute } from './components/landing/route'
import { useChat } from './lib/store'

type Phase = 'checking' | 'auth' | 'leaving' | 'app'

/** Приложение для Windows или значок на главном экране телефона: там нет лендинга и кнопок «Скачать» — сразу вход */
const IN_APP = isInstalledApp()

export function App() {
  const rawRoute = useRoute()
  const route = IN_APP ? 'home' : rawRoute
  const [phase, setPhase] = useState<Phase>(() => (getToken() ? 'checking' : 'auth'))
  // Сервер не отвечает (нет сети, перезапуск) — показываем это под сферой и пробуем снова
  const [offline, setOffline] = useState(false)

  useEffect(() => startGlowTracking(), [])
  useEffect(() => registerServiceWorker(), [])

  // В приложении адрес всегда «/»: страниц лендинга и скачивания там нет
  useEffect(() => {
    if (IN_APP && rawRoute !== 'home') navigate('home', true)
  }, [rawRoute])

  // Уже внутри — адрес «/login» больше ни к чему
  useEffect(() => {
    if (phase === 'app' && route === 'login') navigate('home', true)
  }, [phase, route])

  useEffect(() => {
    if (phase !== 'checking') return
    let alive = true
    let timer = 0
    const check = () => {
      api
        .me()
        .then(() => {
          if (alive) setPhase('app')
        })
        .catch((err) => {
          if (!alive) return
          if (err instanceof ApiError && err.status === 401) {
            // вход устарел — заново
            setToken(null)
            setPhase('auth')
            return
          }
          // Нет сети или сервер перезапускается — из аккаунта не выкидываем, просто пробуем ещё раз
          setOffline(true)
          timer = window.setTimeout(check, 4000)
        })
    }
    check()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [phase])

  const onAuth = useCallback((token: string, _user: Me) => {
    setToken(token)
    // Сначала форма растворяется, а сфера укатывается вправо — потом появляется приложение
    setPhase('leaving')
    window.setTimeout(() => setPhase('app'), 650)
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setPhase('auth')
    // на сайте после выхода — сразу форма входа (с неё можно вернуться на главную)
    if (!IN_APP) navigate('login', true)
  }, [])

  const web = !IN_APP
  const download = web && route === 'download'
  // Лендинг — на главной у тех, кто не вошёл
  const landing = web && route === 'home' && phase === 'auth'
  const auth = (phase === 'auth' && !landing && !download) || phase === 'leaving'
  const sphereMode = phase === 'auth' && !download ? 'hero' : 'ambient'

  // Страница скачивания поверх приложения: само приложение прячем, но не закрываем (звонок не прервётся)
  const overApp = download && phase === 'app'
  useEffect(() => {
    document.documentElement.classList.toggle('dl-over-app', overApp)
  }, [overApp])
  // Нажали на уведомление или приняли звонок, пока открыта страница скачивания, — возвращаемся в приложение,
  // иначе чат или звонок открылись бы невидимо за ней
  useEffect(() => {
    if (!overApp) return
    return useChat.subscribe((s, prev) => {
      // первая загрузка данных (открыли сразу /download) тоже задаёт экран — это не переход
      if (s.ready && prev.ready && s.view !== prev.view) goBack('home', true)
    })
  }, [overApp])

  return (
    <>
      <div className="backdrop" aria-hidden="true" />
      <ParticleSphere mode={sphereMode} className={`bg-sphere${landing ? ' bg-sphere--landing' : ''}`} />
      {phase === 'checking' && !download && (
        <div className="splash">
          <div className="splash__inner">
            <MiniSphere size={72} dots={140} />
            {offline && (
              <p className="splash__quote">
                <span>Нет связи с сервером — пробуем снова…</span>
              </p>
            )}
          </div>
        </div>
      )}
      {landing && <Landing />}
      {auth && <AuthPage onAuth={onAuth} leaving={phase === 'leaving'} />}
      {auth && web && <AuthBack hidden={phase === 'leaving'} />}
      {phase === 'app' && <Shell onLogout={logout} />}
      {download && <DownloadPage signedIn={phase === 'app' || phase === 'checking'} />}
    </>
  )
}
