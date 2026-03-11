// ============================================================
// /api/runs — Agent run execution tracking
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkConsecutiveFailures, checkHardLimit, checkApprovalThreshold } from '@/lib/policies/governance'

// GET /api/runs
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { searchParams } = new URL(req.url)

  const agent_id = searchParams.get('agent_id')
  const status   = searchParams.get('status')
  const limit    = Number(searchParams.get('limit') ?? 20)

  let query = supabase.from('runs').select('*').order('created_at', { ascending: false }).limit(limit)
  if (agent_id) query = query.eq('agent_id', agent_id)
  if (status)   query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// POST /api/runs — Start a new run
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const body = await req.json()

  if (!body.agent_id || !body.goal) {
    return NextResponse.json({ error: 'Missing agent_id or goal' }, { status: 400 })
  }

  // Validate agent is in a runnable state
  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('*')
    .eq('id', body.agent_id)
    .single()

  if (agentError || !agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  if (!['active'].includes(agent.status)) {
    return NextResponse.json(
      { error: `Agent is ${agent.status} — cannot start run. Status must be 'active'.` },
      { status: 422 }
    )
  }

  // Pre-run policy checks
  const { data: budget } = await supabase.from('budgets').select('*').eq('agent_id', body.agent_id).order('created_at', { ascending: false }).limit(1).single()

  if (budget) {
    const hardLimitCheck = checkHardLimit({
      budget: budget as any,
      requested_eur: body.cost_estimated_eur ?? 0,
    })
    if (hardLimitCheck.triggered) {
      return NextResponse.json({ error: hardLimitCheck.reason, policy: 'HARD_BUDGET_LIMIT' }, { status: 422 })
    }

    const approvalCheck = checkApprovalThreshold({ amount_eur: body.cost_estimated_eur ?? 0 })
    if (approvalCheck.triggered) {
      // Flag but don't block — run can start but spend must be approved
      console.warn('[policy]', approvalCheck.reason)
    }
  }

  const { data: run, error } = await supabase.from('runs').insert({
    agent_id:           body.agent_id,
    goal:               body.goal,
    status:             'queued',
    cost_estimated_eur: body.cost_estimated_eur ?? 0,
    cost_real_eur:      0,
    metadata:           body.metadata ?? {},
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: run }, { status: 201 })
}

// PATCH /api/runs — Update run status (called by agent runner)
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const body = await req.json()

  if (!body.run_id || !body.status) {
    return NextResponse.json({ error: 'Missing run_id or status' }, { status: 400 })
  }

  const validStatuses = ['running', 'completed', 'failed', 'cancelled']
  if (!validStatuses.includes(body.status)) {
    return NextResponse.json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }, { status: 400 })
  }

  const updates: Record<string, unknown> = { status: body.status }

  if (body.status === 'running')   updates.started_at  = new Date().toISOString()
  if (['completed', 'failed', 'cancelled'].includes(body.status)) {
    updates.finished_at      = new Date().toISOString()
    updates.cost_real_eur    = body.cost_real_eur ?? 0
    updates.tasks_completed  = body.tasks_completed ?? 0
    updates.tasks_failed     = body.tasks_failed ?? 0
    updates.tokens_used      = body.tokens_used ?? 0
    updates.output_summary   = body.output_summary ?? null
    updates.error_message    = body.error_message ?? null
  }

  const { data: run, error } = await supabase
    .from('runs')
    .update(updates)
    .eq('id', body.run_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Record real cost in ledger if completed with spend
  if (body.status === 'completed' && body.cost_real_eur > 0 && body.budget_id) {
    const { data: budget } = await supabase.from('budgets').select('*').eq('id', body.budget_id).single()
    if (budget) {
      await supabase.from('transactions_ledger').insert({
        agent_id:         run.agent_id,
        budget_id:        body.budget_id,
        type:             'spend',
        amount_eur:       -Math.abs(body.cost_real_eur),
        balance_after_eur: Number((budget as any).available_eur) - Math.abs(body.cost_real_eur),
        description:      `Run completed: ${run.goal?.substring(0, 60)}`,
        run_id:           run.id,
        approved_by:      'auto',
        requires_approval: body.cost_real_eur > 30,
        approved_at:      body.cost_real_eur <= 30 ? new Date().toISOString() : null,
      })
    }
  }

  return NextResponse.json({ data: run })
}
