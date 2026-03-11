// ============================================================
// FINANCIAL PANEL — Budget overview sidebar widget
// ============================================================

'use client'

interface FinancialPanelProps {
  summary: Record<string, unknown> | null
}

export function FinancialPanel({ summary }: FinancialPanelProps) {
  const allocated = Number(summary?.total_budget_allocated ?? 0)
  const spent     = Number(summary?.total_budget_spent ?? 0)
  const pct       = allocated > 0 ? Math.min((spent / allocated) * 100, 100) : 0
  const revenue   = Number(summary?.monthly_revenue ?? 0)
  const profit    = Number(summary?.monthly_profit ?? 0)
  const isProfit  = profit >= 0

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-4 space-y-4">
      <div className="text-[10px] text-slate-500 tracking-[0.2em] uppercase">
        Financial Overview
      </div>

      {/* Budget bar */}
      <div>
        <div className="flex justify-between text-[10px] mb-1">
          <span className="text-slate-500">Budget deployed</span>
          <span className="text-amber-400">{pct.toFixed(0)}%</span>
        </div>
        <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-400 rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] mt-1 text-slate-600">
          <span>€{spent.toFixed(0)} spent</span>
          <span>€{allocated.toFixed(0)} allocated</span>
        </div>
      </div>

      {/* Revenue / Profit */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/[0.03] rounded px-3 py-2">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Revenue</div>
          <div className="text-sm text-emerald-400 font-light mt-1">€{revenue.toFixed(0)}</div>
        </div>
        <div className="bg-white/[0.03] rounded px-3 py-2">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Profit</div>
          <div className={`text-sm font-light mt-1 ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
            {isProfit ? '+' : ''}€{profit.toFixed(0)}
          </div>
        </div>
      </div>
    </div>
  )
}
