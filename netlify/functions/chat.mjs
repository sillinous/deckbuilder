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
      if (msg.content.some(b => b.type === "tool_result")) continue;
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
  return {
    id: data.id || "msg_" + Date.now(),
    type: "message", role: "assistant",
    content: [{ type: "text", text: choice?.message?.content || "" }],
    model: data.model,
    stop_reason: choice?.finish_reason === "stop" ? "end_turn" : (choice?.finish_reason || "end_turn"),
    usage: { input_tokens: data.usage?.prompt_tokens || 0, output_tokens: data.usage?.completion_tokens || 0 },
  };
}

async function callWithRetry(url, opts, maxRetries = 4) {
  let resp;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    resp = await fetch(url, opts);
    if (resp.status === 429 && attempt < maxRetries) {
      const ra = resp.headers.get("retry-after");
      const ms = ra ? Math.min(parseInt(ra) * 1000, 60000) : Math.min(2000 * Math.pow(2.5, attempt), 60000);
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

  const apiKey = providerId === "groq-free" ? process.env.GROQ_API_KEY : userKey;

  if (!apiKey) {
    const msg = providerId === "groq-free"
      ? "Server GROQ_API_KEY not set. Get a free key at https://console.groq.com"
      : `No API key for ${providerId}. Add your key in Settings.`;
    return new Response(JSON.stringify({ type: "error", error: { type: "auth_error", message: msg } }), { status: 401, headers: cors });
  }

  try {
    const body = await req.json();
    const model = userModel || provider.defaultModel || provider.model;
    const maxTokens = Math.min(body.max_tokens || 4096, 8000);

    // ── Anthropic native ──────────────────────────────────
    if (provider.format === "anthropic") {
      const aBody = { model, max_tokens: maxTokens, messages: body.messages || [] };
      if (body.system) aBody.system = body.system;

      const resp = await callWithRetry(provider.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(aBody),
      });

      const data = await resp.json();
      if (!resp.ok) {
        const errMsg = resp.status === 429 ? "Anthropic rate limited — retries exhausted." : (data.error?.message || JSON.stringify(data));
        return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: errMsg } }), { status: resp.status, headers: cors });
      }
      return new Response(JSON.stringify(data), { status: 200, headers: cors });
    }

    // ── OpenAI-compatible (Groq, OpenRouter, OpenAI) ──────
    const hdrs = { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` };
    if (providerId === "openrouter") {
      hdrs["HTTP-Referer"] = "https://arcanum-mtg-architect.netlify.app";
      hdrs["X-Title"] = "Arcanum MTG Architect";
    }

    const resp = await callWithRetry(provider.url, {
      method: "POST", headers: hdrs,
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.7, messages: buildOpenAIMessages(body) }),
    });

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
