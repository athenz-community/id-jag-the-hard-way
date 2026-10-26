// From the repository root: node tools/render-architecture-diagrams.mjs --core
// Without --core, also render archived diagrams with their original technical meaning.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { addCoreDiagrams } from './core-architecture-diagrams.mjs'

const { values: options } = parseArgs({ options: { core: { type: 'boolean' }, check: { type: 'boolean' } } })
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const palette = { blue: '#1a73e8', green: '#188038', red: '#c5221f', gray: '#5f6368', purple: '#7b4cc0' }
const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const definitions = `
  <g id="human" fill="currentColor"><path d="M12 13a7 7 0 1 1 8 0c6 2 10 7 10 13v4H2v-4c0-6 4-11 10-13Z"/></g>
  <g id="server" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="26" height="11" rx="3"/><rect x="3" y="18" width="26" height="11" rx="3"/><path d="M18 8.5h5m-5 15h5"/><circle cx="9" cy="8.5" r="1"/><circle cx="9" cy="23.5" r="1"/></g>
  <g id="shield" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M16 2 29 7v9c0 7-7 12-13 15C10 28 3 23 3 16V7Z"/><path d="m10 16 4 4 9-10"/></g>
  <g id="key" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><circle cx="10" cy="11" r="7"/><path d="m15 16 13 13m-6-6 4-4m-9-1 4-4"/></g>
  <g id="agent" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="7" width="26" height="21" rx="6"/><path d="M16 7V2m-5 19h10M9 14h1m12 0h1"/></g>
  <g id="exchange" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h24m-6-6 6 6-6 6M29 23H5m6-6-6 6 6 6"/></g>
  <g id="plugin" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v8m12-8v8M7 10h18v7a9 9 0 0 1-18 0Zm9 16v5"/></g>
  <g id="file" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h13l7 7v21H6Zm13 0v8h7M11 17h10m-10 6h10"/></g>
  <g id="lock" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="13" width="22" height="17" rx="3"/><path d="M10 13V8a6 6 0 0 1 12 0v5m-6 7v4"/></g>`

