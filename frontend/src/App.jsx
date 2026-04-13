import { useState, useEffect, useCallback } from 'react'
import { Routes, Route, NavLink } from 'react-router-dom'
import CompanyCashFlow from './components/CompanyCashFlow'
import ProjectCashFlow from './components/ProjectCashFlow'
import AISearch from './components/AISearch'
import './App.css'

// Map section IDs to display components — add one line here when adding a new section
const COMPONENT_MAP = {
  'company-cashflow': CompanyCashFlow,
  'project-cashflow': ProjectCashFlow
}

function CompanyPage({ queryParams }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!queryParams) return
    setLoading(true)
    setError(null)
    fetch(`/api/dashboard/company-cashflow${queryParams}`)
      .then(r => r.json())
      .then(res => {
        if (!res.success) throw new Error('Server error')
        setData(res.data)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [queryParams])

  if (!queryParams) return <SelectFiltersBox />
  if (loading || !data) return <LoadingBox />
  if (error) return <ErrorBox message={error} />
  return <CompanyCashFlow data={data} />
}

function ProjectPage({ queryParams }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!queryParams) return
    setLoading(true)
    setError(null)
    fetch(`/api/dashboard/project-cashflow${queryParams}`)
      .then(r => r.json())
      .then(res => {
        if (!res.success) throw new Error('Server error')
        setData(res.data)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [queryParams])

  if (!queryParams) return <SelectFiltersBox />
  if (loading || !data) return <LoadingBox />
  if (error) return <ErrorBox message={error} />
  return <ProjectCashFlow data={data} queryParams={queryParams} />
}

function SearchPage({ sections, selectedCompany, queryParams, searchQuery, setSearchQuery, searchResults, setSearchResults, searchLedgerResults, setSearchLedgerResults, searchError, setSearchError }) {
  if (!sections.length) return <LoadingBox />
  return (
    <div className="search-page">
      <AISearch
        sections={sections}
        componentMap={COMPONENT_MAP}
        selectedCompany={selectedCompany}
        queryParams={queryParams}
        query={searchQuery}
        setQuery={setSearchQuery}
        results={searchResults}
        setResults={setSearchResults}
        ledgerResults={searchLedgerResults}
        setLedgerResults={setSearchLedgerResults}
        error={searchError}
        setError={setSearchError}
      />
    </div>
  )
}

function LoadingBox() {
  return (
    <div className="state-box">
      <div className="spinner" />
      <p>Fetching data from Tally…</p>
    </div>
  )
}

function ErrorBox({ message }) {
  return (
    <div className="state-box error">
      <span className="error-icon">⚠</span>
      <p><strong>Could not connect to backend</strong></p>
      <p className="error-detail">{message}</p>
      <p className="error-hint">Make sure the backend is running on port 5000.</p>
    </div>
  )
}

function SelectFiltersBox() {
  return (
    <div className="state-box">
      <p>Select both a period and a company above to load data.</p>
    </div>
  )
}

