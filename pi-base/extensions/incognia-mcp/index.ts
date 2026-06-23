import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_ENDPOINT = "https://ai-proxy.incognia.tech/mcp";
const DEFAULT_REDIRECT_URI = "http://localhost:33385/callback";
const DEFAULT_PROTOCOL_VERSION = "2025-11-25";
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const MAX_BYTES = 50 * 1024;
const MAX_LINES = 2000;

type JsonObject = Record<string, unknown>;
type McpTool = { name: string; description?: string; inputSchema?: JsonObject };
type McpRequestResult = { result: unknown; sessionId?: string };
type RefreshOptions = { interactiveAuth: boolean };
type ToolExecutionContext = { ui?: { notify?: (message: string, level?: "info" | "warn" | "error") => void; confirm?: (title: string, message?: string) => Promise<boolean> } };
type OAuthTokenSet = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_at?: number;
  scope?: string;
  client_id?: string;
  token_endpoint?: string;
  resource?: string;
};

type IncogniaState = {
  tokenSet?: OAuthTokenSet;
  sessionId?: string;
  initialized: boolean;
  tools: McpTool[];
  errors: string[];
  registeredToolNames: Set<string>;
};

function config() {
  return {
    endpoint: process.env.INCOGNIA_MCP_URL || DEFAULT_ENDPOINT,
    redirectUri: process.env.INCOGNIA_MCP_REDIRECT_URI || DEFAULT_REDIRECT_URI,
    protocolVersion: process.env.INCOGNIA_MCP_PROTOCOL_VERSION || DEFAULT_PROTOCOL_VERSION,
    clientId: process.env.INCOGNIA_MCP_CLIENT_ID,
    scopes: process.env.INCOGNIA_MCP_SCOPES || "openid profile email",
    bearerToken: process.env.INCOGNIA_MCP_BEARER_TOKEN || "",
    tokenFile: process.env.INCOGNIA_MCP_TOKEN_FILE || join(homedir(), ".config", "pi", "incognia-mcp-token.json"),
    requestTimeoutMs: Number(process.env.INCOGNIA_MCP_REQUEST_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS),
  };
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function randomUrlToken(bytes = 32): string {
  return base64Url(crypto.randomBytes(bytes));
}

function sha256Base64Url(value: string): string {
  return base64Url(crypto.createHash("sha256").update(value).digest());
}

function sanitizeToolName(name: string): string {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized || "tool";
}

function parseSseMessages(body: string): unknown[] {
  const messages: unknown[] = [];
  let dataLines: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
      continue;
    }
    if (line.trim() === "" && dataLines.length > 0) {
      const data = dataLines.join("\n");
      dataLines = [];
      if (data !== "[DONE]") messages.push(JSON.parse(data));
    }
  }
  if (dataLines.length > 0) {
    const data = dataLines.join("\n");
    if (data !== "[DONE]") messages.push(JSON.parse(data));
  }
  return messages;
}