class Diagram {
  constructor(width, height, title, description = title) {
    this.width = width; this.height = height; this.title = title; this.description = description
    this.items = []; this.labels = []
  }
  text(x, y, content, { size = 20, color = 'gray', weight = 400, anchor = 'middle', mono = false } = {}) {
    this.items.push(`<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${palette[color] ?? color}" font-size="${size}" font-weight="${weight}"${mono ? ' font-family="Consolas, Liberation Mono, monospace"' : ''}>${escape(content)}</text>`)
  }
  group(x, y, w, h, title, color = 'blue') {
    this.items.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="20" fill="${color === 'purple' ? '#faf8fd' : '#f8fafd'}" stroke="${color === 'purple' ? '#d8cce9' : '#c4d4ee'}" stroke-width="1.5" stroke-dasharray="6 6"/>`)
    this.text(x + 22, y + 29, title, { size: 18, weight: 600, anchor: 'start', color })
  }
  node(x, y, w, h, title, { sub = [], icon = 'server', color = 'blue', locked = false, size = 23, portrait = false } = {}) {
    const lines = Array.isArray(title) ? title : [title]
    const subtitles = Array.isArray(sub) ? sub : [sub]
    this.items.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="#fff" stroke="#dadce0" stroke-width="1.5"/>`)
    if (portrait) {
      this.items.push(`<circle cx="${x + w / 2}" cy="${y + 96}" r="56" fill="#e8f0fe"/><use href="#${icon}" transform="translate(${x + w / 2 - 26} ${y + 70}) scale(1.625)" color="${palette[color]}"/>`)
      lines.forEach((line, i) => this.text(x + w / 2, y + 208 + i * 28, line, { size: 26, weight: 700, color: '#202124' }))
      subtitles.forEach((line, i) => this.text(x + w / 2, y + h - 20 + i * 24, line, { size: 18 }))
      return
    }
    const iconY = y + Math.min(42, h / 2)
    this.items.push(`<circle cx="${x + 37}" cy="${iconY}" r="23" fill="${color === 'red' ? '#fce8e6' : '#e8f0fe'}"/><use href="#${icon}" transform="translate(${x + 24} ${iconY - 13}) scale(.8125)" color="${palette[color]}"/>`)
    const longest = Math.max(...lines.map((line) => line.length))
    const fontSize = Math.min(size, (w - 86) / (longest * .53))
    lines.forEach((line, i) => this.text(x + 73, y + 39 + i * 27, line, { size: fontSize, weight: 700, anchor: 'start', color: '#202124' }))
    subtitles.forEach((line, i) => this.text(x + w / 2, y + h - 18 - (subtitles.length - i - 1) * 24, line, { size: Math.min(18, (w - 24) / (line.length * .55)), color: 'gray' }))
    if (locked) this.items.push(`<use href="#lock" transform="translate(${x + w - 26} ${y + 9}) scale(.5)" color="#5f6368"/>`)
  }
  label(x, y, lines, { color = 'gray', size = 19, mono = false } = {}) {
    lines = Array.isArray(lines) ? lines : [lines]
    const w = Math.max(...lines.map((line) => line.length)) * size * (mono ? .61 : .53) + 18
    const h = lines.length * (size + 6)
    const parts = [`<rect x="${x - w / 2}" y="${y - size - 3}" width="${w}" height="${h + 4}" rx="5" fill="#fff"/>`]
    lines.forEach((line, i) => parts.push(`<text x="${x}" y="${y + i * (size + 6)}" text-anchor="middle" fill="${palette[color] ?? color}" font-size="${size}"${i === 0 ? ' font-weight="600"' : ''}${mono ? ' font-family="Consolas, Liberation Mono, monospace"' : ''}>${escape(line)}</text>`))
    this.labels.push(parts.join(''))
  }
  edge(points, { color = 'blue', dash = false, label, at, size, mono } = {}) {
    this.items.push(`<path d="${points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ')}" fill="none" stroke="${palette[color]}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"${dash ? ' stroke-dasharray="7 6"' : ''} marker-end="url(#arrow-${color})"/>`)
    if (label) this.label(...at, label, { color, size, mono })
  }
  svg() {
    const markers = Object.entries(palette).map(([name, color]) => `<marker id="arrow-${name}" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto"><path d="m1 1 9 5-9 5Z" fill="${color}"/></marker>`).join('\n')
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}" role="img" aria-labelledby="title description">\n<title id="title">${escape(this.title)}</title>\n<desc id="description">${escape(this.description)}</desc>\n<defs>${markers}${definitions}</defs>\n<rect width="${this.width}" height="${this.height}" rx="20" fill="#fff"/>\n<g font-family="Arial, Helvetica, sans-serif">\n${this.items.join('\n')}\n${this.labels.join('\n')}\n</g>\n</svg>\n`
  }
}

const outputs = new Map()
function add(paths, diagram) {
  for (const path of Array.isArray(paths) ? paths : [paths]) outputs.set(path.replace(/\.png$/, '.svg'), diagram.svg())
}
const shared = (name) => [`tutorials/assets/${name}.png`, `tutorials/open_webui/assets/${name}.png`]

// Simple, pre-authentication API request.
{
  const d = new Diagram(1440, 440, 'Document request and response')
  d.node(64, 88, 280, 264, 'Human', { icon: 'human', portrait: true })
  d.node(1096, 88, 280, 264, 'API service', { portrait: true })
  d.edge([[344, 190], [1096, 190]], { label: 'GET /api/docs', at: [720, 155], mono: true, size: 26 })
  d.edge([[1096, 306], [344, 306]], { color: 'green', dash: true, label: 'Documents', at: [720, 274], size: 24 })
  add('tutorials/assets/04_arc_get_docs_from_api_server.png', d)
}

