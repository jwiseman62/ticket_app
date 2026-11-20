/**
 * How a ticket is named to people.
 *
 * Tickets carry a short reference like "TK-AC43" that people read aloud and
 * quote in email. Anything created before references existed has no ref, so
 * this falls back to the old sequential form rather than showing a blank.
 *
 * This used to be copy-pasted into five pages, which meant changing the
 * format meant finding all five.
 */
export function ticketRef(ticket) {
  if (!ticket) return ''
  if (typeof ticket === 'object' && ticket.ref) return ticket.ref
  const id = typeof ticket === 'object' ? ticket.id : ticket
  return `TKT-${String(id).padStart(3, '0')}`
}