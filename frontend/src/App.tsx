import { Fragment, useEffect, useRef, useState } from 'react'
import './App.css'

type TestSession = { id: string; number: string; name: string; createdAt: number; updatedAt: number }
type AgentOption = { label: string; value: string }
type TestMessage = { id: string; sessionId: string; role: 'user' | 'assistant'; content: string; options: AgentOption[]; status: 'pending' | 'completed' | 'failed'; error: string | null; createdAt: number }
type TestAppointment = { id: string; sessionId: string; service: string; date: string; time: string; status: 'scheduled'; createdAt: number; updatedAt: number }
type Snapshot = {
  testSessions: TestSession[]
  testMessages: TestMessage[]
  testAppointments: TestAppointment[]
  configuration: { testAgent: 'local' | 'custom' }
}

const date = (time: number | null) => time ? new Date(time).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : 'Pendiente'
const testPrompts = ['Menú', 'Agendar cita', 'Consultar mis citas', 'Reprogramar cita']

export default function App() {
  const [data, setData] = useState<Snapshot | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const stream = new EventSource('/api/events')
    stream.onmessage = event => {
      try { setData(JSON.parse(event.data) as Snapshot); setConnected(true) } catch { setConnected(false) }
    }
    stream.onerror = () => setConnected(false)
    return () => stream.close()
  }, [])

  const sessions = data?.testSessions ?? []
  const testMessages = data?.testMessages ?? []
  const appointments = data?.testAppointments ?? []

  return <main className="workspace">
    <header className="topbar">
      <div><span className="eyebrow">CENTRO DERMATOLÓGICO · ENTORNO LOCAL</span><h1>Simulador de atención</h1></div>
      <span className={`badge ${connected ? 'online' : ''}`}>{connected ? '● Conectado al servidor' : '○ Reconectando...'}</span>
    </header>
    <section className="metrics" aria-label="Estado del simulador">
      <div><small>Sesiones simuladas</small><strong>{sessions.length}</strong></div>
      <div><small>Mensajes de prueba</small><strong>{testMessages.length}</strong></div>
      <div><small>Citas agendadas</small><strong>{appointments.length}</strong></div>
      <div><small>Agente conectado</small><strong>{data?.configuration.testAgent === 'custom' ? 'Externo' : 'Local incluido'}</strong></div>
    </section>
    {!connected && <BackendNotice />}
    <TestPanel sessions={sessions} messages={testMessages} connected={connected} />
    <footer>Entorno de práctica · Historial y citas simuladas guardados localmente</footer>
  </main>
}

function BackendNotice() {
  return <p className="notice" role="status">Esperando al backend. Ejecuta <code>npm run dev</code> en la carpeta backend; la conexión se reintentará automáticamente.</p>
}

