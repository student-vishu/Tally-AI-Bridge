import { useState } from 'react'

export default function AISearch({ sections, componentMap }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)   // null = not searched yet
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSearch = async () => {
    if (!query.trim()) return
    setLoading(true)
    setResults(null)
    setError('')

    try {
      // Step 1: Ask AI which sections match the query
      const aiRes = await fetch('/api/ai/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          sections: sections.map(s => ({ id: s.id, description: s.description }))
        })
      })
      const aiJson = await aiRes.json()
      if (!aiJson.success) throw new Error('AI error')

      const matchedIds = aiJson.data.sections
      if (!matchedIds.length) {
        setResults([])
        return
      }

      // Step 2: Fetch data for each matched section in parallel
      const matched = matchedIds
        .map(id => sections.find(s => s.id === id))
        .filter(Boolean)

      const fetched = await Promise.all(
        matched.map(async (section) => {
          const res = await fetch(section.endpoint)
          const json = await res.json()
          return { section, data: json.success ? json.data : null }
        })
      )
      setResults(fetched)
    } catch {
      setError('Could not get a response. Please check the backend and try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch()
  }


  return (
    <>
      <div className="ai-hero">
        <div className="ai-hero-inner">
          <div className="ai-hero-icon">✨</div>
          <h2 className="ai-hero-title">What would you like to explore?</h2>
          <p className="ai-hero-subtitle">Ask in plain English — AI will find the right data for you</p>

          <div className="ai-hero-bar">
            <input
              className="ai-hero-input"
              type="text"
              placeholder='e.g. "show cash flow" or "project expenses"'
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button
              className="ai-hero-btn"
              onClick={handleSearch}
              disabled={loading || !query.trim()}
            >
              {loading ? '…' : 'Ask'}
            </button>
          </div>

          {error && (
            <div className="ai-answer-error">
              <p>{error}</p>
            </div>
          )}

          {results !== null && results.length === 0 && !error && (
            <div className="ai-no-result">
              <p>No matching data found for your query.</p>
            </div>
          )}
        </div>
      </div>

      {results && results.length > 0 && (
        <div className="ai-results">
          {results.map(({ section, data }) => {
            const Component = componentMap[section.id]
            if (!Component || !data) return null
            return (
              <div key={section.id} className="ai-result-section">
                <h2 className="ai-result-heading">{section.label}</h2>
                <Component data={data} />
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
