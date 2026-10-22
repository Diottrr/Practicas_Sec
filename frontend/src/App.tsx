import { useEffect, useRef, useState } from 'react'
import './App.css'

type Message = { id: string; phone: string; name: string; text: string; direction: 'in' | 'out'; timestamp: number; status: string }
type Snapshot = { messages: Message[]; verifiedAt: number | null; eventAt: number | null; configuration: { verifyToken: boolean; appSecret: boolean; accessToken: boolean; phoneNumber: boolean } }
const labels: Record<string, string> = { received: 'Recibido', accepted: 'Aceptado por Meta', sent: 'Enviado', delivered: 'Entregado', read: 'Leído', failed: 'Falló la entrega' }
const date = (time: number | null) => time ? new Date(time).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : 'Pendiente'

export default function App() {
  const [data, setData] = useState<Snapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const stream = new EventSource('/api/events')
    stream.onmessage = event => {
      try { setData(JSON.parse(event.data) as Snapshot); setConnected(true) } catch { setConnected(false) }
    }
    stream.onerror = () => setConnected(false)
    return () => stream.close()
  }, [])
  const messages = data?.messages ?? []
  const contacts = new Map<string, Message>()
  for (const message of [...messages].sort((a, b) => a.timestamp - b.timestamp)) contacts.set(message.phone, message)
  const conversations = [...contacts.values()].sort((a, b) => b.timestamp - a.timestamp)
  const phone = selected || conversations[0]?.phone || ''
  const active = contacts.get(phone)
  const thread = messages.filter(m => m.phone === phone).sort((a, b) => a.timestamp - b.timestamp)
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [phone, messages.length])

  async function send() {
    if (!draft.trim() || sending) return
    setSending(true)
    setError('')
    try {
      const response = await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, text: draft }) })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || 'No se pudo enviar el mensaje.')
      setDraft('')
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Error de conexión.') }
    finally { setSending(false) }
  }

  return <main className="workspace">
    <header className="topbar"><div><span className="eyebrow">CENTRO DERMATOLÓGICO · PROTOTIPO LOCAL</span><h1>Bandeja de WhatsApp</h1></div><span className={`badge ${connected ? 'online' : ''}`}>{connected ? '● Conectado al servidor' : '○ Reconectando…'}</span></header>
    <section className="metrics" aria-label="Estado de la integración">
      <div><small>Conversaciones</small><strong>{contacts.size}</strong></div>
      <div><small>Mensajes</small><strong>{messages.length}</strong></div>
      <div><small>Última verificación de Meta</small><strong>{date(data?.verifiedAt ?? null)}</strong></div>
      <div><small>Último evento firmado</small><strong>{date(data?.eventAt ?? null)}</strong></div>
    </section>
    {!connected && <p className="notice" role="status">Esperando al backend. Ejecuta npm run dev en la carpeta backend. La conexión se reintentará automáticamente.</p>}
    {data && Object.values(data.configuration).some(value => !value) && <p className="notice">Completa en backend/.env: {[
      !data.configuration.verifyToken && 'META_VERIFY_TOKEN', !data.configuration.appSecret && 'META_APP_SECRET',
      !data.configuration.accessToken && 'WHATSAPP_ACCESS_TOKEN', !data.configuration.phoneNumber && 'WHATSAPP_PHONE_NUMBER_ID',
    ].filter(Boolean).join(', ')}. Reinicia el backend después de guardar.</p>}
    <section className="inbox">
      <aside><div className="sidebar-heading"><h2>Conversaciones</h2><input aria-label="Buscar conversación" placeholder="Buscar nombre o teléfono" value={query} onChange={event => setQuery(event.target.value)} /></div>
        <div className="contacts">{conversations.filter(c => `${c.name} ${c.phone}`.toLowerCase().includes(query.toLowerCase())).map(contact => <button disabled={sending} key={contact.phone} className={`contact ${phone === contact.phone ? 'selected' : ''}`} onClick={() => { setSelected(contact.phone); setDraft(''); setError('') }}><span className="avatar">{contact.name.slice(0, 1).toUpperCase()}</span><span><b>{contact.name}</b><small>+{contact.phone}</small><span className="preview">{contact.text}</span></span></button>)}
          {!conversations.length && <p className="empty-list">Todavía no hay conversaciones. Los mensajes reales aparecerán aquí.</p>}
        </div>
      </aside>
      <section className="chat" aria-label="Mensajes">
        {active ? <><div className="chat-heading"><h2>{active.name}</h2><small>+{phone} · WhatsApp Cloud API</small></div>
          <div className="thread" role="log" aria-live="polite">{thread.map(message => <article className={`bubble ${message.direction}`} key={message.id}><p>{message.text}</p><small>{date(message.timestamp)} · {labels[message.status] ?? message.status}</small></article>)}<div ref={bottom} /></div>
          <form className="composer" onSubmit={event => { event.preventDefault(); void send() }}>
            {error && <p className="error" role="alert">{error}</p>}
            <label htmlFor="reply">Responder al contacto</label><div className="compose-row"><textarea id="reply" maxLength={4096} disabled={sending} placeholder="Escribe tu respuesta…" value={draft} onChange={event => setDraft(event.target.value)} /><button disabled={!connected || sending || !draft.trim() || !data?.configuration.accessToken || !data.configuration.phoneNumber}>{sending ? 'Enviando…' : 'Enviar mensaje'}</button></div>
            <small>Respuestas de texto dentro de las 24 horas posteriores al último mensaje del contacto.</small>
          </form></> : <div className="welcome"><span className="welcome-icon">W</span><h2>Tu primera conversación empieza aquí</h2><p>Verifica el webhook en Meta, suscríbete a <b>messages</b> y escribe al número de prueba desde tu WhatsApp.</p><p>Los mensajes se guardan localmente y aparecen sin recargar la página.</p></div>}
      </section>
    </section>
    <footer>Entorno de práctica · Adjuntos representados por su tipo · Historial local en backend/data</footer>
  </main>
}
