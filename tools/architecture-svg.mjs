// Native SVG drawing primitives for the core tutorial artwork.
export const COMPONENT_SIZE = Object.freeze({ width: 280, height: 200 })

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const ink = '#202B40'
const muted = '#718096'
const tones = {
  human: ['#A66D4C', '#F8EEE6'], client: ['#B96850', '#FAEDE6'],
  idp: ['#4168B5', '#EBF1FC'], gateway: ['#456DCD', '#ECF1FE'],
  proxy: ['#287E8B', '#E7F5F5'], mcp: ['#7361B2', '#F0EDFA'],
  api: ['#38836F', '#EAF5EF'], zts: ['#505D80', '#EEF0F8'],
  plugin: ['#7361B2', '#F0EDFA'], file: ['#718096', '#F0F3F7'],
  inactive: ['#9BA5B4', '#F3F5F8']
}
const flows = { blue: '#537AC7', green: '#428B76', red: '#C46864', gray: '#8B96AA', purple: '#8770B1' }
const tokenColors = { access: '#C49A3C', exchanged: '#6295C3' }
const tokenKey = '<g id="access-token-key" transform="rotate(42 22 22)"><path d="M19 15h6v12h5v5h-5v8h-6Z" fill="currentColor"/><circle cx="22" cy="10" r="9" fill="currentColor"/><circle cx="22" cy="9" r="3.2" fill="white"/><path d="M16 8a6 6 0 0 1 9-3M20.5 20v15" fill="none" stroke="white" stroke-opacity=".48" stroke-width="1.4" stroke-linecap="round"/></g>'
const glyphs = {
  human: '<path d="M21 26a11 11 0 1 1 10 0c10 2 17 10 17 20v5H4v-5c0-10 7-18 17-20Z" fill="currentColor"/>',
  client: '<rect x="3" y="5" width="47" height="39" rx="8" fill="white" stroke="currentColor" stroke-width="2.2"/><path d="m12 19 6 6-6 6m13 1h10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="m43 0 2.5 6.5L52 9l-6.5 2.5L43 18l-2.5-6.5L34 9l6.5-2.5Z" fill="currentColor"/>',
  idp: '<path d="M26 2 47 14v24L26 50 5 38V14Z" fill="white" stroke="currentColor" stroke-width="2"/><circle cx="22" cy="23" r="8" fill="none" stroke="currentColor" stroke-width="3"/><path d="m28 29 11 11m-6-6 4-4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  gateway: '<path d="M8 46V24a18 18 0 0 1 36 0v22H33V25a7 7 0 0 0-14 0v21Z" fill="currentColor" opacity=".17"/><path d="M8 46V24a18 18 0 0 1 36 0v22M19 46V25a7 7 0 0 1 14 0v21" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/><path d="M0 32h25m-6-6 6 6-6 6m33 6H28m6-6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
  proxy: '<path d="m26 2 20 7v16c0 12-10 20-20 26C16 45 6 37 6 25V9Z" fill="white" stroke="currentColor" stroke-width="2.2"/><path d="m26 9 13 5v12c0 8-6 14-13 19-7-5-13-11-13-19V14Z" fill="currentColor" opacity=".12"/><path d="m17 25 6 6 13-14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  mcp: '<rect x="9" y="9" width="34" height="34" rx="10" fill="white" stroke="currentColor" stroke-width="2.2"/><path d="M18 1v8m16-8v8M18 43v8m16-8v8M1 18h8m-8 16h8m34-16h8m-8 16h8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="m18 27 6-6a5 5 0 0 1 7 7l-5 5m8-7-6 6a5 5 0 0 1-7-7l5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  api: '<rect x="11" y="2" width="36" height="40" rx="7" fill="currentColor" opacity=".12"/><rect x="5" y="10" width="36" height="40" rx="7" fill="white" stroke="currentColor" stroke-width="2.2"/><path d="m18 22-6 8 6 8m10-16 6 8-6 8" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>',
  zts: '<path d="m26 1 22 12v26L26 51 4 39V13Z" fill="white" stroke="currentColor" stroke-width="2.2"/><path d="m26 9 15 8v17L26 43l-15-9V17Z" fill="currentColor" opacity=".13"/><rect x="18" y="23" width="16" height="14" rx="4" fill="currentColor"/><path d="M21 23v-5a5 5 0 0 1 10 0v5" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M26 28v4" stroke="white" stroke-width="2" stroke-linecap="round"/>',
  plugin: '<path d="M10 9h12a6 6 0 1 1 12 0h10v13a6 6 0 1 1 0 12v12H31a6 6 0 1 0-12 0h-9V34a6 6 0 1 1 0-12Z" fill="white" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="27" cy="27" r="5" fill="currentColor" opacity=".22"/>',
  file: '<path d="M10 3h22l12 12v34H10Z" fill="white" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M32 3v13h12M18 25h18m-18 8h18m-18 8h10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'
}

