const formatINR = (value) =>
  new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)

function balanceDisplay(amount, isDr) {
  return isDr ? formatINR(amount) : `${formatINR(amount)} Cr`
}

function LedgerTable({ ledger }) {
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
              <th>Particulars</th>
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

            {ledger.months.map((m) => (
              <tr key={m.month} className={m.debit === 0 && m.credit === 0 ? 'empty-month-row' : ''}>
                <td>{m.month}</td>
                <td className="num-col">{m.debit > 0 ? formatINR(m.debit) : ''}</td>
                <td className="num-col">{m.credit > 0 ? formatINR(m.credit) : ''}</td>
                <td className="num-col">{balanceDisplay(m.closingBalance, m.closingDr)}</td>
              </tr>
            ))}

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
