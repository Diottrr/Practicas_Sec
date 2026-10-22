import { config } from 'dotenv'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import type { Response } from 'express'

config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

type Message = { id: string; phone: string; name: string; text: string; direction: 'in' | 'out'; timestamp: number; status: string }
type Status = { status: string; timestamp: number }
type Store = { messages: Message[]; statuses: Record<string, Status>; verifiedAt: number | null; eventAt: number | null }
const directory = new URL('../data/', import.meta.url)
const file = new URL('messages.json', directory)
mkdirSync(directory, { recursive: true })
let store: Store = existsSync(file)
  ? JSON.parse(readFileSync(file, 'utf8')) as Store
  : { messages: [], statuses: {}, verifiedAt: null, eventAt: null }
const clients = new Set<Response>()
const configured = (key: string) => Boolean(process.env[key]?.trim())
const snapshot = () => ({ ...store, statuses: undefined, configuration: {
  verifyToken: configured('META_VERIFY_TOKEN'), appSecret: configured('META_APP_SECRET'),
  accessToken: configured('WHATSAPP_ACCESS_TOKEN'), phoneNumber: configured('WHATSAPP_PHONE_NUMBER_ID'),
} })
function commit(next: Store) {
  const temporary = new URL('messages.tmp', directory)
  writeFileSync(temporary, JSON.stringify(next), 'utf8')
  renameSync(temporary, file)
  store = next
  for (const client of clients) client.write(`data: ${JSON.stringify(snapshot())}\n\n`)
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const string = (value: unknown) => typeof value === 'string' ? value : ''
const timestamp = (value: unknown) => {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now()
}

// Solo estas rutas se publican por ngrok.
const webhook = express()
webhook.get('/', (_req, res) => res.json({ service: 'Webhook WhatsApp', health: '/health', webhook: '/webhook' }))
webhook.get('/health', (_req, res) => res.json({ ok: true }))
webhook.get('/webhook', (req, res) => {
  if (configured('META_VERIFY_TOKEN') && req.query['hub.mode'] === 'subscribe'
    && req.query['hub.verify_token'] === process.env.META_VERIFY_TOKEN && typeof req.query['hub.challenge'] === 'string') {
    commit({ ...store, verifiedAt: Date.now() })
    res.type('text/plain').send(req.query['hub.challenge'])
  } else res.sendStatus(403)
})
webhook.post('/webhook', express.raw({ type: 'application/json', limit: '3mb' }), (req, res) => {
  const secret = process.env.META_APP_SECRET
  const signature = req.get('x-hub-signature-256') ?? ''
  if (!secret || !/^sha256=[a-f0-9]{64}$/i.test(signature) || !Buffer.isBuffer(req.body)) {
    res.sendStatus(403)
    return
  }
  const expected = createHmac('sha256', secret).update(req.body).digest()
  if (!timingSafeEqual(Buffer.from(signature.slice(7), 'hex'), expected)) {
    res.sendStatus(403)
    return
  }
  let payload: Record<string, unknown>
  try { payload = object(JSON.parse(req.body.toString('utf8'))) } catch { res.sendStatus(400); return }
  if (payload.object !== 'whatsapp_business_account') { res.sendStatus(400); return }
  const next = structuredClone(store)
  for (const entry of array(payload.entry)) {
    for (const change of array(object(entry).changes)) {
      const value = object(object(change).value)
      const phoneId = string(object(value.metadata).phone_number_id)
      if (configured('WHATSAPP_PHONE_NUMBER_ID') && phoneId && phoneId !== process.env.WHATSAPP_PHONE_NUMBER_ID) continue
      for (const item of array(value.messages)) {
        const message = object(item)
        const id = string(message.id)
        const phone = string(message.from)
        if (!id || !phone || next.messages.some(m => m.id === id)) continue
        const contact = array(value.contacts).map(object).find(c => c.wa_id === phone)
        const type = string(message.type)
        const text = string(object(message.text).body) || string(object(message.button).text)
          || string(object(object(message.interactive).button_reply).title)
          || string(object(object(message.interactive).list_reply).title) || `[Mensaje ${type || 'no compatible'}]`
        next.messages.push({ id, phone, name: string(object(contact?.profile).name) || phone, text,
          direction: 'in', timestamp: timestamp(message.timestamp), status: 'received' })
      }
      for (const item of array(value.statuses)) {
        const event = object(item)
        const id = string(event.id)
        const status = string(event.status)
        const time = timestamp(event.timestamp)
        if (!id || !['sent', 'delivered', 'read', 'failed'].includes(status)) continue
        const previous = next.statuses[id]
        const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 }
        if (previous && (time < previous.timestamp || (time === previous.timestamp && (rank[status] ?? 0) < (rank[previous.status] ?? 0)))) continue
        next.statuses[id] = { status, timestamp: time }
        const message = next.messages.find(m => m.id === id)
        if (message) message.status = status
      }
    }
  }
  next.eventAt = Date.now()
  commit(next)
  console.log('Evento de WhatsApp recibido y guardado')
  res.sendStatus(200)
})

// Administración local: no exponer el puerto 3001 con ngrok.
const admin = express()
admin.use((req, res, next) => {
  const origin = req.get('origin')
  if (origin && origin !== 'http://localhost:5173' && origin !== 'http://127.0.0.1:5173') { res.sendStatus(403); return }
  next()
})
admin.use(express.json({ limit: '32kb' }))
admin.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  res.flushHeaders()
  clients.add(res)
  res.write(`data: ${JSON.stringify(snapshot())}\n\n`)
  const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15000)
  req.on('close', () => { clearInterval(heartbeat); clients.delete(res) })
})
admin.post('/api/messages', async (req, res) => {
  const phone = string(object(req.body).phone)
  const text = string(object(req.body).text).trim()
  if (!/^\d{6,15}$/.test(phone) || !text || text.length > 4096) { res.status(400).json({ error: 'Número o texto inválido (máximo 4096 caracteres).' }); return }
  if (!configured('WHATSAPP_ACCESS_TOKEN') || !configured('WHATSAPP_PHONE_NUMBER_ID')) { res.status(503).json({ error: 'Completa el token y el ID del número en backend/.env y reinicia el backend.' }); return }
  const incoming = store.messages.filter(m => m.phone === phone && m.direction === 'in').sort((a, b) => b.timestamp - a.timestamp)[0]
  if (!incoming || Date.now() - incoming.timestamp >= 86400000) { res.status(409).json({ error: 'Pide al contacto que te escriba de nuevo: las respuestas de texto requieren una ventana de 24 horas.' }); return }
  const version = process.env.META_GRAPH_VERSION || 'v23.0'
  try {
    const response = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } }),
      signal: AbortSignal.timeout(20000),
    })
    const data = object(await response.json())
    if (!response.ok) { res.status(502).json({ error: string(object(data.error).message) || 'Meta rechazó el envío.' }); return }
    const id = string(object(array(data.messages)[0]).id)
    if (!id) throw new Error('Respuesta sin identificador')
    const next = structuredClone(store)
    next.messages.push({ id, phone, name: incoming.name, text, direction: 'out', timestamp: Date.now(), status: next.statuses[id]?.status ?? 'accepted' })
    commit(next)
    res.status(201).json({ id })
  } catch {
    res.status(502).json({ error: 'No se pudo confirmar el envío. Comprueba WhatsApp antes de reintentarlo para evitar duplicados.' })
  }
})
webhook.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log('Webhook listo en http://127.0.0.1:3000'))
admin.listen(3001, '127.0.0.1', () => console.log('API local lista en http://127.0.0.1:3001; abre http://localhost:5173 para ver mensajes'))
