import { Architecture, COMPONENT_SIZE } from './architecture-svg.mjs'

// The completed chapter 15 architecture defines the visual vocabulary for every stage.
const auth = (d, x, y, product = true) => d.card('as', x, y, ['Authorization', 'Server (AS)'], { kind: 'zts', sub: product ? ['Athenz'] : [] })
const provider = (d, x, y) => d.card('idp', x, y, 'IdP', { sub: ['Keycloak'] })
const identityAS = (d, x, y, product = true) => d.card('idp-as', x, y, 'IdP AS', { kind: 'plugin', sub: product ? ['Athenz'] : [] })
const agent = (d, x, y, options = {}) => d.card('client', x, y, 'AI Agent', { ...options, sub: ['Codex, Claude Code, etc.', ...(options.sub ?? [])] })
const resource = (d, x, y, options = {}) => d.card('api', x, y, 'Resource Server', { ...options, sub: ['api.idthw-api'] })
const runtime = (d, x, y, options = {}) => d.card('proxy', x, y, ['MCP Runtime', 'Proxy'], { sub: ['mcp.idthw-api-mcp'], ...options })
const mcpServer = (d, x, y, options = {}) => d.card('mcp', x, y, 'MCP server', { sub: ['idthw-demo-api-mcp'], ...options })
const column = index => 48 + index * (COMPONENT_SIZE.width + 120)
const viaY = (from, to, y) => [from, [from[0], y], [to[0], y], to]
const docs = (d, api, client, y) => d.edge(viaY(api.bottom(), client.bottom(), y), { tone: 'green', dash: true, label: 'Documents', at: [(client.bottom()[0] + api.bottom()[0]) / 2, y - 19] })

export function createApiRequestDiagram({ enforced = false } = {}) {
  const d = new Architecture(1160, 392, enforced
    ? 'The Resource Server rejects a document request without an access token'
    : 'Document access with token enforcement disabled')
  const human = d.card('human', 64, 96, 'Human')
  const api = resource(d, 816, 96)
  d.edge([human.right(.3), api.left(.3)], {
    label: 'GET /api/docs', secondary: enforced ? 'No access token' : undefined,
    at: [580, enforced ? 112 : 128]
  })
  d.edge([api.left(.7), human.right(.7)], {
    tone: enforced ? 'red' : 'green', dash: true,
    label: enforced ? '401 Unauthorized' : 'Documents', at: [580, 276]
  })
  return d
}

export function createMcpSuccessDiagram() {
  const d = new Architecture(1432, 392,
    'The AI agent retrieves documents through MCP using an API access token',
    'Claude Code, Codex, or Open WebUI calls get_k8s_docs with the learner\'s API access token in the Authorization bearer header. The MCP server forwards the same token with GET /api/docs. The Resource Server validates the token\'s API audience and document-read permission, then returns 200 OK and documents. MCP returns the document tool result to the AI agent.')
  const client = agent(d, 48, 96)
  const mcp = d.card('mcp', 576, 96, 'MCP server', { sub: ['idthw-demo-api-mcp'] })
  const api = d.card('api', 1104, 96, 'Resource Server', { sub: ['api.idthw-api'], tag: 'api' })

  d.edge([client.right(.3), mcp.left(.3)], {
    label: 'get_k8s_docs', secondary: 'Bearer API token', at: [452, 118], size: 17,
    token: 'access', tokenAt: [452, 196]
  })
  d.edge([mcp.right(.3), api.left(.3)], {
    label: 'GET /api/docs', secondary: 'Same API token', at: [980, 118], size: 17,
    token: 'access', tokenAt: [980, 196]
  })
  d.edge([api.left(.74), mcp.right(.74)], {
    tone: 'green', dash: true, label: '200 OK · documents', at: [980, 278], size: 17
  })
  d.edge([mcp.left(.74), client.right(.74)], {
    tone: 'green', dash: true, label: 'Tool result · docs', at: [452, 278], size: 17
  })
  return d
}

