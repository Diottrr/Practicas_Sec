import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import type { Response } from 'express'
import { greeting, initialConversation, respond } from './agent.js'
import type { AgentOption, Appointment, Conversation } from './agent.js'

config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

type TestSession = { id: string; number: string; name: string; createdAt: number; updatedAt: number }
type TestMessage = { id: string; sessionId: string; role: 'user' | 'assistant'; content: string; options: AgentOption[]; status: 'pending' | 'completed' | 'failed'; error: string | null; createdAt: number }
type Store = { testSessions: TestSession[]; testMessages: TestMessage[]; testAppointments: Appointment[]; testConversations: Conversation[] }
const directory = new URL('../data/', import.meta.url)
const file = new URL('messages.json', directory)
mkdirSync(directory, { recursive: true })
const rawSaved: unknown = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
const saved = rawSaved && typeof rawSaved === 'object' && !Array.isArray(rawSaved) ? rawSaved as Record<string, unknown> : {}
const savedSessions = Array.isArray(saved.testSessions) ? saved.testSessions as TestSession[] : []
const savedMessages = Array.isArray(saved.testMessages) ? (saved.testMessages as TestMessage[]).map(message => ({
  ...message,
  options: Array.isArray(message.options) ? message.options : [],
  ...(message.status === 'pending' ? { status: 'failed' as const, error: 'El backend se reinició antes de recibir la respuesta.' } : {}),
})) : []
const savedAppointments = Array.isArray(saved.testAppointments) ? (saved.testAppointments as Appointment[]).map(appointment => ({
  ...appointment,
  status: 'scheduled' as const,
  updatedAt: typeof appointment.updatedAt === 'number' ? appointment.updatedAt : appointment.createdAt,
})) : []
const savedConversations: Conversation[] = Array.isArray(saved.testConversations) ? saved.testConversations as Conversation[] : savedSessions.map(session => ({
  ...initialConversation(session.id),
  patientName: session.name.startsWith('Prueba ') ? '' : session.name,
  stage: session.name.startsWith('Prueba ') ? 'awaiting_name' as const : 'menu' as const,
}))
let store: Store = {
  testSessions: savedSessions,
  testMessages: savedMessages,
  testAppointments: savedAppointments,
  testConversations: savedConversations,
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
const options = (value: unknown): AgentOption[] => Array.isArray(value) ? value.map(object).map(option => ({ label: string(option.label), value: string(option.value) })).filter(option => option.label && option.value) : []
const testSession = (id: string) => store.testSessions.find(session => session.id === id)
const agentError = (value: unknown) => value instanceof Error && value.name === 'TimeoutError'
  ? 'El agente agotó el tiempo de espera.'
  : 'No se pudo obtener una respuesta del agente local.'
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
  next.testConversations.push(initialConversation(session.id))
  next.testMessages.push({ id: randomUUID(), sessionId: session.id, role: 'assistant', content: greeting, options: [], status: 'completed', error: null, createdAt: now })
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
  if (!testSession(sessionId)) { res.status(404).json({ error: 'La sesión de prueba no existe.' }); return }
  const conversation = store.testConversations.find(item => item.sessionId === sessionId) ?? initialConversation(sessionId)
  const result = respond(conversation, store.testAppointments, message)
  const next = structuredClone(store)
  const conversationIndex = next.testConversations.findIndex(item => item.sessionId === sessionId)
  if (conversationIndex >= 0) next.testConversations[conversationIndex] = result.conversation
  else next.testConversations.push(result.conversation)
  next.testAppointments = result.appointments
  commit(next)
  res.json({ reply: result.reply, options: result.options })
})

admin.post('/api/test/sessions/:sessionId/messages', async (req, res) => {
  const session = testSession(string(req.params.sessionId))
  const content = string(object(req.body).content).trim()
  if (!session) { res.status(404).json({ error: 'La sesión de prueba no existe.' }); return }
  if (!content || content.length > 4096) { res.status(400).json({ error: 'Escribe un mensaje de hasta 4096 caracteres.' }); return }
  const message: TestMessage = { id: randomUUID(), sessionId: session.id, role: 'user', content, options: [], status: 'pending', error: null, createdAt: Date.now() }
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
    const replyOptions = options(payload.options)
    if (!response.ok) throw new Error(string(payload.error) || `El agente respondió HTTP ${response.status}.`)
    if (!reply || reply.length > 20000) throw new Error('El agente debe responder JSON con un campo reply de hasta 20000 caracteres.')
    const next = structuredClone(store)
    const savedMessage = next.testMessages.find(item => item.id === message.id)
    if (savedMessage) savedMessage.status = 'completed'
    const assistant: TestMessage = { id: randomUUID(), sessionId: session.id, role: 'assistant', content: reply, options: replyOptions, status: 'completed', error: null, createdAt: Date.now() }
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
