/**
 * Every href and image URL the terminal renders passes through here.
 *
 * Token addresses, user handles and image links arrive from fomo's API and socket frames
 * unvalidated (token metadata is user-submitted upstream). Building paths by template made a
 * value containing `/`, `?`, `#` or `..` rewrite the destination, and an `http:` or `data:`
 * image URL either tripped mixed-content blocking or sidestepped fomo's img-src intent.
 */

/** fomo's own coin page for a token. Segments are encoded so identity cannot escape the path. */
export function tokenPath(chain: string, address: string): string {
  return `/tokens/${encodeURIComponent(chain)}/${encodeURIComponent(address)}`
}

/** fomo's profile page for a trader handle. */
export function profilePath(handle: string): string {
  return `/profile/${encodeURIComponent(handle)}`
}

/**
 * Resolve an in-app href to a same-origin `pathname + search + hash`, or null when it would
 * leave fomo. A `//host/…` or absolute foreign URL must never reach pushState's fallback
 * (`location.assign`), where it would become an open redirect.
 */
export function sameOriginHref(href: string): string | null {
  let url: URL
  try {
    url = new URL(href, window.location.origin)
  } catch {
    return null
  }
  if (url.origin !== window.location.origin) return null
  return url.pathname + url.search + url.hash
}

/** Only https image URLs are rendered; anything else is treated as "no image". */
export function safeImageUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}