function parseMcpMessages(body: string, contentType: string): unknown[] {
  if (!body.trim()) return [];
  if (contentType.includes("text/event-stream")) return parseSseMessages(body);
  const parsed = JSON.parse(body);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function summarizeBody(body: string): string {
  return body.replace(/\s+/g, " ").slice(0, 500);
}

function extractElicitationUrls(value: unknown): string[] {
  const urls = new Set<string>();
  const visit = (item: unknown) => {
    if (typeof item === "string") {
      for (const match of item.matchAll(/https?:\/\/[^\s)\]}"']+/g)) urls.add(match[0]);
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (item && typeof item === "object") {
      for (const child of Object.values(item as Record<string, unknown>)) visit(child);
    }
  };
  visit(value);
  return [...urls];
}

function parseAuthenticateParams(header: string | null): Record<string, string> {
  const params: Record<string, string> = {};
  if (!header) return params;
  const withoutScheme = header.replace(/^\s*Bearer\s+/i, "");
  const pattern = /([a-zA-Z_][a-zA-Z0-9_-]*)=("(?:[^"\\]|\\.)*"|[^,\s]+)/g;
  for (const match of withoutScheme.matchAll(pattern)) {
    const raw = match[2];
    params[match[1]] = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\"/g, '"') : raw;
  }
  return params;
}

function oauthAuthorizationServerMetadataUrl(issuer: string): string {
  const issuerUrl = new URL(issuer);
  const path = issuerUrl.pathname.replace(/\/$/, "");
  return new URL(`/.well-known/oauth-authorization-server${path}`, issuerUrl.origin).toString();
}

function openIdConfigurationUrl(issuer: string): string {
  const issuerUrl = new URL(issuer);
  const path = issuerUrl.pathname.replace(/\/$/, "");
  return new URL(`${path}/.well-known/openid-configuration`, issuerUrl.origin).toString();
}

function truncateForTool(text: string): string {
  const lines = text.split("\n");
  let output = lines.slice(0, MAX_LINES).join("\n");
  while (Buffer.byteLength(output, "utf8") > MAX_BYTES) output = output.slice(0, -1024);
  const truncated = lines.length > MAX_LINES || Buffer.byteLength(text, "utf8") > MAX_BYTES;
  return truncated ? `${output}\n\n[Output truncated to 2000 lines or 50KB.]` : text;
}

function normalizeToolResult(result: unknown): string {
  const typed = result as { content?: Array<{ type?: string; text?: string }> };
  const textParts = typed.content?.filter((item) => item.type === "text" && typeof item.text === "string").map((item) => item.text) ?? [];
  return truncateForTool(textParts.length > 0 ? textParts.join("\n\n") : JSON.stringify(result, null, 2));
}

function schemaFromMcp(inputSchema: unknown) {
  if (inputSchema && typeof inputSchema === "object") return inputSchema as JsonObject;
  return Type.Object({});
}

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const cfg = config();
  try {
    return await fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(cfg.requestTimeoutMs) });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new Error(`MCP request to ${url} timed out after ${cfg.requestTimeoutMs}ms`);
    throw error;
  }
}

async function fetchJson(url: string, options: RequestInit = {}): Promise<JsonObject> {
  const response = await fetchWithTimeout(url, { redirect: "manual", ...options });
  const body = await response.text();
  if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}: ${summarizeBody(body)}`);
  return JSON.parse(body) as JsonObject;
}

async function discoverProtectedResourceMetadata(endpoint: string, resourceMetadataUrl?: string): Promise<JsonObject> {
  if (resourceMetadataUrl) return fetchJson(resourceMetadataUrl);
  const endpointUrl = new URL(endpoint);
  const candidates = endpointUrl.pathname === "/" ? [
    new URL("/.well-known/oauth-protected-resource", endpointUrl.origin).toString(),
  ] : [
    new URL("/.well-known/oauth-protected-resource" + endpointUrl.pathname, endpointUrl.origin).toString(),
    new URL("/.well-known/oauth-protected-resource", endpointUrl.origin).toString(),
  ];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await fetchJson(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function discoverAuthorizationServerMetadata(protectedResourceMetadata: JsonObject): Promise<JsonObject> {
  const authorizationServers = (protectedResourceMetadata.authorization_servers || protectedResourceMetadata.authorizationServers || []) as string[];
  const issuer = authorizationServers[0] || (protectedResourceMetadata.issuer as string | undefined);
  if (!issuer) throw new Error("MCP OAuth discovery failed: protected resource metadata did not include authorization_servers or issuer");
  const candidates = [oauthAuthorizationServerMetadataUrl(issuer), openIdConfigurationUrl(issuer)];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await fetchJson(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function loadStoredTokenSet(): OAuthTokenSet | undefined {
  try {
    const tokenFile = config().tokenFile;
    if (!existsSync(tokenFile)) return undefined;
    const parsed = JSON.parse(readFileSync(tokenFile, "utf8")) as Partial<OAuthTokenSet>;
    if (typeof parsed.access_token !== "string" || parsed.access_token.length === 0) return undefined;
    return parsed as OAuthTokenSet;
  } catch {
    return undefined;
  }
}

function saveStoredTokenSet(tokenSet: OAuthTokenSet): void {
  const tokenFile = config().tokenFile;
  mkdirSync(dirname(tokenFile), { recursive: true, mode: 0o700 });
  writeFileSync(tokenFile, `${JSON.stringify(tokenSet, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tokenFile, 0o600);
}

