export default function HistoryTimeline({ entries }) {
  if (!entries?.length) return null
  return (
    <ul className="history-timeline">
      {[...entries].reverse().map((entry, i) => {
        const m   = entry.match(/^\[([^\]]+)\]\s*(.*)$/)
        const ts  = m ? m[1] : ''
        const msg = m ? m[2] : entry
        return (
          <li key={i} className="history-entry">
            <span className="history-dot" />
            <div className="history-content">
              <span className="history-time">{ts}</span>
              <span className="history-body">{msg}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