// Request an access token with the original certificate identity, then use it.
for (const nonAdmin of [false, true]) {
  const d = new Diagram(1720, 780, 'Athenz access token and document request')
  if (nonAdmin) d.group(40, 480, 320, 250, 'human', 'purple')
  d.group(1030, 480, 650, 250, 'api')
  d.node(60, 550, 280, 140, 'Human', { icon: 'human', sub: nonAdmin ? ['human.idjag-learner'] : [] })
  d.node(560, 60, 480, 150, 'Athenz', { icon: 'shield', sub: ['Authorization server'] })
  d.node(1060, 550, 250, 140, nonAdmin ? ['Athenz', 'ZPE'] : ['Token', 'validation'], { icon: 'shield', locked: true })
  d.node(1400, 550, 250, 140, 'API service')
  d.edge([[130, 550], [130, 115], [560, 115]], { label: ['1. Request AT', nonAdmin ? 'human.idjag-learner · X.509' : 'Default root user · X.509'], at: [335, 72] })
  d.edge([[560, 175], [255, 175], [255, 550]], { color: 'green', dash: true, label: '2. Access token', at: [410, 250] })
  d.edge([[340, 600], [1060, 600]], { label: ['3. GET /api/docs', 'Athenz access token'], at: [700, 549], mono: true })
  d.edge([[1310, 600], [1400, 600]], { label: ['4. Validate', 'AT'], at: [1355, 517], size: 17 })
  d.edge([[1500, 690], [1500, 750], [200, 750], [200, 690]], { color: 'green', dash: true, label: '5. Documents', at: [820, 742] })
  add(`tutorials/assets/${nonAdmin ? '08_arc_fetch_at_with_non_admin_certificiate' : '07_arc_get_athenz_at_and_pass_api_req'}.png`, d)
}

// MCP is added in front of the existing API validation layer.
{
  const d = new Diagram(1740, 660, 'MCP server in front of the API')
  d.node(640, 44, 400, 140, 'Athenz', { icon: 'shield', sub: ['Authorization server'] })
  d.group(40, 300, 310, 270, 'human', 'purple')
  d.group(410, 300, 1290, 270, 'api')
  d.node(64, 370, 260, 150, 'Human', { icon: 'human', sub: ['human.idjag-learner'] })
  d.node(450, 370, 290, 150, 'MCP server', { sub: ['api.api-mcp'] })
  d.node(980, 370, 250, 150, 'Athenz ZPE', { icon: 'shield', locked: true })
  d.node(1410, 370, 250, 150, 'API service')
  d.edge([[740, 440], [980, 440]], { label: 'Forward request', at: [860, 420] })
  d.edge([[1230, 440], [1410, 440]], { label: ['Validate AT', 'Forward'], at: [1320, 410], size: 18 })
  add('tutorials/assets/09_arch_mcp_server_for_api.png', d)
}

// The trust relationship is absent at this tutorial stage.
{
  const d = new Diagram(1440, 440, 'Athenz does not yet trust Keycloak')
  d.node(64, 88, 340, 264, 'Keycloak', { icon: 'key', sub: ['Identity provider'], portrait: true })
  d.node(1036, 88, 340, 264, 'Athenz', { icon: 'shield', sub: ['Authorization server'], portrait: true })
  d.edge([[1036, 220], [404, 220]], { color: 'red', dash: true, label: 'Not trusted', at: [720, 192], size: 26 })
  add(shared('14_athenz_not_trusting_keycloak_yet'), d)
}

// Common topology for the staged Open WebUI diagrams. Only original-stage
// relationships are drawn; inactive downstream components remain visible.
function world({ gateway = false, authProxy = true, identity = true, plugin = true, config = true, tokenPolicy = false, idjagPolicy = false, compact = false } = {}) {
  const d = new Diagram(2240, compact ? 720 : 1040, 'Athenz, AI client, MCP, and API architecture')
  if (identity) d.node(90, 70, 360, 160, 'Keycloak', { icon: 'key', sub: ['Identity provider'] })
  if (plugin) {
    d.group(1080, 30, 1100, 315, 'Athenz · Authorization server')
    d.node(1120, 98, 490, 140, 'KeycloakTokenExchangeProvider', { icon: 'plugin', sub: idjagPolicy ? ['ID token → ID-JAG permission'] : [], size: 22 })
    d.node(1770, 98, 370, 140, 'Athenz', { icon: 'shield', sub: tokenPolicy ? ['Token exchange permission'] : ['Authorization server'] })
    if (config) d.node(1240, 270, 250, 58, 'providers.json', { icon: 'file', size: 19 })
  } else {
    d.node(1360, 60, 700, 220, 'Athenz', { icon: 'shield', sub: tokenPolicy ? ['Authorization server', 'Token exchange permission'] : ['Authorization server'] })
  }
  const labelStart = d.labels.length
  if (compact) d.items.push('<g transform="translate(0 -320)">')
  d.group(30, 710, 300, 270, 'human', 'purple')
  d.group(360, 710, gateway ? 650 : 350, 270, 'ai', 'purple')
  d.group(1050, 710, 1150, 270, 'api')
  d.node(60, 778, 240, 148, 'Human', { icon: 'human', sub: ['human.idjag-learner'] })
  d.node(390, 778, 290, 148, 'Open WebUI', { icon: 'agent', sub: ['LLM front-end'] })
  d.text(535, 960, 'Ollama · Gemma 4', { size: 17 })
  if (gateway) d.node(770, 778, 210, 148, ['AI Client', 'Proxy'], { icon: 'exchange' })
  if (authProxy) d.node(1080, 778, 210, 148, ['Authorization', 'proxy'], { icon: 'shield', locked: true, size: 20 })
  const mcpX = authProxy ? 1390 : 1100
  d.node(mcpX, 778, 230, 148, 'MCP server', { sub: ['api.api-mcp'] })
  d.node(1710, 778, 190, 148, ['Athenz', 'ZPE'], { icon: 'shield', locked: true })
  d.node(2000, 778, 170, 148, ['API', 'service'])
  if (authProxy) d.edge([[1290, 850], [1390, 850]], { color: 'gray', label: 'Forward', at: [1340, 828], size: 17 })
  d.edge([[1900, 850], [2000, 850]], { color: 'gray', label: ['Validate AT', 'Forward'], at: [1950, 806], size: 14 })
  if (compact) {
    d.items.push('</g>')
    const runtimeLabels = d.labels.splice(labelStart)
    d.labels.push(`<g transform="translate(0 -320)">${runtimeLabels.join('')}</g>`)
  }
  return d
}

