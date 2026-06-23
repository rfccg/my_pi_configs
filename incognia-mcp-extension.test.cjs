const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const repoRoot = __dirname;
const extensionPath = join(repoRoot, 'pi-base/extensions/incognia-mcp/index.ts');
const source = () => readFileSync(extensionPath, 'utf8');
const readJson = (path) => JSON.parse(readFileSync(join(repoRoot, path), 'utf8'));

test('shared Incognia MCP extension exists and is loaded by both Pi homes', () => {
  assert.equal(existsSync(extensionPath), true, 'missing shared Incognia MCP extension');

  for (const settingsPath of ['agent/settings.json', 'agent-bedrock/settings.json']) {
    const settings = readJson(settingsPath);
    assert.ok(Array.isArray(settings.extensions), `${settingsPath} settings.extensions must be an array`);
    assert.ok(
      settings.extensions.includes('../pi-base/extensions/incognia-mcp'),
      `${settingsPath} must load shared Incognia MCP extension`,
    );
  }
});

test('Incognia MCP extension registers status tool and dynamic prefixed tools', () => {
  const content = source();
  assert.match(content, /name:\s*["']incognia_mcp_list_tools["']/, 'must register helper list/status tool');
  assert.match(content, /incognia_\$\{sanitizeToolName/, 'dynamic MCP tools must be prefixed with incognia_');
  assert.match(content, /pi\.registerTool/, 'must register Pi tools');
  assert.match(content, /tools\/list/, 'must discover MCP tools');
  assert.match(content, /tools\/call/, 'must call MCP tools');
});

test('Incognia MCP extension exposes a generic callable MCP tool after listing dynamic tools', () => {
  const content = source();
  assert.match(content, /name:\s*["']incognia_mcp_call_tool["']/, 'must register a stable proxy tool available before dynamic discovery');
  assert.match(content, /Tool Name[\s\S]*name of the discovered Incognia MCP tool/, 'proxy tool must accept discovered MCP tool name');
  assert.match(content, /refreshTools\(pi, state, \{ interactiveAuth: true \}, true(?:, ctx)?\)/, 'proxy must rethrow refresh/list failures instead of masking timeout/auth errors');
  assert.match(content, /function resolveMcpTool[\s\S]*candidate\.name === requestedName[\s\S]*incognia_\$\{sanitizeToolName\(candidate\.name\)\}` === requestedName/, 'proxy must resolve raw MCP names and prefixed sanitized Pi names');
  assert.match(content, /let tool = resolveMcpTool\(state, params\.name\)[\s\S]*if \(!tool\)[\s\S]*refreshTools\(pi, state, \{ interactiveAuth: true \}, true(?:, ctx)?\)[\s\S]*tool = resolveMcpTool\(state, params\.name\)/, 'proxy must refresh again when cached tools do not include the requested tool');
  assert.match(content, /tools\/call[\s\S]*name: tool\.name/, 'proxy must call the resolved MCP tool');
});

test('Incognia MCP extension applies timeouts to MCP HTTP requests', () => {
  const content = source();
  assert.match(content, /INCOGNIA_MCP_REQUEST_TIMEOUT_MS/, 'must allow request timeout override');
  assert.match(content, /DEFAULT_REQUEST_TIMEOUT_MS/, 'must define default MCP request timeout');
  assert.match(content, /AbortSignal\.timeout\(cfg\.requestTimeoutMs\)/, 'MCP fetch calls must use AbortSignal timeout');
  assert.match(content, /timed out after \$\{cfg\.requestTimeoutMs\}ms/, 'timeout errors must be explicit');
});

test('Incognia MCP extension advertises elicitation client capability', () => {
  const content = source();
  assert.match(content, /capabilities:\s*\{\s*elicitation:\s*\{\s*\}\s*\}/, 'initialize must advertise elicitation capability');
});

test('Incognia MCP extension parses and handles multiple MCP response messages', () => {
  const content = source();
  assert.match(content, /function parseMcpMessages/, 'must parse all JSON-RPC messages from HTTP or SSE responses');
  assert.match(content, /parseSseMessages/, 'must preserve all SSE data messages instead of only the last one');
  assert.match(content, /for \(const message of response\.messages\)/, 'request flow must inspect intermediate messages before final response');
});

test('Incognia MCP extension handles MCP elicitation create requests', () => {
  const content = source();
  assert.match(content, /handleElicitationRequest/, 'must handle server-initiated elicitation/create requests');
  assert.match(content, /method === "elicitation\/create"/, 'must detect MCP elicitation/create method');
  assert.match(content, /extractElicitationUrls/, 'must extract URL-like values from elicitation params');
  assert.match(content, /ctx\.ui\.confirm/, 'must ask the user to accept or decline through Pi UI');
  assert.match(content, /action:\s*accepted \? "accept" : "decline"/, 'must map user decision to MCP elicitation action');
  assert.match(content, /MCP server requested user elicitation, but no interactive UI context was available/, 'no-UI elicitation must fail clearly');
});

test('Incognia MCP extension implements MCP OAuth and Keycloak-compatible discovery', () => {
  const content = source();
  assert.match(content, /INCOGNIA_MCP_BEARER_TOKEN/, 'must support bearer-token fallback');
  assert.match(content, /WWW-Authenticate/i, 'must inspect WWW-Authenticate from MCP auth challenge');
  assert.match(content, /resource_metadata/i, 'must support protected resource metadata discovery');
  assert.match(content, /oauth-protected-resource/, 'must discover MCP protected resource metadata');
  assert.match(content, /oauth-authorization-server/, 'must discover OAuth authorization server metadata');
  assert.match(content, /openIdConfigurationUrl/, 'must include Keycloak-compatible OIDC fallback');
  assert.match(content, /code_challenge_method[\s\S]*S256/, 'must use PKCE S256');
  assert.match(content, /code_verifier/, 'must exchange PKCE verifier for token');
  assert.match(content, /Authorization[\s\S]*Bearer/, 'must send bearer token to MCP');
});

test('Incognia MCP extension uses Incognia-supported protocol version and direct network calls', () => {
  const content = source();
  assert.match(content, /INCOGNIA_MCP_PROTOCOL_VERSION/, 'must allow protocol version override');
  assert.match(content, /2025-11-25/, 'must default to Incognia-supported MCP protocol version');
  assert.match(content, /["']MCP-Protocol-Version["']:\s*mcpProtocolVersion/, 'must send MCP protocol header');
  assert.match(content, /fetch\(/, 'MCP network calls must use direct fetch from Pi process');
  assert.doesNotMatch(content, /gondolin/i, 'MCP traffic must not be routed through Gondolin');
});

test('Incognia MCP extension normalizes and truncates tool output', () => {
  const content = source();
  assert.match(content, /normalizeToolResult/, 'must normalize MCP tool results');
  assert.match(content, /truncateForTool/, 'must truncate large outputs');
  assert.match(content, /50 \* 1024/, 'must cap output bytes');
  assert.match(content, /2000/, 'must cap output lines');
});

test('Incognia MCP extension reinitializes after interactive reauthentication for non-initialize requests', () => {
  const content = source();
  assert.match(content, /const method = typeof payload\.method === "string"/, 'must inspect retried MCP method after reauth');
  assert.match(content, /method !== "initialize"[\s\S]*ensureInitialized\(state, \{ interactiveAuth: false \}(?:, ctx)?\)/, 'must reinitialize session before retrying non-initialize payload after reauth');
});

test('Incognia MCP extension persists OAuth 3LO token sets and renews with refresh_token', () => {
  const content = source();

  assert.match(content, /type\s+OAuthTokenSet/, 'must model full OAuth token sets, not only access-token strings');
  assert.match(content, /refresh_token\??:\s*string/, 'must retain refresh_token from the token endpoint');
  assert.match(content, /expires_at\??:\s*number/, 'must persist an absolute expiry time derived from expires_in');
  assert.match(content, /loadStoredTokenSet/, 'must load a saved token set on startup');
  assert.match(content, /saveStoredTokenSet/, 'must save token sets after login or refresh');
  assert.match(content, /0600|0o600/, 'stored token file must be user-only readable/writable');
  assert.match(content, /chmodSync\(tokenFile, 0o600\)/, 'must enforce user-only permissions even for existing token files');
  assert.match(content, /grant_type[\s\S]*refresh_token/, 'must use OAuth refresh-token grant for renewal');
  assert.match(content, /refreshAccessToken/, 'must implement refresh before interactive auth');
  assert.match(content, /ensureValidAccessToken/, 'must validate/renew access tokens before MCP requests');
  assert.match(content, /INCOGNIA_MCP_TOKEN_FILE/, 'must allow overriding token store location');
  assert.match(content, /refreshAccessToken\(state\.tokenSet\)[\s\S]*state\.sessionId = undefined[\s\S]*state\.initialized = false/, 'refresh-before-request must reset MCP session state');
  assert.match(content, /config\(\)\.bearerToken \|\| state\.tokenSet/, 'session_start must discover tools with a stored token set');
});
