import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { apiGet, type Meta } from './api'
import { SESSION_KEY } from './constants/statuses'
import { SignInView } from './features/sign-in/SignInView'
import { MainApp } from './MainApp'

export default function App() {
  const [session, setSession] = useState(
    () => typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SESSION_KEY) === '1',
  )

  const metaQ = useQuery({
    queryKey: ['meta'],
    queryFn: () => apiGet<Meta>('/api/meta'),
  })

  const enterApp = useCallback(() => setSession(true), [])

  const signOut = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY)
    setSession(false)
  }, [])

  if (!session) {
    return (
      <SignInView
        meta={metaQ.data}
        metaLoading={metaQ.isLoading}
        metaError={metaQ.error}
        onEnterApp={enterApp}
      />
    )
  }

  return <MainApp onSignOut={signOut} />
}
