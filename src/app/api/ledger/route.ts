// ============================================================
// /api/ledger — Financial ledger & spend recording
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/ledger?agent_id=...&pending=true
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { searchParams } = new URL(req.url)

  const agent_id = searchParams.get('agent_id')
  const pending  = searchParams.get('pending') === 'true'
  const page     = Number(searchParams.get('page') ?? 1)
  const per_page = Number(searchParams.get('per_page') ?? 50)

  let query = supabase
    .from('transactions_ledger')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (agent_id) query = query.eq('agent_id', agent_id)
  if (pending)  query = query.eq('requires_approval', true).is('approved_at', null)

  const { data, error, count } = await query
    .range((page - 1) * per_page, page * per_page - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: { items: data, total: count, page, per_page } })
}

// POST /api/ledger — Record a spend/credit transaction
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const body = await req.json()

  const required = ['agent_id', 'type', 'amount_eur', 'description']
  for (const field of required) {
    if (body[field] === undefined || body[field] === null) {
      return NextResponse.json({ error: `Missing: ${field}` }, { status: 400 })
    }
  }

  // Get current budget
  const { data: budget, error: budgetError } = await supabase
    .from('budgets')
    .select('*')
    .eq('agent_id', body.agent_id)
    .single()

  if (budgetError || !budget) {
    return NextResponse.json({ error: 'Budget not found for agent' }, { status: 404 })
  }

  const amount = Number(body.amount_eur)
  const isSpend = amount < 0
  const absAmount = Math.abs(amount)

  // Check available balance for spend transactions
  if (isSpend && absAmount > Number(budget.available)) {
    return NextResponse.json(
      { error: `Insufficient budget. Available: €${budget.available}, Requested: €${absAmount}` },
      { status: 422 }
    )
  }

  // Determine approval requirement (DB trigger also checks this)
  const requires_approval = isSpend && absAmount > Number(budget.auto_approve_threshold)
  const balance_after = Number(budget.available) + amount

  const { data: transaction, error } = await supabase
    .from('transactions_ledger')
    .insert({
      agent_id:         body.agent_id,
      budget_id:        budget.id,
      type:             body.type,
      amount_eur:       amount,
      balance_after,
      description:      body.description,
      approved_by:      requires_approval ? 'pending' : 'auto',
      run_id:           body.run_id ?? null,
      requires_approval,
      approved_at:      requires_approval ? null : new Date().toISOString(),
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    data: transaction,
    requires_approval,
    message: requires_approval
      ? `Transaction queued for approval (€${absAmount} exceeds €${budget.auto_approve_threshold} threshold)`
      : 'Transaction auto-approved',
  }, { status: 201 })
}

// PATCH /api/ledger — Approve a pending transaction
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const body = await req.json()

  if (!body.transaction_id || !body.reviewer_id) {
    return NextResponse.json({ error: 'Missing transaction_id or reviewer_id' }, { status: 400 })
  }

  // Verify transaction exists and is pending
  const { data: tx, error: txError } = await supabase
    .from('transactions_ledger')
    .select('*')
    .eq('id', body.transaction_id)
    .single()

  if (txError || !tx) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  }

  if (tx.approved_at) {
    return NextResponse.json({ error: 'Transaction already processed' }, { status: 409 })
  }

  // Ledger is immutable — we can only update approval fields via a separate approval table
  // For simplicity here, we use a direct update (allowed for approval fields only)
  const { data: approved, error } = await supabase
    .from('transactions_ledger')
    .update({
      approved_by: body.reviewer_id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', body.transaction_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data: approved })
}
