import { randomUUID } from 'node:crypto'

export type AgentOption = { label: string; value: string }
export type ConversationStage = 'awaiting_name' | 'menu' | 'specialties' | 'booking_service' | 'booking_date' | 'booking_time' | 'booking_confirm'
  | 'reschedule_select' | 'reschedule_date' | 'reschedule_time' | 'reschedule_confirm'
export type Conversation = {
  sessionId: string
  patientName: string
  stage: ConversationStage
  draftService: string
  draftDate: string
  draftTime: string
  draftAppointmentId: string
}
export type Appointment = {
  id: string
  sessionId: string
  service: string
  date: string
  time: string
  status: 'scheduled'
  createdAt: number
  updatedAt: number
}
export type AgentResult = { reply: string; options: AgentOption[]; conversation: Conversation; appointments: Appointment[] }

type Service = { name: string; description: string; aliases: string[] }

const services: Service[] = [
  { name: 'Consulta dermatológica', description: 'Atención de enfermedades de la piel, el cabello y las uñas.', aliases: ['consulta dermatologica', 'dermatologia', 'piel', 'cabello', 'unas'] },
  { name: 'Medicina estética', description: 'Orientación sobre botox, ácido hialurónico, bioestimuladores y otros procedimientos estéticos.', aliases: ['medicina estetica', 'estetica', 'botox', 'acido hialuronico', 'bioestimuladores'] },
  { name: 'Reumatología', description: 'Atención de consultas relacionadas con reumatología.', aliases: ['reumatologia', 'reumatologo'] },
  { name: 'Tratamientos faciales', description: 'Información general sobre los tratamientos faciales disponibles.', aliases: ['tratamientos faciales', 'tratamiento facial', 'faciales'] },
  { name: 'Tratamientos corporales', description: 'Información general sobre los tratamientos corporales disponibles.', aliases: ['tratamientos corporales', 'tratamiento corporal', 'corporales'] },
  { name: 'Farmacia dermatológica', description: 'Consultas sobre productos y compras en la farmacia dermatológica.', aliases: ['farmacia dermatologica', 'farmacia', 'productos'] },
]

const specialties: Service[] = [
  { name: 'Psicología', description: 'Atención en psicología.', aliases: ['psicologia', 'psicologo', 'psicologa'] },
  { name: 'Nutrición', description: 'Atención en nutrición.', aliases: ['nutricion', 'nutricionista'] },
  { name: 'Ginecología', description: 'Atención en ginecología.', aliases: ['ginecologia', 'ginecologo', 'ginecologa'] },
  { name: 'Cardiología', description: 'Atención en cardiología.', aliases: ['cardiologia', 'cardiologo', 'cardiologa'] },
  { name: 'Pediatría', description: 'Atención en pediatría.', aliases: ['pediatria', 'pediatra'] },
  { name: 'Cirugía vascular', description: 'Atención en cirugía vascular.', aliases: ['cirugia vascular', 'vascular'] },
  { name: 'Hematología', description: 'Atención en hematología.', aliases: ['hematologia', 'hematologo', 'hematologa'] },
  { name: 'Endocrinología', description: 'Atención en endocrinología.', aliases: ['endocrinologia', 'endocrinologo', 'endocrinologa'] },
  { name: 'Medicina familiar', description: 'Atención en medicina familiar.', aliases: ['medicina familiar', 'medico familiar'] },
]

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim()
const mainOptions: AgentOption[] = [
  ...services.map((service, index) => ({ label: `${index + 1}. ${service.name}`, value: service.name })),
  { label: '7. Otras especialidades', value: 'Otras especialidades' },
  { label: '8. Otra consulta', value: 'Otra consulta' },
]
const specialtyOptions: AgentOption[] = specialties.map((service, index) => ({ label: `${index + 1}. ${service.name}`, value: service.name }))
const bookingOptions: AgentOption[] = [...services, ...specialties].map(service => ({ label: service.name, value: service.name }))
const navigationOptions: AgentOption[] = [
  { label: 'Agendar cita', value: 'Agendar cita' },
  { label: 'Hablar con un asesor', value: 'Hablar con un asesor' },
  { label: 'Volver al menú', value: 'Menú' },
]
const handoffReply = 'En este momento no puedo responder tu consulta. Serás atendido por un asesor.'
const menuReply = '¿En qué podemos ayudarte hoy? Elige una opción o escribe el nombre del servicio que necesitas.'

export const initialConversation = (sessionId: string): Conversation => ({
  sessionId, patientName: '', stage: 'awaiting_name', draftService: '', draftDate: '', draftTime: '', draftAppointmentId: '',
})

