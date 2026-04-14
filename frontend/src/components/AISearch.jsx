import { useState, useEffect, useRef } from 'react'

const FMT = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (amount) => '₹' + FMT.format(amount);

// Returns { dr, cr } labels based on the ledger's direct parent group.
// Uses exact match first, then substring fallback for custom sub-groups.
function getGroupLabels(parent) {
  const p = (parent || '').toLowerCase().trim()

  if (['bank accounts', 'cash-in-hand', 'bank od a/c'].includes(p))
    return { dr: '⬆️ Money IN',         cr: '⬇️ Money OUT' }

  if (p === 'sales accounts')
    return { dr: '↩️ Sales Return',      cr: '⬆️ Sales Earned' }

  if (p === 'direct income' || p === 'indirect income' || p.includes('income'))
    return { dr: '↩️ Income Reduced',    cr: '⬆️ Income Earned' }

  if (p === 'purchase accounts')
    return { dr: '⬇️ Purchase Made',     cr: '↩️ Purchase Return' }

  if (p === 'direct expenses' || p === 'indirect expenses' || p.includes('expense'))
    return { dr: '⬇️ Expense Incurred',  cr: '↩️ Expense Reduced' }

  if (p === 'sundry debtors' || p.includes('debtor') || p.includes('receivable'))
    return { dr: '📋 Invoice Raised',    cr: '⬆️ Payment Received' }

  if (p === 'sundry creditors' || p.includes('creditor') || p.includes('payable'))
    return { dr: '⬇️ Payment Made',      cr: '📋 Bill Received' }

  if (p === 'secured loans' || p === 'unsecured loans' || p === 'loans (liability)' || p.includes('loan'))
    return { dr: '⬇️ Loan Repaid',       cr: '⬆️ Loan Received' }

  if (p === 'capital account' || p === 'reserves & surplus' || p.includes('capital'))
    return { dr: '↩️ Capital Withdrawn', cr: '⬆️ Capital Invested' }

  if (p === 'fixed assets' || p.includes('fixed asset'))
    return { dr: '⬇️ Asset Purchased',   cr: '↩️ Asset Sold' }

  if (p === 'duties & taxes' || p.includes('tax') || p.includes('duties'))
    return { dr: '⬇️ Tax Paid',          cr: '⬆️ Tax Payable' }

  if (p.includes('asset') || p.includes('deposit') || p.includes('investment'))
    return { dr: '⬆️ Asset Increased',   cr: '⬇️ Asset Reduced' }

  if (p.includes('liabilit') || p.includes('provision'))
    return { dr: '⬇️ Liability Reduced', cr: '⬆️ Liability Increased' }

  return { dr: 'Dr', cr: 'Cr' }
}

