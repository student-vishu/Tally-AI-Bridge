import { useState } from 'react'

const fmt = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(Math.abs(value))

const fmtAmt = (val) => (val > 0 ? fmt(val) : '—')

export default function ProjectCashFlow({ data }) {
  const [expandState, setExpandState] = useState({}) // name → 'loading'|'loaded'|'error'
  const [expandData, setExpandData] = useState({})   // name → { items: [...] }

  async function toggleExpand(projectName) {
    const state = expandState[projectName]
    if (state === 'loading') return
    // collapse if already open
    if (state === 'loaded' || state === 'error') {
      setExpandState(prev => ({ ...prev, [projectName]: null }))
      return
    }
    setExpandState(prev => ({ ...prev, [projectName]: 'loading' }))
    try {
      const res  = await fetch(`/api/dashboard/project-cashflow-expand?project=${encodeURIComponent(projectName)}`)
      const json = await res.json()
      if (!json.success) throw new Error('Server error')
      setExpandData(prev => ({ ...prev, [projectName]: json.data }))
      setExpandState(prev => ({ ...prev, [projectName]: 'loaded' }))
    } catch {
      setExpandState(prev => ({ ...prev, [projectName]: 'error' }))
    }
  }

  return (
    <div className="section-card">
      <h2 className="section-title">Project-wise Cash Flow</h2>
      <p className="section-subtitle">Click the arrow next to a project to view month-wise breakdown</p>

      <table className="data-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Fee Received</th>
            <th>Expenses Done</th>
            <th>Net (Fee − Expenses)</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => {
            const net      = row.feesReceived - row.expensesDone
            const netClass = net > 0 ? 'net-positive' : net < 0 ? 'net-negative' : 'net-zero'
            const state    = expandState[row.project]
            const isLoading  = state === 'loading'
            const isExpanded = state === 'loaded'
            const isError    = state === 'error'

            return [
              <tr key={`r-${i}`} className={isExpanded ? 'project-row-expanded' : ''}>
                <td>
                  <button
                    className={`project-expand-btn${isLoading ? ' proj-spinning' : ''}`}
                    onClick={() => toggleExpand(row.project)}
                    title={isExpanded ? 'Collapse' : 'Expand month-wise'}
                  >
                    {isLoading ? '●' : isExpanded ? '▼' : '▶'}
                  </button>
                  {row.project}
                </td>
                <td>{fmt(row.feesReceived)}</td>
                <td>{fmt(row.expensesDone)}</td>
                <td className={netClass}>
                  {net >= 0 ? '+' : ''}{fmt(net)}
                </td>
              </tr>,

              (isExpanded || isError) && (
                <tr key={`e-${i}`} className="project-expand-row">
                  <td colSpan={4}>
                    {isError
                      ? <div className="project-expand-empty">Failed to load data. Please try again.</div>
                      : <ExpandPanel data={expandData[row.project]} />
                    }
                  </td>
                </tr>
              )
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}

function ExpandPanel({ data }) {
  if (!data || !data.items || data.items.length === 0) {
    return <div className="project-expand-empty">No data available for this period.</div>
  }
  return (
    <div className="project-expand-panel">
      {data.items.map((item, idx) => (
        <SubCategorySection key={idx} item={item} />
      ))}
    </div>
  )
}

function SubCategorySection({ item }) {
  return (
    <div className="project-subcategory">
      <div className="project-subcategory-header">{item.name}</div>
      <table className="project-monthly-table">
        <thead>
          <tr>
            <th>Month</th>
            <th className="pm-num">Debit</th>
            <th className="pm-num">Credit</th>
            <th className="pm-num">Closing Balance</th>
          </tr>
        </thead>
        <tbody>
          {item.months.map((m, i) => (
            <tr key={i}>
              <td>{m.monthShort}</td>
              <td className="pm-num">{fmtAmt(m.debit)}</td>
              <td className="pm-num">{fmtAmt(m.credit)}</td>
              <td className="pm-num pm-closing">
                {fmt(m.closingBalance)}&nbsp;<span className="pm-dr-cr">{m.closingDr ? 'Dr' : 'Cr'}</span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="pm-grand-total">
            <td>Grand Total</td>
            <td className="pm-num">{fmtAmt(item.grandDebit)}</td>
            <td className="pm-num">{fmtAmt(item.grandCredit)}</td>
            <td className="pm-num pm-closing">
              {fmt(item.closingBalance)}&nbsp;<span className="pm-dr-cr">{item.closingDr ? 'Dr' : 'Cr'}</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