export const greeting = '¡Hola! Bienvenido a nuestro Centro Dermatológico Integral. Soy el asistente virtual y estoy aquí para brindarte información, ayudarte a agendar una cita o consultar tus citas.\n\n¿Con quién tengo el gusto?'

const clearDraft = (conversation: Conversation, stage: ConversationStage = 'menu'): Conversation => ({
  ...conversation, stage, draftService: '', draftDate: '', draftTime: '', draftAppointmentId: '',
})
const containsAlias = (text: string, alias: string) => {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(text)
}

const findService = (message: string): Service | undefined => {
  const text = normalize(message).replace(/^\d+[.)-]?\s*/, '')
  const all = [...services, ...specialties]
  return all.find(service => normalize(service.name) === text)
    ?? all.find(service => service.aliases.some(alias => containsAlias(text, alias)))
}

const requestedMainOption = (message: string) => {
  const text = normalize(message)
  const number = text.match(/^(\d+)(?:[.)-]|$)/)?.[1]
  if (number === '7' || text.includes('otras especialidades')) return 'specialties'
  if (number === '8' || text.includes('otra consulta')) return 'handoff'
  if (number && Number(number) >= 1 && Number(number) <= services.length) return services[Number(number) - 1]
  return findService(message)
}

const requestedSpecialty = (message: string) => {
  const text = normalize(message)
  const number = Number(text.match(/^(\d+)(?:[.)-]|$)/)?.[1] ?? 0)
  return number >= 1 && number <= specialties.length ? specialties[number - 1] : specialties.find(service => service.aliases.some(alias => containsAlias(text, alias)))
}

const localDate = (year: number, month: number, day: number) => {
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

const formatDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const nextYearlessDate = (month: number, day: number, today: Date) => {
  for (let year = today.getFullYear(); year <= today.getFullYear() + 4; year++) {
    const candidate = localDate(year, month, day)
    if (candidate && candidate > today) return candidate
  }
  return null
}

const parseFutureDate = (message: string, now: Date): { value: string; error: string } => {
  const text = normalize(message)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let parsed: Date | null = null
  if (/\bmanana\b/.test(text)) parsed = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  const iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/)
  if (!parsed && iso) parsed = localDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const numeric = text.match(/\b([0-3]?\d)[/-]([01]?\d)(?:[/-](\d{2,4}))?\b/)
  if (!parsed && numeric) {
    if (numeric[3]) {
      let year = Number(numeric[3])
      if (year < 100) year += 2000
      parsed = localDate(year, Number(numeric[2]), Number(numeric[1]))
    } else parsed = nextYearlessDate(Number(numeric[2]), Number(numeric[1]), today)
  }
  const monthNames: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 }
  const words = text.match(/\b([0-3]?\d)\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?\b/)
  if (!parsed && words && monthNames[words[2] ?? '']) {
    const hasYear = Boolean(words[3])
    parsed = hasYear
      ? localDate(Number(words[3]), monthNames[words[2] ?? '']!, Number(words[1]))
      : nextYearlessDate(monthNames[words[2] ?? '']!, Number(words[1]), today)
  }
  if (!parsed) return { value: '', error: 'No pude reconocer la fecha. Escríbela como 25/10/2027, 2027-10-25 o "mañana".' }
  if (parsed <= today) return { value: '', error: 'La fecha debe ser posterior a hoy. Indícame una fecha futura.' }
  return { value: formatDate(parsed), error: '' }
}

