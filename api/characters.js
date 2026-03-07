export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { text } = req.body;

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
        max_tokens: 400,
        system: `You are a character name extractor for fiction writers. Extract all character names from the passage. Only return proper names of people or characters. Return ONLY a JSON array of strings, nothing else. Example: ["Alice","Mr. Darcy"]. If none found, return [].`,
        messages: [{ role: "user", content: text.slice(0, 800) }],
      }),
    });
    const data = await response.json();
    const raw = data.content?.map(c => c.text || "").join("").trim();
    const names = JSON.parse(raw.replace(/```json|```/g, "").trim());
    res.status(200).json({ ok: true, names });
  } catch (e) {
    console.error("Characters API error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
}