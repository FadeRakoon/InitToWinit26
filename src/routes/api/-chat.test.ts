import { describe, expect, it } from 'vitest'
import handler from '../../../server/api/chat.post'

describe('/api/chat', () => {
  it('rejects malformed Winston chat payloads', async () => {
    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messages: [],
      }),
    })
    const response = await handler({
      method: 'POST',
      headers: request.headers,
      context: {},
      path: '/api/chat',
      node: {} as never,
      req: request,
      request,
      response: {} as never,
      res: {} as never,
      url: new URL(request.url),
      waitUntil: () => {},
      web: {} as never,
    } as never)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid Winston chat payload.',
    })
  })
})
