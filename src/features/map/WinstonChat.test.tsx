// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { WinstonChat } from './WinstonChat'
import type { WinstonRegion } from './winstonChatSchema'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: unknown }) => children,
  motion: new Proxy(
    {},
    {
      get: () =>
        ({ children, ...props }: { children?: unknown }) =>
          children ?? null,
    },
  ),
}))

vi.mock('@ai-sdk/react', async () => {
  const React = await import('react')

  return {
    useChat: () => {
      const [messages, setMessages] = React.useState<any[]>([])
      const [status, setStatus] = React.useState<'ready' | 'submitted' | 'streaming' | 'error'>('ready')
      const stop = React.useRef(vi.fn()).current
      const clearError = React.useRef(vi.fn()).current

      return {
        id: 'mock-chat',
        messages,
        setMessages,
        status,
        error: undefined,
        stop,
        clearError,
        regenerate: vi.fn(),
        resumeStream: vi.fn(),
        addToolResult: vi.fn(),
        addToolOutput: vi.fn(),
        addToolApprovalResponse: vi.fn(),
        sendMessage: async ({ text }: { text: string }) => {
          setStatus('submitted')
          setMessages((current) => [
            ...current,
            {
              id: `user-${current.length + 1}`,
              role: 'user',
              parts: [
                {
                  type: 'text',
                  text,
                },
              ],
            },
          ])
          setStatus('streaming')
          setMessages((current) => [
            ...current,
            {
              id: `assistant-${current.length + 1}`,
              role: 'assistant',
              parts: [
                {
                  type: 'tool-getNearestSurgeLevels',
                  toolCallId: 'tool-1',
                  state: 'output-available',
                  input: { center: [-76.8, 18] },
                  output: {
                    stationId: 7,
                    rp100Bestfit: 1.9,
                  },
                },
                {
                  type: 'text',
                  state: 'done',
                  text: 'The nearest surge station is 12.3 km away.',
                },
              ],
            },
          ])
          setStatus('ready')
        },
      }
    },
  }
})

const regionA: WinstonRegion = {
  kind: 'cell',
  label: 'Region A1',
  center: [-76.8, 18],
  bounds: [
    [-76.81, 17.99],
    [-76.79, 18.01],
  ],
  gridCellId: 'A1',
}

const regionB: WinstonRegion = {
  ...regionA,
  label: 'Region B2',
  gridCellId: 'B2',
}

describe('WinstonChat', () => {
  it('seeds the selected-cell greeting, renders tool output, resets on cell change, and preserves messages across close/reopen on the same cell', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const renderChat = async (region: WinstonRegion, isOpen: boolean) => {
      await act(async () => {
        root.render(
          <WinstonChat
            imageSrc="/winston.png"
            isOpen={isOpen}
            onClose={() => {}}
            onToggleOpen={() => {}}
            region={region}
          />,
        )
      })
    }

    await renderChat(regionA, true)

    await screen.findByText(/You selected Region A1/i)

    fireEvent.change(screen.getByPlaceholderText('Ask Winston...'), {
      target: { value: 'What about surge risk?' },
    })
    fireEvent.submit(screen.getByPlaceholderText('Ask Winston...').closest('form')!)

    await waitFor(() => {
      expect(screen.getByText('What about surge risk?')).toBeTruthy()
      expect(screen.getByText(/12.3 km away/i)).toBeTruthy()
    })

    await renderChat(regionA, false)
    await renderChat(regionA, true)

    expect(screen.getByText('What about surge risk?')).toBeTruthy()

    await renderChat(regionB, true)

    await waitFor(() => {
      expect(screen.queryByText('What about surge risk?')).toBeNull()
      expect(screen.getByText(/You selected Region B2/i)).toBeTruthy()
    })

    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
