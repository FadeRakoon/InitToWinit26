"use client"

import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Send, Loader2 } from 'lucide-react'
import winstonIcon from '../../images/WinstonTheWeathervane.png'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isOpen])

  const handleSendMessage = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    e.stopPropagation()
    return false
  }, [])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value)
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
    }

    const currentMessages = [...messages, userMessage]
    
    setMessages(currentMessages)
    setInput('')
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: currentMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get response')
      }

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.choices?.[0]?.message?.content || 'No response',
      }

      setMessages((prev) => [...prev, aiMessage])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }, [input, isLoading, messages])

  const toggleChat = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [])

  return (
    <div className={`chat-widget ${isOpen ? 'chat-widget--open' : ''}`}>
      <button
        type="button"
        className="chat-widget__toggle"
        onClick={toggleChat}
        aria-label={isOpen ? 'Close chat' : 'Open chat'}
      >
        {isOpen ? (
          <X size={20} />
        ) : (
          <img
            src={winstonIcon}
            alt="Winston the Weathervane"
            className="chat-widget__toggle-icon"
          />
        )}
      </button>

      {isOpen && (
        <div className="chat-widget__panel">
          <div className="chat-widget__header">
            <span>AI Assistant</span>
            {isLoading && <Loader2 size={14} className="chat-widget__spinner" />}
          </div>

          <div className="chat-widget__messages">
            {messages.length === 0 && (
              <p className="chat-widget__empty">
                Ask me anything about the weather grid...
              </p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`chat-widget__message ${
                  m.role === 'user' ? 'chat-widget__message--user' : 'chat-widget__message--ai'
                }`}
              >
                {m.content}
              </div>
            ))}
            {error && (
              <div className="chat-widget__error">
                Error: {error}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form 
            className="chat-widget__input" 
            onSubmit={(e) => {
              e.preventDefault()
              e.stopPropagation()
              handleSubmit()
            }}
          >
            <input
              type="text"
              value={input}
              onChange={handleInputChange}
              placeholder="Type a message..."
              disabled={isLoading}
            />
            <button 
              type="button"
              disabled={isLoading || !input.trim()}
              onClick={handleSubmit}
            >
              {isLoading ? (
                <Loader2 size={16} className="chat-widget__spinner" />
              ) : (
                <Send size={16} />
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