// Installed plugin, trust configuration, and installed client proxy.
for (const stage of ['placed', 'mounted', 'gateway']) {
  const d = world({ gateway: stage === 'gateway', config: stage !== 'placed', compact: true })
  if (stage === 'mounted') {
    d.edge([[1770, 165], [1610, 165]], { color: 'gray', dash: true, label: 'Mount', at: [1690, 143] })
    d.edge([[1120, 165], [450, 165]], { color: 'gray', dash: true, label: 'Trusts', at: [780, 143] })
    d.edge([[1365, 238], [1365, 270]], { color: 'gray', label: 'Uses', at: [1415, 262], size: 17 })
  }
  if (stage === 'gateway') d.edge([[680, 530], [770, 530]], { label: 'Forward', at: [725, 508], size: 17 })
  add(shared(stage === 'placed' ? '14_place_plugin' : stage === 'mounted' ? '14_arc_plugin_mounted_and_used' : '15_ai_client_agent_installed_and_used'), d)
}

// Browser authentication before the ID-JAG flow is configured.
{
  const d = world({ plugin: false })
  d.edge([[135, 778], [135, 390], [195, 390], [195, 230]], { label: ['1. Login', 'Username / password'], at: [260, 360] })
  d.edge([[355, 230], [355, 500], [535, 500], [535, 778]], { label: '2. Redirect to Open WebUI', at: [615, 477] })
  d.edge([[390, 828], [300, 828]], { color: 'green', label: ['3. Sign-in', 'success'], at: [345, 800], size: 14 })
  d.edge([[300, 895], [390, 895]], { label: '4. Prompt', at: [345, 875], size: 16 })
  add('tutorials/open_webui/assets/13_arc_signed_into_ui_with_keycloak.png', d)
}

