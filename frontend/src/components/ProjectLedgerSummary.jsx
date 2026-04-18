import { useState } from 'react'

const fmt = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(Math.abs(value))

// Aggregate entries grouped by cost centre (item.name)
function aggregateEntries(expandData) {
  const byCostCentre = []

  for (const item of expandData.items || []) {
    const incomeMap  = new Map()
    const expenseMap = new Map()

    for (const month of item.months || []) {
      for (const entry of month.entries || []) {
        if (entry.credit > 0) {
          const key  = `${entry.ledger}||${entry.party || ''}`
          const prev = incomeMap.get(key) || { ledger: entry.ledger, party: entry.party || '', total: 0 }
          prev.total += entry.credit
          incomeMap.set(key, prev)
        }
        if (entry.debit > 0) {
          const key  = `${entry.ledger}||${entry.party || ''}`
          const prev = expenseMap.get(key) || { ledger: entry.ledger, party: entry.party || '', total: 0 }
          prev.total += entry.debit
          expenseMap.set(key, prev)
        }
      }
    }

    const income   = [...incomeMap.values()].sort((a, b) => b.total - a.total)
    const expenses = [...expenseMap.values()].sort((a, b) => b.total - a.total)
    if (income.length || expenses.length) {
      byCostCentre.push({ ccName: item.name, income, expenses })
    }
  }

  return { byCostCentre }
}

export default function ProjectLedgerSummary({ data, queryParams = '' }) {
  const [expandState, setExpandState] = useState({})
  const [expandData,  setExpandData]  = useState({})

  async function toggleExpand(projectName) {
    const state = expandState[projectName]
    if (state === 'loading') return
    if (state === 'loaded' || state === 'error') {
      setExpandState(prev => ({ ...prev, [projectName]: null }))
      return
    }
    setExpandState(prev => ({ ...prev, [projectName]: 'loading' }))
    try {
      const sep  = queryParams ? '&' : '?'
      const res  = await fetch(`/api/dashboard/project-cashflow-expand${queryParams}${sep}project=${encodeURIComponent(projectName)}`)
      const json = await res.json()
      if (!json.success) throw new Error('Server error')
      setExpandData(prev => ({ ...prev, [projectName]: aggregateEntries(json.data) }))
      setExpandState(prev => ({ ...prev, [projectName]: 'loaded' }))
    } catch {
      setExpandState(prev => ({ ...prev, [projectName]: 'error' }))
    }
  }

  return (
    <div className="section-card">
      <div className="section-header-row">
        <h2 className="section-title">Project Ledger Summary</h2>
      </div>
      <p className="section-subtitle">Click the arrow to see income and expense breakdown per cost centre</p>

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
            const net        = row.feesReceived - row.expensesDone
            const netClass   = net > 0 ? 'net-positive' : net < 0 ? 'net-negative' : 'net-zero'
            const state      = expandState[row.project]
            const isLoading  = state === 'loading'
            const isExpanded = state === 'loaded'
            const isError    = state === 'error'

            return [
              <tr key={`r-${i}`} className={isExpanded ? 'project-row-expanded' : ''}>
                <td>
                  <button
                    className={`project-expand-btn${isLoading ? ' proj-spinning' : ''}`}
                    onClick={() => toggleExpand(row.project)}
                    title={isExpanded ? 'Collapse' : 'Expand ledger summary'}
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
                      : <LedgerSummaryPanel data={expandData[row.project]} />
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

function LedgerSummaryPanel({ data }) {
  if (!data?.byCostCentre?.length) {
    return <div className="project-expand-empty">No transactions in this period.</div>
  }

  return (
    <div className="pls-panel">
      {data.byCostCentre.map(({ ccName, income, expenses }) => {
        const incomeTotal  = income.reduce((s, e) => s + e.total, 0)
        const expenseTotal = expenses.reduce((s, e) => s + e.total, 0)
        return (
          <div key={ccName} className="pls-cc-section">
            <div className="pls-cc-name">{ccName}</div>
            <div className="pls-columns">

              {/* ── Income ── */}
              <div className="pls-col pls-col-income">
                <div className="pls-col-header">Income (Cr)</div>
                {income.length > 0 ? (
                  <table className="pls-table">
                    <tbody>
                      {income.map((e, i) => (
                        <tr key={i}>
                          <td>
                            <span className="pm-entry-ledger">{e.ledger}</span>
                            {e.party && <span className="pm-entry-party">↳ {e.party}</span>}
                          </td>
                          <td className="pls-amt">{fmt(e.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="pls-total-row">
                        <td>Total</td>
                        <td className="pls-amt">{fmt(incomeTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                ) : (
                  <div className="pls-empty">No income entries</div>
                )}
              </div>

              {/* ── Expenses ── */}
              <div className="pls-col pls-col-expense">
                <div className="pls-col-header">Expenses (Dr)</div>
                {expenses.length > 0 ? (
                  <table className="pls-table">
                    <tbody>
                      {expenses.map((e, i) => (
                        <tr key={i}>
                          <td>
                            <span className="pm-entry-ledger">{e.ledger}</span>
                            {e.party && <span className="pm-entry-party">↳ {e.party}</span>}
                          </td>
                          <td className="pls-amt">{fmt(e.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="pls-total-row">
                        <td>Total</td>
                        <td className="pls-amt">{fmt(expenseTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                ) : (
                  <div className="pls-empty">No expense entries</div>
                )}
              </div>

            </div>
          </div>
        )
      })}
    </div>
  )
}