function LedgerCard({ ledger, queryParams }) {
  const [detail, setDetail]     = useState(null)  // null = not fetched, false = failed, object = ok
  const [fetching, setFetching] = useState(false)
  const labels = getGroupLabels(ledger.parent)

  useEffect(() => {
    if (!queryParams) { setDetail(null); return }
    setFetching(true)
    setDetail(null)
    const params = new URLSearchParams(queryParams.replace(/^\?/, ''))
    params.set('ledger', ledger.name)
    fetch(`/api/dashboard/ledger-detail?${params.toString()}`)
      .then(r => r.json())
      .then(res => setDetail(res.success && res.data ? res.data : false))
      .catch(() => setDetail(false))
      .finally(() => setFetching(false))
  }, [ledger.name, queryParams])

  // If no period selected — prompt user
  if (!queryParams) {
    return (
      <div className="led-card led-card--empty">
        <div className="led-card-header">
          <span className="led-card-name">{ledger.name}</span>
          {ledger.parent && <span className="led-card-parent">{ledger.parent}</span>}
        </div>
        <div className="led-context-bar">
          <span />
          <span className="led-ctx-dr">Dr → {labels.dr}</span>
          <span className="led-ctx-cr">Cr → {labels.cr}</span>
        </div>
        <div className="led-card-prompt">
          Select a company &amp; year above to see transactions
        </div>
      </div>
    )
  }

  return (
    <div className="led-card">
      {/* ── Header ── */}
      <div className="led-card-header">
        <span className="led-card-name">{ledger.name}</span>
        {ledger.parent && <span className="led-card-parent">{ledger.parent}</span>}
      </div>

      {/* ── Context bar ── */}
      <div className="led-context-bar">
        <span />
        <span className="led-ctx-dr">Dr → {labels.dr}</span>
        <span className="led-ctx-cr">Cr → {labels.cr}</span>
      </div>

      {fetching && (
        <div className="led-card-loading">
          <span className="led-loading-dot" />
          Loading transactions…
        </div>
      )}

      {!fetching && detail === false && (
        <div className="led-card-prompt">No transactions found for this period.</div>
      )}

      {!fetching && detail && !detail.hasActivity && (
        <div className="led-card-prompt led-card-prompt--info">
          No transactions in this period — ledger exists but had no Dr/Cr activity in{' '}
          {detail.period.from.substring(0, 4)}-{detail.period.to.substring(2, 4)}
        </div>
      )}

      {!fetching && detail && detail.hasActivity && (
        <div className="led-card-body">

          {/* ── Month-wise table ── */}
          <div className="led-months">
            <div className="led-month-row led-month-head">
              <span className="led-mc-month">Month</span>
              <span className="led-mc-dr">Dr</span>
              <span className="led-mc-cr">Cr</span>
            </div>
            {detail.months.map(m => (
              <div
                key={m.month}
                className={`led-month-row${m.dr === 0 && m.cr === 0 ? ' led-month-nil' : ''}`}
              >
                <span className="led-mc-month">{m.month}</span>
                <span className={`led-mc-dr${m.dr > 0 ? ' dr' : ''}`}>
                  {m.dr > 0 ? fmt(m.dr) : '—'}
                </span>
                <span className={`led-mc-cr${m.cr > 0 ? ' cr' : ''}`}>
                  {m.cr > 0 ? fmt(m.cr) : '—'}
                </span>
              </div>
            ))}
          </div>

          {/* ── Totals + group bifurcation ── */}
          <div className="led-totals">
            <div className="led-total-col">
              <div className="led-total-head dr">
                <span className="led-total-label">{labels.dr}</span>
                <span className="led-total-amt">{fmt(detail.dr)}</span>
              </div>
              {detail.drGroups.map(g => (
                <div key={g.name} className="led-group-row">
                  <span className="led-group-name">{g.name}</span>
                  <span className="led-group-amt">{fmt(g.amount)}</span>
                </div>
              ))}
            </div>

            <div className="led-total-divider" />

            <div className="led-total-col">
              <div className="led-total-head cr">
                <span className="led-total-label">{labels.cr}</span>
                <span className="led-total-amt">{fmt(detail.cr)}</span>
              </div>
              {detail.crGroups.map(g => (
                <div key={g.name} className="led-group-row">
                  <span className="led-group-name">{g.name}</span>
                  <span className="led-group-amt">{fmt(g.amount)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Net ── */}
          <div className="led-net-row">
            <span className="led-net-label">Net</span>
            <span className={`led-net-val${detail.net === 0 ? ' zero' : detail.netIsDr ? ' dr' : ' cr'}`}>
              {fmt(detail.net)}
              {detail.net > 0 && (
                <span className="led-net-tag">{detail.netIsDr ? 'Dr' : 'Cr'}</span>
              )}
            </span>
          </div>

        </div>
      )}
    </div>
  )
}

export default function AISearch({
  sections,
  componentMap,
  selectedCompany,
  queryParams,
  // Lifted state (persists across route changes)
  query, setQuery,
  results, setResults,
  ledgerResults, setLedgerResults,
  error, setError,
}) {
  const [loading, setLoading] = useState(false)

  // Ledger autocomplete (local — fetched fresh per company)
  const [allLedgers, setAllLedgers]           = useState([])
  const [suggestions, setSuggestions]         = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef(null)

  // Fetch all ledger names whenever the selected company changes
  useEffect(() => {
    const url = selectedCompany
      ? `/api/dashboard/ledgers?company=${encodeURIComponent(selectedCompany)}`
      : '/api/dashboard/ledgers'
    fetch(url)
      .then(r => r.json())
      .then(res => { if (res.success) setAllLedgers(res.data.ledgers || []) })
      .catch(() => {})
  }, [selectedCompany])

  // Filter ledgers client-side as user types
  const handleQueryChange = (e) => {
    const val = e.target.value
    setQuery(val)
    if (val.trim().length < 2) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    const lower = val.toLowerCase()
    const matched = allLedgers
      .filter(l => l.name.toLowerCase().includes(lower))
      .slice(0, 8)
    setSuggestions(matched)
    setShowSuggestions(matched.length > 0)
  }

  const handleSuggestionClick = (name) => {
    setQuery(name)
    setSuggestions([])
    setShowSuggestions(false)
    inputRef.current?.focus()
  }

  const handleSearch = async () => {
    if (!query.trim()) return
    setLoading(true)
    setResults(null)
    setLedgerResults([])
    setError('')
    setSuggestions([])
    setShowSuggestions(false)

    // Sync: filter all ledgers by query (immediate, no network call)
    const lower = query.trim().toLowerCase()
    const matched = allLedgers.filter(l => l.name.toLowerCase().includes(lower))
    setLedgerResults(matched)

    try {
      // Ask AI which dashboard sections match the query
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

      const matchedSections = matchedIds
        .map(id => sections.find(s => s.id === id))
        .filter(Boolean)

      // Fetch each matched section — append queryParams so company/period are respected
      const fetched = await Promise.all(
        matchedSections.map(async (section) => {
          const url = queryParams
            ? `${section.endpoint}${queryParams}`
            : section.endpoint
          const res = await fetch(url)
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
    if (e.key === 'Escape') setShowSuggestions(false)
  }

  return (
    <>
      <div className="ai-hero">
        <div className="ai-hero-inner">
          <div className="ai-hero-icon">✨</div>
          <h2 className="ai-hero-title">What would you like to explore?</h2>
          <p className="ai-hero-subtitle">Search ledgers, persons, or ask in plain English</p>

          <div className="ai-hero-bar-wrapper">
            <div className="ai-hero-bar">
              <input
                ref={inputRef}
                className="ai-hero-input"
                type="text"
                placeholder='e.g. "Reliance Industries", "HDFC", or "show cash flow"'
                value={query}
                onChange={handleQueryChange}
                onKeyDown={handleKeyDown}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
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

            {showSuggestions && (
              <ul className="ai-suggestions">
                {suggestions.map(l => (
                  <li
                    key={l.name}
                    className="ai-suggestion-item"
                    onMouseDown={() => handleSuggestionClick(l.name)}
                  >
                    <span className="ai-suggestion-name">{l.name}</span>
                    {l.parent && <span className="ai-suggestion-parent">{l.parent}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <div className="ai-answer-error">
              <p>{error}</p>
            </div>
          )}

          {results !== null && results.length === 0 && ledgerResults.length === 0 && !error && (
            <div className="ai-no-result">
              <p>No matching data found for your query.</p>
            </div>
          )}
        </div>
      </div>

      {(ledgerResults.length > 0 || (results && results.length > 0)) && (
        <div className="ai-results">
          {ledgerResults.length > 0 && (
            <div className="ai-result-section">
              <h2 className="ai-result-heading">Matching Ledgers ({ledgerResults.length})</h2>
              {!queryParams && (
                <p className="led-period-hint">Select a company &amp; year in the header to see transaction details</p>
              )}
              <div className="led-cards">
                {ledgerResults.map(l => (
                  <LedgerCard key={l.name} ledger={l} queryParams={queryParams} />
                ))}
              </div>
            </div>
          )}

          {results && results.map(({ section, data }) => {
            const Component = componentMap[section.id]
            if (!Component || !data) return null
            return (
              <div key={section.id} className="ai-result-section">
                <h2 className="ai-result-heading">{section.label}</h2>
                <Component data={data} queryParams={queryParams} />
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
