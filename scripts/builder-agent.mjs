import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '/opt/agenteia/.env.local' })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID
const GEMINI_KEY = process.env.GEMINI_API_KEY

async function buildProduct(client) {
  const prompt = 'Eres un arquitecto de sistemas de automatización. Un cliente llamado ' + client.company_name + ' acaba de contratar un sistema de recordatorios automáticos de citas por WhatsApp. Genera un plan de implementación detallado en español con: 1) Información que necesitas del cliente (formulario de onboarding), 2) Pasos de configuración técnica, 3) Mensajes de WhatsApp/email a configurar, 4) Checklist de QA antes de entregar, 5) Instrucciones de uso para el cliente. Sé concreto y práctico.'

  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + GEMINI_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  })
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Error generando plan'
}

async function sendTelegram(message) {
  await fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message })
  })
}

export async function runBuilderAgent(clientId) {
  const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).single()
  if (!client) { console.log('Cliente no encontrado'); return }

  console.log('Builder Agent iniciado para: ' + client.company_name)
  await sendTelegram('🔨 BUILDER AGENT iniciado para ' + client.company_name + '\nGenerando plan de implementación...')

  const plan = await buildProduct(client)

  await supabase.from('deliveries').insert({
    client_id: clientId,
    product_name: 'AUTOFLOW-1',
    status: 'in_progress',
    started_at: new Date().toISOString(),
    checklist: { plan: plan }
  })

  await sendTelegram('📋 PLAN DE IMPLEMENTACIÓN LISTO:\n\n' + plan.substring(0, 3000))
  console.log('Builder Agent completado')
}

console.log('Builder Agent listo')
