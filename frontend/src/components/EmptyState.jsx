/**
 * A dead end like "No tickets found" tells the user nothing about what to do.
 * This gives them a reason and usually a way out.
 */
export default function EmptyState({ icon = '📭', title, body, action, compact }) {
  return (
    <div className={`empty-state ${compact ? 'empty-state-compact' : ''}`}>
      <div className="empty-state-icon">{icon}</div>
      <div className="empty-state-title">{title}</div>
      {body && <p className="empty-state-body">{body}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}