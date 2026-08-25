import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchClickAway } from '~/lib/clickAway'

function down(node: Node): void {
  node.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }))
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('watchClickAway (light DOM)', () => {
  it('fires for outside pointerdowns only', () => {
    const el = document.createElement('div')
    const inner = document.createElement('button')
    el.append(inner)
    const outside = document.createElement('div')
    document.body.append(el, outside)

    const away = vi.fn()
    const stop = watchClickAway(el, away)
    down(inner)
    expect(away).not.toHaveBeenCalled()
    down(outside)
    expect(away).toHaveBeenCalledTimes(1)
    stop()
    down(outside)
    expect(away).toHaveBeenCalledTimes(1)
  })
})

describe('watchClickAway (closed shadow root)', () => {
  function shadowSetup() {
    const host = document.createElement('div')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'closed' })
    const el = document.createElement('div')
    const inner = document.createElement('button')
    el.append(inner)
    const sibling = document.createElement('div')
    shadow.append(el, sibling)
    return { host, shadow, el, inner, sibling }
  }

  it('keeps the menu open for pointerdowns inside it', () => {
    const { inner } = shadowSetup()
    const away = vi.fn()
    watchClickAway(inner.parentElement as HTMLElement, away)
    down(inner)
    expect(away).not.toHaveBeenCalled()
  })

  it('closes for pointerdowns elsewhere in the shadow tree', () => {
    const { el, sibling } = shadowSetup()
    const away = vi.fn()
    watchClickAway(el, away)
    down(sibling)
    expect(away).toHaveBeenCalledTimes(1)
  })

  it('closes for pointerdowns on the page outside the shadow tree', () => {
    const { el } = shadowSetup()
    const outside = document.createElement('div')
    document.body.append(outside)
    const away = vi.fn()
    watchClickAway(el, away)
    down(outside)
    expect(away).toHaveBeenCalledTimes(1)
  })

  it('ignores window-level events retargeted to the host', () => {
    const { host, el } = shadowSetup()
    const away = vi.fn()
    watchClickAway(el, away)
    // Simulate what an inside event looks like from window's side: target === host.
    host.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(away).not.toHaveBeenCalled()
  })
})