// ID-JAG permission denial and complete delegated-access flow.
for (const success of [false, true]) {
  const d = world({ gateway: true, idjagPolicy: true, tokenPolicy: success })
  d.edge([[135, 778], [135, 380], [195, 380], [195, 230]], { label: ['1. Login', 'Password'], at: [240, 355] })
  d.edge([[355, 230], [355, 560], [535, 560], [535, 778]], { color: 'green', dash: true, label: '2. ID token', at: [470, 538] })
  d.edge([[390, 828], [300, 828]], { color: 'gray', label: ['3. Prompt', 'screen'], at: [345, 800], size: 14 })
  d.edge([[300, 895], [390, 895]], { label: '4. Prompt', at: [345, 875], size: 16 })
  d.edge([[680, 850], [770, 850]], { label: '5. Forward', at: [725, 828], size: 14 })
  d.edge([[820, 778], [820, 405], [1230, 405], [1230, 238]], { label: ['6. ID token → ID-JAG'], at: [1010, 383], size: 19 })
  d.edge([[1120, 165], [450, 165]], { color: 'gray', dash: true, label: ['7. Validate ID token', 'jwks_uri'], at: [770, 125] })
  d.edge([[1520, 238], [1520, 510], [930, 510], [930, 778]], { color: success ? 'green' : 'red', dash: true, label: success ? '9. ID-JAG' : ['9. Rejected', 'Insufficient permission'], at: [1150, 477] })
  if (success) {
    d.edge([[980, 810], [1020, 810], [1020, 600], [1810, 600], [1810, 238]], { label: ['10. Access token request', 'ID-JAG'], at: [1140, 572], size: 18 })
    d.edge([[1900, 238], [1900, 660], [1040, 660], [1040, 895], [980, 895]], { color: 'green', dash: true, label: '11. Access token', at: [1170, 645], size: 18 })
    d.edge([[980, 850], [1080, 850]], { label: '12. AT', at: [1030, 829], size: 17 })
    d.label(1190, 758, ['13. access on mcp'], { size: 17 })
    d.edge([[1470, 778], [1470, 385], [1990, 385], [1990, 238]], { label: '15. Token exchange', at: [1710, 365], size: 18 })
    d.edge([[2080, 238], [2080, 445], [1590, 445], [1590, 778]], { color: 'green', dash: true, label: '17. Exchanged AT', at: [1740, 425], size: 18 })
    d.edge([[1620, 850], [1710, 850]], { label: ['18. Exchanged AT'], at: [1665, 752], size: 17 })
    d.edge([[2085, 926], [2085, 1010], [180, 1010], [180, 926]], { color: 'green', dash: true, label: '20. Documents', at: [1120, 1000] })
  }
  add(success ? 'tutorials/open_webui/assets/16_arc_get_docs_through_id_jag.png' : shared('15_arc_not_enough_permission_into_idjag'), d)
}

// Manual access-token registration and the subsequent MCP token exchange.
for (const stage of ['denied', 'allowed', 'auth-proxy']) {
  const authProxy = stage === 'auth-proxy'
  const success = stage !== 'denied'
  const d = world({ identity: false, plugin: false, authProxy, tokenPolicy: success })
  d.edge([[135, 778], [135, 130], [1360, 130]], { label: ['1. Request AT', 'human.idjag-learner · X.509'], at: [760, 90] })
  d.edge([[1360, 245], [250, 245], [250, 778]], { color: 'green', dash: true, label: authProxy ? ['2. Access token', 'api:role.api-mcp-accessor', 'api:role.docs-getter'] : '2. Access token', at: [760, 320] })
  d.edge([[300, 828], [390, 828]], { label: ['3. Register', 'AT'], at: [345, 800], size: 14 })
  d.edge([[300, 895], [390, 895]], { label: '4. Prompt', at: [345, 875], size: 16 })
  const targetX = authProxy ? 1080 : 1100
  d.edge([[680, 850], [targetX, 850]], { label: '5. Request with AT', at: [880, 828] })
  if (authProxy) d.label(1190, 758, '6. access on mcp', { size: 17 })
  const mcpRequestX = authProxy ? 1460 : 1180
  const mcpResponseX = authProxy ? 1550 : 1270
  d.edge([[mcpRequestX, 778], [mcpRequestX, 500], [1610, 500], [1610, 280]], { label: `${authProxy ? '8' : '6'}. Token exchange`, at: [1500, 477] })
  d.edge([[1860, 280], [1860, 610], [mcpResponseX, 610], [mcpResponseX, 778]], { color: success ? 'green' : 'red', dash: true, label: success ? `${authProxy ? '9' : '7'}. Exchanged AT` : ['7. Rejected', 'Insufficient exchange permission'], at: [1590, 570] })
  if (success) d.edge([[authProxy ? 1620 : 1330, 850], [1710, 850]], { label: 'Exchanged AT', at: [authProxy ? 1665 : 1510, authProxy ? 744 : 828], size: 17 })
  add(`tutorials/open_webui/assets/${stage === 'denied' ? '10_arc_failed_to_token_exchange' : stage === 'allowed' ? '11_arc_success_to_token_exchange' : '12_arch_architecture_of_mcp_server_with_authorization_proxy'}.png`, d)
}