function tokenSetFromResponse(token: JsonObject, metadata: JsonObject, clientId: string, resource?: string, previous?: OAuthTokenSet): OAuthTokenSet {
  if (typeof token.access_token !== "string" || token.access_token.length === 0) throw new Error("Token endpoint response did not include access_token");
  const expiresIn = typeof token.expires_in === "number" ? token.expires_in : undefined;
  return {
    access_token: token.access_token,
    refresh_token: typeof token.refresh_token === "string" ? token.refresh_token : previous?.refresh_token,
    token_type: typeof token.token_type === "string" ? token.token_type : previous?.token_type,
    expires_at: expiresIn ? Date.now() + expiresIn * 1000 : previous?.expires_at,
    scope: typeof token.scope === "string" ? token.scope : previous?.scope,
    client_id: clientId,
    token_endpoint: metadata.token_endpoint as string,
    resource,
  };
}

function tokenNeedsRefresh(tokenSet?: OAuthTokenSet): boolean {
  return Boolean(tokenSet?.expires_at && tokenSet.expires_at <= Date.now() + 60_000);
}

async function registerClientIfNeeded(metadata: JsonObject, redirectUri: string, clientId?: string): Promise<string> {
  if (clientId) return clientId;
  const registrationEndpoint = metadata.registration_endpoint as string | undefined;
  if (!registrationEndpoint) throw new Error("MCP OAuth discovery found no registration_endpoint. Set INCOGNIA_MCP_CLIENT_ID for this Keycloak client.");
  const response = await fetchWithTimeout(registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: "Pi Incognia MCP",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Dynamic client registration failed with HTTP ${response.status}: ${summarizeBody(body)}`);
  const registered = JSON.parse(body) as { client_id?: string };
  if (!registered.client_id) throw new Error("Dynamic client registration response did not include client_id");
  return registered.client_id;
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", (error) => {
    console.error(`Failed to open browser for Incognia SSO: ${error.message}`);
  });
  child.unref();
}

function waitForAuthorizationCode(redirectUri: string, expectedState: string): Promise<string> {
  const callbackUrl = new URL(redirectUri);
  const port = Number(callbackUrl.port || 80);
  const path = callbackUrl.pathname;
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const incoming = new URL(req.url || "/", redirectUri);
        if (incoming.pathname !== path) {
          res.writeHead(404).end("Not found");
          return;
        }
        const state = incoming.searchParams.get("state");
        const code = incoming.searchParams.get("code");
        const error = incoming.searchParams.get("error");
        if (error) throw new Error(`OAuth authorization failed: ${error}`);
        if (state !== expectedState) throw new Error("OAuth callback state mismatch");
        if (!code) throw new Error("OAuth callback did not include code");
        res.writeHead(200, { "content-type": "text/plain" }).end("Incognia MCP login complete. You can close this tab.");
        clearTimeout(timeout);
        server.close();
        resolve(code);
      } catch (error) {
        res.writeHead(400, { "content-type": "text/plain" }).end(error instanceof Error ? error.message : String(error));
        clearTimeout(timeout);
        server.close();
        reject(error);
      }
    });
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for OAuth callback"));
    }, 5 * 60 * 1000);
    server.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server.listen(port, callbackUrl.hostname);
  });
}

async function exchangeCodeForToken(metadata: JsonObject, clientId: string, redirectUri: string, code: string, codeVerifier: string, resource?: string): Promise<OAuthTokenSet> {
  const tokenEndpoint = metadata.token_endpoint as string;
  const form = new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirectUri, code_verifier: codeVerifier });
  if (resource) form.set("resource", resource);
  const response = await fetchWithTimeout(tokenEndpoint, { method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body: form });
  const body = await response.text();
  if (!response.ok) throw new Error(`Token exchange failed with HTTP ${response.status}: ${summarizeBody(body)}`);
  return tokenSetFromResponse(JSON.parse(body) as JsonObject, metadata, clientId, resource);
}

async function refreshAccessToken(tokenSet: OAuthTokenSet): Promise<OAuthTokenSet> {
  if (!tokenSet.refresh_token) throw new Error("Stored OAuth token set does not include refresh_token");
  if (!tokenSet.client_id) throw new Error("Stored OAuth token set does not include client_id");
  if (!tokenSet.token_endpoint) throw new Error("Stored OAuth token set does not include token_endpoint");
  const form = new URLSearchParams({ grant_type: "refresh_token", client_id: tokenSet.client_id, refresh_token: tokenSet.refresh_token });
  if (tokenSet.resource) form.set("resource", tokenSet.resource);
  const response = await fetchWithTimeout(tokenSet.token_endpoint, { method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body: form });
  const body = await response.text();
  if (!response.ok) throw new Error(`Token refresh failed with HTTP ${response.status}: ${summarizeBody(body)}`);
  const refreshed = tokenSetFromResponse(JSON.parse(body) as JsonObject, { token_endpoint: tokenSet.token_endpoint }, tokenSet.client_id, tokenSet.resource, tokenSet);
  saveStoredTokenSet(refreshed);
  return refreshed;
}

async function loginWithMcpOAuth(wwwAuthenticateHeader: string | null): Promise<OAuthTokenSet> {
  const cfg = config();
  const authParams = parseAuthenticateParams(wwwAuthenticateHeader); // WWW-Authenticate: Bearer resource_metadata="..."
  const protectedResourceMetadata = await discoverProtectedResourceMetadata(cfg.endpoint, authParams.resource_metadata || authParams.resource || authParams.metadata);
  const authServerMetadata = await discoverAuthorizationServerMetadata(protectedResourceMetadata);
  const clientId = await registerClientIfNeeded(authServerMetadata, cfg.redirectUri, cfg.clientId);
  const codeVerifier = randomUrlToken(64);
  const state = randomUrlToken(24);
  const authorize = new URL(authServerMetadata.authorization_endpoint as string);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", cfg.redirectUri);
  authorize.searchParams.set("scope", cfg.scopes);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", sha256Base64Url(codeVerifier));
  authorize.searchParams.set("code_challenge_method", "S256");
  if (protectedResourceMetadata.resource) authorize.searchParams.set("resource", String(protectedResourceMetadata.resource));
  console.error(`Opening browser for Incognia SSO: ${authorize.toString()}`);
  openBrowser(authorize.toString());
  const code = await waitForAuthorizationCode(cfg.redirectUri, state);
  const tokenSet = await exchangeCodeForToken(authServerMetadata, clientId, cfg.redirectUri, code, codeVerifier, protectedResourceMetadata.resource as string | undefined);
  saveStoredTokenSet(tokenSet);
  return tokenSet;
}

async function ensureValidAccessToken(state: IncogniaState): Promise<void> {
  const cfg = config();
  if (cfg.bearerToken) {
    state.tokenSet = { access_token: cfg.bearerToken, token_type: "Bearer" };
    return;
  }
  if (!state.tokenSet) state.tokenSet = loadStoredTokenSet();
  if (!state.tokenSet || !tokenNeedsRefresh(state.tokenSet)) return;
  state.tokenSet = await refreshAccessToken(state.tokenSet);
  state.sessionId = undefined;
  state.initialized = false;
}

async function readMcpResponseMessages(response: Response, state: IncogniaState, ctx?: ToolExecutionContext): Promise<unknown[]> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const body = await response.text();
    const messages = parseMcpMessages(body, contentType);
    const finalMessages: unknown[] = [];
    for (const message of messages) {
      const typed = message as { method?: string };
      if (typed.method === "elicitation/create") await handleElicitationRequest(state, message, ctx);
      else finalMessages.push(message);
    }
    return finalMessages;
  }

  if (!response.body) return [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const finalMessages: unknown[] = [];
  let buffer = "";
  let dataLines: string[] = [];
  const flushEvent = async () => {
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n");
    dataLines = [];
    if (data === "[DONE]") return;
    const message = JSON.parse(data);
    const typed = message as { method?: string };
    if (typed.method === "elicitation/create") await handleElicitationRequest(state, message, ctx);
    else finalMessages.push(message);
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trimStart());
      else if (line.trim() === "") await flushEvent();
    }
    if (done) break;
  }
  if (buffer.startsWith("data:")) dataLines.push(buffer.slice("data:".length).trimStart());
  await flushEvent();
  return finalMessages;
}

async function postMcp(state: IncogniaState, payload: JsonObject, retryAuth = true, interactiveAuth = false, ctx?: ToolExecutionContext): Promise<{ messages: unknown[]; sessionId?: string }> {
  const cfg = config();
  try {
    await ensureValidAccessToken(state);
  } catch (error) {
    state.tokenSet = undefined;
    state.sessionId = undefined;
    state.initialized = false;
    if (!interactiveAuth) throw error;
  }
  const mcpProtocolVersion = cfg.protocolVersion;
  const headers: Record<string, string> = { accept: "application/json, text/event-stream", "content-type": "application/json", "MCP-Protocol-Version": mcpProtocolVersion };
  if (state.tokenSet?.access_token) headers.Authorization = `${state.tokenSet.token_type || "Bearer"} ${state.tokenSet.access_token}`;
  if (state.sessionId) headers["Mcp-Session-Id"] = state.sessionId;
  const response = await fetchWithTimeout(cfg.endpoint, { method: "POST", headers, body: JSON.stringify(payload), redirect: "manual" });
  const body = response.ok || response.status === 202 ? "" : await response.text();
  if ((response.status === 401 || response.status === 403) && retryAuth) {
    const rejectedTokenSet = state.tokenSet;
    state.tokenSet = undefined;
    state.sessionId = undefined;
    state.initialized = false;
    if (!cfg.bearerToken && rejectedTokenSet?.refresh_token) {
      try {
        state.tokenSet = await refreshAccessToken(rejectedTokenSet);
        return postMcp(state, payload, false, false, ctx);
      } catch {
        state.tokenSet = undefined;
      }
    }
    if (interactiveAuth) {
      state.tokenSet = await loginWithMcpOAuth(response.headers.get("WWW-Authenticate"));
      const method = typeof payload.method === "string" ? payload.method : "";
      if (method !== "initialize") await ensureInitialized(state, { interactiveAuth: false }, ctx);
      return postMcp(state, payload, false, false, ctx);
    }
  }
  if (response.status === 401 || response.status === 403) throw new Error(`Authentication failed with HTTP ${response.status}: ${summarizeBody(body)}`);
  if (!response.ok && response.status !== 202) throw new Error(`MCP request failed with HTTP ${response.status}: ${summarizeBody(body)}`);
  return { messages: await readMcpResponseMessages(response, state, ctx), sessionId: response.headers.get("mcp-session-id") || state.sessionId };
}

async function handleElicitationRequest(state: IncogniaState, message: unknown, ctx?: ToolExecutionContext): Promise<void> {
  const typed = message as { id?: string | number; method?: string; params?: JsonObject };
  if (typed.method !== "elicitation/create") return;
  if (typed.id === undefined) throw new Error("MCP elicitation/create request did not include an id");
  const params = typed.params ?? {};
  const urls = extractElicitationUrls(params);
  const serverMessage = typeof params.message === "string" ? params.message : "MCP server requested user approval.";
  const promptText = [serverMessage, ...urls.map((url) => `URL: ${url}`)].join("\n");
  if (!ctx?.ui?.confirm) {
    throw new Error(`MCP server requested user elicitation, but no interactive UI context was available. ${promptText}`);
  }
  ctx.ui.notify?.(promptText, "info");
  const accepted = await ctx.ui.confirm("MCP approval requested", promptText);
  await postMcp(state, {
    jsonrpc: "2.0",
    id: typed.id,
    result: {
      action: accepted ? "accept" : "decline",
    },
  }, true, false, ctx);
}

function assertJsonRpcSuccess(message: unknown, method: string, id: number): unknown {
  if (!message || typeof message !== "object") throw new Error(`${method} failed: no JSON-RPC response body`);
  const typed = message as { id?: number; error?: { message?: string }; result?: unknown };
  if (typed.id !== id) throw new Error(`${method} failed: unexpected JSON-RPC id ${JSON.stringify(typed.id)}, expected ${id}`);
  if (typed.error) throw new Error(`${method} failed: ${typed.error.message || JSON.stringify(typed.error)}`);
  if (!Object.prototype.hasOwnProperty.call(typed, "result")) throw new Error(`${method} failed: response missing result`);
  return typed.result;
}

let nextId = 1;
async function request(state: IncogniaState, method: string, params: JsonObject = {}, options: RefreshOptions = { interactiveAuth: false }, ctx?: ToolExecutionContext): Promise<McpRequestResult> {
  const id = nextId++;
  const response = await postMcp(state, { jsonrpc: "2.0", id, method, params }, true, options.interactiveAuth, ctx);
  state.sessionId = response.sessionId;
  let finalMessage: unknown;
  for (const message of response.messages) {
    const typed = message as { id?: number; method?: string };
    if (typed.method === "elicitation/create") {
      await handleElicitationRequest(state, message, ctx);
      continue;
    }
    if (typed.id === id) finalMessage = message;
  }
  return { result: assertJsonRpcSuccess(finalMessage, method, id), sessionId: response.sessionId };
}

async function notify(state: IncogniaState, method: string, params: JsonObject = {}, options: RefreshOptions = { interactiveAuth: false }, ctx?: ToolExecutionContext): Promise<void> {
  await postMcp(state, { jsonrpc: "2.0", method, params }, true, options.interactiveAuth, ctx);
}

async function ensureInitialized(state: IncogniaState, options: RefreshOptions, ctx?: ToolExecutionContext): Promise<void> {
  if (state.initialized && state.sessionId) return;
  const cfg = config();
  await request(state, "initialize", { protocolVersion: cfg.protocolVersion, capabilities: { elicitation: {} }, clientInfo: { name: "pi-incognia-mcp", version: "1.0.0" } }, options, ctx);
  await notify(state, "notifications/initialized", {}, options, ctx);
  state.initialized = true;
}

async function refreshTools(pi: ExtensionAPI, state: IncogniaState, options: RefreshOptions = { interactiveAuth: false }, rethrow = false, ctx?: ToolExecutionContext): Promise<void> {
  try {
    const cfg = config();
    if (!state.tokenSet && cfg.bearerToken) state.tokenSet = { access_token: cfg.bearerToken, token_type: "Bearer" };
    await ensureInitialized(state, options, ctx);
    const listed = await request(state, "tools/list", {}, options, ctx);
    state.tools = Array.isArray((listed.result as { tools?: unknown[] }).tools) ? ((listed.result as { tools: McpTool[] }).tools) : [];
    for (const tool of state.tools) registerIncogniaTool(pi, state, tool);
  } catch (error) {
    state.errors.push(error instanceof Error ? error.message : String(error));
    if (rethrow) throw error;
  }
}

function resolveMcpTool(state: IncogniaState, requestedName: string): McpTool | undefined {
  return state.tools.find((candidate) => candidate.name === requestedName || `incognia_${sanitizeToolName(candidate.name)}` === requestedName);
}

function registerIncogniaTool(pi: ExtensionAPI, state: IncogniaState, tool: McpTool): void {
  const toolName = `incognia_${sanitizeToolName(tool.name)}`;
  if (state.registeredToolNames.has(toolName)) return;
  state.registeredToolNames.add(toolName);
  pi.registerTool({
    name: toolName,
    label: `Incognia: ${tool.name}`,
    description: tool.description || `Call Incognia MCP tool ${tool.name}`,
    promptSnippet: `Call Incognia MCP tool ${tool.name}`,
    promptGuidelines: [`Use ${toolName} only for Incognia MCP workflows that match this tool description.`],
    parameters: schemaFromMcp(tool.inputSchema),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      await ensureInitialized(state, { interactiveAuth: true }, ctx);
      const called = await request(state, "tools/call", { name: tool.name, arguments: params as JsonObject }, { interactiveAuth: true }, ctx);
      return { content: [{ type: "text" as const, text: normalizeToolResult(called.result) }], details: { mcpTool: tool.name } };
    },
  });
}

export default function incogniaMcpExtension(pi: ExtensionAPI) {
  const state: IncogniaState = { tokenSet: config().bearerToken ? { access_token: config().bearerToken, token_type: "Bearer" } : loadStoredTokenSet(), initialized: false, tools: [], errors: [], registeredToolNames: new Set() };

  pi.registerTool({
    name: "incognia_mcp_call_tool",
    label: "Call Incognia MCP Tool",
    description: "Call an Incognia MCP tool by its discovered MCP tool name after listing tools.",
    promptSnippet: "Call a discovered Incognia MCP tool by name",
    promptGuidelines: ["Use incognia_mcp_call_tool when a discovered Incognia MCP tool is not directly available as a first-class callable tool."],
    parameters: Type.Object({
      name: Type.String({ description: "Tool Name: name of the discovered Incognia MCP tool, for example dbt__list" }),
      arguments: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Arguments object for the discovered MCP tool" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (state.tools.length === 0) await refreshTools(pi, state, { interactiveAuth: true }, true, ctx);
      let tool = resolveMcpTool(state, params.name);
      if (!tool) {
        await refreshTools(pi, state, { interactiveAuth: true }, true, ctx);
        tool = resolveMcpTool(state, params.name);
      }
      if (!tool) throw new Error(`Incognia MCP tool not found: ${params.name}. Run incognia_mcp_list_tools with refresh=true and use one of the discovered tool names.`);
      await ensureInitialized(state, { interactiveAuth: true }, ctx);
      const called = await request(state, "tools/call", { name: tool.name, arguments: (params.arguments ?? {}) as JsonObject }, { interactiveAuth: true }, ctx);
      return { content: [{ type: "text" as const, text: normalizeToolResult(called.result) }], details: { mcpTool: tool.name } };
    },
  });

  pi.registerTool({
    name: "incognia_mcp_list_tools",
    label: "List Incognia MCP Tools",
    description: "List Incognia MCP tools discovered from the Incognia MCP server and report connection/auth errors.",
    promptSnippet: "List Incognia MCP tools and connection status",
    promptGuidelines: ["Use incognia_mcp_list_tools when you need to inspect available Incognia MCP tools or diagnose Incognia MCP connection status."],
    parameters: Type.Object({ refresh: Type.Optional(Type.Boolean({ description: "Refresh MCP tools before listing" })) }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.refresh) await refreshTools(pi, state, { interactiveAuth: true }, false, ctx);
      const lines = [
        `Endpoint: ${config().endpoint}`,
        `Protocol: ${config().protocolVersion}`,
        `Discovered tools: ${state.tools.length}`,
        ...state.tools.map((tool) => `- incognia_${sanitizeToolName(tool.name)}: ${tool.description || tool.name}`),
      ];
      if (state.errors.length > 0) lines.push("", "Errors:", ...state.errors.map((error) => `- ${error}`));
      return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { toolCount: state.tools.length, errors: state.errors } };
    },
  });

  pi.on("session_start", async () => {
    if (config().bearerToken || state.tokenSet) {
      await refreshTools(pi, state, { interactiveAuth: false });
    } else {
      state.errors.push("Incognia MCP auth required. Run incognia_mcp_list_tools with refresh=true to authenticate.");
    }
  });
}
