/**
 * Resolve a journal link element to a journal id.
 *
 * Pure DOM helper — no feature state. Accepts an anchor, an element inside
 * an anchor, or any element bearing journal-id hints in attributes/markup,
 * and returns `{ href, id }` or `null`.
 */

import Logger from '../../../services/Logger.js'

export function resolveJournalFromElement(el) {
  if (!el) return null
  // If it's an anchor
  if (el.tagName && el.tagName.toLowerCase() === 'a') {
    const href = el.getAttribute('href') || el.getAttribute('ng-href') || ''
    const idMatch = String(href).match(/\/journal\/(\d+)/)
    if (idMatch && idMatch[1]) return { href, id: parseInt(idMatch[1], 10) }
    // fallback: href may contain query param like /#/journal/123
    const anchorMatch = String(href).match(/#\/?journal\/(\d+)/)
    if (anchorMatch && anchorMatch[1]) return { href, id: parseInt(anchorMatch[1], 10) }
    return { href, id: null }
  }

  // If it's inside an anchor (like span.linked-name), walk up to find anchor
  let parent = el
  while (parent && parent !== document.body) {
    if (parent.tagName && parent.tagName.toLowerCase() === 'a') {
      return resolveJournalFromElement(parent)
    }
    parent = parent.parentNode
  }

  // If element has data attributes with an id
  if (el.dataset && el.dataset.journalId) {
    return { href: null, id: parseInt(el.dataset.journalId, 10) }
  }

  // Additional heuristics: check for router/link attributes on the element itself
  const routerAttrs = ['ng-reflect-router-link', 'routerlink', 'ng-href', 'data-href', 'href', 'onclick']
  for (const attr of routerAttrs) {
    try {
      const val = el.getAttribute && el.getAttribute(attr)
      if (val) {
        // Try to extract journal id from the attribute value
        const m = String(val).match(/#?\/?(?:#\/)?(?:journal\/)?(\d{3,7})/)
        if (m && m[1]) {
          Logger.debug(`Resolved journal id from attribute '${attr}': ${m[1]}`)
          return { href: val, id: parseInt(m[1], 10) }
        }
      }
    } catch (err) {
      // ignore
    }
  }

  // If this element is inside a table row, try to find an anchor in the same row
  try {
    const tr = el.closest ? el.closest('tr') : null
    if (tr) {
      const anchors = tr.querySelectorAll && tr.querySelectorAll('a')
      if (anchors && anchors.length > 0) {
        for (const a of anchors) {
          const resolved = resolveJournalFromElement(a)
          if (resolved && resolved.id) return resolved
        }
      }
    }
  } catch (err) {
    // ignore
  }

  // As a last resort, inspect sibling anchors inside same parent
  try {
    const parentEl = el.parentNode
    if (parentEl && parentEl.querySelectorAll) {
      const anchors = parentEl.querySelectorAll('a')
      for (const a of anchors) {
        const resolved = resolveJournalFromElement(a)
        if (resolved && resolved.id) return resolved
      }
    }
  } catch (err) {
    // ignore
  }

  // Final fallback: scan element.outerHTML for journal id patterns
  try {
    const outer = el && el.outerHTML ? String(el.outerHTML) : ''
    if (outer) {
      const m1 = outer.match(/journal\/(\d{3,7})/)
      if (m1 && m1[1]) {
        Logger.debug(`Resolved journal id from outerHTML pattern journal/ID: ${m1[1]}`)
        return { href: null, id: parseInt(m1[1], 10) }
      }
      const m2 = outer.match(/#\/?journal\/(\d{3,7})/)
      if (m2 && m2[1]) {
        Logger.debug(`Resolved journal id from outerHTML pattern #/journal/ID: ${m2[1]}`)
        return { href: null, id: parseInt(m2[1], 10) }
      }
      const m3 =
        outer.match(/journalId\W*[:=]\W*"?(\d{3,7})"?/) ||
        outer.match(/data[-_]journal[-_]id\W*[:=]\W*"?(\d{3,7})"?/) ||
        outer.match(/data[-_]id\W*[:=]\W*"?(\d{3,7})"?/)
      if (m3 && m3[1]) {
        Logger.debug(`Resolved journal id from outerHTML generic id pattern: ${m3[1]}`)
        return { href: null, id: parseInt(m3[1], 10) }
      }
    }
  } catch (err) {
    // ignore
  }

  return null
}