// Overview diagrams use the component and identity names in their sources.
function overview({ current = false, permissions = false } = {}) {
  const d = new Diagram(2080, permissions ? 1040 : 1100, permissions ? 'ID-JAG permission architecture' : 'ID-JAG architecture')
  d.group(30, 30, 340, 260, 'Keycloak')
  d.group(560, 30, 1480, 260, 'Athenz')
  d.node(60, 90, 280, 150, 'IdP', { icon: 'key' })
  d.node(600, 90, 460, 150, ['IdP authorization', 'server'], { icon: 'plugin' })
  d.node(1570, 90, 430, 150, ['Authorization', 'server'], { icon: 'shield' })
  d.node(60, 740, 300, 160, 'Human', { icon: 'human', sub: ['human.idjag-learner'] })
  d.node(650, 740, 360, 160, ['Requesting agent', '(AI)'], { icon: 'agent', sub: ['ai.open-webui'] })
  d.node(1330, 740, 300, 160, 'MCP', { icon: 'exchange', sub: [permissions ? 'api.api-mcp' : 'api.mcp-api'] })
  d.node(1760, 740, 280, 160, ['Resource', 'server'], { sub: ['api.api'] })
  if (permissions) return d
  d.edge([[600, 166], [340, 166]], { color: 'gray', dash: true, label: current ? 'Fetch JWKS' : 'JWT validation', at: [470, 144] })
  d.edge([[1570, 166], [1060, 166]], { color: 'gray', dash: true, label: 'Mount', at: [1300, 144] })
  if (current) {
    d.edge([[150, 740], [150, 240]], { label: '1. Login', at: [235, 465] })
  } else {
    d.edge([[360, 790], [650, 790]], { label: '1. Login', at: [505, 770] })
    d.edge([[710, 740], [710, 405], [170, 405], [170, 240]], { label: '1.1 Redirect', at: [430, 385] })
    d.edge([[290, 240], [290, 510], [770, 510], [770, 740]], { color: 'green', dash: true, label: '1.2 ID token', at: [495, 490] })
  }
  d.edge([[360, 860], [650, 860]], { label: ['2. Prompt', 'Get docs'], at: [505, 832], size: 18 })
  d.edge([[850, 740], [850, 240]], { label: current ? '3. Request ID-JAG' : ['3. Request ID-JAG', 'ID token'], at: [840, 604], size: 19 })
  d.edge([[940, 240], [940, 740]], { color: 'green', dash: true, label: '4.1 ID-JAG', at: [1020, 680], size: 18 })
  d.edge([[700, 240], [700, 325], [980, 325], [980, 240]], { color: 'gray', label: ['4. Enterprise', 'policies'], at: [840, 307], size: 18 })
  d.edge([[1010, 770], [1140, 770], [1140, 395], [1630, 395], [1630, 240]], { label: ['5. Access token request', 'ID-JAG'], at: [1280, 345] })
  d.edge([[1700, 240], [1700, 475], [1210, 475], [1210, 815], [1010, 815]], { color: 'green', dash: true, label: '5.1 Access token', at: [1320, 453] })
  d.edge([[1010, 860], [1330, 860]], { label: ['6. Request', 'Access token'], at: [1170, 835], size: 18 })
  d.edge([[1390, 740], [1390, 550], [1780, 550], [1780, 240]], { label: ['7. Token exchange', 'Access token'], at: [1560, 525], size: 18 })
  d.edge([[1860, 240], [1860, 635], [1490, 635], [1490, 740]], { color: 'green', dash: true, label: '7.1 Exchanged AT', at: [1650, 615], size: 18 })
  d.edge([[1630, 825], [1760, 825]], { label: ['8. Request', 'Exchanged AT'], at: [1695, 785], size: 17 })
  const validation = current ? 'Token introspection' : 'JWT validation'
  d.edge([[1330, 790], [1280, 790], [1280, 1050], [2060, 1050], [2060, 325], [2000, 325], [2000, 240]], { color: 'gray', dash: true, label: validation, at: [1540, 1040], size: 18 })
  d.edge([[1960, 740], [1960, 240]], { color: 'gray', dash: true, label: validation, at: [1960, 680], size: 18 })
  return d
}
add('assets/full_architecture.png', overview())
add('assets/id-jag-the-hard-way-current-full-architecture.png', overview({ current: true }))
{
  const d = overview({ permissions: true })
  d.edge([[360, 820], [650, 820]], { color: 'gray' })
  d.edge([[1010, 820], [1330, 820]], { color: 'gray' })
  d.edge([[1630, 820], [1760, 820]], { color: 'gray' })
  d.edge([[720, 740], [720, 240]], { color: 'purple', label: ['zts.jag_exchange', 'api:role.mcp-accessor'], at: [715, 405], size: 19 })
  d.edge([[960, 740], [960, 240]], { color: 'purple', label: ['zts.jag_exchange', 'api:role.docs-getter'], at: [965, 565], size: 19 })
  d.edge([[1400, 740], [1400, 365], [1640, 365], [1640, 240]], { color: 'purple', label: ['zts.token_source_exchange', 'api:api'], at: [1470, 340], size: 19 })
  d.edge([[1530, 740], [1530, 540], [1840, 540], [1840, 240]], { color: 'purple', label: ['zts.token_target_exchange', 'api:role.docs-getter'], at: [1695, 510], size: 19 })
  d.edge([[150, 900], [150, 950], [1440, 950], [1440, 900]], { color: 'purple', label: ['access on api:mcp'], at: [785, 940] })
  d.edge([[240, 900], [240, 1010], [1900, 1010], [1900, 900]], { color: 'purple', label: ['get on api:docs'], at: [1070, 1000] })
  add('assets/permission-id-jag-the-hard-way-permission-architecture.png', d)
}

