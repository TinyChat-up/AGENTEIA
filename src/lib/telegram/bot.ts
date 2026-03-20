// ============================================================
// AI VENTURE STUDIO — Telegram Bot
// Receives Mother AI alerts + handles spend approvals
// ============================================================

import { createClient } from '@/lib/supabase/server'

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`
const CHAT_ID = process.env.TELEGRAM_CHAT_ID

// ============================================================
// SEND MESSAGE
// ============================================================

export async function sendTelegramMessage(text: string, replyMarkup?: object): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !CHAT_ID) {
    console.warn('[Telegram] Bot not configured — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID')
    return
  }

  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: 'Markdown',
      reply_markup: replyMarkup,
    }),
  })
}

// ============================================================
// ALERT TYPES — called by Mother AI and Agent Runner
// ============================================================

export async function alertAgentFrozen(agentName: string, reason: string): Promise<void> {
  await sendTelegramMessage(
    `🧊 *AGENTE CONGELADO*\n\n` +
    `*Agente:* ${agentName}\n` +
    `*Motivo:* ${reason}\n\n` +
    `_Sin reporte válido en 48h — fondos suspendidos_`
  )
}

export async function alertDecisionMade(
  agentName: string,
  decision: string,
  score: number,
  rationale: string
): Promise<void> {
  const emoji: Record<string, string> = {
    fund: '💰', hold: '⏸️', pivot: '🔄',
    kill: '💀', promote: '🚀', graduate: '🎓', replicate: '📋'
  }
  const icon = emoji[decision] ?? '📊'

  await sendTelegramMessage(
    `${icon} *DECISIÓN: ${decision.toUpperCase()}*\n\n` +
    `*Agente:* ${agentName}\n` +
    `*Score:* ${score}/100\n` +
    `*Motivo:* ${rationale}\n\n` +
    `_Mother AI — Ciclo semanal_`
  )
}

export async function alertPendingApproval(params: {
  transactionId: string
  agentName: string
  amount: number
  vendor: string
  description: string
}): Promise<void> {
  const { transactionId, agentName, amount, vendor, description } = params

  await sendTelegramMessage(
    `💳 *APROBACIÓN PENDIENTE*\n\n` +
    `*Agente:* ${agentName}\n` +
    `*Importe:* €${amount}\n` +
    `*Proveedor:* ${vendor}\n` +
    `*Concepto:* ${description}\n\n` +
    `Responde con:\n` +
    `/aprobar_${transactionId}\n` +
    `/rechazar_${transactionId}`,
    {
      inline_keyboard: [[
        { text: `✅ Aprobar €${amount}`, callback_data: `approve_${transactionId}` },
        { text: '❌ Rechazar', callback_data: `reject_${transactionId}` },
      ]]
    }
  )
}

export async function alertRunCompleted(params: {
  agentName: string
  goal: string
  reportSubmitted: boolean
  summary: string
}): Promise<void> {
  const { agentName, goal, reportSubmitted, summary } = params

  await sendTelegramMessage(
    `✅ *RUN COMPLETADO*\n\n` +
    `*Agente:* ${agentName}\n` +
    `*Objetivo:* ${goal.substring(0, 100)}\n` +
    `*Reporte:* ${reportSubmitted ? '✅ Enviado' : '⚠️ No enviado'}\n\n` +
    `*Resumen:*\n${summary.substring(0, 300)}`
  )
}

export async function alertOrchestratorCycle(params: {
  cycle: string
  agentsEvaluated: number
  decisionsMade: number
  agentsFrozen: number
  summary: string
}): Promise<void> {
  const { cycle, agentsEvaluated, decisionsMade, agentsFrozen, summary } = params

  await sendTelegramMessage(
    `🧠 *CICLO ${cycle.toUpperCase()} COMPLETADO*\n\n` +
    `*Agentes evaluados:* ${agentsEvaluated}\n` +
    `*Decisiones:* ${decisionsMade}\n` +
    `*Congelados:* ${agentsFrozen}\n\n` +
    `${summary}`
  )
}

// ============================================================
// WEBHOOK HANDLER — processes incoming Telegram messages
// ============================================================

export async function handleTelegramWebhook(body: TelegramUpdate): Promise<void> {
  const supabase = await createClient()

  // Handle callback queries (button presses)
  if (body.callback_query) {
    const { id, data, from } = body.callback_query

    // Acknowledge callback immediately
    await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: id }),
    })
if (data?.startsWith('approve_outreach_')) {
      const outreachIndex = data.replace('approve_outreach_', '')
      await handleOutreachApproval(outreachIndex, true, supabase)
    } else if (data?.startsWith('reject_outreach_')) {
      const outreachIndex = data.replace('reject_outreach_', '')
      await handleOutreachApproval(outreachIndex, false, supabase)
    } else if (data?.startsWith('approve_')) {
      const txId = data.replace('approve_', '')
      await handleApproval(txId, true, from.first_name, supabase)
    } else if (data?.startsWith('reject_')) {
      const txId = data.replace('reject_', '')
      await handleApproval(txId, false, from.first_name, supabase)
    }
    return
  }

  // Handle text commands
  const message = body.message
  if (!message?.text) return

  const text = message.text.trim()
  const chatId = message.chat.id.toString()

  // Security: only respond to authorized chat
  if (chatId !== CHAT_ID) {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '⛔ Unauthorized',
      }),
    })
    return
  }

  // Commands
  if (text === '/estado' || text === '/status') {
    await handleStatusCommand(supabase)
  } else if (text === '/pendientes') {
    await handlePendingCommand(supabase)
  } else if (text.startsWith('/aprobar_')) {
    const txId = text.replace('/aprobar_', '')
    await handleApproval(txId, true, message.from?.first_name ?? 'Human', supabase)
  } else if (text.startsWith('/rechazar_')) {
    const txId = text.replace('/rechazar_', '')
    await handleApproval(txId, false, message.from?.first_name ?? 'Human', supabase)
  } else if (text.startsWith('/tarea ') || text === '/tarea') {
    await handleTareaCommand(text, supabase)
  } else if (text === '/costes') {
    await handleCostesCommand(supabase)
  } else if (text === '/logs') {
    await handleLogsCommand(supabase)
  } else if (text === '/ayuda' || text === '/help') {
    await sendTelegramMessage(
      `🤖 *AI Venture Studio — Comandos*\n\n` +
      `/estado — Estado del portfolio\n` +
      `/pendientes — Aprobaciones pendientes\n` +
      `/aprobar_ID — Aprobar un gasto\n` +
      `/rechazar_ID — Rechazar un gasto\n` +
      `/tarea [desc] — Lanzar tarea nueva\n` +
      `/costes — Ver gastos del mes\n` +
      `/logs — Ver últimas tareas\n` +
      `/ayuda — Esta ayuda`
    )
  }
}

// ============================================================
// COMMAND HANDLERS
// ============================================================

async function handleStatusCommand(supabase: Awaited<ReturnType<typeof createClient>>): Promise<void> {
  const { data: summary } = await supabase.from('studio_summary').select('*').single()
  const { data: agents } = await supabase.from('agents').select('name, type, status, stage, current_score').neq('type', 'mother')

  if (!summary) {
    await sendTelegramMessage('⚠️ No se pudo obtener el estado del studio')
    return
  }

  const agentLines = (agents ?? []).map((a: { name: string; stage: string; status: string; current_score: number }) => {
    const statusEmoji: Record<string, string> = {
      active: '🟢', paused: '🟡', frozen: '🧊', terminated: '🔴', killed: '💀', graduating: '🎓'
    }
    return `${statusEmoji[a.status] ?? '⚪'} *${a.name}* [${a.stage}] — Score: ${a.current_score}/100`
  }).join('\n')

  await sendTelegramMessage(
    `📊 *VENTURE STUDIO — ESTADO*\n\n` +
    `*Agentes activos:* ${summary.active_agents}/${summary.total_agents}\n` +
    `*Score medio:* ${summary.avg_score}/100\n` +
    `*Revenue mensual:* €${summary.monthly_revenue_eur}\n` +
    `*Beneficio:* €${summary.monthly_profit_eur}\n` +
    `*Aprobaciones:* ${summary.pending_approvals} pendientes\n\n` +
    `*Portfolio:*\n${agentLines}`
  )
}

async function handlePendingCommand(supabase: Awaited<ReturnType<typeof createClient>>): Promise<void> {
  const { data: pending } = await supabase
    .from('transactions_ledger')
    .select('*, agents(name)')
    .eq('requires_approval', true)
    .is('approved_at', null)
    .is('rejected_at', null)
    .order('created_at', { ascending: false })
    .limit(5)

  if (!pending || pending.length === 0) {
    await sendTelegramMessage('✅ *Sin aprobaciones pendientes*')
    return
  }

  for (const tx of pending) {
    await alertPendingApproval({
      transactionId: tx.id,
      agentName: (tx.agents as any)?.name ?? 'Unknown',
      amount: Math.abs(tx.amount_eur),
      vendor: tx.vendor ?? 'Unknown',
      description: tx.description,
    })
  }
}

async function handleApproval(
  txId: string,
  approved: boolean,
  approverName: string,
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<void> {
  if (approved) {
    await supabase.from('transactions_ledger')
      .update({ approved_at: new Date().toISOString(), approved_by: `human:${approverName}` })
      .eq('id', txId)

    await sendTelegramMessage(`✅ *Gasto aprobado* por ${approverName}\nID: \`${txId.substring(0, 8)}...\``)
  } else {
    await supabase.from('transactions_ledger')
      .update({ rejected_at: new Date().toISOString(), rejection_reason: `Rejected by ${approverName}` })
      .eq('id', txId)

    await sendTelegramMessage(`❌ *Gasto rechazado* por ${approverName}\nID: \`${txId.substring(0, 8)}...\``)
  }
}

