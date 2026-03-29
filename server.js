import express from 'express'
import cors from 'cors'

const app = express()
const PORT = 3001

app.use(cors())
app.use(express.json())

app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.VITE_ANTHROPIC_KEY || process.env.ANTHROPIC_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_KEY not set in environment' })
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    })

    const data = await upstream.json()
    res.status(upstream.status).json(data)
  } catch (err) {
    console.error('Proxy error:', err.message)
    res.status(502).json({ error: 'Upstream request failed', detail: err.message })
  }
})

app.listen(PORT, () => {
  console.log(`First Perp proxy running on http://localhost:${PORT}`)
})
