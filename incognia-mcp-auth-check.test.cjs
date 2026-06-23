const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const scriptPath = join(__dirname, 'scripts/incognia-mcp-auth-check.mjs');

test('Incognia MCP auth check script exists and performs minimal MCP handshake', () => {
  assert.equal(existsSync(scriptPath), true, 'missing scripts/incognia-mcp-auth-check.mjs');
  const content = readFileSync(scriptPath, 'utf8');

  assert.match(content, /https:\/\/ai-proxy\.incognia\.tech\/mcp/, 'must default to Incognia MCP endpoint');
  assert.match(content, /INCOGNIA_MCP_URL/, 'must allow endpoint override');
  assert.match(content, /initialize/, 'must perform MCP initialize');
  assert.match(content, /tools\/list/, 'must list MCP tools after authentication');
  assert.match(content, /text\/event-stream/, 'must accept streamable HTTP/SSE MCP responses');
  assert.match(content, /INCOGNIA_MCP_ALLOW_INSECURE_TLS/, 'must expose explicit diagnostic TLS bypass for VM certificate issues');
});

test('Incognia MCP auth check validates JSON-RPC responses strictly', () => {
  const content = readFileSync(scriptPath, 'utf8');

  assert.match(content, /no JSON-RPC response body/, 'requests must fail on empty response bodies');
  assert.match(content, /unexpected JSON-RPC id/, 'requests must validate response ids');
  assert.match(content, /response missing result/, 'requests must require JSON-RPC result');
});

test('diagnostic TLS bypass is restricted to the default Incognia origin', () => {
  const content = readFileSync(scriptPath, 'utf8');

  assert.match(content, /endpointUrl\.origin !== defaultUrl\.origin/, 'TLS bypass must reject custom origins');
  assert.match(content, /only allowed for the default Incognia MCP endpoint/, 'TLS bypass rejection must be explicit');
});

test('Incognia MCP auth check follows MCP OAuth discovery and PKCE flow', () => {
  const content = readFileSync(scriptPath, 'utf8');

  assert.match(content, /WWW-Authenticate/i, 'must inspect WWW-Authenticate from MCP 401 responses');
  assert.match(content, /resource_metadata/i, 'must support MCP protected resource metadata discovery');
  assert.match(content, /oauth-authorization-server/i, 'must discover OAuth authorization server metadata');
  assert.match(content, /code_challenge_method.*S256/s, 'must use PKCE S256');
  assert.match(content, /code_verifier/, 'must send PKCE code_verifier to token endpoint');
  assert.match(content, /authorization_endpoint/, 'must use discovered authorization endpoint');
  assert.match(content, /token_endpoint/, 'must use discovered token endpoint');
  assert.match(content, /localhost/, 'must use local callback authorization-code flow');
});

test('Incognia MCP auth check supports bearer token fallback and token forwarding', () => {
  const content = readFileSync(scriptPath, 'utf8');

  assert.match(content, /INCOGNIA_MCP_BEARER_TOKEN/, 'must support env bearer token fallback');
  assert.match(content, /Authorization.*Bearer/s, 'must forward bearer tokens to MCP');
});

test('Incognia MCP auth check uses resource indicators consistently', () => {
  const content = readFileSync(scriptPath, 'utf8');

  assert.match(content, /endpointUrl\.pathname[\s\S]*oauth-protected-resource" \+ endpointUrl\.pathname[\s\S]*oauth-protected-resource"/, 'must prefer path-specific protected resource metadata');
  assert.match(content, /exchangeCodeForToken\([^)]*resource/s, 'token exchange must accept resource indicator');
  assert.match(content, /if \(resource\) form\.set\("resource", resource\)/, 'token request must include resource indicator when present');
});

test('Incognia MCP auth check uses Keycloak-compatible OIDC discovery fallback', () => {
  const content = readFileSync(scriptPath, 'utf8');

  assert.match(content, /oauthAuthorizationServerMetadataUrl/, 'must have OAuth AS metadata URL builder');
  assert.match(content, /openIdConfigurationUrl/, 'must have OIDC metadata URL builder');
  assert.match(content, /`\$\{path\}\/\.well-known\/openid-configuration`/, 'OIDC discovery must append .well-known under issuer path for Keycloak realms');
});

test('Incognia MCP auth check uses Incognia-supported MCP protocol version header', () => {
  const content = readFileSync(scriptPath, 'utf8');

  assert.match(content, /INCOGNIA_MCP_PROTOCOL_VERSION/, 'must allow protocol version override');
  assert.match(content, /2025-11-25/, 'must default to Incognia-supported protocol version');
  assert.match(content, /"MCP-Protocol-Version": mcpProtocolVersion/, 'must send MCP protocol version header on HTTP requests');
  assert.match(content, /protocolVersion: mcpProtocolVersion/, 'initialize must use configured MCP protocol version');
});

test('Incognia MCP auth check persists OAuth 3LO token sets and refreshes before browser login', () => {
  const content = readFileSync(scriptPath, 'utf8');

  assert.match(content, /refresh_token/, 'must retain refresh_token from the token endpoint');
  assert.match(content, /expires_at/, 'must calculate/store absolute expiry from expires_in');
  assert.match(content, /loadStoredTokenSet/, 'must load a saved token set before authenticating');
  assert.match(content, /saveStoredTokenSet/, 'must save token sets after login or refresh');
  assert.match(content, /0600|0o600/, 'stored token file must be user-only readable/writable');
  assert.match(content, /chmodSync\(tokenFile, 0o600\)/, 'must enforce user-only permissions even for existing token files');
  assert.match(content, /grant_type[\s\S]*refresh_token/, 'must use OAuth refresh-token grant for renewal');
  assert.match(content, /refreshAccessToken/, 'must implement refresh-token renewal');
  assert.match(content, /ensureValidAccessToken/, 'must refresh before falling back to browser-based 3LO');
  assert.match(content, /INCOGNIA_MCP_TOKEN_FILE/, 'must allow overriding token store location');
  assert.match(content, /const authChanged = await ensureValidAccessToken\(\)[\s\S]*if \(authChanged\) sessionId = undefined/, 'refresh-before-request must clear the MCP session id');
});
