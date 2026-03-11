-- ============================================================
-- AI VENTURE STUDIO — RLS Policies v2
-- ============================================================

ALTER TABLE agents              ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics_daily       ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports             ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE learnings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchestrator_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_policies ENABLE ROW LEVEL SECURITY;

-- studio_admin: full access to everything
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agents','budgets','runs','metrics_daily','reports',
    'transactions_ledger','decisions','learnings','artifacts',
    'orchestrator_runs','governance_policies'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY "admin_full_%s" ON %I FOR ALL USING (auth.jwt() ->> ''role'' = ''studio_admin'')',
      t, t
    );
  END LOOP;
END $$;

-- studio_viewer: read-only
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agents','budgets','runs','metrics_daily','reports',
    'transactions_ledger','decisions','learnings','artifacts',
    'orchestrator_runs','governance_policies'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY "viewer_read_%s" ON %I FOR SELECT USING (auth.jwt() ->> ''role'' IN (''studio_admin'',''studio_viewer''))',
      t, t
    );
  END LOOP;
END $$;

-- Kill switch: human can always pause/kill any agent
CREATE OR REPLACE FUNCTION apply_kill_switch(p_agent_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE agents
  SET status     = 'killed',
      config_json = config_json || '{"kill_switch_active": true}'::JSONB,
      updated_at = NOW()
  WHERE id = p_agent_id;

  INSERT INTO decisions (agent_id, outcome, rationale, score_at_decision, confidence, made_by, effective_date)
  SELECT p_agent_id, 'kill', 'Manual kill switch: ' || p_reason, current_score, 1.0, 'human_override', CURRENT_DATE
  FROM agents WHERE id = p_agent_id;
END;
$$;

-- Manual pause (reversible)
CREATE OR REPLACE FUNCTION apply_pause(p_agent_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE agents SET status = 'paused', updated_at = NOW() WHERE id = p_agent_id;
END;
$$;

-- Manual resume
CREATE OR REPLACE FUNCTION apply_resume(p_agent_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE agents
  SET status = 'active', consecutive_failures = 0, updated_at = NOW()
  WHERE id = p_agent_id AND status = 'paused';
END;
$$;
