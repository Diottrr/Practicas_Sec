import assert from 'node:assert/strict'
import test from 'node:test'
import { initialConversation, respond } from './agent.js'
import type { Appointment, Conversation } from './agent.js'

const now = new Date(2026, 9, 22, 9, 0)

const send = (conversation: Conversation, appointments: Appointment[], message: string) => respond(conversation, appointments, message, now)

test('captures the patient name and opens the service menu', () => {
  const result = send(initialConversation('session-1'), [], 'Me llamo Ana Pérez')

  assert.equal(result.conversation.patientName, 'Ana Pérez')
  assert.equal(result.conversation.stage, 'menu')
  assert.match(result.reply, /Mucho gusto, Ana Pérez/)
  assert.equal(result.options.length, 8)
})

test('collects and confirms an appointment over multiple messages', () => {
  let conversation = send(initialConversation('session-1'), [], 'Ana').conversation
  let appointments: Appointment[] = []

  let result = send(conversation, appointments, 'Agendar cita')
  conversation = result.conversation
  assert.equal(conversation.stage, 'booking_service')

  result = send(conversation, appointments, 'Consulta dermatológica')
  conversation = result.conversation
  assert.equal(conversation.stage, 'booking_date')

  result = send(conversation, appointments, '25/10/2027')
  conversation = result.conversation
  assert.equal(conversation.stage, 'booking_time')

  result = send(conversation, appointments, '3 pm')
  conversation = result.conversation
  assert.equal(conversation.stage, 'booking_confirm')
  assert.equal(conversation.draftTime, '15:00')

  result = send(conversation, appointments, 'Confirmar cita')
  assert.equal(result.appointments.length, 1)
  assert.equal(result.appointments[0]?.date, '2027-10-25')
  assert.equal(result.appointments[0]?.service, 'Consulta dermatológica')
})

test('accepts service, relative date and time in one booking request', () => {
  const named = send(initialConversation('session-2'), [], 'Luis').conversation
  const result = send(named, [], 'Agendar cita de psicología mañana a las 10:00')

  assert.equal(result.conversation.stage, 'booking_confirm')
  assert.equal(result.conversation.draftService, 'Psicología')
  assert.equal(result.conversation.draftDate, '2026-10-23')
  assert.equal(result.conversation.draftTime, '10:00')
})

test('rejects past dates', () => {
  let conversation = send(initialConversation('session-3'), [], 'María').conversation
  conversation = send(conversation, [], 'Agendar cita').conversation
  conversation = send(conversation, [], 'Nutrición').conversation
  const result = send(conversation, [], '21/10/2026')

  assert.equal(result.conversation.stage, 'booking_date')
  assert.match(result.reply, /posterior a hoy/)
})

test('reprograms an existing appointment after confirmation', () => {
  const appointment: Appointment = { id: 'ABC12345', sessionId: 'session-4', service: 'Cardiología', date: '2027-01-10', time: '09:00', status: 'scheduled', createdAt: now.getTime(), updatedAt: now.getTime() }
  let conversation: Conversation = { ...initialConversation('session-4'), patientName: 'Carlos', stage: 'menu' }
  let appointments = [appointment]

  let result = send(conversation, appointments, 'Reprogramar cita')
  conversation = result.conversation
  appointments = result.appointments
  assert.equal(conversation.stage, 'reschedule_select')

  result = send(conversation, appointments, 'ABC12345')
  conversation = result.conversation
  result = send(conversation, appointments, '12/01/2027')
  conversation = result.conversation
  result = send(conversation, appointments, '11:30')
  conversation = result.conversation
  result = send(conversation, appointments, 'Confirmar cambio')

  assert.equal(result.appointments[0]?.date, '2027-01-12')
  assert.equal(result.appointments[0]?.time, '11:30')
  assert.equal(result.conversation.stage, 'menu')
})

test('uses the exact handoff response for unsupported requests', () => {
  const conversation = { ...initialConversation('session-5'), patientName: 'Elena', stage: 'menu' as const }
  const result = send(conversation, [], 'Necesito interpretar unos análisis de laboratorio')

  assert.equal(result.reply, 'En este momento no puedo responder tu consulta. Serás atendido por un asesor.')
  assert.deepEqual(result.options, [])
})

test('keeps numbered specialty selection within the specialty menu', () => {
  let conversation: Conversation = { ...initialConversation('session-6'), patientName: 'José', stage: 'menu' }
  conversation = send(conversation, [], 'Otras especialidades').conversation
  const result = send(conversation, [], '1')

  assert.match(result.reply, /^Psicología/)
})

test('prioritizes an exact treatment selection over a generic menu request', () => {
  const conversation: Conversation = { ...initialConversation('session-7'), patientName: 'Sofía', stage: 'menu' }
  const result = send(conversation, [], 'Tratamientos faciales')

  assert.match(result.reply, /^Tratamientos faciales/)
  assert.equal(result.conversation.draftService, 'Tratamientos faciales')
})