async function handleTareaCommand(
  text: string,
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<void> {
  const goal = text.replace('/tarea', '').trim()

  if (!goal) {
    await sendTelegramMessage('⚠️ Uso: /tarea [descripción de la tarea]')
    return
  }

  const { data: agent } = await supabase
    .from('agents')
    .select('id, name')
    .eq('status', 'active')
    .neq('type', 'mother')
    .limit(1)
    .single()

  if (!agent) {
    await sendTelegramMessage('⚠️ No hay agentes activos. Usa /agentes para ver el estado.')
    return
  }

  const { data: run } = await supabase.from('runs').insert({
    agent_id: agent.id,
    goal,
    status: 'queued',
    cost_estimated_eur: 0,
  }).select('id').single()

  await sendTelegramMessage(
    `⚙️ *TAREA RECIBIDA*\n\n` +
    `${goal}\n\n` +
    `*Agente:* ${agent.name}\n` +
    `*ID:* ${(run?.id ?? '').substring(0, 8)}\n` +
    `*Estado:* En cola ⏳`
  )
}

async function handleCostesCommand(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<void> {
  const now = new Date()
  const firstDayThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
  const firstDayNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()

  const [thisMonthResult, lastMonthResult, spendResult, allocResult] = await Promise.all([
    supabase
      .from('transactions_ledger')
      .select('amount_eur')
      .lt('amount_eur', 0)
      .gte('created_at', firstDayThisMonth),
    supabase
      .from('transactions_ledger')
      .select('amount_eur')
      .lt('amount_eur', 0)
      .gte('created_at', firstDayLastMonth)
      .lt('created_at', firstDayThisMonth),
    supabase
      .from('transactions_ledger')
      .select('amount_eur')
      .eq('type', 'spend')
      .gte('created_at', firstDayThisMonth)
      .lt('created_at', firstDayNextMonth),
    supabase
      .from('transactions_ledger')
      .select('amount_eur')
      .eq('type', 'budget_allocation')
      .gte('created_at', firstDayThisMonth)
      .lt('created_at', firstDayNextMonth),
  ])

  const sum = (rows: { amount_eur: number }[] | null) =>
    (rows ?? []).reduce((acc, r) => acc + Math.abs(Number(r.amount_eur)), 0).toFixed(2)

  await sendTelegramMessage(
    `💰 *COSTES*\n\n` +
    `*Este mes:* €${sum(thisMonthResult.data)}\n` +
    `*Mes anterior:* €${sum(lastMonthResult.data)}\n\n` +
    `*Desglose este mes:*\n` +
    `- Operativo: €${sum(spendResult.data)}\n` +
    `- Asignaciones: €${sum(allocResult.data)}`
  )
}

async function handleLogsCommand(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<void> {
  const { data: runs } = await supabase
    .from('runs')
    .select('id, goal, status, cost_real_eur, agents(name)')
    .order('created_at', { ascending: false })
    .limit(5)

  if (!runs || runs.length === 0) {
    await sendTelegramMessage('📋 *ÚLTIMAS TAREAS*\n\nNo hay tareas registradas.')
    return
  }

  const statusEmoji: Record<string, string> = {
    completed: '✅',
    failed: '❌',
    running: '⏳',
    queued: '⏳',
    cancelled: '🚫',
  }

  const lines = runs.map(r => {
    const emoji = statusEmoji[r.status] ?? '⚪'
    const name = (r.agents as { name?: string } | null)?.name ?? 'Unknown'
    const goal = (r.goal ?? '').substring(0, 60)
    const cost = Number(r.cost_real_eur ?? 0).toFixed(2)
    return `${emoji} *${name}* — ${goal}... — €${cost}`
  }).join('\n')

  await sendTelegramMessage(`📋 *ÚLTIMAS TAREAS*\n\n${lines}`)
}

// ============================================================
// TYPES
// ============================================================

interface TelegramUpdate {
  message?: {
    text?: string
    chat: { id: number }
    from?: { first_name: string }
  }
  callback_query?: {
    id: string
    data?: string
    from: { first_name: string }
  }
}
async function handleOutreachApproval(index: string, approved: boolean, supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: items } = await supabase
    .from('outreach_queue')
    .select('*')
    .eq('status', 'pending_approval')
    .order('created_at', { ascending: true })

  if (!items || items.length === 0) {
    await sendTelegramMessage('⚠️ No hay outreach pendiente.')
    return
  }

  const item = items[parseInt(index) - 1] || items[0]
  if (!item) return

  if (approved) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Alejandro <onboarding@resend.dev>',
        to: ['olo.paya@gmail.com'],
        subject: `Propuesta de automatización IA para ${item.agency_name}`,
        text: item.email_body
      })
    })
    await supabase.from('outreach_queue').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', item.id)
    await sendTelegramMessage(`✅ Email enviado a *${item.agency_name}*`)
  } else {
    await supabase.from('outreach_queue').update({ status: 'rejected', rejected_at: new Date().toISOString() }).eq('id', item.id)
    await sendTelegramMessage(`❌ Outreach rechazado: *${item.agency_name}*`)
  }
}