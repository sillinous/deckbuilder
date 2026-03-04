// Netlify serverless function — Tavily Search Proxy
// Relays search requests from the client securely to Tavily

export default async (req, context) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Tavily-Key",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });

  const userKey = req.headers.get("x-tavily-key") || "";
  const apiKey = userKey || process.env.TAVILY_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "No Tavily API key provided. Please configure one in Settings." }), { status: 401, headers: cors });
  }

  try {
    const body = await req.json();
    if (!body.query) {
      return new Response(JSON.stringify({ error: "Missing query parameter." }), { status: 400, headers: cors });
    }

    const tavilyBody = {
      api_key: apiKey,
      query: body.query,
      search_depth: "advanced",
      include_answer: true,
      max_results: 5,
    };

    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tavilyBody),
    });

    const data = await resp.json();

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: data.detail || data.message || "Tavily search failed." }), { status: resp.status, headers: cors });
    }

    // Format the response into a clean string for the LLM
    let resultString = "";
    if (data.answer) {
      resultString += `SUMMARY:\n${data.answer}\n\n`;
    }
    
    if (data.results && data.results.length > 0) {
      resultString += "TOP SEARCH RESULTS:\n";
      data.results.forEach((r, i) => {
        resultString += `${i + 1}. [${r.title}](${r.url})\n${r.content}\n\n`;
      });
    } else {
      resultString += "No relevant search results found.";
    }

    return new Response(JSON.stringify({ success: true, content: resultString.trim() }), { status: 200, headers: cors });

  } catch (err) {
    return new Response(JSON.stringify({ error: "Network error parsing search request." }), { status: 500, headers: cors });
  }
};

export const config = { path: "/api/search" };