function TestPanel({ sessions, messages, connected }: { sessions: TestSession[]; messages: TestMessage[]; connected: boolean }) {
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const conversations = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  const sessionId = selected || conversations[0]?.id || ''
  const active = sessions.find(session => session.id === sessionId)
  const thread = messages.filter(message => message.sessionId === sessionId).sort((a, b) => a.createdAt - b.createdAt)
  const interactiveMessageId = thread.at(-1)?.role === 'assistant' ? thread.at(-1)?.id : undefined

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [sessionId, messages.length])

  async function createSession() {
    if (creating || !connected) return
    setCreating(true)
    setError('')
    try {
      const response = await fetch('/api/test/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      const result = await response.json() as TestSession & { error?: string }
      if (!response.ok) throw new Error(result.error || 'No se pudo crear el chat.')
      setSelected(result.id)
      setName('')
      setDraft('')
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Error de conexión.') }
    finally { setCreating(false) }
  }

  async function send(requestedContent?: string) {
    const content = (requestedContent ?? draft).trim()
    if (!active || !content || sending || !connected) return
    setSending(true)
    setError('')
    try {
      const response = await fetch(`/api/test/sessions/${encodeURIComponent(active.id)}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || 'El agente no pudo responder.')
      if (requestedContent === undefined) setDraft('')
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Error de conexión.') }
    finally { setSending(false) }
  }

  return <section className="inbox test-inbox">
    <aside>
      <div className="sidebar-heading">
        <h2>Sesiones simuladas</h2>
        <form className="new-chat" onSubmit={event => { event.preventDefault(); void createSession() }}>
          <input aria-label="Nombre del nuevo chat" maxLength={80} placeholder="Nombre opcional" value={name} onChange={event => setName(event.target.value)} />
          <button disabled={!connected || creating}>{creating ? 'Creando...' : '+ Nuevo chat'}</button>
        </form>
        <input aria-label="Buscar sesión" placeholder="Buscar nombre o número" value={query} onChange={event => setQuery(event.target.value)} />
      </div>
      <div className="contacts">{conversations.filter(session => `${session.name} ${session.number}`.toLowerCase().includes(query.toLowerCase())).map(session => {
        const last = [...messages].reverse().find(message => message.sessionId === session.id)
        return <button disabled={sending} key={session.id} className={`contact ${sessionId === session.id ? 'selected' : ''}`} onClick={() => { setSelected(session.id); setDraft(''); setError('') }}>
          <span className="avatar test-avatar">T</span><span><b>{session.name}</b><small>+{session.number}</small><span className="preview">{last?.content ?? 'Conversación vacía'}</span></span>
        </button>
      })}
        {!conversations.length && <p className="empty-list">Crea un chat. El sistema asignará un número falso y conservará el historial localmente.</p>}
      </div>
    </aside>
    <section className="chat" aria-label="Chat de prueba">
      {active ? <>
        <div className="chat-heading"><span className="lab-mark">CONSULTA SIMULADA</span><h2>{active.name}</h2><small>Sesión {active.number} · Entorno local</small></div>
        <div className="thread test-thread" role="log" aria-live="polite">{thread.map(message => <Fragment key={message.id}><article className={`bubble ${message.role === 'user' ? 'out' : 'assistant'} ${message.status}`}>
          <p>{message.content}</p><small>{date(message.createdAt)} · {message.role === 'user' ? 'Tú' : 'Agente'}{message.status === 'pending' ? ' · Esperando respuesta...' : ''}{message.status === 'failed' ? ` · ${message.error ?? 'Falló'}` : ''}</small>
        </article>{message.id === interactiveMessageId && message.options?.length > 0 && <div className="agent-options" aria-label="Opciones de respuesta">{message.options.map(option => <button type="button" key={option.value} disabled={sending || !connected} onClick={() => { void send(option.value) }}>{option.label}</button>)}</div>}</Fragment>)}{sending && <div className="typing" aria-label="El agente está respondiendo"><i /><i /><i /></div>}<div ref={bottom} /></div>
        <form className="composer" onSubmit={event => { event.preventDefault(); void send() }}>
          {error && <p className="error" role="alert">{error}</p>}
          <label htmlFor="test-message">Mensaje para el agente</label>
          <div className="prompt-options" aria-label="Preguntas de prueba sugeridas">{testPrompts.map(prompt => <button type="button" key={prompt} disabled={sending} onClick={() => setDraft(prompt)}>{prompt}</button>)}</div>
          <div className="compose-row"><textarea id="test-message" maxLength={4096} disabled={sending} placeholder="Escribe cualquier mensaje o elige una prueba sugerida" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} /><button disabled={!connected || sending || !draft.trim()}>{sending ? 'Consultando...' : 'Enviar prueba'}</button></div>
          <small>Enter envía · Shift + Enter crea una nueva línea · Sesión {active.number}</small>
        </form>
      </> : <div className="welcome"><span className="welcome-icon test-icon">D</span><h2>Crea una consulta dermatológica</h2><p>El agente local puede informar servicios, simular el agendamiento y consultar las citas registradas.</p></div>}
    </section>
  </section>
}
