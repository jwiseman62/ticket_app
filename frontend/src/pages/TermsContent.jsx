/*
 * The terms themselves, with no page furniture around them.
 *
 * Two places show this text: the public /terms page, and the acceptance
 * screen people are stopped at after the terms change. Keeping the words in
 * one component means the thing someone accepts is necessarily the same
 * thing the public page shows — if these were two copies, one would
 * eventually be edited without the other.
 *
 * Headings start at <h2> because each caller supplies its own <h1>.
 *
 * It is not legal advice and has not been reviewed by a lawyer. Anything
 * handling real users' data for real should be.
 */

/**
 * Shown to readers as the revision date.
 *
 * IMPORTANT: this is only the label. Whether anyone is actually asked to
 * accept again is decided by TERMS_VERSION in backend/auth.py. Change the
 * words here, change the date here, and bump that — all three, or people
 * will read a new date and never be asked, or be asked and see an old one.
 */
export const LAST_UPDATED = '25 November 2026'

export const CONTACT_URL = 'https://www.linkedin.com/in/jefferson-wiseman-718332155'

export default function TermsContent() {
  return (
    <>
      <div className="legal-callout">
        <strong>This is a demonstration project.</strong> Tech Help is a
        portfolio piece built to show how a helpdesk application works. It
        is not a commercial service, and it is not intended for managing
        real support requests. Please don't enter anything you wouldn't be
        comfortable seeing deleted or read by someone else.
      </div>

      <h2>1. What this service is</h2>
      <p>
        Tech Help is an IT ticketing application made available publicly so
        that anyone can try it. Accounts, tickets, messages and files
        created here exist to demonstrate the software. There is no company
        behind it, no support desk, and no agreement to provide the service
        for any length of time.
      </p>

      <h2>2. Demonstration data</h2>
      <p>
        The demo accounts shown on the sign-in page are shared. Anyone
        visiting can use them, see what you enter, and change or delete it.
      </p>
      <p>
        Demonstration data is reset on a regular schedule. A reset removes{' '}
        <strong>all</strong> tickets, messages, attachments and accounts
        created since the last one, including any you made. This is normal
        operation, not a fault, and there is no way to recover data a reset
        has removed.
      </p>

      <h2>3. Your account</h2>
      <p>
        If you register your own account, you're responsible for keeping
        your password to yourself and for what happens under your account.
        Use a password you don't use anywhere else — this is a demonstration
        project and should not be trusted with a password that protects
        anything real.
      </p>
      <p>
        Accounts may be removed at any time, with or without notice,
        including as part of a scheduled reset.
      </p>

      <h2>4. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>
          Upload unlawful material, malware, or anything you don't have the
          right to share
        </li>
        <li>
          Attempt to gain access to accounts, data or systems you haven't
          been given access to
        </li>
        <li>
          Interfere with the service — including automated traffic that
          degrades it for others
        </li>
        <li>
          Use the service to harass anyone, or to store personal information
          about other people
        </li>
      </ul>

      <h2>5. What is collected</h2>
      <p>Using the application stores the following:</p>
      <ul>
        <li>
          <strong>Account details</strong> — the username and email address
          you provide. Passwords are stored only as a salted hash and are
          never readable, by anyone, including the operator.
        </li>
        <li>
          <strong>Content you create</strong> — tickets, descriptions,
          survey answers, comments, chat messages, announcements, and any
          files you attach.
        </li>
        <li>
          <strong>Activity</strong> — timestamps of when tickets change
          state and who changed them, kept as each ticket's history, and the
          date you accepted these terms.
        </li>
      </ul>
      <p>
        There is no advertising, no analytics, and no third-party tracking
        on this site. Nothing is sold or shared for marketing.
      </p>

      <h2>6. How long it is kept</h2>
      <ul>
        <li>
          <strong>Tickets</strong> — deleting a ticket moves it to a trash
          area, where it can be restored for 30 days before being removed
          permanently.
        </li>
        <li>
          <strong>Closed tickets</strong> — kept and searchable in the
          archive indefinitely, unless deleted.
        </li>
        <li>
          <strong>Chat messages</strong> — kept while a conversation is
          open. Once a conversation is closed, it and its messages are
          deleted 30 days later.
        </li>
        <li>
          <strong>Everything</strong> — removed entirely at each scheduled
          demonstration reset, whichever comes first.
        </li>
      </ul>

      <h2>7. Where the data is held</h2>
      <p>
        The application runs on third-party hosting and stores its data in a
        managed PostgreSQL database located in the United States. If you are
        somewhere else, your data is transferred there by using the service.
        Email, where configured, is sent through a third-party delivery
        provider.
      </p>

      <h2>8. Removing your data</h2>
      <p>
        You can delete tickets you have access to from within the
        application. To have an account and its content removed sooner than
        the next scheduled reset, get in touch using the link below.
      </p>

      <h2>9. Availability</h2>
      <p>
        The service runs on free hosting and is not guaranteed to be
        available. It sleeps when idle, so the first request after a quiet
        period can take around a minute. It may be changed, interrupted or
        withdrawn at any time without notice.
      </p>

      <h2>10. No warranty</h2>
      <p>
        The service is provided “as is”, without warranties of any kind,
        express or implied, including fitness for a particular purpose. No
        promise is made that it will be available, correct, secure or free
        of errors.
      </p>

      <h2>11. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, the operator is not liable
        for any loss or damage arising from use of this service — including
        loss of data, which should be expected rather than treated as
        exceptional given the resets described above.
      </p>

      <h2>12. Changes to these terms</h2>
      <p>
        These terms may change. The date at the top shows when they were
        last revised. When they change in a way that matters, you'll be
        asked to read and accept the new version the next time you use the
        application, and you'll need to accept it to carry on using your
        account.
      </p>

      <h2>13. Contact</h2>
      <p>
        Questions about these terms, or a request to remove your data, can
        be sent via{' '}
        <a href={CONTACT_URL} target="_blank" rel="noopener noreferrer">
          LinkedIn
        </a>.
      </p>

      <p className="legal-footnote">
        These terms are provided for a demonstration project and are not
        legal advice. They have not been reviewed by a lawyer.
      </p>
    </>
  )
}