// Netlify serverless function — multi-provider AI router
// Supports: Groq (free + BYOK), Anthropic, OpenRouter, OpenAI
// Frontend sends X-Provider, X-API-Key, X-Model headers

const PROVIDERS = {
  "groq-free": {
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
    format: "openai",
  },
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    format: "openai",
    defaultModel: "llama-3.3-70b-versatile",
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    format: "anthropic",
    defaultModel: "claude-sonnet-4-20250514",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    format: "openai",
    defaultModel: "anthropic/claude-sonnet-4",
  },
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    format: "openai",
    defaultModel: "gpt-4o",
  },
};

function buildOpenAIMessages(body) {
  const messages = [];
  if (body.system) {
    const text = typeof body.system === "string" ? body.system : body.system.map(b => b.text || "").join("\n");
    messages.push({ role: "system", content: text });
  }
  for (const msg of (body.messages || [])) {
    if (Array.isArray(msg.content)) {
      if (msg.role === "assistant" && msg.content.some(b => b.type === "tool_use")) {
        const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");
        const toolCalls = msg.content.filter(b => b.type === "tool_use").map(b => ({
          id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input) }
        }));
        messages.push({ role: "assistant", content: text || null, tool_calls: toolCalls.length ? toolCalls : undefined });
        continue;
      }
      if (msg.role === "user" && msg.content.some(b => b.type === "tool_result")) {
        for (const tr of msg.content.filter(b => b.type === "tool_result")) {
          messages.push({ role: "tool", tool_call_id: tr.tool_use_id, content: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content) });
        }
        continue;
      }
      const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");
      if (text.trim()) messages.push({ role: msg.role, content: text });
      continue;
    }
    if (typeof msg.content === "string" && msg.content.trim()) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }
  return messages;
}

function openAIToAnthropic(data) {
  const choice = data.choices?.[0];
  const content = [];
  if (choice?.message?.content) content.push({ type: "text", text: choice.message.content });
  if (choice?.message?.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      if (tc.type === "function") {
        content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments || "{}") });
      }
    }
  }
  return {
    id: data.id || "msg_" + Date.now(),
    type: "message", role: "assistant",
    content,
    model: data.model,
    stop_reason: choice?.finish_reason === "tool_calls" ? "tool_use" : (choice?.finish_reason === "stop" ? "end_turn" : (choice?.finish_reason || "end_turn")),
    usage: { input_tokens: data.usage?.prompt_tokens || 0, output_tokens: data.usage?.completion_tokens || 0 },
  };
}

async function callWithRetry(url, getOpts, apiKeys, maxRetries = 4) {
  let resp;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const key = apiKeys[attempt % apiKeys.length];
    const opts = getOpts(key);
    resp = await fetch(url, opts);
    const isTransient = [429, 502, 503, 504].includes(resp.status);
    if (isTransient && attempt < maxRetries) {
      if (resp.status === 429 && apiKeys.length > 1) {
    // Try the next key quickly if rate limited
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      const ra = resp.headers.get("retry-after");
      const ms = ra ? Math.min(parseInt(ra) * 1000, 60000) : Math.min(2000 * Math.pow(2, attempt), 30000);
      await new Promise(r => setTimeout(r, ms));
      continue;
    }
    break;
  }
  return resp;
}

export default async (req, context) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Provider, X-API-Key, X-Model",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });

  const providerId = req.headers.get("x-provider") || "groq-free";
  const userKey = req.headers.get("x-api-key") || "";
  const userModel = req.headers.get("x-model") || "";
  const provider = PROVIDERS[providerId];

  if (!provider) {
    return new Response(JSON.stringify({ type: "error", error: { type: "invalid_provider", message: `Unknown provider: ${providerId}` } }), { status: 400, headers: cors });
  }

  const apiKeyStr = providerId === "groq-free" ? process.env.GROQ_API_KEY : userKey;

  if (!apiKeyStr) {
    const msg = providerId === "groq-free"
      ? "Server GROQ_API_KEY not set. Get a free key at https://console.groq.com"
      : `No API key for ${providerId}. Add your key in Settings.`;
    return new Response(JSON.stringify({ type: "error", error: { type: "auth_error", message: msg } }), { status: 401, headers: cors });
  }

  const apiKeys = apiKeyStr.split(",").map(k => k.trim()).filter(Boolean);
  if (apiKeys.length === 0) {
    return new Response(JSON.stringify({ type: "error", error: { type: "auth_error", message: "API key is empty." } }), { status: 401, headers: cors });
  }

  try {
    const body = await req.json();
    const model = userModel || provider.defaultModel || provider.model;
    const maxTokens = Math.min(body.max_tokens || 4096, 8000);

    // ── Anthropic native ──────────────────────────────────
    if (provider.format === "anthropic") {
      const aBody = { model, max_tokens: maxTokens, messages: body.messages || [] };
      if (body.system) aBody.system = body.system;
      if (body.tools) aBody.tools = body.tools;

      const resp = await callWithRetry(provider.url, (key) => ({
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(aBody),
      }), apiKeys);

      const data = await resp.json();
      if (!resp.ok) {
        const errMsg = resp.status === 429 ? "Anthropic rate limited — retries exhausted." : (data.error?.message || JSON.stringify(data));
        return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: errMsg } }), { status: resp.status, headers: cors });
      }
      return new Response(JSON.stringify(data), { status: 200, headers: cors });
    }

    // ── OpenAI-compatible (Groq, OpenRouter, OpenAI) ──────
    const getHdrs = (key) => {
      const hdrs = { "Content-Type": "application/json", "Authorization": `Bearer ${key}` };
      if (providerId === "openrouter") {
        hdrs["HTTP-Referer"] = "https://arcanum-mtg-architect.netlify.app";
        hdrs["X-Title"] = "Arcanum MTG Architect";
      }
      return hdrs;
    };

    const oaiBody = { model, max_tokens: maxTokens, temperature: 0.7, messages: buildOpenAIMessages(body) };
    if (body.tools) {
      oaiBody.tools = body.tools.map(t => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema }
      }));
    }

    const resp = await callWithRetry(provider.url, (key) => ({
      method: "POST", headers: getHdrs(key),
      body: JSON.stringify(oaiBody),
    }), apiKeys);

    const data = await resp.json();
    if (!resp.ok) {
      const errMsg = resp.status === 429
        ? `${providerId} rate limited — retries exhausted.`
        : (data.error?.message || JSON.stringify(data));
      return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: errMsg } }), { status: resp.status, headers: cors });
    }

    const rlH = { ...cors };
    const rem = resp.headers.get("x-ratelimit-remaining-requests");
    if (rem) rlH["X-RateLimit-Remaining"] = rem;

    return new Response(JSON.stringify(openAIToAnthropic(data)), { status: 200, headers: rlH });

  } catch (err) {
    return new Response(JSON.stringify({ type: "error", error: { type: "network_error", message: err.message } }), { status: 500, headers: cors });
  }
};

export const config = { path: "/api/chat" };
