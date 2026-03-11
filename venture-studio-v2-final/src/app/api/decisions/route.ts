// ============================================================
// /api/decisions — Governance decisions endpoint
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { searchParams } = new URL(req.url)

  const agent_id = searchParams.get('agent_id')
  const pending  = searchParams.get('pending') === 'true'

  let query = supabase
    .from('decisions')
    .select('*, agents(name, vertical, mode)')
    .order('created_at', { ascending: false })
    .limit(50)

  if (agent_id) query = query.eq('agent_id', agent_id)
  if (pending)  query = query.is('reviewed_at', null)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// PATCH /api/decisions — Human override a decision
export async function PATCH(req: NextRequest) {
  const supabase = createClient()
  const body = await req.json()

  if (!body.decision_id || !body.reviewer_id) {
    return NextResponse.json({ error: 'Missing decision_id or reviewer_id' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('decisions')
    .update({
      human_reviewer_id: body.reviewer_id,
      reviewed_at:       new Date().toISOString(),
      overridden:        body.override ?? false,
      override_reason:   body.override_reason ?? null,
      // If overriding, apply new decision type
      decision_type:     body.override ? body.new_decision_type : undefined,
    })
    .eq('id', body.decision_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
