/** Shimmering placeholders that hold the layout while data loads. */

export function SkeletonLine({ width = '100%', height = 12 }) {
  return <div className="skeleton-line" style={{ width, height }} />
}

export function SkeletonTicketRow() {
  return (
    <div className="skeleton-ticket-row">
      <div className="skeleton-row-top">
        <SkeletonLine width="52px" height={10} />
        <SkeletonLine width="44px" height={10} />
        <SkeletonLine width="58px" height={10} />
      </div>
      <SkeletonLine width="78%" height={13} />
      <SkeletonLine width="45%" height={10} />
    </div>
  )
}

export function SkeletonTicketList({ count = 6 }) {
  return (
    <div aria-busy="true" aria-label="Loading tickets">
      {Array.from({ length: count }, (_, i) => <SkeletonTicketRow key={i} />)}
    </div>
  )
}

export function SkeletonStatCards({ count = 5 }) {
  return (
    <div className="stat-cards" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="stat-card">
          <SkeletonLine width="46px" height={28} />
          <div style={{ height: 8 }} />
          <SkeletonLine width="66%" height={10} />
        </div>
      ))}
    </div>
  )
}

export function SkeletonTableRows({ rows = 5, cols = 6 }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }, (_, c) => (
            <td key={c}><SkeletonLine width={c === 1 ? '85%' : '60%'} height={11} /></td>
          ))}
        </tr>
      ))}
    </>
  )
}