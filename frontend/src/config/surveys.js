/**
 * Intake survey definitions.
 *
 * To add a category: add an entry to CATEGORIES, then a matching key in
 * CATEGORY_QUESTIONS. To add a question: push an object onto the array.
 *
 * Question shape:
 *   id       unique key, becomes the survey answer key
 *   label    the question text
 *   type     'radio' | 'select' | 'text' | 'textarea' | 'date'
 *   options  array of strings (radio/select only)
 *   weight   optional map of answer -> priority points
 *   hint     optional helper text under the label
 */

export const CATEGORIES = [
  { id: 'hardware', label: 'Hardware',       icon: '💻', blurb: 'Laptop, desktop, monitor, or peripheral' },
  { id: 'software', label: 'Software',       icon: '🧩', blurb: 'An application crashing or misbehaving' },
  { id: 'network',  label: 'Network',        icon: '📶', blurb: 'Wi-Fi, ethernet, VPN, or internet access' },
  { id: 'account',  label: 'Account/Access', icon: '🔐', blurb: 'Passwords, lockouts, or permissions' },
  { id: 'printer',  label: 'Printer',        icon: '🖨️', blurb: 'Printing, scanning, or copier issues' },
  { id: 'email',    label: 'Email',          icon: '✉️', blurb: 'Sending, receiving, or mailbox problems' },
  { id: 'other',    label: 'Something else', icon: '❓', blurb: "Doesn't fit the categories above" },
]

export const CATEGORY_QUESTIONS = {
  hardware: [
    { id: 'device_type', label: 'What kind of device is it?', type: 'select',
      options: ['Laptop', 'Desktop', 'Monitor', 'Phone', 'Tablet', 'Keyboard/Mouse', 'Docking station', 'Other'] },
    { id: 'asset_tag', label: 'Asset tag or serial number', type: 'text',
      hint: 'Usually a sticker on the underside or back of the device' },
    { id: 'powers_on', label: 'Does the device power on?', type: 'radio',
      options: ['Yes, normally', 'Sometimes', 'No, nothing happens'],
      weight: { 'No, nothing happens': 2, 'Sometimes': 1 } },
    { id: 'physical_damage', label: 'Is there any visible physical damage?', type: 'radio',
      options: ['No', 'Yes — cracked screen', 'Yes — liquid spill', 'Yes — other'],
      weight: { 'Yes — liquid spill': 2, 'Yes — cracked screen': 1, 'Yes — other': 1 } },
    { id: 'unusual_signs', label: 'Any unusual sounds, heat, or smells?', type: 'radio',
      options: ['None', 'Loud fan or clicking', 'Running very hot', 'Burning smell'],
      weight: { 'Burning smell': 3, 'Running very hot': 1 } },
  ],

  software: [
    { id: 'app_name', label: 'Which application?', type: 'text',
      hint: 'Include the version number if you can find it' },
    { id: 'operating_system', label: 'Operating system', type: 'select',
      options: ['Windows 11', 'Windows 10', 'macOS', 'Linux', 'iOS', 'Android', 'Not sure'] },
    { id: 'behaviour', label: 'What does it do?', type: 'radio',
      options: ['Crashes and closes', 'Freezes or hangs', 'Shows an error message',
                'Runs but behaves incorrectly', "Won't launch at all"],
      weight: { "Won't launch at all": 2, 'Crashes and closes': 1 } },
    { id: 'error_text', label: 'Exact error message', type: 'textarea',
      hint: 'Copy the text word for word, or attach a screenshot after creating the ticket' },
    { id: 'frequency', label: 'How often does it happen?', type: 'radio',
      options: ['Every single time', 'Most of the time', 'Occasionally', 'Only happened once'],
      weight: { 'Every single time': 2, 'Most of the time': 1 } },
    { id: 'recent_change', label: 'Any recent changes before it started?', type: 'radio',
      options: ['No changes', 'App was updated', 'OS was updated', 'New software installed', 'Not sure'] },
  ],

  network: [
    { id: 'connection_type', label: 'How are you connected?', type: 'radio',
      options: ['Wi-Fi', 'Wired ethernet', 'Mobile hotspot', 'Not sure'] },
    { id: 'can_reach', label: 'What can you reach?', type: 'radio',
      options: ['Nothing at all', 'Internal sites only', 'External sites only', 'Everything but it is slow'],
      weight: { 'Nothing at all': 3, 'Internal sites only': 2, 'External sites only': 2 } },
    { id: 'others_affected', label: 'Are others near you affected?', type: 'radio',
      options: ['Just me', 'A few people nearby', 'Everyone in the area', 'Not sure'],
      weight: { 'Everyone in the area': 3, 'A few people nearby': 1 } },
    { id: 'location', label: 'Building and room number', type: 'text' },
    { id: 'vpn', label: 'Are you using VPN?', type: 'radio',
      options: ['No', 'Yes — and it connects', 'Yes — and it fails to connect'],
      weight: { 'Yes — and it fails to connect': 1 } },
  ],

  account: [
    { id: 'issue_type', label: 'What kind of access issue?', type: 'radio',
      options: ['Forgot password', 'Account locked out', 'Permission denied',
                'Multi-factor auth problem', 'Need access to something new'],
      weight: { 'Account locked out': 2, 'Multi-factor auth problem': 2, 'Permission denied': 1 } },
    { id: 'system_name', label: 'Which system or resource?', type: 'text',
      hint: 'e.g. Windows login, VPN, a shared drive, a specific web app' },
    { id: 'error_text', label: 'Exact error message shown', type: 'textarea' },
    { id: 'worked_before', label: 'Did this work before?', type: 'radio',
      options: ['Yes, it worked yesterday', 'Yes, but a while ago', 'No, never had access'] },
    { id: 'last_login', label: 'When did you last sign in successfully?', type: 'text',
      hint: 'An approximate date is fine' },
  ],

  printer: [
    { id: 'printer_name', label: 'Printer name and location', type: 'text',
      hint: 'Usually labelled on the front of the device' },
    { id: 'problem', label: 'What is happening?', type: 'radio',
      options: ['Shows offline', 'Paper jam', 'Out of toner or ink',
                'Prints but quality is poor', 'Job disappears from the queue', 'Scanner not working'],
      weight: { 'Shows offline': 1 } },
    { id: 'display_error', label: 'Error shown on the printer display', type: 'text' },
    { id: 'others_can_print', label: 'Can other people print to it?', type: 'radio',
      options: ['Yes, only I have the problem', 'No, nobody can print', 'Not sure'],
      weight: { 'No, nobody can print': 2 } },
  ],

  email: [
    { id: 'client', label: 'Which email client?', type: 'select',
      options: ['Outlook desktop', 'Outlook web', 'Outlook mobile', 'Apple Mail', 'Other'] },
    { id: 'direction', label: 'What is affected?', type: 'radio',
      options: ['Sending only', 'Receiving only', 'Both sending and receiving', 'Calendar or contacts'],
      weight: { 'Both sending and receiving': 2, 'Receiving only': 1 } },
    { id: 'bounce_text', label: 'Bounce or error message text', type: 'textarea' },
    { id: 'mailbox_full', label: 'Have you seen a mailbox full warning?', type: 'radio',
      options: ['No', 'Yes', 'Not sure'] },
  ],

  other: [
    { id: 'what_happened', label: 'Describe what is happening', type: 'textarea',
      hint: 'Include what you were doing when the problem appeared' },
    { id: 'device_involved', label: 'What device or system is involved?', type: 'text' },
  ],
}