export function createMcpRejectedDiagram() {
  const d = new Architecture(1840, 424,
    'Runtime Proxy rejects a tool call before it reaches MCP or the API',
    'The AI agent calls get_k8s_docs without a valid access token for MCP. MCP Runtime Proxy returns 401 Unauthorized for a missing or invalid token, including a token issued for the API audience. The proxy and MCP server run in the same pod. The MCP server and Resource Server are shown for context but are not called; their downstream connections are gray and dashed.')
  const client = agent(d, 48, 112)
  const proxy = runtime(d, 536, 112, { tag: 'mcp' })
  const mcp = d.card('mcp', 1024, 112, 'MCP server', { sub: ['idthw-demo-api-mcp'], inactive: true })
  const api = d.card('api', 1512, 112, 'Resource Server', { sub: ['api.idthw-api'], tag: 'api', inactive: true })
  d.group([proxy, mcp], 'MCP POD')

  d.edge([client.right(.3), proxy.left(.3)], {
    label: 'get_k8s_docs', secondary: 'No valid MCP AT', at: [432, 135], size: 17
  })
  d.edge([proxy.left(.74), client.right(.74)], {
    tone: 'red', dash: true, label: '401 Unauthorized', at: [432, 294], size: 17
  })
  d.edge([proxy.right(.3), mcp.left(.3)], {
    tone: 'gray', dash: true, label: 'tools/call', secondary: 'Not called', at: [920, 135], size: 17
  })
  d.edge([mcp.right(.3), api.left(.3)], {
    tone: 'gray', dash: true, label: 'GET /api/docs', secondary: 'Not called', at: [1408, 135], size: 17
  })
  return d
}

export function createMcpSharedTokenDirectoryDiagram() {
  const d = new Architecture(1104, 776,
    'Runtime Proxy and MCP share an in-memory API token directory',
    'Inside one MCP pod, Runtime Proxy and the MCP server mount the same access-tokens emptyDir volume at /var/run/idthw-access-tokens. The volume uses memory. After a successful downstream token exchange, the proxy writes a request-specific API token file through its read-write mount, then sends its path in tools/call metadata. MCP reads the same file through its read-only mount. The pod setting fsGroup: 1000 provides shared group access. The proxy removes the file after the response.')
  const proxy = d.card('proxy', 96, 112, ['MCP Runtime', 'Proxy'], { sub: ['auth-proxy'], tag: 'container' })
  const mcp = d.card('mcp', 728, 112, 'MCP server', { sub: ['idthw-demo-api-mcp'], tag: 'container' })
  const volume = d.card('volume', 412, 464, 'Shared token files', {
    kind: 'file', tag: 'Memory', sub: ['access-tokens · emptyDir', '/var/run/idthw-access-tokens']
  })
  d.group([proxy, mcp, volume], 'MCP POD', { product: 'fsGroup: 1000' })

  d.edge([proxy.bottom(), [236, 564], volume.left()], {
    label: '1. Write API token', secondary: 'Read-write mount', at: [236, 392], size: 17,
    token: 'exchanged', tokenAt: [236, 476]
  })
  d.edge([proxy.right(), mcp.left()], {
    tone: 'purple', label: '2. tools/call', secondary: 'File path in _meta', at: [552, 168], size: 17
  })
  d.edge([volume.right(), [868, 564], mcp.bottom()], {
    label: '3. Read API token', secondary: 'Read-only mount', at: [868, 392], size: 17,
    token: 'exchanged', tokenAt: [868, 476]
  })
  return d
}

