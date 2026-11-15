import { useRef, useState } from 'react'
import type { AssistantAnswer, Farm } from '../../shared/types'
import { postJson } from '../api'
import { Card, Empty, Pill } from './ui'

type Message = {
  role: 'farmer' | 'assistant'
  text: string
  answer?: AssistantAnswer
}

const SUGGESTED = [
  'What should I plant next season?',
  'Why is the top crop recommended?',
  'Is my field experiencing drought stress?',
  'Which crops require less water?',
  'How has rainfall changed over the past five years?',
]

export function Assistant({ farm, ready }: { farm: Farm; ready: boolean }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy || !ready) return
    setBusy(true)
    setError('')
    setMessages((previous) => [...previous, { role: 'farmer', text: trimmed }])
    setQuestion('')
    try {
      const answer = await postJson<AssistantAnswer>(`/api/farms/${farm.id}/assistant`, {
        question: trimmed,
      })
      setMessages((previous) => [...previous, { role: 'assistant', text: answer.answer, answer }])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The assistant could not answer.')
    } finally {
      setBusy(false)
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
      })
    }
  }

  if (!ready)
    return (
      <Card title="Assistant needs field data">
        <Empty title="Run the field analysis first">
          The assistant answers only from stored NASA retrievals and engine outputs for this field.
          Analyse a field, then come back.
        </Empty>
      </Card>
    )

  return (
    <div className="stack">
      <div className="field-head">
        <div>
          <span className="eyebrow">Field assistant</span>
          <h1>Ask about {farm.name}</h1>
          <p className="field-meta">
            Grounded in this field's NASA POWER record, soil screening and recommendation output
          </p>
        </div>
        <Pill tone="info">No invented measurements</Pill>
      </div>

      <div className="assistant-layout">
        <Card className="assistant-thread">
          <div className="thread" ref={listRef} aria-live="polite">
            {!messages.length && (
              <div className="thread-intro">
                <h3>What would you like to know?</h3>
                <p>
                  Answers cite the dataset and period behind each number. If the data doesn't support
                  an answer, the assistant says so instead of estimating.
                </p>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={index} className={`bubble bubble-${message.role}`}>
                {message.role === 'assistant' && message.answer && (
                  <div className="bubble-meta">
                    <Pill tone={message.answer.mode === 'llm' ? 'info' : 'good'}>
                      {message.answer.mode === 'llm' ? 'LLM over field facts' : 'Deterministic, data-grounded'}
                    </Pill>
                  </div>
                )}
                <p>{message.text}</p>
                {message.answer?.facts.length ? (
                  <details className="bubble-facts">
                    <summary>Evidence used ({message.answer.facts.length})</summary>
                    <dl>
                      {message.answer.facts.map((fact) => (
                        <div key={fact.label}>
                          <dt>{fact.label}</dt>
                          <dd>
                            {fact.value}
                            <span className="fact-source">{fact.source}</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}
              </div>
            ))}
            {busy && <div className="bubble bubble-assistant bubble-pending">Reading field data…</div>}
          </div>

          {error && <p className="form-error">{error}</p>}

          <form
            className="ask-form"
            onSubmit={(event) => {
              event.preventDefault()
              void send(question)
            }}
          >
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask about crops, water, drought or rotation…"
              maxLength={500}
              disabled={busy}
              aria-label="Your question"
            />
            <button type="submit" disabled={busy || !question.trim()}>
              Ask
            </button>
          </form>

          <div className="suggestions">
            {SUGGESTED.map((text) => (
              <button key={text} className="chip" onClick={() => void send(text)} disabled={busy}>
                {text}
              </button>
            ))}
          </div>
        </Card>

        <Card title="Grounding rules" className="assistant-rules">
          <ul className="bullet-list">
            <li>Uses only the retrieved NASA POWER record, SoilGrids values, NDVI (when available) and this field's engine output.</li>
            <li>Refuses yield, profit and fertiliser-rate questions: those need local trials and soil tests.</li>
            <li>Never claims satellite data measures soil nutrients.</li>
            <li>Names the dataset and period for each figure it quotes.</li>
            <li>With no model key configured, answers are composed deterministically from the same facts.</li>
          </ul>
          <p className="fineprint">
            An LLM key can be configured server-side (<span className="mono">OPENAI_API_KEY</span>) to
            phrase answers conversationally. The key is never sent to the browser, and any failure
            falls back to the deterministic answer.
          </p>
        </Card>
      </div>
    </div>
  )
}
