/**
 * ISOLATED-world content script. Owns the UI.
 *
 * fomo server-renders straight into <body> with no stable mount node, and React Router owns
 * that tree. So we never touch it: we append a sibling host element and render into a shadow
 * root on it. Removing the host restores the page exactly.
 */

import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { App } from '~/content/App'
import styles from '~/content/styles.css?inline'

const HOST_ID = 'fobo-terminal-root'
const LAUNCHER_ID = 'fobo-terminal-launcher'
const ENABLED_KEY = 'fobo:enabled'

/**
 * Dismissal has to survive a navigation: opening a coin does a full page load, and without
 * this the overlay would immediately re-cover the coin page the user just asked for. Scoped
 * to the tab via sessionStorage, so a new tab starts on the home screen again.
 */
const DISMISSED_KEY = 'fobo:dismissed'

function isDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function setDismissed(value: boolean): void {
  try {
    if (value) window.sessionStorage.setItem(DISMISSED_KEY, '1')
    else window.sessionStorage.removeItem(DISMISSED_KEY)
  } catch {
    /* private mode — fall back to in-memory behaviour */
  }
}

/**
 * fomo's own bootstrap treats this key as the signal that a session exists — it is what
 * decides whether `/` redirects into the app. We use the same signal so fobo never covers
 * the marketing page for a logged-out visitor.
 */
function isLoggedIn(): boolean {
  try {
    const token = window.localStorage.getItem('privy:refresh_token')
    return typeof token === 'string' && token.startsWith('"') && token !== '"deprecated"'
  } catch {
    return false
  }
}

let host: HTMLElement | null = null
let root: Root | null = null
let launcher: HTMLButtonElement | null = null

function removeLauncher(): void {
  launcher?.remove()
  launcher = null
}

function showLauncher(): void {
  if (launcher || document.getElementById(LAUNCHER_ID)) return
  const button = document.createElement('button')
  button.id = LAUNCHER_ID
  button.textContent = 'fobo'
  button.setAttribute(
    'style',
    [
      'position:fixed',
      'right:1rem',
      'bottom:1rem',
      'z-index:2147483000',
      'background:var(--color-accent-primary,#516af6)',
      'color:#fff',
      'border:0',
      'border-radius:999px',
      'padding:0.5rem 0.875rem',
      'font-size:0.75rem',
      'font-weight:600',
      'cursor:pointer',
      'box-shadow:0 4px 16px rgb(0 0 0 / 0.4)',
    ].join(';'),
  )
  button.addEventListener('click', () => {
    setDismissed(false)
    removeLauncher()
    void mount()
  })
  document.body.append(button)
  launcher = button
}

function unmount(): void {
  root?.unmount()
  root = null
  host?.remove()
  host = null
}

function dismiss(): void {
  setDismissed(true)
  unmount()
  showLauncher()
}

async function mount(): Promise<void> {
  if (host || document.getElementById(HOST_ID)) return
  if (!isLoggedIn()) return

  const stored = await chrome.storage.sync.get(ENABLED_KEY)
  if (stored[ENABLED_KEY] === false) return

  // Dismissed earlier in this tab: offer the launcher rather than taking the page over again.
  if (isDismissed()) {
    showLauncher()
    return
  }

  host = document.createElement('div')
  host.id = HOST_ID
  const shadow = host.attachShadow({ mode: 'open' })

  const sheet = document.createElement('style')
  sheet.textContent = styles
  shadow.append(sheet)

  const container = document.createElement('div')
  shadow.append(container)
  document.body.append(host)

  root = createRoot(container)
  root.render(
    <StrictMode>
      <App onDismiss={dismiss} />
    </StrictMode>,
  )
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && host) dismiss()
})

chrome.runtime.onMessage.addListener((message: { type?: string; enabled?: boolean }) => {
  if (message?.type !== 'fobo:enabled-changed') return
  if (message.enabled) {
    setDismissed(false)
    removeLauncher()
    void mount()
  } else {
    unmount()
    removeLauncher()
  }
})

void mount()
