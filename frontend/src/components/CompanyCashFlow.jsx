import { useState, Fragment } from 'react'

const formatINR = (value) =>
  new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)

function balanceDisplay(amount, isDr) {
  return isDr ? formatINR(amount) : `${formatINR(amount)} Cr`
}

// Category definitions — same order as backend emptyEntries()
const CATEGORIES = [
  { key: 'Income',    label: 'Income',    totalLabel: 'Total Income',    color: '#1a7a4a', bg: '#f0faf4', border: '#a8d5b8' },
  { key: 'Expense',   label: 'Expense',   totalLabel: 'Total Expense',   color: '#b71c1c', bg: '#fff5f5', border: '#f5c6c6' },
  { key: 'Asset',     label: 'Asset',     totalLabel: 'Total Assets',    color: '#1565c0', bg: '#f0f5ff', border: '#b3c8f0' },
  { key: 'Liability', label: 'Liability', totalLabel: 'Total Liability', color: '#6a1b9a', bg: '#faf0ff', border: '#d4b3f0' },
  { key: 'Transfer',  label: 'Transfer',  totalLabel: 'Total Transfer',  color: '#e65100', bg: '#fff8f0', border: '#f5cca8' },
]

function CategoryCards({ sideEntries }) {
  const active = CATEGORIES.filter(
    c => sideEntries[c.key] && Object.keys(sideEntries[c.key]).length > 0
  )
  if (active.length === 0) return null
  return (
    <div className="mdc-side-cards">
      {active.map(cat => {
        const rows  = Object.entries(sideEntries[cat.key])
        const total = rows.reduce((s, [, v]) => s + v, 0)
        return (
          <div
            key={cat.key}
            className="mdc-card"
            style={{ '--cat-color': cat.color, '--cat-bg': cat.bg, '--cat-border': cat.border }}
          >
            <div className="mdc-card-header">
              <span className="mdc-dot" />
              {cat.label}
            </div>
            <div className="mdc-rows">
              {rows.map(([name, amount]) => (
                <div key={name} className="mdc-row">
                  <span className="mdc-name" title={name}>{name}</span>
                  <span className="mdc-amt">{formatINR(amount)}</span>
                </div>
              ))}
            </div>
            <div className="mdc-total">
              <span>{cat.totalLabel}</span>
              <span>{formatINR(total)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MonthDetailPanel({ entries, debitTotal, creditTotal }) {
  const hasDebit  = entries?.debit  && CATEGORIES.some(c => Object.keys(entries.debit[c.key]  || {}).length > 0)
  const hasCredit = entries?.credit && CATEGORIES.some(c => Object.keys(entries.credit[c.key] || {}).length > 0)

  if (!hasDebit && !hasCredit) {
    return (
      <tr className="month-detail-row">
        <td colSpan={4} className="month-detail-empty">No entry details available for this month.</td>
      </tr>
    )
  }

  return (
    <tr className="month-detail-row">
      <td colSpan={4}>
        <div className="month-detail-panel">
          {hasDebit && (
            <div className="mdc-side">
              <div className="mdc-side-header mdc-side-header--debit">
                <span className="mdc-side-label">Debit Side</span>
                <span className="mdc-side-total">{formatINR(debitTotal)}</span>
              </div>
              <CategoryCards sideEntries={entries.debit} />
            </div>
          )}
          {hasCredit && (
            <div className="mdc-side">
              <div className="mdc-side-header mdc-side-header--credit">
                <span className="mdc-side-label">Credit Side</span>
                <span className="mdc-side-total">{formatINR(creditTotal)}</span>
              </div>
              <CategoryCards sideEntries={entries.credit} />
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

function LedgerTable({ ledger }) {
  const [expanded, setExpanded]           = useState(false)
  const [expandedMonths, setExpandedMonths] = useState(new Set())

  function toggleMonth(month) {
    setExpandedMonths(prev => {
      const next = new Set(prev)
      if (next.has(month)) next.delete(month)
      else next.add(month)
      return next
    })
  }

  return (
    <div className="section-card ledger-card">
      <div className="ledger-card-header">
        <h2 className="section-title">{ledger.name}</h2>
        <span className="ledger-group-badge">{ledger.group}</span>
      </div>

      <div className="ledger-table-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>
                <span className="particulars-header">
                  Particulars
                  <button
                    className="expand-btn"
                    onClick={() => setExpanded(e => !e)}
                    title={expanded ? 'Collapse months' : 'Expand months'}
                  >
                    {expanded ? '▲' : '▼'}
                  </button>
                </span>
              </th>
              <th className="num-col">Debit</th>
              <th className="num-col">Credit</th>
              <th className="num-col">Closing Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr className="opening-row">
              <td>Opening Balance</td>
              <td></td>
              <td></td>
              <td className="num-col">{balanceDisplay(ledger.openingBalance, ledger.openingDr)}</td>
            </tr>

            {expanded && ledger.months.map((m) => {
              const hasData        = m.debit > 0 || m.credit > 0
              const isMonthExpanded = expandedMonths.has(m.month)
              return (
                <Fragment key={m.month}>
                  <tr className={[
                    !hasData          ? 'empty-month-row'  : '',
                    isMonthExpanded   ? 'month-row-active' : '',
                  ].filter(Boolean).join(' ')}>
                    <td>
                      <span className="month-particulars">
                        {hasData && (
                          <button
                            className="expand-btn month-expand-btn"
                            onClick={() => toggleMonth(m.month)}
                            title={isMonthExpanded ? 'Hide details' : 'Show details'}
                          >
                            {isMonthExpanded ? '▲' : '▼'}
                          </button>
                        )}
                        {m.month}
                      </span>
                    </td>
                    <td className="num-col">{m.debit  > 0 ? formatINR(m.debit)  : ''}</td>
                    <td className="num-col">{m.credit > 0 ? formatINR(m.credit) : ''}</td>
                    <td className="num-col">{balanceDisplay(m.closingBalance, m.closingDr)}</td>
                  </tr>

                  {isMonthExpanded && m.entries && (
                    <MonthDetailPanel entries={m.entries} debitTotal={m.debit} creditTotal={m.credit} />
                  )}
                </Fragment>
              )
            })}

            <tr className="grand-total-row">
              <td>Grand Total</td>
              <td className="num-col">{formatINR(ledger.grandDebit)}</td>
              <td className="num-col">{formatINR(ledger.grandCredit)}</td>
              <td className="num-col">{balanceDisplay(ledger.closingBalance, ledger.closingDr)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function CompanyCashFlow({ data }) {
  if (!data?.ledgers?.length) {
    return (
      <div className="section-card">
        <h2 className="section-title">Company Cash Flow</h2>
        <p className="section-subtitle">No bank or cash ledger data found for the selected period.</p>
      </div>
    )
  }

  return (
    <div className="ledger-list">
      {data.ledgers.map(ledger => (
        <LedgerTable key={ledger.name} ledger={ledger} />
      ))}
    </div>
  )
}
