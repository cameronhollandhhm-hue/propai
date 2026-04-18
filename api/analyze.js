export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "No text provided" });
  }

  try {
    // TEMP FAKE RESPONSE (we’ll upgrade this later)
    return res.status(200).json({
      score: 7,
      summary: "This looks like a decent deal, but needs more validation.",
      input: text
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
