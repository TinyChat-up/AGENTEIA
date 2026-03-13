// ============================================================
// /api/agent-run — Trigger real agent execution
// POST: start a run for a specific agent
// GET: list recent runs with status
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { runAgent } from '@/lib/agent-runner/runner'
import { createClient } from '@/lib/supabase/server'

// POST /api/agent-run — trigger a run
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-orchestrator-secret')
  const body = await req.json().catch(() => ({}))

  const { agent_id, goal } = body

  if (!agent_id) {
    return NextResponse.json({ error: 'Missing agent_id' }, { status: 400 })
  }

  const runGoal = goal ?? 'Execute your daily research and validation tasks based on your hypothesis. Search for market evidence, record learnings, and submit your ReportV1.'

  try {
    const result = await runAgent({
      agentId: agent_id,
      goal: runGoal,
      maxIterations: 10,
    })

    return NextResponse.json({
      data: {
        run_id: result.run.id,
        status: result.run.status,
        report_submitted: result.report_submitted,
        summary: result.summary.substring(0, 500),
      }
    }, { status: 201 })

  } catch (error) {
    console.error('[AgentRun] Error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

// GET /api/agent-run — recent runs
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { searchParams } = new URL(req.url)
  const agent_id = searchParams.get('agent_id')
  const limit = Number(searchParams.get('limit') ?? 20)

  let query = supabase
    .from('runs')
    .select('*, agents(name, type, vertical)')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (agent_id) query = query.eq('agent_id', agent_id)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data })
}
