export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { text } = req.body;
  if (!text) return res.status(400).json({ ok: false, error: "No text provided" });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-6",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `Analyze this text and identify verbs that could be replaced with more succinct and potent alternatives. For each verb, suggest 3-4 stronger alternatives and briefly explain why in one short sentence.

Return ONLY a JSON array like this, no other text:
[
  {
    "original": "walked",
    "alternatives": ["strode", "marched", "trudged", "swept"],
    "context": "Conveys direction and intent more vividly than 'walked'."
  }
]

Limit to the 8 most impactful verbs. Text to analyze:
${text}`
      }]
    }),
  });

  const raw = await response.json();
  const content = raw?.content?.[0]?.text || "";
  try {
    const clean = content.replace(/```json|```/g, "").trim();
    const verbs = JSON.parse(clean);
    res.json({ ok: true, verbs });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to parse response" });
  }
}