function connector(points) {
  if (points.length < 2) throw new Error('An edge needs two endpoints')
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const dx = Math.abs(b[0] - a[0])
    const dy = Math.abs(b[1] - a[1])
    // Straight horizontal/vertical routes first; any diagonal must be 45°.
    if (![...a, ...b].every(Number.isFinite) || (dx > 1e-6 && dy > 1e-6 && Math.abs(dx - dy) > 1e-6)) {
      throw new Error(`Connector must be horizontal, vertical, or 45°: ${a} → ${b}`)
    }
  }
  return points.map((point, i) => `${i ? 'L' : 'M'}${point.join(' ')}`).join(' ')
}

export class Architecture {
  constructor(width, height, title, description = title) {
    Object.assign(this, { width, height, title, description, groups: [], wires: [], nodes: [], labels: [] })
  }
  text(x, y, value, { size = 22, weight = 500, color = ink, mono = false, anchor = 'start', spacing } = {}) {
    return `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}"${mono ? ' font-family="Menlo, Consolas, monospace"' : ''}${spacing ? ` letter-spacing="${spacing}"` : ''}>${esc(value)}</text>`
  }
  icon(kind, x, y, size = 44, tone = kind) {
    return `<g transform="translate(${x} ${y}) scale(${size / 52})" color="${tones[tone][0]}">${glyphs[kind]}</g>`
  }
  card(id, x, y, title, { kind = id, sub = [], tag, inactive = false } = {}) {
    const { width: w, height: h } = COMPONENT_SIZE
    const tone = inactive ? 'inactive' : kind
    const [accent, tint] = tones[tone]
    const lines = Array.isArray(title) ? title : [title]
    const details = Array.isArray(sub) ? sub : [sub]
    const parts = [`<g data-component="${esc(id)}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="white" stroke="#DEE4ED" stroke-width="1.2" filter="url(#card-shadow)"/>`]
    parts.push(`<rect x="${x + 22}" y="${y + 20}" width="58" height="58" rx="16" fill="${tint}"/>`, this.icon(kind, x + 31, y + 29, 40, tone))
    if (tag) {
      const tw = tag.length * 8 + 20
      parts.push(`<rect x="${x + w - tw - 20}" y="${y + 29}" width="${tw}" height="25" rx="8" fill="${tint}"/>`, this.text(x + w - tw / 2 - 20, y + 46, tag, { size: 13, weight: 500, color: accent, mono: true, anchor: 'middle' }))
    }
    lines.forEach((line, i) => parts.push(this.text(x + 22, y + 108 + i * 27, line, { size: 24, weight: 600 })))
    details.forEach((line, i) => parts.push(this.text(x + 22, y + h - 20 - (details.length - i - 1) * 22, line, { size: 14, color: muted, mono: true })))
    parts.push('</g>'); this.nodes.push(parts.join(''))
    return { id, x, y, w, h, left: (t = .5) => [x, y + h * t], right: (t = .5) => [x + w, y + h * t], top: (t = .5) => [x + w * t, y], bottom: (t = .5) => [x + w * t, y + h] }
  }
  group(cards, title, { product } = {}) {
    if (!cards.length) throw new Error('A group needs at least one component')
    const padding = 48
    const x = Math.min(...cards.map(card => card.x)) - padding
    const y = Math.min(...cards.map(card => card.y)) - padding
    const w = Math.max(...cards.map(card => card.x + card.w)) - x + padding
    const h = Math.max(...cards.map(card => card.y + card.h)) - y + padding
    this.groups.push(`<rect data-group="${esc(title)}" x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="#F1F3FA" fill-opacity=".8" stroke="#E1E5F0" stroke-width="1"/>${this.text(x + 22, y + 31, title, { size: 14, weight: 600, color: '#7A85A0', spacing: '1.3' })}${product ? this.text(x + w - 22, y + 31, product, { size: 14, color: muted, anchor: 'end' }) : ''}`)
  }
  edge(points, { tone = 'blue', dash = false, label, at, size = 18, secondary, labelWidth, token, tokenAt } = {}) {
    const color = flows[tone]
    const [sx, sy] = points[0]
    this.wires.push(`<path d="${connector(points)}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${dash ? ' stroke-dasharray="4 7"' : ''} marker-end="url(#arrow-${tone})"/><circle cx="${sx}" cy="${sy}" r="3" fill="white" stroke="${color}" stroke-width="1.5"/>`)
    if (label) this.label(...at, label, { tone, size, secondary, width: labelWidth })
    if (token) {
      const [x, y] = tokenAt ?? [(points[0][0] + points.at(-1)[0]) / 2, (points[0][1] + points.at(-1)[1]) / 2]
      this.token(token, x, y)
    }
  }
  token(kind, x, y) {
    if (!tokenColors[kind]) throw new Error(`Unknown token kind: ${kind}`)
    this.labels.push(`<g data-token-kind="${kind}" aria-label="${kind === 'access' ? 'Access token' : 'Exchanged access token'}"><circle cx="${x}" cy="${y}" r="20" fill="#FDFEFF"/><use href="#access-token-key" transform="translate(${x - 19} ${y - 19}) scale(.86)" color="${tokenColors[kind]}"/></g>`)
  }
  label(x, y, value, { tone = 'blue', size = 18, secondary, width } = {}) {
    const error = tone === 'red'
    const iconSpace = error ? 30 : 0
    width = (width ?? Math.max(value.length * size * .53, secondary ? secondary.length * (size - 2) * .6 : 0) + 24) + iconSpace
    const height = secondary ? 52 : 32
    const textX = x + iconSpace / 2
    const c = flows[tone]
    const mark = error ? `<g data-error-mark="true" aria-hidden="true" transform="translate(${x - width / 2 + 17} ${y - 23 + height / 2})"><circle r="10" fill="#FCEDEC"/><path d="M-5 -5L5 5M5 -5L-5 5" fill="none" stroke="#C43D3D" stroke-width="2.8" stroke-linecap="round"/></g>` : ''
    this.labels.push(`<g${error ? ' data-status="error"' : ''}><rect x="${x - width / 2}" y="${y - 23}" width="${width}" height="${height}" rx="9" fill="#FFFFFF" stroke="#E9EDF3" stroke-width=".9"/>${mark}${this.text(textX, y - 1, value, { size, weight: 500, color: c, anchor: 'middle' })}${secondary ? this.text(textX, y + 20, secondary, { size: size - 2, color: muted, mono: true, anchor: 'middle' }) : ''}</g>`)
  }
  svg() {
    const markers = Object.entries(flows).map(([key, color]) => `<marker id="arrow-${key}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="m2 1 6 4-6 4" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>`).join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}" role="img" aria-labelledby="title desc"><title id="title">${esc(this.title)}</title><desc id="desc">${esc(this.description)}</desc><defs>${markers}${tokenKey}<filter id="card-shadow" x="-12%" y="-18%" width="124%" height="148%"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#253B68" flood-opacity=".055"/></filter><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="12" cy="12" r=".7" fill="#C9D2E2" opacity=".38"/></pattern></defs><rect x=".5" y=".5" width="${this.width - 1}" height="${this.height - 1}" rx="26" fill="#FDFEFF" stroke="#E7ECF4"/><rect x="20" y="20" width="${this.width - 40}" height="${this.height - 40}" rx="18" fill="url(#grid)"/><g font-family="Avenir Next, Avenir, Segoe UI, Helvetica, Arial, sans-serif">${this.groups.join('')}${this.wires.join('')}${this.nodes.join('')}${this.labels.join('')}</g></svg>\n`
  }
}
