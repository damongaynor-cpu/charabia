export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { text, docTitle, isSelection } = req.body;

  const systemPrompt = isSelection
    ? `You are a research assistant for fiction writers. The writer has selected a specific passage and wants targeted research on it. Identify 4-6 precise, actionable research topics directly relevant to THIS selection. Return ONLY a JSON object (no markdown, no backticks): {"title": "Selection Research", "suggestions": [{"topic": "Topic Name", "why": "One sentence why this matters for the selected passage", "queries": ["search query 1", "search query 2"]}]}`
    : `You are a research assistant for fiction writers. Given a passage of writing, identify 4-6 specific, actionable research topics the writer should look into. Return ONLY a JSON object (no markdown, no backticks): {"title": "Research", "suggestions": [{"topic": "Topic Name", "why": "One sentence why this matters for the scene", "queries": ["search query 1", "search query 2"]}]}`;

  const userContent = isSelection
    ? `Selected passage from "${docTitle}":\n\n${text}`
    : `Chapter/document: "${docTitle}"\n\nPassage:\n${text}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
    });
    const data = await response.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}