const parseTime = (message: string): { value: string; error: string } => {
  const text = normalize(message).replace(/([ap])\.\s*m\./g, '$1m')
  const match = text.match(/(?:\ba\s+las?\s+|\bhora\s+)(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?\b/)
    ?? text.match(/\b(\d{1,2}):([0-5]\d)\s*(am|pm)?\b/)
    ?? text.match(/\b(\d{1,2})\s*(am|pm)\b/)
  if (!match) return { value: '', error: 'No pude reconocer la hora. Escríbela como 10:30 o 3:00 pm.' }
  let hour = Number(match[1])
  const period = match[3] ?? (/^(am|pm)$/.test(match[2] ?? '') ? match[2] : undefined)
  const minute = Number(period === match[2] ? 0 : (match[2] ?? 0))
  if (period && (hour < 1 || hour > 12)) return { value: '', error: 'La hora indicada no es válida.' }
  if (!period && hour > 23) return { value: '', error: 'La hora indicada no es válida.' }
  if (period === 'pm' && hour < 12) hour += 12
  if (period === 'am' && hour === 12) hour = 0
  return { value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, error: '' }
}

const bookingSummary = (conversation: Conversation) => `Confirma los datos de la cita simulada:\nServicio: ${conversation.draftService}\nFecha: ${conversation.draftDate}\nHora: ${conversation.draftTime}`
const confirmationOptions: AgentOption[] = [{ label: 'Confirmar cita', value: 'Confirmar cita' }, { label: 'Cambiar datos', value: 'Cambiar datos' }, { label: 'Volver al menú', value: 'Menú' }]
const rescheduleOptions: AgentOption[] = [{ label: 'Confirmar cambio', value: 'Confirmar cambio' }, { label: 'Cancelar cambio', value: 'Menú' }]

const continueBooking = (conversation: Conversation, message: string, now: Date): { conversation: Conversation; reply: string; options: AgentOption[] } => {
  let next = { ...conversation }
  if (!next.draftService) {
    const service = findService(message)
    if (service) next.draftService = service.name
  }
  if (!next.draftDate) {
    const parsed = parseFutureDate(message, now)
    if (parsed.value) next.draftDate = parsed.value
    else if (next.stage === 'booking_date') return { conversation: next, reply: parsed.error, options: [{ label: 'Volver al menú', value: 'Menú' }] }
  }
  if (!next.draftTime) {
    const parsed = parseTime(message)
    if (parsed.value) next.draftTime = parsed.value
    else if (next.stage === 'booking_time') return { conversation: next, reply: parsed.error, options: [{ label: 'Volver al menú', value: 'Menú' }] }
  }
  if (!next.draftService) return { conversation: { ...next, stage: 'booking_service' }, reply: '¿Para qué servicio deseas agendar la cita?', options: bookingOptions }
  if (!next.draftDate) return { conversation: { ...next, stage: 'booking_date' }, reply: `¿Qué fecha futura prefieres para ${next.draftService}?`, options: [{ label: 'Mañana', value: 'Mañana' }, { label: 'Volver al menú', value: 'Menú' }] }
  if (!next.draftTime) return { conversation: { ...next, stage: 'booking_time' }, reply: `¿A qué hora deseas la cita del ${next.draftDate}?`, options: [{ label: 'Volver al menú', value: 'Menú' }] }
  next.stage = 'booking_confirm'
  return { conversation: next, reply: bookingSummary(next), options: confirmationOptions }
}

export function respond(conversation: Conversation, currentAppointments: Appointment[], message: string, now = new Date()): AgentResult {
  const text = normalize(message)
  let next = { ...conversation }
  let appointments = currentAppointments.map(appointment => ({ ...appointment }))
  const result = (reply: string, options: AgentOption[] = []): AgentResult => ({ reply, options, conversation: next, appointments })

  if (next.stage === 'awaiting_name') {
    if (/\b(hola|buenos dias|buenas tardes|buenas noches|saludos|menu|agendar|cita|servicio|especialidad|asesor)\b/.test(text)) return result('¡Hola! Antes de continuar, ¿con quién tengo el gusto?')
    const patientName = message.trim().replace(/^(me llamo|soy)\s+/i, '').trim()
    if (!/^[\p{L}][\p{L}\s'.-]{1,79}$/u.test(patientName)) return result('Por favor, indícame tu nombre para continuar.')
    next = { ...clearDraft(next), patientName }
    return result(`Mucho gusto, ${patientName}. ${menuReply}`, mainOptions)
  }

  if (/^(menu|volver al menu|inicio)$/.test(text)) {
    next = clearDraft(next)
    return result(menuReply, mainOptions)
  }
  if (/\b(asesor|asesora|persona|atencion humana|otra consulta)\b/.test(text)) {
    next = clearDraft(next)
    return result(handoffReply)
  }
  const negatedAppointment = /\bno\s+(?:(?:quiero|necesito|deseo)\s+)?(?:agendar|reservar|programar|reprogramar|reagendar|mover)\b/.test(text)
    || /\bno\s+(?:quiero|necesito|deseo)\b.*\b(?:cita|turno)\b/.test(text)
  if (negatedAppointment) {
    next = clearDraft(next)
    return result('Entendido. ¿En qué más podemos ayudarte?', mainOptions)
  }
  if (/\b(reprogramar|reagendar|mover)\b/.test(text) && next.stage !== 'booking_confirm') {
    const own = appointments.filter(appointment => appointment.sessionId === next.sessionId && appointment.status === 'scheduled')
    if (own.length === 0) return result('No tienes citas simuladas registradas para reprogramar.', [{ label: 'Agendar cita', value: 'Agendar cita' }, { label: 'Volver al menú', value: 'Menú' }])
    next = clearDraft(next, 'reschedule_select')
    return result('Selecciona la cita que deseas reprogramar.', own.map((appointment, index) => ({ label: `${index + 1}. ${appointment.service} - ${appointment.date} ${appointment.time}`, value: appointment.id })))
  }
  if (/\b(mis citas|consultar (?:mi |mis )?citas?|ver (?:mi |mis )?citas?|tengo (?:una |alguna )?cita|citas? agendadas?)\b/.test(text)) {
    const own = appointments.filter(appointment => appointment.sessionId === next.sessionId && appointment.status === 'scheduled')
    next = clearDraft(next)
    return own.length === 0
      ? result('No tienes citas simuladas registradas.', [{ label: 'Agendar cita', value: 'Agendar cita' }, { label: 'Volver al menú', value: 'Menú' }])
      : result(`Tus citas simuladas:\n${own.map((appointment, index) => `${index + 1}. ${appointment.service} - ${appointment.date}, ${appointment.time} - Código ${appointment.id}`).join('\n')}`, [{ label: 'Reprogramar cita', value: 'Reprogramar cita' }, { label: 'Agendar otra cita', value: 'Agendar cita' }, { label: 'Volver al menú', value: 'Menú' }])
  }
  const wantsBooking = /\b(agendar|reservar|programar|solicitar|sacar|quiero|necesito)\b.*\b(cita|turno)\b|\b(cita|turno)\b.*\b(agendar|reservar|programar)\b/.test(text)
  if (wantsBooking && !next.stage.startsWith('booking_')) {
    const selectedService = findService(message)?.name ?? next.draftService
    next = { ...clearDraft(next, 'booking_service'), draftService: selectedService }
    const progress = continueBooking(next, message, now)
    next = progress.conversation
    return result(progress.reply, progress.options)
  }

  if (next.stage.startsWith('booking_')) {
    if (next.stage === 'booking_confirm') {
      if (/\b(no|cancelar|cambiar|corregir)\b/.test(text)) {
        next = clearDraft(next, 'booking_service')
        return result('De acuerdo. ¿Para qué servicio deseas agendar la cita?', bookingOptions)
      }
      if (/\b(confirmar|confirmo|si|correcto)\b/.test(text)) {
        const validatedDate = parseFutureDate(next.draftDate, now)
        if (!validatedDate.value) {
          next = { ...next, stage: 'booking_date', draftDate: '', draftTime: '' }
          return result('La fecha elegida ya no es futura. Indícame una nueva fecha para continuar.', [{ label: 'Mañana', value: 'Mañana' }, { label: 'Volver al menú', value: 'Menú' }])
        }
        const appointment: Appointment = { id: randomUUID().slice(0, 8).toUpperCase(), sessionId: next.sessionId, service: next.draftService, date: next.draftDate, time: next.draftTime, status: 'scheduled', createdAt: now.getTime(), updatedAt: now.getTime() }
        appointments.push(appointment)
        next = clearDraft(next)
        return result(`Cita simulada agendada correctamente.\nServicio: ${appointment.service}\nFecha: ${appointment.date}\nHora: ${appointment.time}\nCódigo: ${appointment.id}`, [{ label: 'Consultar mis citas', value: 'Consultar mis citas' }, { label: 'Volver al menú', value: 'Menú' }])
      }
      return result(bookingSummary(next), confirmationOptions)
    }
    const progress = continueBooking(next, message, now)
    next = progress.conversation
    return result(progress.reply, progress.options)
  }

  if (next.stage === 'reschedule_select') {
    const own = appointments.filter(appointment => appointment.sessionId === next.sessionId && appointment.status === 'scheduled')
    const index = Number(text.match(/^(\d+)/)?.[1] ?? 0) - 1
    const selected = own.find(appointment => normalize(appointment.id) === text) ?? (index >= 0 ? own[index] : undefined)
    if (!selected) return result('No encontré esa cita. Selecciona una de las opciones disponibles.', own.map((appointment, itemIndex) => ({ label: `${itemIndex + 1}. ${appointment.service} - ${appointment.date} ${appointment.time}`, value: appointment.id })))
    next = { ...next, stage: 'reschedule_date', draftAppointmentId: selected.id, draftService: selected.service, draftDate: '', draftTime: '' }
    return result(`Indícame la nueva fecha futura para la cita ${selected.id}.`, [{ label: 'Mañana', value: 'Mañana' }, { label: 'Volver al menú', value: 'Menú' }])
  }
  if (next.stage === 'reschedule_date') {
    const parsed = parseFutureDate(message, now)
    if (!parsed.value) return result(parsed.error, [{ label: 'Volver al menú', value: 'Menú' }])
    const parsedTime = parseTime(message)
    if (parsedTime.value) {
      next = { ...next, stage: 'reschedule_confirm', draftDate: parsed.value, draftTime: parsedTime.value }
      return result(`Confirma la reprogramación de ${next.draftService}:\nNueva fecha: ${next.draftDate}\nNueva hora: ${next.draftTime}`, rescheduleOptions)
    }
    next = { ...next, stage: 'reschedule_time', draftDate: parsed.value }
    return result(`¿A qué hora deseas reprogramarla para el ${parsed.value}?`, [{ label: 'Volver al menú', value: 'Menú' }])
  }
  if (next.stage === 'reschedule_time') {
    const parsed = parseTime(message)
    if (!parsed.value) return result(parsed.error, [{ label: 'Volver al menú', value: 'Menú' }])
    next = { ...next, stage: 'reschedule_confirm', draftTime: parsed.value }
    return result(`Confirma la reprogramación de ${next.draftService}:\nNueva fecha: ${next.draftDate}\nNueva hora: ${next.draftTime}`, rescheduleOptions)
  }
  if (next.stage === 'reschedule_confirm') {
    if (/\b(no|cancelar)\b/.test(text)) {
      next = clearDraft(next)
      return result('La reprogramación fue cancelada. No se realizaron cambios.', mainOptions)
    }
    if (/\b(confirmar|confirmo|si|correcto|confirmar cambio)\b/.test(text)) {
      const validatedDate = parseFutureDate(next.draftDate, now)
      if (!validatedDate.value) {
        next = { ...next, stage: 'reschedule_date', draftDate: '', draftTime: '' }
        return result('La fecha elegida ya no es futura. Indícame una nueva fecha para continuar.', [{ label: 'Mañana', value: 'Mañana' }, { label: 'Volver al menú', value: 'Menú' }])
      }
      const appointment = appointments.find(item => item.id === next.draftAppointmentId && item.sessionId === next.sessionId)
      if (!appointment) {
        next = clearDraft(next)
        return result('No pude encontrar la cita que querías reprogramar. Serás atendido por un asesor.')
      }
      appointment.date = next.draftDate
      appointment.time = next.draftTime
      appointment.updatedAt = now.getTime()
      next = clearDraft(next)
      return result(`Cita simulada reprogramada correctamente.\nServicio: ${appointment.service}\nFecha: ${appointment.date}\nHora: ${appointment.time}\nCódigo: ${appointment.id}`, [{ label: 'Consultar mis citas', value: 'Consultar mis citas' }, { label: 'Volver al menú', value: 'Menú' }])
    }
    return result(`Confirma la reprogramación de ${next.draftService}:\nNueva fecha: ${next.draftDate}\nNueva hora: ${next.draftTime}`, rescheduleOptions)
  }

  if (/\b(hola|buenos dias|buenas tardes|buenas noches|saludos)\b/.test(text)) return result(`¡Hola${next.patientName ? `, ${next.patientName}` : ''}! ${menuReply}`, mainOptions)
  if (/\b(gracias|muchas gracias|perfecto|entendido)\b/.test(text)) return result('Con gusto. ¿Hay algo más en lo que podamos ayudarte?', mainOptions)

  if (next.stage === 'specialties') {
    const specialty = requestedSpecialty(message)
    if (!specialty) return result('No reconocí esa especialidad. Selecciona una de las opciones disponibles.', specialtyOptions)
    next = { ...clearDraft(next), draftService: specialty.name }
    return result(`${specialty.name}\n${specialty.description}\n\nPodemos simular el agendamiento de una cita o derivarte con un asesor para recibir información específica.`, navigationOptions)
  }

  const selection = requestedMainOption(message)
  if (selection === 'specialties') {
    next = clearDraft(next, 'specialties')
    return result('Estas son las especialidades disponibles. Selecciona una opción.', specialtyOptions)
  }
  if (selection === 'handoff') {
    next = clearDraft(next)
    return result(handoffReply)
  }
  const selectedService = typeof selection === 'object' ? selection : undefined
  if (selectedService) {
    next = { ...clearDraft(next), draftService: selectedService.name }
    return result(`${selectedService.name}\n${selectedService.description}\n\nPodemos simular el agendamiento de una cita o derivarte con un asesor para recibir información específica.`, navigationOptions)
  }
  if (/\b(servicio|servicios|tratamiento|tratamientos|especialidad|especialidades|que ofrecen|opciones|ayuda)\b/.test(text)) return result(menuReply, mainOptions)

  next = clearDraft(next)
  return result(handoffReply)
}
