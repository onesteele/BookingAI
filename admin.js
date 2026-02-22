// Shared admin utilities — loaded on every admin page

// SVG icons used in sidebar nav
const ICONS = {
  dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`,
  users:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  settings:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M12 2a10 10 0 0 1 7.07 2.93"/><path d="M4.93 4.93a10 10 0 0 0 0 14.14M12 22a10 10 0 0 1-7.07-2.93"/></svg>`,
  link:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  book:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  logout:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
  calendar:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  status:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
}

const NAV = [
  { href: './index.html',       label: 'Dashboard',    icon: 'dashboard' },
  { href: './status.html',      label: 'Status',       icon: 'status' },
  { href: './agents.html',      label: 'Agents',       icon: 'users' },
  { href: './event-types.html', label: 'Event Types',  icon: 'settings' },
  { href: './links.html',       label: 'Booking Links',icon: 'link' },
  { href: './bookings.html',    label: 'Bookings',     icon: 'book' },
]

// Profit Insider logo (references pi-logo.png uploaded to docs root)
const LOGO_IMG = `<img src="../pi-logo.png" alt="Profit Insider" style="height:28px;object-fit:contain;" onerror="this.style.display='none'">`

function renderSidebar(supabase) {
  const page = location.pathname.split('/').pop()
  const items = NAV.map(n => {
    const active = n.href.replace('./', '') === page ? ' active' : ''
    return `<a href="${n.href}" class="nav-item${active}">${ICONS[n.icon]}${n.label}</a>`
  }).join('')

  return `
    <aside class="sidebar">
      <div class="sidebar-brand">
        ${LOGO_IMG}
        <span>Profit Insider</span>
      </div>
      <nav>${items}</nav>
      <div class="sidebar-footer">
        <button class="nav-item" onclick="adminSignOut()" style="width:100%;border:none;cursor:pointer;background:none;">
          ${ICONS.logout} Sign Out
        </button>
      </div>
    </aside>`
}

// Call at the start of each admin page. Returns { supabase } or null (redirected).
async function initAdmin() {
  const sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey)
  const { data: { session } } = await sb.auth.getSession()
  if (!session) { window.location.href = '../admin/login.html'; return null }

  // Build layout
  document.body.innerHTML = `
    <div class="admin-layout">
      ${renderSidebar(sb)}
      <main class="admin-main">
        <div class="page-shell" id="page-content"></div>
      </main>
    </div>
    <div id="toast"></div>` + document.body.innerHTML

  window._supabase = sb
  return sb
}

async function adminSignOut() {
  const sb = window._supabase || window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey)
  await sb.auth.signOut()
  window.location.href = '../admin/login.html'
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function showToast(title, body = '', isError = false) {
  const container = document.getElementById('toast')
  if (!container) return
  const el = document.createElement('div')
  el.className = 'toast' + (isError ? ' error' : '')
  el.innerHTML = `<div><div class="toast-title">${title}</div>${body ? `<div class="toast-body">${body}</div>` : ''}</div>`
  container.appendChild(el)
  setTimeout(() => el.remove(), 4000)
}

// ─── Modal helpers ───────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.remove('hidden') }
function closeModal(id) { document.getElementById(id).classList.add('hidden') }

// ─── Confirm delete helper ───────────────────────────────────────────────────
function confirmAction(msg) { return window.confirm(msg) }

// ─── Date/time formatters ─────────────────────────────────────────────────────
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true, timeZone: TZ })
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric', timeZone: TZ })
}
function fmtShort(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', timeZone: TZ })
}
