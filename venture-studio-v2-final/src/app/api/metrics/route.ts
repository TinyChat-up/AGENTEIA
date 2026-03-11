// ============================================================
// /api/metrics — Daily metrics ingestion & retrieval
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/metrics?agent_id=...&days=30
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { searchParams } = new URL(req.url)

  const agent_id = searchParams.get('agent_id')
  const days     = Number(searchParams.get('days') ?? 30)
  const since    = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  let query = supabase
    .from('metrics_daily')
    .select('*')
    .gte('date', since)
    .order('date', { ascending: false })

  if (agent_id) query = query.eq('agent_id', agent_id)

  const { data, error } = await query.limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// POST /api/metrics — Ingest daily metrics for an agent
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const body = await req.json()

  if (!body.agent_id) {
    return NextResponse.json({ error: 'Missing agent_id' }, { status: 400 })
  }

  const date = body.date ?? new Date().toISOString().split('T')[0]

  // Upsert (one row per agent per day)
  const { data, error } = await supabase
    .from('metrics_daily')
    .upsert(
      {
        agent_id:              body.agent_id,
        date,
        revenue_eur:           body.revenue_eur ?? 0,
        cost_eur:              body.cost_eur ?? 0,
        leads_generated:       body.leads_generated ?? 0,
        conversions:           body.conversions ?? 0,
        experiments_run:       body.experiments_run ?? 0,
        experiments_succeeded: body.experiments_succeeded ?? 0,
        nps_score:             body.nps_score ?? null,
        custom_kpis:           body.custom_kpis ?? {},
      },
      { onConflict: 'agent_id,date' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Automatically record the cost as a ledger entry
  if (body.cost_eur > 0) {
    const { data: budget } = await supabase
      .from('budgets')
      .select('*')
      .eq('agent_id', body.agent_id)
      .single()

    if (budget) {
      await supabase.from('transactions_ledger').insert({
        agent_id:         body.agent_id,
        budget_id:        budget.id,
        type:             'spend',
        amount_eur:       -Math.abs(body.cost_eur),
        balance_after:    Number(budget.available) - Math.abs(body.cost_eur),
        description:      `Daily operations: ${date}`,
        approved_by:      'auto',
        requires_approval: body.cost_eur > Number(budget.auto_approve_threshold),
        approved_at:      body.cost_eur <= Number(budget.auto_approve_threshold) 
                            ? new Date().toISOString() : null,
      })
    }
  }

  return NextResponse.json({ data }, { status: 201 })
}
