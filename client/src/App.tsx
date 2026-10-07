import { useCallback, useEffect, useState } from 'react'
import { api, getToken, setToken, type User } from './lib/api'
import { AuthPage } from './components/AuthPage'
import { AppShell } from './components/AppShell'
import { Logo } from './components/Logo'

export function App() {
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(() => getToken() !== null)

  useEffect(() => {
    if (!checking) return
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => setToken(null))
      .finally(() => setChecking(false))
  }, [checking])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  if (checking) {
    return (
      <div className="splash">
        <Logo size={56} spinning />
      </div>
    )
  }

  if (!user) {
    return (
      <AuthPage
        onAuth={(token, user) => {
          setToken(token)
          setUser(user)
        }}
      />
    )
  }

  return (
    <AppShell
      user={user}
      onLogout={logout}
    />
  )
}
