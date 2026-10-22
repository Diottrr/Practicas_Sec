# CRM WhatsApp — prototipo local

## Preparación

En `backend/.env` completa los valores de `.env.example` sin sobrescribir el verify token que ya hayas configurado en Meta:

- `META_VERIFY_TOKEN`: cadena elegida por ti, la misma que introduces al verificar el webhook.
- `META_APP_SECRET`: secreto de la app (Configuración de la app → Básica).
- `WHATSAPP_ACCESS_TOKEN`: token de acceso de WhatsApp. El token temporal de pruebas caduca; si Meta rechaza el envío, genera otro y reinicia el backend.
- `WHATSAPP_PHONE_NUMBER_ID`: identificador del número de prueba, no el teléfono ni el ID de la cuenta de WhatsApp Business.
- `PORT=3000`. Mantén este puerto para los comandos siguientes.
- `META_GRAPH_VERSION=v23.0` es opcional: el servidor usa esa versión por defecto.

Las credenciales solo se leen en el backend. Reinicia el backend después de editar `.env`.

## Comandos (PowerShell, desde la carpeta del proyecto)

Primero comprueba el código:

```powershell
cd C:\Users\Jokerlokura69\Desktop\Proyecto\backend
npm run check
cd ..\frontend
npm run build
```

Terminal 1:

```powershell
cd C:\Users\Jokerlokura69\Desktop\Proyecto\backend
npm run dev
```

Terminal 2:

```powershell
cd C:\Users\Jokerlokura69\Desktop\Proyecto\frontend
npm run dev
```

Terminal 3 (ngrok ya instalado y autenticado):

```powershell
ngrok http http://127.0.0.1:3000
```

Abre `http://localhost:5173`. Publica únicamente el puerto 3000 con ngrok. El 3001 contiene la API de administración local y Vite la conecta mediante `/api`. Este prototipo no tiene inicio de sesión y está diseñado para ejecutarse en tu propio equipo.

No se añadieron dependencias. Si trabajas en otra máquina sin node_modules, ejecuta `npm ci` en cada carpeta antes de los comandos anteriores.

## Meta for Developers

1. Abre la app que contiene el número de prueba. En WhatsApp → Configuración (o Casos de uso → Personalizar → Configuración), localiza Webhooks.
2. Callback URL: la URL HTTPS que ngrok muestre en esta sesión, seguida de `/webhook`.
3. Verify token: valor de `META_VERIFY_TOKEN` en `.env`. Pulsa Verificar y guardar.
4. Suscríbete al campo `messages` del objeto WhatsApp Business Account. Puedes usar Probar para enviar un evento de ejemplo. Si el ejemplo usa un phone_number_id distinto del configurado, el panel registrará el evento pero no creará una conversación.
5. En Configuración de API, agrega y verifica tu teléfono como destinatario de pruebas. Envía la plantilla `hello_world` desde Meta al teléfono autorizado.
6. Responde a ese mensaje desde WhatsApp. La conversación deberá aparecer en el panel. Responde desde el panel dentro de las 24 horas posteriores al mensaje entrante.

El indicador “Conectado al servidor” confirma únicamente la conexión del navegador con tu backend. “Última verificación” y “Último evento firmado” son registros históricos, no pruebas de que ngrok siga conectado.

## Alcance y diagnóstico

- Conversaciones y estados guardados en `backend/data/messages.json`, ignorado por Git; evitar varias instancias del backend compartiendo el archivo.
- Eventos firmados verificados con el secreto de la app; mensajes repetidos deduplicados por ID y estados atrasados filtrados por fecha.
- Solo envío de texto; adjuntos recibidos se representan por su tipo. No hay descarga de imágenes ni envío de plantillas desde el panel.
- Actualizaciones en tiempo real mediante SSE (EventSource nativo). La conexión se restablece automáticamente y envía el historial actual.
- Si aparece 403 al probar desde Meta, comprueba el App Secret y reinicia el backend. Abrir `/webhook` manualmente sin parámetros también devuelve 403, lo cual es normal.
- `/health` devuelve `{ "ok": true }`. Si Meta no verifica, comprueba primero la URL actual de ngrok, el backend y el verify token.
- Si una petición de envío pierde la conexión, verifica WhatsApp antes de reintentar: Meta puede haber aceptado el mensaje aunque no haya llegado su respuesta.
- Para cerrar: Ctrl+C en cada terminal.

Los comandos de comprobación y los servicios no se ejecutaron durante esta revisión, por petición del usuario. La validación de extremo a extremo requiere ejecutar los pasos anteriores con Meta.
