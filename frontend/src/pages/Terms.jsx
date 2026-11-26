import { Link } from 'react-router-dom'
import TermsContent, { LAST_UPDATED } from './TermsContent.jsx'

/*
 * The public terms page. Deliberately thin: the words live in
 * TermsContent.jsx so that this page and the acceptance screen in
 * components/TermsGate.jsx always show the same text.
 */

export default function Terms() {
  return (
    <div className="legal-page">
      <div className="legal-inner">
        <Link to="/" className="legal-back">← Back to home</Link>

        <h1 className="legal-title">Terms of Service</h1>
        <p className="legal-updated">Last updated {LAST_UPDATED}</p>

        <TermsContent />
      </div>
    </div>
  )
}