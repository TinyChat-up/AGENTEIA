// ============================================================
// /api/agents/[id] — Single agent operations including kill switch
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/agents/[id]
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('agent_full_status')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json({ data })
}

// PATCH /api/agents/[id] — Update, pause, resume, or kill
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const body = await req.json()
  const { action, reason } = body

  if (!action) return NextResponse.json({ error: 'Missing action' }, { status: 400 })

  switch (action) {
    // ---- KILL SWITCH ----------------------------------------
    case 'kill': {
      if (!reason) return NextResponse.json({ error: 'reason required for kill' }, { status: 400 })

      // Call DB function which also registers the decision
      const { error } = await supabase.rpc('apply_kill_switch', {
        p_agent_id: params.id,
        p_reason:   reason,
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      return NextResponse.json({ data: { action: 'kill', agent_id: params.id, reason } })
    }

    // ---- MANUAL PAUSE ---------------------------------------
    case 'pause': {
      const { error } = await supabase.rpc('apply_pause', {
        p_agent_id: params.id,
        p_reason:   reason ?? 'Manual pause',
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ data: { action: 'pause', agent_id: params.id } })
    }

    // ---- RESUME ---------------------------------------------
    case 'resume': {
      const { error } = await supabase.rpc('apply_resume', { p_agent_id: params.id })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ data: { action: 'resume', agent_id: params.id } })
    }

    // ---- GENERIC FIELD UPDATE -------------------------------
    case 'update': {
      const allowed_fields = ['hypothesis', 'config_json', 'metadata']
      const updates: Record<string, unknown> = {}
      for (const f of allowed_fields) {
        if (body[f] !== undefined) updates[f] = body[f]
      }
      if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
      }
      const { data, error } = await supabase.from('agents').update(updates).eq('id', params.id).select().single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ data })
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }
}

// DELETE /api/agents/[id] — Permanently terminate (irreversible)
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const body = await req.json().catch(() => ({}))

  if (!body.confirm || body.confirm !== 'TERMINATE') {
    return NextResponse.json(
      { error: 'Must send {"confirm": "TERMINATE"} to permanently terminate an agent' },
      { status: 400 }
    )
  }

  const { error } = await supabase
    .from('agents')
    .update({ status: 'terminated' })
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: { terminated: params.id } })
}
