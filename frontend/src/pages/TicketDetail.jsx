import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import TicketForm from '../components/TicketForm.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { ticketRef } from '../utils/tickets.js'

/**
 * One ticket, on its own page.
 *
 * This used to be a pane beside the list, sharing the page with a blank
 * creation form. Giving it a URL of its own means a ticket can be linked to,
 * bookmarked, and opened in a new tab — which the pane could never do.
 */
export default function TicketDetail() {
  const { id }   = useParams()
  const { user } = useAuth()
  const toast    = useToast()
  const navigate = useNavigate()

  // The id comes from the URL, so it can be anything at all.
  const ticketId = Number(id)
  const valid    = Number.isInteger(ticketId) && ticketId > 0

  if (!valid) {
    return (
      <div className="detail-page">
        <EmptyState
          icon="🔍"
          title="No such ticket"
          body={`"${id}" isn't a ticket number.`}
          action={<Link to="/tickets" className="btn btn-primary">Back to tickets</Link>}
        />
      </div>
    )
  }

  return (
    <div className="detail-page">
      <div className="detail-header">
        {/* The ticket card below leads with its own reference heading, so
            repeating it here would just be noise. */}
        <Link to="/tickets" className="btn btn-secondary btn-sm">← All tickets</Link>
      </div>

      <TicketForm
        key={ticketId}
        ticketId={ticketId}
        currentUser={user}
        onSaved={() => { /* TicketForm reports success itself */ }}
        onDeleted={(deleted) => {
          toast.success(`${ticketRef(deleted || ticketId)} moved to the trash.`)
          navigate('/tickets', { replace: true })
        }}
      />
    </div>
  )
}