test('recognizes common booking wording and an explicitly changed service', () => {
  let conversation: Conversation = { ...initialConversation('session-8'), patientName: 'Diego', stage: 'menu', draftService: 'Consulta dermatológica' }
  let result = send(conversation, [], 'Quiero una cita de cardiología mañana a las 3 p. m.')

  assert.equal(result.conversation.stage, 'booking_confirm')
  assert.equal(result.conversation.draftService, 'Cardiología')
  assert.equal(result.conversation.draftTime, '15:00')

  conversation = result.conversation
  result = send(conversation, [], 'No confirmar')
  assert.equal(result.appointments.length, 0)
  assert.equal(result.conversation.stage, 'booking_service')
})

test('prioritizes a reprogramming request over listing appointments', () => {
  const appointment: Appointment = { id: 'ZXCV1234', sessionId: 'session-9', service: 'Nutrición', date: '2027-02-10', time: '10:00', status: 'scheduled', createdAt: now.getTime(), updatedAt: now.getTime() }
  const conversation: Conversation = { ...initialConversation('session-9'), patientName: 'Lucía', stage: 'menu' }
  const result = send(conversation, [appointment], 'Quiero reprogramar mis citas')

  assert.equal(result.conversation.stage, 'reschedule_select')
})

test('finds the next valid year for a yearless leap-day date', () => {
  let conversation: Conversation = { ...initialConversation('session-10'), patientName: 'Mateo', stage: 'booking_date', draftService: 'Pediatría' }
  const result = send(conversation, [], '29/02')

  assert.equal(result.conversation.draftDate, '2028-02-29')
})

test('preserves date and time while waiting for a service', () => {
  const conversation: Conversation = { ...initialConversation('session-11'), patientName: 'Andrea', stage: 'menu' }
  let result = send(conversation, [], 'Quiero una cita mañana a las 3 pm')

  assert.equal(result.conversation.stage, 'booking_service')
  assert.equal(result.conversation.draftDate, '2026-10-23')
  assert.equal(result.conversation.draftTime, '15:00')

  result = send(result.conversation, [], 'Medicina estética')
  assert.equal(result.conversation.stage, 'booking_confirm')
})

test('does not start booking from a negated request', () => {
  const conversation: Conversation = { ...initialConversation('session-12'), patientName: 'Julia', stage: 'specialties' }
  const result = send(conversation, [], 'No agendar cita')

  assert.equal(result.conversation.stage, 'menu')
  assert.equal(result.appointments.length, 0)
})

test('does not start reprogramming from a negated request', () => {
  const appointment: Appointment = { id: 'ASDF1234', sessionId: 'session-15', service: 'Pediatría', date: '2027-05-10', time: '08:00', status: 'scheduled', createdAt: now.getTime(), updatedAt: now.getTime() }
  const conversation: Conversation = { ...initialConversation('session-15'), patientName: 'Julia', stage: 'menu' }
  const result = send(conversation, [appointment], 'No quiero reprogramar mi cita')

  assert.equal(result.conversation.stage, 'menu')
})

test('does not match service aliases inside unrelated words', () => {
  const conversation: Conversation = { ...initialConversation('session-16'), patientName: 'Mario', stage: 'menu' }
  const result = send(conversation, [], 'Tengo preguntas sobre vacunas')

  assert.equal(result.reply, 'En este momento no puedo responder tu consulta. Serás atendido por un asesor.')
})

test('revalidates the date when an appointment is confirmed later', () => {
  const conversation: Conversation = {
    ...initialConversation('session-13'), patientName: 'Pedro', stage: 'booking_confirm', draftService: 'Reumatología', draftDate: '2026-10-23', draftTime: '09:00',
  }
  const later = new Date(2026, 9, 24, 9, 0)
  const result = respond(conversation, [], 'Confirmar cita', later)

  assert.equal(result.appointments.length, 0)
  assert.equal(result.conversation.stage, 'booking_date')
})

test('accepts a combined date and time while reprogramming', () => {
  const appointment: Appointment = { id: 'QWER1234', sessionId: 'session-14', service: 'Psicología', date: '2027-03-10', time: '08:00', status: 'scheduled', createdAt: now.getTime(), updatedAt: now.getTime() }
  let conversation: Conversation = { ...initialConversation('session-14'), patientName: 'Rosa', stage: 'reschedule_date', draftAppointmentId: appointment.id, draftService: appointment.service }
  const result = send(conversation, [appointment], 'Mañana a las 3 pm')

  conversation = result.conversation
  assert.equal(conversation.stage, 'reschedule_confirm')
  assert.equal(conversation.draftTime, '15:00')
})
