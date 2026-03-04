// Netlify serverless function — proxies to Groq (free tier)
// Translates Anthropic message format <-> OpenAI format so frontend needs zero changes
// Get free key: https://console.groq.com -> API Keys

export default async (req, context) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: corsHeaders,
    });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "GROQ_API_KEY not configured. Get a free key at https://console.groq.com" }),
      { status: 500, headers: corsHeaders }
    );
  }

  try {
    const body = await req.json();

    // -- Transform Anthropic format -> OpenAI format --
    const openaiMessages = [];

    // System prompt
    if (body.system) {
      const sysText = typeof body.system === "string"
        ? body.system
        : body.system.map(b => b.text || "").join("\n");
      openaiMessages.push({ role: "system", content: sysText });
    }

    // Messages: filter out tool_use/tool_result blocks from Anthropic multi-turn
    for (const msg of (body.messages || [])) {
      // Skip tool result messages (array of {type:"tool_result"} objects)
      if (Array.isArray(msg.content)) {
        const hasToolResult = msg.content.some(b => b.type === "tool_result");
        if (hasToolResult) continue;

        // Assistant messages with mixed content blocks (text + tool_use)
        const textParts = msg.content
          .filter(b => b.type === "text")
          .map(b => b.text)
          .join("\n");

        if (textParts.trim()) {
          openaiMessages.push({ role: msg.role, content: textParts });
        }
        continue;
      }

      // Simple string content
      if (typeof msg.content === "string" && msg.content.trim()) {
        openaiMessages.push({ role: msg.role, content: msg.content });
      }
    }

    // -- Call Groq with retry on rate limit --
    const groqBody = {
      model: "llama-3.3-70b-versatile",
      max_tokens: Math.min(body.max_tokens || 4096, 8000),
      temperature: 0.7,
      messages: openaiMessages,
    };

    let response, data;
    const maxRetries = 4;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(groqBody),
      });

      if (response.status === 429 && attempt < maxRetries) {
        // Exponential backoff: 2s, 5s, 12s, 30s
        const retryAfter = response.headers.get("retry-after");
        const waitMs = retryAfter
          ? Math.min(parseInt(retryAfter) * 1000, 60000)
          : Math.min(2000 * Math.pow(2.5, attempt), 60000);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      break;
    }

    data = await response.json();

    if (!response.ok) {
      const errMsg = response.status === 429
        ? "Rate limited by Groq — retries exhausted. Wait 30-60 seconds and try again."
        : (data.error?.message || JSON.stringify(data));
      return new Response(JSON.stringify({
        type: "error",
        error: { type: "api_error", message: errMsg },
      }), { status: response.status, headers: corsHeaders });
    }

    // Forward rate limit info
    const rlHeaders = { ...corsHeaders };
    const remaining = response.headers.get("x-ratelimit-remaining-requests");
    const resetMs = response.headers.get("x-ratelimit-reset-requests");
    if (remaining) rlHeaders["X-RateLimit-Remaining"] = remaining;
    if (resetMs) rlHeaders["X-RateLimit-Reset"] = resetMs;

    // -- Transform OpenAI response -> Anthropic format --
    const choice = data.choices?.[0];
    const text = choice?.message?.content || "";

    const anthropicResponse = {
      id: data.id || "msg_" + Date.now(),
      type: "message",
      role: "assistant",
      content: [{ type: "text", text }],
      model: data.model,
      stop_reason: choice?.finish_reason === "stop" ? "end_turn" : (choice?.finish_reason || "end_turn"),
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0,
      },
    };

    return new Response(JSON.stringify(anthropicResponse), {
      status: 200, headers: rlHeaders,
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ type: "error", error: { type: "network_error", message: err.message } }),
      { status: 500, headers: corsHeaders }
    );
  }
};

export const config = {
  path: "/api/chat",
};
