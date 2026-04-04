import { useState, useEffect } from 'react'
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import CompanyCashFlow from './components/CompanyCashFlow'
import ProjectCashFlow from './components/ProjectCashFlow'
import AISearch from './components/AISearch'
import './App.css'

// Map section IDs to display components — add one line here when adding a new section
const COMPONENT_MAP = {
  'company-cashflow': CompanyCashFlow,
  'project-cashflow': ProjectCashFlow
}

function CompanyPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/dashboard/company-cashflow')
      .then(r => r.json())
      .then(res => {
        if (!res.success) throw new Error('Server error')
        setData(res.data)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingBox />
  if (error) return <ErrorBox message={error} />
  return <CompanyCashFlow data={data} />
}

function ProjectPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/dashboard/project-cashflow')
      .then(r => r.json())
      .then(res => {
        if (!res.success) throw new Error('Server error')
        setData(res.data)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingBox />
  if (error) return <ErrorBox message={error} />
  return <ProjectCashFlow data={data} />
}

function SearchPage({ sections }) {
  if (!sections.length) return <LoadingBox />
  return (
    <div className="search-page">
      <AISearch sections={sections} componentMap={COMPONENT_MAP} />
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

export default function App() {
  const [fyLabel, setFyLabel]         = useState('...')
  const [companyName, setCompanyName] = useState('')
  const [sections, setSections]       = useState([])
  const [tallyConnected, setTallyConnected] = useState(null) // null = checking

  useEffect(() => {
    fetch('/api/dashboard/config')
      .then(r => r.json())
      .then(res => {
        if (res.success) {
          setFyLabel(res.data.fyLabel)
          setCompanyName(res.data.companyName || '')
        }
      })
      .catch(() => setFyLabel('—'))

    fetch('/api/dashboard/sections')
      .then(r => r.json())
      .then(res => { if (res.success) setSections(res.data) })
      .catch(() => { })

    fetch('/api/dashboard/tally-status')
      .then(r => r.json())
      .then(res => { if (res.success) setTallyConnected(res.data.connected) })
      .catch(() => setTallyConnected(false))
  }, [])

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
          <p className="header-subtitle">Financial Year {fyLabel} &nbsp;|&nbsp; Data sourced from Tally</p>
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
          <Route path="/" element={<SearchPage sections={sections} />} />
          <Route path="/company-cashflow" element={<CompanyPage />} />
          <Route path="/project-cashflow" element={<ProjectPage />} />
        </Routes>
      </main>

      <footer className="app-footer">
        <p>Tally AI Bridge &nbsp;·&nbsp; FY {fyLabel} &nbsp;·&nbsp; Essact</p>
      </footer>
    </div>
  )
}
