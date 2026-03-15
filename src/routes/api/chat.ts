import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const apiKey = process.env.OPENROUTER_API_KEY

          if (!apiKey) {
            return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            })
          }

          const body = await new Response(request.body).text()
          const { messages } = JSON.parse(body)

          const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
              'HTTP-Referer': 'https://yaad-guard.railway.app',
              'X-Title': 'Yaad Guard',
            },
            body: JSON.stringify({
              model: 'openai/gpt-4o-mini',
              messages,
              stream: false,
            }),
          })

          if (!response.ok) {
            return new Response(JSON.stringify({ error: `API error: ${response.status}` }), {
              status: response.status,
              headers: { 'Content-Type': 'application/json' },
            })
          }

          const data = await response.json()
          return new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (err) {
          return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      },
    },
  },
})
