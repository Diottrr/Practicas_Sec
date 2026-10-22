# Centro dermatológico - simulador local

## Agente dermatológico local

El proyecto incluye un agente de demostración para consultar servicios, simular el agendamiento y la reprogramación de citas, y revisar las citas registradas. El agente conserva el estado de cada conversación para recopilar nombre, servicio, fecha y hora en mensajes separados. Las conversaciones y citas se guardan localmente y no requieren servicios externos.

Requisito: Node.js `20.19` o posterior. Las versiones actuales de Vite y Oxlint no funcionan con versiones anteriores de Node 20.

En Windows puedes instalar o actualizar la versión LTS y después abrir una terminal nueva:

```powershell
winget upgrade --id OpenJS.NodeJS.LTS
node --version
```

Desde PowerShell, instala las dependencias una sola vez:

```powershell
cd C:\Users\usuario\Desktop\alejandro\backend
npm ci
cd ..\frontend
npm ci
```

Terminal 1:

```powershell
cd C:\Users\usuario\Desktop\alejandro\backend
npm run dev
```

Terminal 2:

```powershell
cd C:\Users\usuario\Desktop\alejandro\frontend
npm run dev
```

Abre `http://localhost:5173` y pulsa **Nuevo chat**. El agente enviará el saludo inicial, solicitará el nombre y mostrará botones para recorrer el menú. También puedes escribir las opciones, solicitar una cita o consultar las citas existentes.

El menú incluye consulta dermatológica, medicina estética, reumatología, tratamientos faciales y corporales, farmacia dermatológica y otras especialidades médicas. Las fechas deben ser futuras y pueden escribirse como `25/10/2027`, `2027-10-25`, `25 de octubre de 2027` o `mañana`.

El flujo local es:

```text
Navegador -> POST /api/test/sessions/:id/messages
          -> POST /api/local-agent
          <- { "reply": "..." }
          -> backend/data/messages.json
          -> actualización SSE del navegador
```

Para usar otro agente o un webhook local como n8n, crea `backend/.env` y configura:

```env
TEST_AGENT_WEBHOOK_URL=http://127.0.0.1:5678/webhook/agente
TEST_AGENT_WEBHOOK_TOKEN=
TEST_AGENT_TIMEOUT_MS=30000
TEST_PHONE_PREFIX=593999999
```

La petición enviada al agente tiene este contrato:

```json
{
  "session_id": "5939999990001",
  "numero": "5939999990001",
  "nombre": "Prueba 01",
  "message": "Quiero agendar una cita",
  "source": "test-panel"
}
```

El agente externo debe responder inmediatamente. Las opciones son opcionales:

```json
{
  "reply": "Indícame el día y la hora que prefieres.",
  "options": [
    { "label": "Volver al menú", "value": "Menú" }
  ]
}
```

Los chats y las citas simuladas se conservan al reiniciar el backend. Para borrar el historial local, detén el backend y elimina `backend/data/messages.json`.

## Comprobaciones

Primero comprueba el código:

```powershell
cd C:\Users\usuario\Desktop\alejandro\backend
npm test
npm run check
cd ..\frontend
npm run build
npm run lint
```

No se añadieron dependencias. Si trabajas en otra máquina sin node_modules, ejecuta `npm ci` en cada carpeta antes de los comandos anteriores.

## Alcance y diagnóstico

- Conversaciones y citas guardadas en `backend/data/messages.json`, ignorado por Git; evita varias instancias del backend compartiendo el archivo.
- El agente reconoce saludos, consultas de servicios, solicitudes de agendamiento, consultas de citas y reprogramaciones.
- El agendamiento y la reprogramación requieren confirmación antes de modificar las citas simuladas.
- Las solicitudes no reconocidas se derivan a un asesor mediante un mensaje predefinido.
- Actualizaciones en tiempo real mediante SSE (EventSource nativo). La conexión se restablece automáticamente y envía el historial actual.
- Para cerrar: Ctrl+C en cada terminal.
