// ============================================================
// /api/agents — Agent management endpoints
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Agent } from '@/types'

// GET /api/agents
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { searchParams } = new URL(req.url)

  const status   = searchParams.get('status')
  const vertical = searchParams.get('vertical')
  const mode     = searchParams.get('mode')
  const page     = Number(searchParams.get('page') ?? 1)
  const per_page = Number(searchParams.get('per_page') ?? 20)

  let query = supabase
    .from('agent_full_status')
    .select('*', { count: 'exact' })

  if (status)   query = query.eq('status', status)
  if (vertical) query = query.eq('vertical', vertical)
  if (mode)     query = query.eq('mode', mode)

  const { data, error, count } = await query
    .order('current_score', { ascending: false })
    .range((page - 1) * per_page, page * per_page - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    data: {
      items: data,
      total: count ?? 0,
      page,
      per_page,
      has_more: (count ?? 0) > page * per_page,
    }
  })
}

// POST /api/agents — create new agent
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const body = await req.json()

  // Validate required fields
  const required = ['name', 'mode', 'vertical', 'hypothesis']
  for (const field of required) {
    if (!body[field]) {
      return NextResponse.json(
        { error: `Missing required field: ${field}` },
        { status: 400 }
      )
    }
  }

  // Validate mode/vertical enums
  if (!['explorer', 'exploiter'].includes(body.mode)) {
    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })
  }
  if (!['education', 'b2b_tech'].includes(body.vertical)) {
    return NextResponse.json({ error: 'Invalid vertical' }, { status: 400 })
  }

  const { data: agent, error } = await supabase
    .from('agents')
    .insert({
      name:      body.name,
      mode:      body.mode,
      vertical:  body.vertical,
      hypothesis: body.hypothesis,
      metadata:  body.metadata ?? {},
      parent_agent_id: body.parent_agent_id ?? null,
      generation: body.generation ?? 0,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Create initial budget
  const { error: budgetError } = await supabase.from('budgets').insert({
    agent_id:              agent.id,
    total_allocated:       body.initial_budget ?? 500,
    weekly_limit:          body.weekly_limit ?? 100,
    auto_approve_threshold: 30,
  })

  if (budgetError) {
    // Rollback agent creation
    await supabase.from('agents').delete().eq('id', agent.id)
    return NextResponse.json({ error: budgetError.message }, { status: 500 })
  }

  return NextResponse.json({ data: agent }, { status: 201 })
}