/** Asked for every category, appended after the specific questions. */
export const COMMON_QUESTIONS = [
  { id: 'started', label: 'When did this start?', type: 'radio',
    options: ['Today', 'Within the last few days', 'More than a week ago', 'It has always been like this'],
    weight: { 'Today': 1 } },
  { id: 'affected_count', label: 'How many people are affected?', type: 'radio',
    options: ['Just me', 'My team', 'The whole office'],
    weight: { 'The whole office': 3, 'My team': 2 } },
  { id: 'impact', label: 'What is the impact on your work?', type: 'radio',
    options: ['Completely blocked', 'Working, but slowed down', 'Minor annoyance'],
    weight: { 'Completely blocked': 3, 'Working, but slowed down': 1 } },
  { id: 'already_tried', label: 'What have you already tried?', type: 'textarea',
    hint: 'Even "nothing yet" is useful to know' },
]

/** Return the full ordered question list for a category. */
export function questionsFor(categoryId) {
  if (!categoryId) return []
  return [...(CATEGORY_QUESTIONS[categoryId] || []), ...COMMON_QUESTIONS]
}

/**
 * Score the answers and return a suggested priority.
 * The user can always override the suggestion.
 */
export function suggestPriority(categoryId, answers) {
  let score = 0
  for (const q of questionsFor(categoryId)) {
    if (!q.weight) continue
    score += q.weight[answers[q.id]] ?? 0
  }
  if (score >= 5) return { priority: 'High',   score }
  if (score >= 2) return { priority: 'Medium', score }
  return { priority: 'Low', score }
}

/** Human-readable label lookup, used when displaying stored answers. */
export function labelFor(categoryId, questionId) {
  const q = questionsFor(categoryId).find((q) => q.id === questionId)
  return q ? q.label : questionId
}

export function categoryLabel(categoryId) {
  return CATEGORIES.find((c) => c.id === categoryId)?.label ?? categoryId
}

export function categoryIcon(categoryId) {
  return CATEGORIES.find((c) => c.id === categoryId)?.icon ?? '📋'
}
