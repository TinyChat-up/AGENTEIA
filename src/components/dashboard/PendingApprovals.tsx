// ============================================================
// PENDING APPROVALS — Transactions awaiting human review
// ============================================================

'use client'

import { TransactionLedger } from '@/types'

interface PendingApprovalsProps {
  items: (TransactionLedger & { agents?: { name: string; vertical: string } | null })[]
}

export function PendingApprovals({ items }: PendingApprovalsProps) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] text-slate-500 tracking-[0.2em] uppercase">
          Pending Approvals
        </div>
        {items.length > 0 && (
          <span className="text-[9px] bg-red-400/10 text-red-400 px-1.5 py-0.5 rounded">
            {items.length}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="text-xs text-slate-600 text-center py-4">All clear</div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="py-2 border-b border-white/[0.04] last:border-0"
            >
              <div className="flex items-center justify-between">
                <div className="text-[10px] text-slate-400 truncate max-w-[140px]">
                  {item.agents?.name ?? item.agent_id.slice(0, 8)}
                </div>
                <div className="text-[10px] text-amber-400 font-medium">
                  €{item.amount_eur.toFixed(2)}
                </div>
              </div>
              <div className="text-[10px] text-slate-600 mt-0.5 truncate">
                {item.description}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
