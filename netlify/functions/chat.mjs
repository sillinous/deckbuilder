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

    // -- Call Groq --
    const groqBody = {
      model: "llama-3.3-70b-versatile",
      max_tokens: Math.min(body.max_tokens || 4096, 8000),
      temperature: 0.7,
      messages: openaiMessages,
    };

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(groqBody),
    });

    const data = await response.json();

    if (!response.ok) {
      return new Response(JSON.stringify({
        type: "error",
        error: { type: "api_error", message: data.error?.message || JSON.stringify(data) },
      }), { status: response.status, headers: corsHeaders });
    }

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
      status: 200, headers: corsHeaders,
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
