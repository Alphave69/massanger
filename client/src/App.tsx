import { useCallback, useEffect, useState } from 'react'
import { api, getToken, setToken, type Me } from './lib/api'
import { startGlowTracking } from './lib/fx'
import { AuthPage } from './components/AuthPage'
import { Shell } from './components/Shell'
import { ParticleSphere } from './components/ParticleSphere'
import { MiniSphere } from './components/MiniSphere'

type Phase = 'checking' | 'auth' | 'leaving' | 'app'

export function App() {
  const [phase, setPhase] = useState<Phase>(() => (getToken() ? 'checking' : 'auth'))

  useEffect(() => startGlowTracking(), [])

  useEffect(() => {
    if (phase !== 'checking') return
    api
      .me()
      .then(() => setPhase('app'))
      .catch(() => {
        setToken(null)
        setPhase('auth')
      })
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
  }, [])

  const sphereMode = phase === 'auth' ? 'hero' : 'ambient'

  return (
    <>
      <div className="backdrop" aria-hidden="true" />
      <ParticleSphere mode={sphereMode} className="bg-sphere" />
      {phase === 'checking' && (
        <div className="splash">
          <MiniSphere size={72} dots={140} />
        </div>
      )}
      {(phase === 'auth' || phase === 'leaving') && <AuthPage onAuth={onAuth} leaving={phase === 'leaving'} />}
      {phase === 'app' && <Shell onLogout={logout} />}
    </>
  )
}
