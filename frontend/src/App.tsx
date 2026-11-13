import { useEffect, useState } from 'react'

interface ApiHealth {
  status: string
  service: string
}

function App() {
  const [health, setHealth] = useState<ApiHealth | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function checkApi() {
      try {
        const response = await fetch('/api/health', { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`API request failed (${response.status})`)
        }

        const result: ApiHealth = await response.json()
        setHealth(result)
      } catch (requestError) {
        if (controller.signal.aborted) {
          return
        }

        setError(requestError instanceof Error ? requestError.message : 'Unable to reach the API')
      }
    }

    void checkApi()
    return () => controller.abort()
  }, [])

  return (
    <main className="page">
      <section className="welcome-card" aria-labelledby="welcome-title">
        <div className="brand-mark" aria-hidden="true">CC</div>
        <p className="eyebrow">Your next great puzzle starts here</p>
        <h1 id="welcome-title">CrosswordCreator</h1>
        <p className="intro">
          A fresh space to create, explore, and solve crossword puzzles.
        </p>

        <div className={`api-status${error ? ' api-status--error' : ''}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          {error
            ? `API unavailable: ${error}`
            : health
              ? `API connected — ${health.service} is ${health.status.toLowerCase()}`
              : 'Connecting to the API…'}
        </div>
      </section>
    </main>
  )
}

export default App