export default function App() {
  const [sections, setSections]             = useState([])
  const [tallyConnected, setTallyConnected] = useState(null)

  // Search state lifted here so it persists when navigating away from the Search page
  const [searchQuery, setSearchQuery]                   = useState('')
  const [searchResults, setSearchResults]               = useState(null)
  const [searchLedgerResults, setSearchLedgerResults]   = useState([])
  const [searchError, setSearchError]                   = useState('')

  // Filter state
  const [availableYears, setAvailableYears]         = useState([])
  const [availableCompanies, setAvailableCompanies] = useState([])
  const [selectedFY, setSelectedFY]                 = useState('')    // '' | '2022' | 'custom'
  const [customFrom, setCustomFrom]                 = useState('')    // 'YYYY-MM-DD'
  const [customTo, setCustomTo]                     = useState('')    // 'YYYY-MM-DD'
  const [selectedCompany, setSelectedCompany]       = useState('')    // '' | 'CompanyName'

  // On mount: fetch static data (companies list, sections, tally status)
  useEffect(() => {
    fetch('/api/dashboard/companies')
      .then(r => r.json())
      .then(res => { if (res.success) setAvailableCompanies(res.data.companies || []) })
      .catch(() => {})

    fetch('/api/dashboard/sections')
      .then(r => r.json())
      .then(res => { if (res.success) setSections(res.data) })
      .catch(() => { })

    fetch('/api/dashboard/tally-status')
      .then(r => r.json())
      .then(res => { if (res.success) setTallyConnected(res.data.connected) })
      .catch(() => setTallyConnected(false))
  }, [])

  // When company is selected: fetch available years from that company's BOOKSFROM date.
  // This is independent of Tally's currently selected period.
  useEffect(() => {
    if (!selectedCompany) {
      setAvailableYears([])
      setSelectedFY('')
      return
    }
    fetch(`/api/dashboard/config?company=${encodeURIComponent(selectedCompany)}`)
      .then(r => r.json())
      .then(res => { if (res.success) setAvailableYears(res.data.availableYears || []) })
      .catch(() => setAvailableYears([]))
  }, [selectedCompany])

  // Build query string — returns '' (blocks fetch) unless BOTH company AND period are explicitly selected.
  // Dashboard state is never derived from Tally's currently active period or company.
  const buildParams = useCallback(() => {
    if (!selectedCompany) return ''
    if (selectedFY === 'custom') {
      if (!customFrom || !customTo) return ''
      const p = new URLSearchParams()
      p.set('company', selectedCompany)
      p.set('from', customFrom.replace(/-/g, ''))
      p.set('to',   customTo.replace(/-/g, ''))
      return `?${p.toString()}`
    }
    if (!selectedFY) return ''
    const p = new URLSearchParams()
    p.set('company', selectedCompany)
    p.set('fy', selectedFY)
    return `?${p.toString()}`
  }, [selectedFY, customFrom, customTo, selectedCompany])

  const queryParams = buildParams()

  // Active period label for subtitle
  const activePeriodLabel = selectedFY === 'custom'
    ? (customFrom && customTo ? `${customFrom} to ${customTo}` : 'Custom period')
    : selectedFY
      ? availableYears.find(y => String(y.fy) === String(selectedFY))?.label || selectedFY
      : '—'

  const activeCompanyLabel = selectedCompany || '—'

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          {tallyConnected !== null && (
            <div className={`tally-status ${tallyConnected ? 'connected' : 'disconnected'}`}>
              <span className="tally-status-dot" />
              {tallyConnected ? 'Tally Connected' : 'Tally Offline'}
            </div>
          )}
          <h1>Tally Cash Flow Dashboard</h1>
          <p className="header-subtitle">
            FY {activePeriodLabel} &nbsp;|&nbsp; {activeCompanyLabel || 'Data sourced from Tally'}
          </p>

          {/* Filters row */}
          <div className="header-filters">
            <div className="filter-group">
              <label className="filter-label">Period</label>
              <select
                className="filter-select"
                value={selectedFY}
                onChange={e => { setSelectedFY(e.target.value); setCustomFrom(''); setCustomTo('') }}
              >
                <option value="">Current FY</option>
                {availableYears.map(y => (
                  <option key={y.fy} value={String(y.fy)}>{y.label}</option>
                ))}
                <option value="custom">Custom…</option>
              </select>
            </div>

            {selectedFY === 'custom' && (
              <div className="filter-group filter-group--custom">
                <label className="filter-label">From</label>
                <input
                  type="date"
                  className="filter-date"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                />
                <span className="filter-to">to</span>
                <input
                  type="date"
                  className="filter-date"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                />
              </div>
            )}

            {availableCompanies.length > 0 && (
              <div className="filter-group">
                <label className="filter-label">Company</label>
                <select
                  className="filter-select"
                  value={selectedCompany}
                  onChange={e => setSelectedCompany(e.target.value)}
                >
                  <option value="">Current Company</option>
                  {availableCompanies.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <nav className="nav-links">
            <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              Search
            </NavLink>
            <NavLink to="/company-cashflow" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              Company Cash Flow
            </NavLink>
            <NavLink to="/project-cashflow" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              Project Cash Flow
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={
            <SearchPage
              sections={sections}
              selectedCompany={selectedCompany}
              queryParams={queryParams}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              searchResults={searchResults}
              setSearchResults={setSearchResults}
              searchLedgerResults={searchLedgerResults}
              setSearchLedgerResults={setSearchLedgerResults}
              searchError={searchError}
              setSearchError={setSearchError}
            />
          } />
          <Route path="/company-cashflow" element={<CompanyPage queryParams={queryParams} />} />
          <Route path="/project-cashflow" element={<ProjectPage queryParams={queryParams} />} />
        </Routes>
      </main>

      <footer className="app-footer">
        <p>Tally AI Bridge &nbsp;·&nbsp; FY {activePeriodLabel} &nbsp;·&nbsp; Essact</p>
      </footer>
    </div>
  )
}
