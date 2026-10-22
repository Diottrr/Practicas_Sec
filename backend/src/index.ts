import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import type { Response } from 'express'

config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

type TestSession = { id: string; number: string; name: string; createdAt: number; updatedAt: number }
type TestMessage = { id: string; sessionId: string; role: 'user' | 'assistant'; content: string; status: 'pending' | 'completed' | 'failed'; error: string | null; createdAt: number }
type TestAppointment = { id: string; sessionId: string; service: string; date: string; time: string; createdAt: number }
type Store = { testSessions: TestSession[]; testMessages: TestMessage[]; testAppointments: TestAppointment[] }
const directory = new URL('../data/', import.meta.url)
const file = new URL('messages.json', directory)
mkdirSync(directory, { recursive: true })
const rawSaved: unknown = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
const saved = rawSaved && typeof rawSaved === 'object' && !Array.isArray(rawSaved) ? rawSaved as Record<string, unknown> : {}
let store: Store = {
  testSessions: Array.isArray(saved.testSessions) ? saved.testSessions as TestSession[] : [],
  testMessages: Array.isArray(saved.testMessages) ? (saved.testMessages as TestMessage[]).map(message => message.status === 'pending'
    ? { ...message, status: 'failed', error: 'El backend se reinició antes de recibir la respuesta.' }
    : message) : [],
  testAppointments: Array.isArray(saved.testAppointments) ? saved.testAppointments as TestAppointment[] : [],
}
const clients = new Set<Response>()
const configured = (key: string) => Boolean(process.env[key]?.trim())
const adminPort = Number(process.env.ADMIN_PORT || 3001)
const testPrefix = /^\d{3,11}$/.test(process.env.TEST_PHONE_PREFIX?.trim() ?? '') ? process.env.TEST_PHONE_PREFIX!.trim() : '593999999'
const testAgentUrl = process.env.TEST_AGENT_WEBHOOK_URL?.trim() || `http://127.0.0.1:${adminPort}/api/local-agent`
const snapshot = () => ({ ...store, configuration: { testAgent: process.env.TEST_AGENT_WEBHOOK_URL?.trim() ? 'custom' : 'local' } })
function commit(next: Store) {
  const temporary = new URL('messages.tmp', directory)
  writeFileSync(temporary, JSON.stringify(next), 'utf8')
  renameSync(temporary, file)
  store = next
  for (const client of clients) client.write(`data: ${JSON.stringify(snapshot())}\n\n`)
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const string = (value: unknown) => typeof value === 'string' ? value : ''
const testSession = (id: string) => store.testSessions.find(session => session.id === id)
const agentError = (value: unknown) => value instanceof Error && value.name === 'TimeoutError'
  ? 'El agente agotó el tiempo de espera.'
  : 'No se pudo obtener una respuesta del agente local.'
const dermatologyServices = [
  { name: 'Consulta dermatológica general', pattern: /\b(consulta|dermatolog(?:ía|ia)|general)\b/ },
  { name: 'Tratamiento para acné', pattern: /\b(acné|acne)\b/ },
  { name: 'Evaluación de manchas y melasma', pattern: /\b(mancha|manchas|melasma)\b/ },
  { name: 'Evaluación de dermatitis y alergias', pattern: /\b(dermatitis|alergia|alergias)\b/ },
  { name: 'Evaluación de caída del cabello', pattern: /\b(caída del cabello|caida del cabello|cabello|alopecia)\b/ },
  { name: 'Revisión de lunares', pattern: /\b(lunar|lunares)\b/ },
]
const servicesReply = `Servicios disponibles:\n${dermatologyServices.map((service, index) => `${index + 1}. ${service.name}`).join('\n')}\n\nTambién puedes consultar tus citas o solicitar una nueva indicando servicio, fecha y hora.`
const handoffReply = 'En este momento no puedo responder tu consulta. Serás atendido por un asesor.'
const appointmentDate = (message: string) => {
  const relative = message.match(/\b(hoy|mañana|manana)\b/i)?.[1]
  if (relative) return relative.toLocaleLowerCase('es') === 'manana' ? 'mañana' : relative.toLocaleLowerCase('es')
  return message.match(/\b([0-3]?\d[/-][01]?\d(?:[/-]\d{2,4})?)\b/)?.[1]
    ?? message.match(/\b([0-3]?\d\s+de\s+[a-záéíóúñ]+(?:\s+de\s+\d{4})?)\b/i)?.[1]
    ?? ''
}
const appointmentTime = (message: string) => {
  const withPrefix = message.match(/\b(?:a\s+las?|hora)\s+([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm|a\.\s*m\.|p\.\s*m\.)?\b/i)
  const numeric = message.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
  const match = withPrefix ?? numeric
  if (!match) return ''
  return `${match[1]}:${match[2] ?? '00'}${match[3] ? ` ${match[3].replace(/\s|\./g, '').toUpperCase()}` : ''}`
}

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
admin.get('/api/test/config', (_req, res) => res.json({
  mode: process.env.TEST_AGENT_WEBHOOK_URL?.trim() ? 'custom' : 'local',
  phonePrefix: testPrefix,
}))
admin.get('/api/test/sessions', (_req, res) => res.json(store.testSessions))
admin.post('/api/test/sessions', (req, res) => {
  const requestedName = string(object(req.body).name).trim()
  if (requestedName.length > 80) { res.status(400).json({ error: 'El nombre puede tener como máximo 80 caracteres.' }); return }
  const used = store.testSessions
    .map(session => session.number.startsWith(testPrefix) ? Number(session.number.slice(testPrefix.length)) : 0)
    .filter(value => Number.isInteger(value) && value > 0)
  const suffix = Math.max(0, ...used) + 1
  if (suffix > 9999) { res.status(409).json({ error: 'Se agotaron los números de prueba para este prefijo.' }); return }
  const number = `${testPrefix}${String(suffix).padStart(4, '0')}`
  const now = Date.now()
  const session: TestSession = { id: number, number, name: requestedName || `Prueba ${String(suffix).padStart(2, '0')}`, createdAt: now, updatedAt: now }
  const next = structuredClone(store)
  next.testSessions.push(session)
  commit(next)
  res.status(201).json(session)
})
admin.get('/api/test/sessions/:sessionId/messages', (req, res) => {
  const sessionId = string(req.params.sessionId)
  if (!testSession(sessionId)) { res.status(404).json({ error: 'La sesión de prueba no existe.' }); return }
  res.json(store.testMessages.filter(message => message.sessionId === sessionId).sort((a, b) => a.createdAt - b.createdAt))
})

// Agente de demostración local. Se puede sustituir con TEST_AGENT_WEBHOOK_URL.
admin.post('/api/local-agent', (req, res) => {
  const body = object(req.body)
  const message = string(body.message).trim()
  const sessionId = string(body.session_id)
  if (!message || !sessionId) { res.status(400).json({ error: 'Faltan session_id o message.' }); return }
  const normalized = message.toLocaleLowerCase('es')
  const sessionMessages = store.testMessages.filter(item => item.sessionId === sessionId)
  const previousReply = [...sessionMessages].reverse().find(item => item.role === 'assistant')?.content ?? ''
  const service = dermatologyServices.find(item => item.pattern.test(normalized))?.name ?? ''
  const date = appointmentDate(message)
  const time = appointmentTime(message)
  const bookingFollowUp = previousReply.startsWith('Para agendar la cita')
  const wantsBooking = /\b(agendar|agenda|reservar|reserva|programar|solicitar|sacar|quiero|necesito)\b.*\b(cita|turno)\b|\b(cita|turno)\b.*\b(agendar|reservar|programar)\b/.test(normalized)
  let reply = handoffReply
  if (/\b(hola|buenos días|buenos dias|buenas tardes|buenas noches|saludos)\b/.test(normalized)) {
    reply = 'Hola, bienvenido al Centro Dermatológico. Puedo ayudarte a consultar nuestros servicios, agendar una cita o revisar tus citas registradas.'
  } else if (/\b(mis citas|consultar (?:mi |mis )?citas?|ver (?:mi |mis )?citas?|citas? (?:agendada|agendadas|registrada|registradas)|tengo (?:una |alguna )?cita|estado de (?:mi |mis )?citas?)\b/.test(normalized)) {
    const appointments = store.testAppointments.filter(item => item.sessionId === sessionId)
    reply = appointments.length === 0
      ? 'No tienes citas simuladas registradas. Para agendar una, indícame el servicio, la fecha y la hora que prefieres.'
      : `Tus citas simuladas:\n${appointments.map((item, index) => `${index + 1}. ${item.service} - ${item.date}, ${item.time} - Código ${item.id}`).join('\n')}`
  } else if (wantsBooking || (bookingFollowUp && Boolean(service || date || time))) {
    const missing = [!service && 'servicio', !date && 'fecha', !time && 'hora'].filter(Boolean)
    if (missing.length > 0) {
      reply = `Para agendar la cita necesito: ${missing.join(', ')}. Puedes responder, por ejemplo: "Consulta dermatológica general, mañana a las 10:00".`
    } else {
      const appointment: TestAppointment = { id: randomUUID().slice(0, 8).toUpperCase(), sessionId, service, date, time, createdAt: Date.now() }
      commit({ ...store, testAppointments: [...store.testAppointments, appointment] })
      reply = `Cita simulada agendada correctamente.\nServicio: ${service}\nFecha: ${date}\nHora: ${time}\nCódigo: ${appointment.id}`
    }
  } else if (/\b(servicio|servicios|tratamiento|tratamientos|especialidad|especialidades|qué ofrecen|que ofrecen|opciones|ayuda)\b/.test(normalized)) {
    reply = servicesReply
  } else if (/\b(gracias|muchas gracias|perfecto|entendido)\b/.test(normalized)) {
    reply = 'Con gusto. Si necesitas consultar servicios, agendar una cita o revisar tus citas, estoy para ayudarte.'
  }
  res.json({ reply })
})

admin.post('/api/test/sessions/:sessionId/messages', async (req, res) => {
  const session = testSession(string(req.params.sessionId))
  const content = string(object(req.body).content).trim()
  if (!session) { res.status(404).json({ error: 'La sesión de prueba no existe.' }); return }
  if (!content || content.length > 4096) { res.status(400).json({ error: 'Escribe un mensaje de hasta 4096 caracteres.' }); return }
  const message: TestMessage = { id: randomUUID(), sessionId: session.id, role: 'user', content, status: 'pending', error: null, createdAt: Date.now() }
  const pending = structuredClone(store)
  pending.testMessages.push(message)
  const pendingSession = pending.testSessions.find(item => item.id === session.id)
  if (pendingSession) pendingSession.updatedAt = message.createdAt
  commit(pending)
  try {
    const configuredTimeout = Number(process.env.TEST_AGENT_TIMEOUT_MS || 30000)
    const timeout = Number.isFinite(configuredTimeout) ? Math.min(120000, Math.max(1000, Math.trunc(configuredTimeout))) : 30000
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (configured('TEST_AGENT_WEBHOOK_TOKEN')) headers.Authorization = `Bearer ${process.env.TEST_AGENT_WEBHOOK_TOKEN}`
    const response = await fetch(testAgentUrl, {
      method: 'POST', headers,
      body: JSON.stringify({ session_id: session.id, numero: session.number, nombre: session.name, message: content, source: 'test-panel' }),
      signal: AbortSignal.timeout(timeout),
    })
    const raw = await response.text()
    let payload: Record<string, unknown> = {}
    try { payload = object(JSON.parse(raw)) } catch { /* Se informa como respuesta inválida abajo. */ }
    const reply = string(payload.reply).trim()
    if (!response.ok) throw new Error(string(payload.error) || `El agente respondió HTTP ${response.status}.`)
    if (!reply || reply.length > 20000) throw new Error('El agente debe responder JSON con un campo reply de hasta 20000 caracteres.')
    const next = structuredClone(store)
    const savedMessage = next.testMessages.find(item => item.id === message.id)
    if (savedMessage) savedMessage.status = 'completed'
    const assistant: TestMessage = { id: randomUUID(), sessionId: session.id, role: 'assistant', content: reply, status: 'completed', error: null, createdAt: Date.now() }
    next.testMessages.push(assistant)
    const updatedSession = next.testSessions.find(item => item.id === session.id)
    if (updatedSession) updatedSession.updatedAt = assistant.createdAt
    commit(next)
    res.status(201).json({ message: savedMessage, reply: assistant })
  } catch (issue) {
    const reason = issue instanceof Error && issue.message && issue.name !== 'TimeoutError' ? issue.message : agentError(issue)
    const next = structuredClone(store)
    const failed = next.testMessages.find(item => item.id === message.id)
    if (failed) { failed.status = 'failed'; failed.error = reason }
    commit(next)
    res.status(502).json({ error: reason })
  }
})
admin.listen(adminPort, '127.0.0.1', () => console.log(`API local lista en http://127.0.0.1:${adminPort}; abre http://localhost:5173 para ver mensajes`))
