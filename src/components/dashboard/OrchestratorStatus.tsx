// ============================================================
// ORCHESTRATOR STATUS — Recent Mother AI runs
// ============================================================

'use client'

import { OrchestratorRun } from '@/types'

interface OrchestratorStatusProps {
  runs: OrchestratorRun[]
}

const statusColor: Record<string, string> = {
  completed: 'text-emerald-400 bg-emerald-400/10',
  running:   'text-blue-400 bg-blue-400/10 animate-pulse',
  failed:    'text-red-400 bg-red-400/10',
}

export function OrchestratorStatus({ runs }: OrchestratorStatusProps) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-4">
      <div className="text-[10px] text-slate-500 tracking-[0.2em] uppercase mb-3">
        Orchestrator Runs
      </div>

      {runs.length === 0 ? (
        <div className="text-xs text-slate-600 text-center py-4">No runs yet</div>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <div
              key={run.id}
              className="flex items-start justify-between gap-2 py-2 border-b border-white/[0.04] last:border-0"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-slate-400 capitalize">
                  {run.cycle_type.replace(/_/g, ' ')}
                </div>
                <div className="text-[10px] text-slate-600 mt-0.5">
                  {run.agents_evaluated} agents · {run.decisions_made} decisions
                </div>
              </div>
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider font-medium ${statusColor[run.status] ?? 'text-slate-500 bg-white/5'}`}
              >
                {run.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