// Diagram labels describe the current core tutorial; prose remains in Markdown.
export function addCoreDiagrams(add) {
  const save = (name, diagram) => add(`tutorials/assets/core_${name}.svg`, diagram)

  save('04_open_api', createApiRequestDiagram())
  save('04_api_rejected', createApiRequestDiagram({ enforced: true }))

  {
    const d = new Architecture(1000, 744, 'Learner identity and protected API in separate Athenz domains', 'Athenz is the Authorization Server. The human domain contains the new learner identity human.idjag-learner. The api domain contains the protected Resource Server api.idthw-api. The learner has not yet been granted the document-reading role.')
    auth(d, 360, 64)
    const human = d.card('human', 112, 448, 'Human', { sub: ['human.idjag-learner'] })
    const api = resource(d, 608, 448, { tag: 'protected' })
    d.group([human], 'DOMAIN · human')
    d.group([api], 'DOMAIN · api')
    save('07_learner_identity', d)
  }

  for (const learner of [false, true]) {
    const d = new Architecture(1240, 688, 'Certificate authentication and protected API access')
    const human = d.card('human', 64, 376, 'Human', { sub: [learner ? 'human.idjag-learner' : 'user.athenz_admin'] })
    const api = resource(d, 896, 376, { tag: 'api' })
    const zts = auth(d, 500, 64)
    d.edge([[288, human.y], zts.left()], { label: 'Request AT', secondary: 'X.509', at: [294, 262] })
    d.edge([zts.left(.88), human.right(.1)], { tone: 'green', dash: true, label: 'AT · aud=api', at: [535, 328], token: 'access' })
    d.edge([human.right(.45), api.left(.45)], { label: 'GET /api/docs', secondary: 'Access token', at: [620, 432], token: 'access', tokenAt: [620, 501] })
    docs(d, api, human, 632)
    save(learner ? '07_learner_access' : '06_admin_access', d)
  }

  {
    const d = new Architecture(1160, 392, 'MCP initialization and tool discovery succeed without an access token')
    const client = d.card('client', 64, 96, 'MCP client', { sub: ['curl'] })
    const mcp = mcpServer(d, 816, 96)
    d.edge([client.right(.3), mcp.left(.3)], { label: 'initialize · tools/list', at: [580, 122] })
    d.edge([mcp.left(.74), client.right(.74)], { tone: 'green', dash: true, label: 'Server info · tools', at: [580, 278] })
    save('08_mcp_api', d)
  }

  save('09_mcp_success', createMcpSuccessDiagram())
  save('10_mcp_rejected', createMcpRejectedDiagram())
  save('10_shared_api_token_directory', createMcpSharedTokenDirectoryDiagram())

  for (const allowed of [false, true]) {
    const d = new Architecture(1576, 848, allowed
      ? 'Runtime Proxy exchanges the MCP token and MCP retrieves documents'
      : 'Athenz denies Runtime Proxy downstream token exchange')
    const as = auth(d, column(1), 70)
    const client = agent(d, column(0), 440)
    const proxy = runtime(d, column(1), 440, { tag: 'mcp' })
    const mcp = mcpServer(d, column(2), 440, { inactive: !allowed })
    const api = resource(d, column(3), 440, { tag: 'api', inactive: !allowed })
    d.group([proxy, mcp], 'MCP DEPLOYMENT')
    d.edge([proxy.top(.65), as.bottom(.65)], { label: 'Exchange AT', at: [550, 350], token: 'access', tokenAt: [630, 396] })
    d.edge([as.bottom(.9), proxy.top(.9)], {
      tone: allowed ? 'green' : 'red', dash: true,
      label: allowed ? 'API AT' : 'Denied', at: [770, 350],
      token: allowed ? 'exchanged' : undefined, tokenAt: [700, 396]
    })
    d.edge([client.right(.46), proxy.left(.46)], { label: 'mcp AT', at: [388, 504], size: 17, token: 'access', tokenAt: [388, 566] })
    d.edge([proxy.right(.46), mcp.left(.46)], {
      tone: allowed ? 'blue' : 'gray', dash: !allowed,
      label: allowed ? 'Tool + file' : 'Not called', at: [788, 504], size: 16,
      token: allowed ? 'exchanged' : undefined, tokenAt: [788, 566]
    })
    d.edge([mcp.right(.46), api.left(.46)], {
      tone: allowed ? 'blue' : 'gray', dash: !allowed,
      label: allowed ? 'api AT' : 'Not called', at: [1188, 504], size: 17,
      token: allowed ? 'exchanged' : undefined, tokenAt: [1188, 566]
    })
    if (allowed) {
      d.edge(viaY(api.bottom(), client.bottom(), 760), { tone: 'green', dash: true, label: 'Documents · 200 OK', at: [788, 738] })
    } else {
      d.edge([proxy.left(.84), client.right(.84)], { tone: 'red', dash: true, label: '403', at: [388, 650] })
    }
    save(allowed ? '11_exchange_allowed' : '10_exchange_denied', d)
  }

  for (const allowed of [false, true]) {
    const d = new Architecture(1440, 746, 'MCP tool call and downstream token exchange')
    const client = agent(d, 64, 432)
    const mcp = d.card('mcp', 580, 432, 'MCP server', { sub: ['mcp.idthw-api-mcp'] })
    const api = resource(d, 1096, 432, { inactive: !allowed, tag: 'api' })
    const zts = auth(d, 580, 64)
    d.edge([client.right(.45), mcp.left(.45)], { label: 'tools/call', secondary: 'aud=api', at: [462, 488], token: 'access', tokenAt: [462, 556] })
    d.edge([mcp.top(.25), zts.bottom(.25)], { label: 'Exchange AT', at: [524, 341], token: 'access' })
    d.edge([zts.bottom(.75), mcp.top(.75)], { tone: allowed ? 'green' : 'red', dash: true, label: allowed ? 'AT · aud=api' : 'Permission denied', at: [912, 341], token: allowed ? 'exchanged' : undefined })
    if (allowed) {
      d.edge([mcp.right(.45), api.left(.45)], { label: 'GET /api/docs', secondary: 'Exchanged AT', at: [978, 488], token: 'exchanged', tokenAt: [978, 556] })
      docs(d, api, client, 690)
    }
    save(allowed ? '10_exchange_allowed' : '09_exchange_denied', d)
  }

  {
    const d = new Architecture(1576, 824, 'Protected MCP calls use separate MCP and API audiences')
    const client = agent(d, column(0), 456)
    const proxy = d.card('proxy', column(1), 456, ['MCP Runtime', 'Proxy'], { tag: 'mcp' })
    const mcp = d.card('mcp', column(2), 456, 'MCP server', { sub: ['mcp.idthw-api-mcp'] })
    const api = resource(d, column(3), 456, { tag: 'api' })
    const zts = auth(d, column(2), 64)
    d.group([proxy, mcp], 'MCP DEPLOYMENT')
    d.edge([client.right(.43), proxy.left(.43)], { label: 'AT · mcp', at: [388, 514], size: 17, token: 'access', tokenAt: [388, 576] })
    d.edge([proxy.right(.43), mcp.left(.43)], { label: 'tools/call', at: [788, 514], size: 17, token: 'access', tokenAt: [788, 576] })
    d.edge([mcp.right(.43), api.left(.43)], { label: 'AT · api', at: [1188, 514], size: 17, token: 'exchanged', tokenAt: [1188, 576] })
    d.edge([mcp.top(.25), zts.bottom(.25)], { label: 'Exchange AT', at: [806, 344], token: 'access' })
    d.edge([zts.bottom(.75), mcp.top(.75)], { tone: 'green', dash: true, label: 'AT · aud=api', at: [1166, 374], token: 'exchanged' })
    docs(d, api, client, 764)
    save('11_protected_mcp', d)
  }

  {
    const d = new Architecture(1160, 392, 'MCP Runtime Proxy rejects a token for the API audience')
    const client = agent(d, 64, 96, { tag: 'api', sub: ['aud=api'] })
    const proxy = d.card('proxy', 816, 96, ['MCP Runtime', 'Proxy'], { tag: 'mcp' })
    d.edge([client.right(.3), proxy.left(.3)], { label: 'tools/call', at: [580, 128], token: 'access', tokenAt: [580, 188] })
    d.edge([proxy.left(.7), client.right(.7)], { tone: 'red', dash: true, label: '401 Unauthorized', secondary: 'Wrong audience', at: [580, 278] })
    save('11_mcp_rejected', d)
  }

  {
    const d = new Architecture(1160, 392, 'The IdP AS does not yet trust the IdP')
    const idp = provider(d, 64, 96)
    const zts = identityAS(d, 816, 96)
    d.edge([zts.left(), idp.right()], { tone: 'red', dash: true, label: 'Not trusted', at: [580, 168], size: 20 })
    save('12_idp_untrusted', d)
  }

  {
    const d = new Architecture(1160, 744, 'The IdP signs the human into Open WebUI',
      'The human signs in with Keycloak. The OIDC redirect completes sign-in to Open WebUI, where the human can submit a prompt. This stage does not yet establish Athenz trust or ID-JAG delegation.')
    const human = d.card('human', 64, 448, 'Human', { sub: ['human.idjag-learner'] })
    const idp = provider(d, 816, 64)
    const client = d.card('client', 816, 448, 'AI Agent', { sub: ['Open WebUI'] })
    d.edge([human.top(.4), [176, 164], idp.left()], { label: 'Login', at: [480, 136] })
    d.edge([idp.bottom(), client.top()], { tone: 'green', dash: true, label: 'OIDC redirect', at: [956, 360] })
    d.edge([client.left(.75), human.right(.75)], { tone: 'green', dash: true, label: 'Signed in', at: [580, 638] })
    d.edge([human.right(.32), client.left(.32)], { label: 'Prompt', at: [580, 484] })
    add('tutorials/open_webui/assets/core_12_sign_in.svg', d)
  }

  {
    const d = new Architecture(600, 424, 'Token exchange provider installed in the IdP AS')
    const plugin = d.card('plugin', 160, 112, ['Token exchange', 'provider'], { sub: ['keycloak-token-provider.jar'] })
    d.group([plugin], 'IdP AS', { product: 'Athenz' })
    save('13_provider_installed', d)
  }

  {
    const d = new Architecture(1352, 456, 'The IdP AS verifies the IdP token')
    const idp = provider(d, 64, 128)
    const plugin = d.card('plugin', 580, 128, ['Token exchange', 'provider'], { sub: ['human.idjag-learner'] })
    const file = d.card('file', 976, 128, 'providers.json')
    d.group([plugin, file], 'IdP AS', { product: 'Athenz' })
    d.edge([plugin.left(), idp.right()], { tone: 'gray', dash: true, label: 'Verify with JWKS', at: [462, 200] })
    d.edge([file.left(), plugin.right()], { tone: 'gray', label: 'Config', at: [918, 200], size: 16 })
    save('13_provider_trust', d)
  }

  for (const webUi of [false, true]) {
    const d = new Architecture(1624, 808, 'Configured AI client gateway and protected MCP route')
    const idp = provider(d, column(1), 80)
    const idpAs = identityAS(d, column(2), 80, false)
    const as = auth(d, column(3), 80, false)
    d.group([idpAs, as], 'Athenz')
    const client = webUi ? d.card('client', column(0), 528, 'AI Agent', { sub: ['Open WebUI'] }) : agent(d, column(0), 528)
    const gateway = d.card('gateway', column(1), 528, ['AI Client', 'Gateway'], { sub: [webUi ? 'ai.open-webui' : 'human.idjag-learner.claude'] })
    const proxy = runtime(d, column(2), 528)
    const mcp = mcpServer(d, column(3), 528)
    d.group([proxy, mcp], 'MCP DEPLOYMENT')
    if (webUi) {
      d.edge([client.top(), [188, 180], idp.left()], { tone: 'gray', dash: true, label: 'OIDC', at: [188, 418] })
    } else {
      d.edge([gateway.top(), idp.bottom()], { tone: 'gray', dash: true, label: 'OIDC', at: [516, 418] })
    }
    d.edge(viaY(gateway.top(.7), idpAs.bottom(.25), 380), { tone: 'gray', dash: true, label: 'ID token → ID-JAG', at: [781, 360] })
    d.edge(viaY(gateway.top(.9), as.bottom(.25), 440), { tone: 'gray', dash: true, label: 'ID-JAG → AT', at: [1060, 420] })
    d.edge([client.right(.43), gateway.left(.43)], { label: webUi ? 'HTTP' : 'MCP', at: [388, 586], size: 17 })
    d.edge([gateway.right(.43), proxy.left(.43)], { label: 'Upstream', at: [788, 586], size: 17 })
    d.edge([proxy.right(.43), mcp.left(.43)], { label: 'MCP', at: [1188, 586], size: 17 })
    if (webUi) add('tutorials/open_webui/assets/core_14_gateway_route.svg', d)
    else save('14_gateway_route', d)
  }

  for (const webUi of [false, true]) {
    const d = new Architecture(1432, 728, 'Sign-in succeeds before ID-JAG delegation is denied')
    const human = d.card('human', 64, 64, 'Human')
    const idp = provider(d, 480, 64)
    const zts = identityAS(d, 1088, 64)
    const client = webUi ? d.card('client', 64, 440, 'AI Agent', { sub: ['Open WebUI'] }) : agent(d, 64, 440)
    const gateway = d.card('gateway', 480, 440, ['AI Client', 'Gateway'], { sub: [webUi ? 'ai.open-webui' : 'human.idjag-learner.claude'] })
    d.edge([human.right(.44), idp.left(.44)], { label: 'Login', at: [412, 124] })
    d.edge([human.bottom(), client.top()], { label: 'Prompt', at: [204, 360] })
    if (webUi) {
      d.edge(viaY(idp.bottom(.1), client.top(.85), 350), { tone: 'green', dash: true, label: 'ID token', at: [405, 326] })
    } else {
      d.edge([idp.bottom(), gateway.top()], { tone: 'green', dash: true, label: 'ID token', at: [700, 356] })
    }
    d.edge([client.right(.4), gateway.left(.4)], { label: webUi ? 'HTTP' : 'MCP', secondary: webUi ? 'ID token' : undefined, at: [412, 488] })
    d.edge([gateway.right(.4), [1158, 520], zts.bottom(.25)], { label: 'ID token → ID-JAG', at: [924, 488] })
    d.edge([zts.bottom(.75), [1298, 588], gateway.right(.74)], { tone: 'red', dash: true, label: 'Permission denied', secondary: 'zts.jag_exchange', at: [924, 630] })
    if (webUi) add('tutorials/open_webui/assets/core_14_idjag_denied.svg', d)
    else save('14_idjag_denied', d)
  }

  for (const [directory, identity, protocol] of [
    ['', 'human.idjag-learner.claude', 'MCP'],
    ['codex/', 'human.idjag-learner.codex', 'MCP'],
    ['open_webui/', 'ai.open-webui', 'HTTP']
  ]) {
    const d = new Architecture(1976, 1008, 'Core tutorial: an AI agent retrieves API documents for a signed-in user', 'The IdP authenticates the human and returns the ID token to AI Client Gateway. The gateway obtains ID-JAG and an MCP access token from Athenz. Athenz ZTS mounts the Keycloak token exchange provider used by its IdP AS role. Runtime Proxy validates and exchanges that token, supplying a request-specific API token file to the MCP server. The API validates the API token and returns documents.')
    const human = d.card('human', column(0), 80, 'Human', { sub: ['human.idjag-learner'] })
    const idp = provider(d, column(1), 80)
    const idpAs = identityAS(d, column(2), 80, false)
    const as = auth(d, column(3), 80, false)
    d.group([idpAs, as], 'Athenz')
    const client = agent(d, column(0), 640)
    const gateway = d.card('gateway', column(1), 640, ['AI Client', 'Gateway'], { sub: [identity] })
    const proxy = runtime(d, column(2), 640, { tag: 'mcp' })
    const mcp = mcpServer(d, column(3), 640)
    const api = resource(d, column(4), 640, { tag: 'api' })
    d.group([proxy, mcp], 'MCP DEPLOYMENT')
    d.edge([as.left(.42), idpAs.right(.42)], { tone: 'gray', dash: true, label: 'Mount plugin', at: [1188, 136], size: 16, labelWidth: 114 })
    d.edge([human.right(.42), idp.left(.42)], { label: 'Login', at: [388, 136], size: 17 })
    d.edge([human.bottom(), client.top()], { label: 'Prompt', at: [188, 460] })
    d.edge([idp.bottom(.1), gateway.top(.1)], { tone: 'green', dash: true, label: 'ID token', at: [476, 585] })
    d.edge([idpAs.left(.42), idp.right(.42)], { tone: 'gray', dash: true, label: 'JWKS', at: [788, 136] })
    d.edge(viaY(gateway.top(.3), idpAs.bottom(.2), 350), { label: 'ID token', at: [714, 330] })
    d.edge(viaY(idpAs.bottom(.4), gateway.top(.5), 410), { tone: 'green', dash: true, label: 'ID-JAG', at: [774, 390] })
    d.edge(viaY(gateway.top(.7), as.bottom(.1), 470), { label: 'ID-JAG', at: [1072, 450] })
    d.edge(viaY(as.bottom(.25), gateway.top(.9), 530), { tone: 'green', dash: true, label: 'AT · aud=mcp', at: [1112, 510], token: 'access', tokenAt: [1208, 530] })
    d.edge(viaY([1030, proxy.y], as.bottom(.55), 564), { label: 'Exchange AT', at: [1402, 340], token: 'access', tokenAt: [1402, 550] })
    d.edge(viaY(as.bottom(.85), [1090, proxy.y], 584), { tone: 'green', dash: true, label: 'AT · aud=api', at: [1486, 470], token: 'exchanged', tokenAt: [1486, 396] })
    d.edge([client.right(.46), gateway.left(.46)], { label: protocol, at: [388, 704], size: 17 })
    d.edge([gateway.right(.46), proxy.left(.46)], { label: 'mcp AT', at: [788, 704], size: 17, token: 'access', tokenAt: [788, 766] })
    d.edge([proxy.right(.46), mcp.left(.46)], { label: 'Tool + file', at: [1188, 704], size: 16, token: 'exchanged', tokenAt: [1188, 766] })
    d.edge([mcp.right(.46), api.left(.46)], { label: 'api AT', at: [1588, 704], size: 17, token: 'exchanged', tokenAt: [1588, 766] })
    docs(d, api, client, 948)
    add(`tutorials/${directory}assets/core_15_idjag_flow.svg`, d)
  }

  {
    const d = new Architecture(1400, 856, 'Core tutorial delegation permissions')
    const rows = [
      { y: 64, kind: 'human', title: 'Human', sub: 'human.idjag-learner', label: 'Member', lines: ['mcp:role.mcp-accessor', 'api:role.docs-getter'] },
      { y: 328, kind: 'gateway', title: ['AI Client', 'Gateway'], sub: 'human.idjag-learner.claude', label: 'zts.jag_exchange', lines: ['mcp:role.mcp-accessor', 'api:role.docs-getter'] },
      { y: 592, kind: 'mcp', title: 'MCP server', sub: 'mcp.idthw-api-mcp', label: 'Exchange', lines: ['zts.token_source_exchange · mcp:api', 'zts.token_target_exchange', 'api:mcp:role.docs-getter'] }
    ]
    for (const row of rows) {
      const service = d.card(row.kind, 64, row.y, row.title, { sub: [row.sub] })
      d.nodes.push(`<rect x="736" y="${row.y}" width="600" height="${COMPONENT_SIZE.height}" rx="18" fill="#F7F6FB" stroke="#E5E0EE" stroke-width="1.2"/>`)
      const firstLineY = row.y + COMPONENT_SIZE.height / 2 - (row.lines.length - 1) * 37 / 2 + 6
      row.lines.forEach((line, i) => d.nodes.push(d.text(764, firstLineY + i * 37, line, { size: 18, mono: true, color: '#5C5575' })))
      d.edge([service.right(.45), [736, service.right(.45)[1]]], { tone: 'purple', label: row.label, at: [540, service.right(.45)[1] - 29] })
    }
    save('permissions', d)
  }
}
