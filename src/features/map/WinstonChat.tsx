import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessagePart } from 'ai'
import { LoaderCircle, MessageSquare, Send, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { RegionInsightResponse } from './types'
import {
  buildWinstonGreeting,
  type WinstonChatMessage,
  type WinstonChatTools,
  type WinstonRegion,
} from './winstonChatSchema'

interface WinstonChatProps {
  imageSrc: string
  isOpen: boolean
  onClose: () => void
  onToggleOpen: () => void
  region: WinstonRegion
  sidebarInsight?: RegionInsightResponse
}

export function WinstonChat({
  imageSrc,
  isOpen,
  onClose,
  onToggleOpen,
  region,
  sidebarInsight,
}: WinstonChatProps) {
  const [input, setInput] = useState('')
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const activeRegionIdRef = useRef<string | null>(null)
  const { messages, sendMessage, setMessages, status, error, stop, clearError } =
    useChat<WinstonChatMessage>({
      transport: new DefaultChatTransport<WinstonChatMessage>({
        api: '/api/chat',
        prepareSendMessagesRequest: ({ messages: nextMessages }) => ({
          body: {
            messages: nextMessages,
            region,
            sidebarInsight,
          },
        }),
      }),
    })

  useEffect(() => {
    if (activeRegionIdRef.current === region.gridCellId) {
      return
    }

    activeRegionIdRef.current = region.gridCellId
    stop()
    clearError()
    setInput('')
    setMessages([buildWinstonGreeting(region)])
  }, [clearError, region, setMessages, stop])

  useEffect(() => {
    if (!isOpen || !transcriptRef.current) {
      return
    }

    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
  }, [isOpen, messages, status])

  const handleSubmit = useEffectEvent(async (event: React.FormEvent) => {
    event.preventDefault()

    const trimmed = input.trim()
    if (!trimmed || status === 'streaming' || status === 'submitted') {
      return
    }

    await sendMessage({ text: trimmed })
    setInput('')
  })

  const isBusy = status === 'streaming' || status === 'submitted'

  return (
    <div className="absolute bottom-8 left-8 z-[60] flex flex-col items-center pointer-events-none">
      <div className="flex flex-col items-center pointer-events-auto">
        <AnimatePresence mode="popLayout" initial={false}>
          {isOpen ? (
            <motion.div
              key="winston-chat-window"
              layoutId="winston-chat-box"
              transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
              className="w-[400px] h-[500px] max-h-[60vh] max-w-[calc(100vw-2rem)] bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden mb-6"
            >
              <div className="flex items-center justify-between p-5 border-b border-white/10 bg-slate-800/50">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-blue-500/20 border border-blue-500/30 overflow-hidden flex items-center justify-center">
                    <img
                      src={imageSrc}
                      alt="Winston"
                      className="w-8 h-8 object-contain"
                    />
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-lg leading-tight">
                      Winston
                    </h3>
                    <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest">
                      Region {region.gridCellId}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div
                ref={transcriptRef}
                className="flex-1 p-5 overflow-y-auto flex flex-col gap-4"
              >
                {messages.map((message) => (
                  <ChatBubble key={message.id} message={message} />
                ))}

                {isBusy ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <LoaderCircle className="animate-spin" size={14} />
                    <span>Winston is checking the regional data...</span>
                  </div>
                ) : null}

                {error ? (
                  <div className="bg-rose-500/10 border border-rose-500/30 text-rose-100 rounded-2xl p-3 text-sm">
                    {error.message}
                  </div>
                ) : null}
              </div>

              <div className="p-5 border-t border-white/10 bg-slate-800/30">
                <form className="flex items-center gap-3" onSubmit={handleSubmit}>
                  <input
                    type="text"
                    value={input}
                    onChange={(event) => setInput(event.currentTarget.value)}
                    placeholder="Ask Winston..."
                    className="flex-1 bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500 transition-all"
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || isBusy}
                    className="w-12 h-12 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-400 flex items-center justify-center text-white transition-all shadow-lg active:scale-95"
                  >
                    <Send size={20} />
                  </button>
                </form>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="winston-bubble"
              layoutId="winston-chat-box"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
              className="bg-slate-800/90 backdrop-blur-md border border-slate-600 p-5 rounded-3xl shadow-2xl text-white relative mb-6 cursor-pointer hover:scale-105"
              onClick={onToggleOpen}
            >
              <p className="font-bold text-xl text-blue-200 flex items-center gap-3 whitespace-nowrap">
                <MessageSquare size={22} className="text-blue-400" />
                Talk to me about it!
              </p>
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-5 bg-slate-800 border-b border-r border-slate-600 transform translate-y-1/2 rotate-45" />
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          className="w-48 h-48 relative cursor-pointer"
          onClick={onToggleOpen}
          whileHover={{ scale: 1.05 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
        >
          <img
            src={imageSrc}
            alt="Winston the Weathervane"
            className="w-full h-full object-contain drop-shadow-[0_20px_40px_rgba(0,0,0,0.6)]"
          />
        </motion.div>
      </div>
    </div>
  )
}

function ChatBubble({ message }: { message: WinstonChatMessage }) {
  const isUser = message.role === 'user'
  const visibleParts = message.parts.filter(
    (part) => part.type === 'text' && part.text.trim().length > 0,
  )

  if (visibleParts.length === 0) {
    return null
  }

  return (
    <div
      className={
        isUser
          ? 'self-end max-w-[85%] bg-blue-600 text-white rounded-2xl rounded-br-none px-4 py-3 text-sm shadow-sm'
          : 'self-start max-w-[90%] flex flex-col gap-2'
      }
    >
      {visibleParts.map((part, index) => (
        <ChatPart
          key={`${message.id}-${index}`}
          part={part}
          isUser={isUser}
        />
      ))}
    </div>
  )
}

function ChatPart({
  part,
  isUser,
}: {
  part: UIMessagePart<never, WinstonChatTools>
  isUser: boolean
}) {
  if (part.type === 'text') {
    return isUser ? (
      <span>{part.text}</span>
    ) : (
      <div className="bg-slate-800 border border-slate-700 p-4 rounded-2xl rounded-tl-none text-slate-200 text-sm leading-relaxed shadow-sm">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
            ul: ({ children }) => (
              <ul className="mb-3 ml-5 list-disc space-y-1 last:mb-0">
                {children}
              </ul>
            ),
            ol: ({ children }) => (
              <ol className="mb-3 ml-5 list-decimal space-y-1 last:mb-0">
                {children}
              </ol>
            ),
            li: ({ children }) => <li>{children}</li>,
            strong: ({ children }) => (
              <strong className="font-semibold text-white">{children}</strong>
            ),
            em: ({ children }) => <em className="italic">{children}</em>,
            code: ({ children }) => (
              <code className="rounded bg-slate-950 px-1.5 py-0.5 text-[0.9em] text-blue-100">
                {children}
              </code>
            ),
            a: ({ children, href }) => (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-blue-300 underline underline-offset-2 hover:text-blue-200"
              >
                {children}
              </a>
            ),
          }}
        >
          {part.text}
        </ReactMarkdown>
      </div>
    )
  }

  if (part.type === 'step-start') {
    return null
  }

  return null
}
