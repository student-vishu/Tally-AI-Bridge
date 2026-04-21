import { useState, useEffect } from 'react'

export default function EmployeeList() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const now = new Date()
  const [exportYear, setExportYear]   = useState(now.getFullYear())
  const [exportMonth, setExportMonth] = useState(now.getMonth() + 1)

  useEffect(() => {
    fetch('/api/asanify/employees-with-projects')
      .then(r => r.json())
      .then(res => {
        if (!res.success) throw new Error(res.error || 'Server error')
        setEmployees(res.employees)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="state-box">
      <div className="spinner" />
      <p>Fetching employee &amp; project data from Asanify…</p>
    </div>
  )

  if (error) return (
    <div className="state-box error">
      <span className="error-icon">⚠</span>
      <p><strong>Could not fetch employees</strong></p>
      <p className="error-detail">{error}</p>
    </div>
  )

  if (!employees.length) return (
    <div className="state-box"><p>No employees found.</p></div>
  )

  const handleExport = () => {
    window.location.href = `/api/asanify/export/team-allocation?year=${exportYear}&month=${exportMonth}`
  }

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  return (
    <div style={{ padding: '1.5rem', overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>All Employees ({employees.length})</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <select value={exportMonth} onChange={e => setExportMonth(Number(e.target.value))} style={selectStyle}>
            {monthNames.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={exportYear} onChange={e => setExportYear(Number(e.target.value))}
            style={{ ...selectStyle, width: '80px' }} min="2020" max="2099" />
          <button onClick={handleExport} style={exportBtn}>Export Team Allocation Excel</button>
        </div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ background: '#f3f4f6', textAlign: 'left' }}>
            <th style={th}>Name</th>
            <th style={th}>Department</th>
            <th style={th}>Designation</th>
            <th style={th}>Type</th>
            <th style={th}>Projects</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((emp, i) => {
            const name = [emp.FIRST_NAME, emp.MIDDLE_NAME, emp.LAST_NAME].filter(Boolean).join(' ') || '—'
            return (
              <tr key={emp.EMPLOYEE_ID || emp.ASAN_EMPCODE || i} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={td}>{name}</td>
                <td style={td}>{emp.DEPARTMENT_NAME || emp.DEPARTMENT || '—'}</td>
                <td style={td}>{emp.DESIGNATION_NAME || emp.DESIGNATION || '—'}</td>
                <td style={td}>{emp.EMPLOYMENT_TYPE || '—'}</td>
                <td style={td}>
                  {emp.projects?.length
                    ? emp.projects.map((p, j) => (
                        <span key={j} style={projectBadge}>{p}</span>
                      ))
                    : <span style={{ color: '#9ca3af' }}>—</span>
                  }
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const selectStyle = {
  padding: '0.4rem 0.6rem', border: '1px solid #d1d5db', borderRadius: '6px',
  fontSize: '0.875rem', background: '#fff', cursor: 'pointer'
}
const exportBtn = {
  padding: '0.5rem 1.2rem', background: '#1d4ed8', color: '#fff',
  border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600
}
const th = { padding: '0.6rem 0.8rem', fontWeight: 600, borderBottom: '2px solid #d1d5db' }
const td = { padding: '0.5rem 0.8rem', verticalAlign: 'top' }
const projectBadge = {
  display: 'inline-block', marginRight: '4px', marginBottom: '4px',
  padding: '2px 8px', borderRadius: '9999px', fontSize: '0.75rem',
  background: '#dbeafe', color: '#1e40af'
}