// AI Client Gateway component overview.
{
  const d = new Diagram(1840, 920, 'AI Client Gateway token flow')
  d.group(40, 30, 1760, 240, 'Athenz')
  d.node(80, 90, 480, 140, ['IdP authorization', 'server'], { icon: 'plugin' })
  d.node(1280, 90, 480, 140, ['Authorization', 'server'], { icon: 'shield' })
  d.group(40, 640, 1080, 240, 'Requesting agent · ai.open-webui', 'purple')
  d.node(70, 710, 280, 130, 'AI client', { icon: 'agent' })
  d.node(650, 710, 430, 130, 'AI Client Gateway', { icon: 'exchange' })
  d.node(1480, 710, 320, 130, 'MCP', { sub: ['api.mcp-api'] })
  d.edge([[1280, 158], [560, 158]], { color: 'gray', dash: true, label: 'Mount', at: [920, 136] })
  d.edge([[350, 775], [650, 775]], { label: ['1. ID token'], at: [500, 750] })
  d.edge([[740, 710], [740, 360], [190, 360], [190, 230]], { label: ['2. ID-JAG request', 'ID token'], at: [470, 317] })
  d.edge([[260, 230], [260, 440], [480, 440], [480, 230]], { color: 'gray', label: '3. Enterprise policies', at: [390, 465] })
  d.edge([[540, 230], [540, 555], [820, 555], [820, 710]], { color: 'green', dash: true, label: '3.1 ID-JAG', at: [690, 535] })
  d.edge([[960, 710], [960, 365], [1370, 365], [1370, 230]], { label: ['4. Access token request', 'ID-JAG'], at: [1140, 325] })
  d.edge([[1460, 230], [1460, 500], [1040, 500], [1040, 710]], { color: 'green', dash: true, label: '4.1 Access token', at: [1270, 480] })
  d.edge([[1080, 775], [1480, 775]], { label: ['5. Request', 'Access token'], at: [1280, 725] })
  d.edge([[1680, 710], [1680, 230]], { color: 'gray', dash: true, label: 'JWT validation', at: [1670, 535] })
  add('components/ai_client_gateway/assets/arc_ai_client_gateway.png', d)
}

const corePaths = new Set()
addCoreDiagrams((path, diagram) => {
  corePaths.add(path)
  add(path, diagram)
})

const selected = [...outputs].filter(([path]) => !options.core || corePaths.has(path))
let stale = 0
for (const [path, svg] of selected) {
  const existing = await readFile(resolve(root, path), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (existing === svg) continue
  if (options.check) {
    console.error(`Out of date: ${path}`)
    stale++
  } else {
    await writeFile(resolve(root, path), svg)
    console.log(`Updated: ${path}`)
  }
}
const scope = options.core ? 'core architecture ' : ''
if (options.check) {
  console.log(`Checked ${selected.length} ${scope}SVGs; ${stale} out of date.`)
  if (stale) process.exitCode = 1
} else {
  console.log(`Rendered ${selected.length} ${scope}SVGs.`)
}
