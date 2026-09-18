// Vercel serverless function — proxies task parsing to the Anthropic API.
// Keeps ANTHROPIC_API_KEY on the server; the browser never sees it.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server' });
    return;
  }

  const { text, today, projects } = req.body || {};
  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'Missing "text" field' });
    return;
  }

  const projectList = Array.isArray(projects) ? projects.join(', ') : '';
  const prompt = `Parse this Russian task: "${text}". Today is ${today || new Date().toLocaleDateString('ru')}. Projects: ${projectList}. Return ONLY JSON: {"title":"...","date":"YYYY-MM-DD or null","time":"HH:MM or null","project":"name or null","priority":"high|med|low or null","notes":"extra or null"}`;

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      res.status(anthropicRes.status).json({ error: 'Anthropic API error', detail: errText });
      return;
    }

    const data = await anthropicRes.json();
    const raw = data.content?.[0]?.text || '';
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    res.status(200).json(parsed);
  } catch (e) {
    res.status(502).json({ error: 'Failed to parse task', detail: String(e) });
  }
};
