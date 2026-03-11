-- ============================================================
-- AI VENTURE STUDIO — Unified Schema v2
-- Merges architectural blueprint + governance spec
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE agent_type      AS ENUM ('mother', 'explorer', 'exploiter');
CREATE TYPE vertical_type   AS ENUM ('education', 'b2b_tech');
CREATE TYPE agent_status    AS ENUM ('active', 'paused', 'frozen', 'graduating', 'terminated', 'killed');
CREATE TYPE agent_stage     AS ENUM ('S0', 'S1', 'S2', 'S3');
CREATE TYPE run_status      AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');
CREATE TYPE decision_outcome AS ENUM ('fund', 'hold', 'pivot', 'kill', 'promote', 'replicate', 'graduate');
CREATE TYPE tx_type         AS ENUM ('budget_allocation', 'stage_promotion', 'spend', 'refund', 'penalty', 'bonus', 'reclaim');
CREATE TYPE artifact_type   AS ENUM ('landing_page', 'report', 'hypothesis', 'experiment', 'model', 'dataset', 'playbook', 'ad_creative');
CREATE TYPE orch_cycle      AS ENUM ('daily_metrics', 'weekly_decisions', 'biweekly_review');

-- ============================================================
-- TABLE: agents
-- ============================================================

CREATE TABLE agents (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                 TEXT        NOT NULL,
  type                 agent_type  NOT NULL,
  vertical             vertical_type NOT NULL,
  status               agent_status  NOT NULL DEFAULT 'active',
  stage                agent_stage   NOT NULL DEFAULT 'S0',
  config_json          JSONB       NOT NULL DEFAULT '{}',
  hypothesis           TEXT        NOT NULL DEFAULT '',
  current_score        NUMERIC(5,2) NOT NULL DEFAULT 0
                         CHECK (current_score >= 0 AND current_score <= 100),
  consecutive_failures INTEGER     NOT NULL DEFAULT 0,
  last_report_at       TIMESTAMPTZ,
  parent_agent_id      UUID        REFERENCES agents(id) ON DELETE SET NULL,
  generation           INTEGER     NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agents_status   ON agents(status);
CREATE INDEX idx_agents_vertical ON agents(vertical);
CREATE INDEX idx_agents_type     ON agents(type);
CREATE INDEX idx_agents_stage    ON agents(stage);
CREATE INDEX idx_agents_score    ON agents(current_score DESC);
CREATE INDEX idx_agents_parent   ON agents(parent_agent_id);

-- ============================================================
-- TABLE: budgets  (one per agent per stage cycle)
-- ============================================================

CREATE TABLE budgets (
  id                         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id                   UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  stage                      agent_stage NOT NULL,
  allocated_eur              NUMERIC(10,2) NOT NULL DEFAULT 0,
  spent_eur                  NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (spent_eur >= 0),
  hard_limit_eur             NUMERIC(10,2) NOT NULL,
  weekly_limit_eur           NUMERIC(10,2) NOT NULL DEFAULT 100,
  auto_approve_threshold_eur NUMERIC(10,2) NOT NULL DEFAULT 30,
  start_date                 DATE        NOT NULL DEFAULT CURRENT_DATE,
  end_date                   DATE        NOT NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT budget_not_overspent   CHECK (spent_eur <= hard_limit_eur + 0.01),
  CONSTRAINT budget_allocated_limit CHECK (allocated_eur <= hard_limit_eur)
);

ALTER TABLE budgets
  ADD COLUMN available_eur NUMERIC(10,2)
    GENERATED ALWAYS AS (allocated_eur - spent_eur) STORED;

CREATE INDEX idx_budgets_agent ON budgets(agent_id);
CREATE INDEX idx_budgets_stage ON budgets(agent_id, stage);

-- ============================================================
-- TABLE: runs
-- ============================================================

CREATE TABLE runs (
  id                  UUID       PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id            UUID       NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  goal                TEXT       NOT NULL,
  status              run_status NOT NULL DEFAULT 'queued',
  cost_estimated_eur  NUMERIC(8,4) NOT NULL DEFAULT 0,
  cost_real_eur       NUMERIC(8,4) NOT NULL DEFAULT 0,
  started_at          TIMESTAMPTZ,
  finished_at         TIMESTAMPTZ,
  tasks_completed     INTEGER    NOT NULL DEFAULT 0,
  tasks_failed        INTEGER    NOT NULL DEFAULT 0,
  tokens_used         INTEGER    NOT NULL DEFAULT 0,
  error_message       TEXT,
  output_summary      TEXT,
  metadata            JSONB      NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_runs_agent   ON runs(agent_id);
CREATE INDEX idx_runs_status  ON runs(status);
CREATE INDEX idx_runs_created ON runs(created_at DESC);

-- ============================================================
-- TABLE: metrics_daily  (full ChatGPT spec fields)
-- ============================================================

CREATE TABLE metrics_daily (
  id                       UUID     PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id                 UUID     NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  date                     DATE     NOT NULL,
  -- Financial
  revenue_eur              NUMERIC(10,2) NOT NULL DEFAULT 0,
  ad_spend_eur             NUMERIC(10,2) NOT NULL DEFAULT 0,
  tools_spend_eur          NUMERIC(10,2) NOT NULL DEFAULT 0,
  other_spend_eur          NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Unit economics
  cac_eur                  NUMERIC(10,2) NOT NULL DEFAULT 0,
  ltv_eur                  NUMERIC(10,2) NOT NULL DEFAULT 0,
  payback_days             INTEGER  NOT NULL DEFAULT 0,
  -- Operations
  leads_generated          INTEGER  NOT NULL DEFAULT 0,
  conversions              INTEGER  NOT NULL DEFAULT 0,
  experiments_run          INTEGER  NOT NULL DEFAULT 0,
  experiments_succeeded    INTEGER  NOT NULL DEFAULT 0,
  automation_score         NUMERIC(4,3) NOT NULL DEFAULT 0
                             CHECK (automation_score >= 0 AND automation_score <= 1),
  tasks_done               INTEGER  NOT NULL DEFAULT 0,
  -- Risk (0-1 each)
  legal_risk               NUMERIC(4,3) NOT NULL DEFAULT 0
                             CHECK (legal_risk >= 0 AND legal_risk <= 1),
  platform_dependency_risk NUMERIC(4,3) NOT NULL DEFAULT 0
                             CHECK (platform_dependency_risk >= 0 AND platform_dependency_risk <= 1),
  reputation_risk          NUMERIC(4,3) NOT NULL DEFAULT 0
                             CHECK (reputation_risk >= 0 AND reputation_risk <= 1),
  injection_exposure       NUMERIC(4,3) NOT NULL DEFAULT 0
                             CHECK (injection_exposure >= 0 AND injection_exposure <= 1),
  -- Optional
  nps_score                NUMERIC(5,1)
                             CHECK (nps_score >= -100 AND nps_score <= 100),
  custom_kpis              JSONB    NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_agent_daily UNIQUE (agent_id, date)
);

-- Computed columns
ALTER TABLE metrics_daily
  ADD COLUMN total_cost_eur  NUMERIC(10,2)
    GENERATED ALWAYS AS (ad_spend_eur + tools_spend_eur + other_spend_eur) STORED,
  ADD COLUMN net_profit_eur  NUMERIC(10,2)
    GENERATED ALWAYS AS (revenue_eur - (ad_spend_eur + tools_spend_eur + other_spend_eur)) STORED,
  ADD COLUMN margin          NUMERIC(6,4)
    GENERATED ALWAYS AS (
      CASE WHEN revenue_eur > 0
        THEN ROUND((revenue_eur - (ad_spend_eur + tools_spend_eur + other_spend_eur)) / revenue_eur, 4)
        ELSE 0
      END) STORED,
  ADD COLUMN conversion_rate NUMERIC(6,4)
    GENERATED ALWAYS AS (
      CASE WHEN leads_generated > 0
        THEN ROUND(conversions::NUMERIC / leads_generated, 4)
        ELSE 0
      END) STORED,
  ADD COLUMN success_rate    NUMERIC(6,4)
    GENERATED ALWAYS AS (
      CASE WHEN experiments_run > 0
        THEN ROUND(experiments_succeeded::NUMERIC / experiments_run, 4)
        ELSE 0
      END) STORED,
  ADD COLUMN risk_score      NUMERIC(6,4)
    GENERATED ALWAYS AS (
      ROUND((legal_risk + platform_dependency_risk + reputation_risk + injection_exposure) / 4, 4)
    ) STORED;

CREATE INDEX idx_metrics_agent      ON metrics_daily(agent_id);
CREATE INDEX idx_metrics_date       ON metrics_daily(date DESC);
CREATE INDEX idx_metrics_agent_date ON metrics_daily(agent_id, date DESC);

-- ============================================================
-- TABLE: reports  (ReportV1 contract)
-- ============================================================

CREATE TABLE reports (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id           UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  run_id             UUID        REFERENCES runs(id) ON DELETE SET NULL,
  period_start       DATE        NOT NULL,
  period_end         DATE        NOT NULL,
  stage              agent_stage NOT NULL,
  format_version     TEXT        NOT NULL DEFAULT 'v1',
  -- KPIs (denormalised for Mother AI ingestion)
  kpi_revenue_eur    NUMERIC(10,2) NOT NULL DEFAULT 0,
  kpi_net_profit_eur NUMERIC(10,2) NOT NULL DEFAULT 0,
  kpi_margin         NUMERIC(6,4)  NOT NULL DEFAULT 0,
  kpi_cac_eur        NUMERIC(10,2) NOT NULL DEFAULT 0,
  kpi_ltv_eur        NUMERIC(10,2) NOT NULL DEFAULT 0,
  kpi_payback_days   INTEGER       NOT NULL DEFAULT 0,
  -- Spend
  spend_ad_eur       NUMERIC(10,2) NOT NULL DEFAULT 0,
  spend_tools_eur    NUMERIC(10,2) NOT NULL DEFAULT 0,
  spend_other_eur    NUMERIC(10,2) NOT NULL DEFAULT 0,
  spend_total_eur    NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Ops
  ops_tasks_done     INTEGER       NOT NULL DEFAULT 0,
  ops_blockers       TEXT[]        NOT NULL DEFAULT '{}',
  ops_automation     NUMERIC(4,3)  NOT NULL DEFAULT 0,
  -- Risk
  risk_legal         NUMERIC(4,3)  NOT NULL DEFAULT 0,
  risk_platform      NUMERIC(4,3)  NOT NULL DEFAULT 0,
  risk_reputation    NUMERIC(4,3)  NOT NULL DEFAULT 0,
  risk_injection     NUMERIC(4,3)  NOT NULL DEFAULT 0,
  risk_overall       NUMERIC(4,3)  NOT NULL DEFAULT 0,
  -- Next steps
  next_actions       TEXT[]        NOT NULL DEFAULT '{}',
  evidence           TEXT[]        NOT NULL DEFAULT '{}',
  hypothesis_status  TEXT          NOT NULL DEFAULT 'validating'
                       CHECK (hypothesis_status IN ('validating','validated','invalidated','pivoting')),
  notes              TEXT,
  -- Validation
  is_valid           BOOLEAN       NOT NULL DEFAULT false,
  validation_errors  TEXT[]        NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reports_agent   ON reports(agent_id);
CREATE INDEX idx_reports_created ON reports(created_at DESC);
CREATE INDEX idx_reports_valid   ON reports(agent_id, is_valid);

-- ============================================================
-- TABLE: transactions_ledger  (IMMUTABLE)
-- ============================================================

CREATE TABLE transactions_ledger (
  id                UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id          UUID    NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  budget_id         UUID    NOT NULL REFERENCES budgets(id) ON DELETE RESTRICT,
  type              tx_type NOT NULL,
  amount_eur        NUMERIC(10,4) NOT NULL,
  balance_after_eur NUMERIC(10,4) NOT NULL,
  description       TEXT    NOT NULL,
  vendor            TEXT,
  evidence_url      TEXT,
  approved_by       TEXT    NOT NULL DEFAULT 'auto',
  run_id            UUID    REFERENCES runs(id) ON DELETE SET NULL,
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  approved_at       TIMESTAMPTZ,
  rejected_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- IMMUTABILITY: block updates and deletes at DB level
CREATE RULE no_update_ledger AS ON UPDATE TO transactions_ledger DO INSTEAD NOTHING;
CREATE RULE no_delete_ledger AS ON DELETE TO transactions_ledger DO INSTEAD NOTHING;

CREATE INDEX idx_ledger_agent    ON transactions_ledger(agent_id);
CREATE INDEX idx_ledger_budget   ON transactions_ledger(budget_id);
CREATE INDEX idx_ledger_created  ON transactions_ledger(created_at DESC);
CREATE INDEX idx_ledger_pending  ON transactions_ledger(requires_approval, approved_at)
  WHERE requires_approval = true AND approved_at IS NULL AND rejected_at IS NULL;

-- ============================================================
-- TABLE: decisions
-- ============================================================

CREATE TABLE decisions (
  id                UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id          UUID             NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  outcome           decision_outcome NOT NULL,
  rationale         TEXT             NOT NULL,
  score_at_decision NUMERIC(5,2)     NOT NULL,
  evidence          TEXT[]           NOT NULL DEFAULT '{}',
  confidence        NUMERIC(3,2)     NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  budget_change_eur NUMERIC(10,2),
  new_stage         agent_stage,
  new_hypothesis    TEXT,
  target_vertical   vertical_type,
  made_by           TEXT             NOT NULL DEFAULT 'mother_ai',
  human_reviewer_id UUID,
  reviewed_at       TIMESTAMPTZ,
  overridden        BOOLEAN          NOT NULL DEFAULT false,
  override_reason   TEXT,
  effective_date    DATE             NOT NULL DEFAULT CURRENT_DATE,
  created_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_decisions_agent   ON decisions(agent_id);
CREATE INDEX idx_decisions_outcome ON decisions(outcome);
CREATE INDEX idx_decisions_created ON decisions(created_at DESC);
CREATE INDEX idx_decisions_pending ON decisions(reviewed_at) WHERE reviewed_at IS NULL;

-- ============================================================
-- TABLE: learnings
-- ============================================================

CREATE TABLE learnings (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id        UUID          NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  run_id          UUID          REFERENCES runs(id) ON DELETE SET NULL,
  hypothesis      TEXT          NOT NULL,
  result          TEXT          NOT NULL,
  analysis        TEXT          NOT NULL,
  vertical        vertical_type NOT NULL,
  stage           agent_stage   NOT NULL,
  is_transferable BOOLEAN       NOT NULL DEFAULT false,
  confidence      NUMERIC(3,2)  NOT NULL DEFAULT 0.5
                    CHECK (confidence >= 0 AND confidence <= 1),
  tags            TEXT[]        NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_learnings_agent       ON learnings(agent_id);
CREATE INDEX idx_learnings_vertical    ON learnings(vertical);
CREATE INDEX idx_learnings_transferable ON learnings(is_transferable) WHERE is_transferable = true;

-- ============================================================
-- TABLE: artifacts
-- ============================================================

CREATE TABLE artifacts (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id     UUID          NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  run_id       UUID          REFERENCES runs(id) ON DELETE SET NULL,
  type         artifact_type NOT NULL,
  title        TEXT          NOT NULL,
  description  TEXT          NOT NULL DEFAULT '',
  url          TEXT,
  storage_path TEXT,
  version      INTEGER       NOT NULL DEFAULT 1,
  is_active    BOOLEAN       NOT NULL DEFAULT true,
  metadata     JSONB         NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_artifacts_agent  ON artifacts(agent_id);
CREATE INDEX idx_artifacts_type   ON artifacts(type);
CREATE INDEX idx_artifacts_active ON artifacts(is_active) WHERE is_active = true;

-- ============================================================
-- TABLE: orchestrator_runs
-- ============================================================

CREATE TABLE orchestrator_runs (
  id                       UUID       PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_type               orch_cycle NOT NULL,
  started_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at             TIMESTAMPTZ,
  agents_evaluated         INTEGER    NOT NULL DEFAULT 0,
  decisions_made           INTEGER    NOT NULL DEFAULT 0,
  reports_validated        INTEGER    NOT NULL DEFAULT 0,
  reports_rejected         INTEGER    NOT NULL DEFAULT 0,
  agents_frozen            INTEGER    NOT NULL DEFAULT 0,
  budget_redistributed_eur NUMERIC(10,2) NOT NULL DEFAULT 0,
  status                   TEXT       NOT NULL DEFAULT 'running'
                             CHECK (status IN ('running','completed','failed')),
  summary                  TEXT,
  raw_output               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orch_created ON orchestrator_runs(created_at DESC);

-- ============================================================
-- TABLE: governance_policies
-- ============================================================

CREATE TABLE governance_policies (
  id          UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT    NOT NULL UNIQUE,
  description TEXT    NOT NULL,
  rule_type   TEXT    NOT NULL,
  parameters  JSONB   NOT NULL DEFAULT '{}',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TRIGGER: updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER agents_updated_at  BEFORE UPDATE ON agents  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER budgets_updated_at BEFORE UPDATE ON budgets FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TRIGGER: sync budget.spent_eur from ledger
-- ============================================================

CREATE OR REPLACE FUNCTION sync_budget_from_ledger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount_eur < 0 THEN
    UPDATE budgets
    SET spent_eur = spent_eur + ABS(NEW.amount_eur)
    WHERE id = NEW.budget_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_sync_budget
  AFTER INSERT ON transactions_ledger
  FOR EACH ROW EXECUTE FUNCTION sync_budget_from_ledger();

-- ============================================================
-- TRIGGER: enforce hard_limit and weekly cap
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_budget_limits()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  b            budgets%ROWTYPE;
  weekly_spent NUMERIC;
BEGIN
  IF NEW.amount_eur >= 0 THEN RETURN NEW; END IF;

  SELECT * INTO b FROM budgets WHERE id = NEW.budget_id FOR UPDATE;

  -- Hard limit check
  IF (b.spent_eur + ABS(NEW.amount_eur)) > b.hard_limit_eur THEN
    RAISE EXCEPTION 'HARD_LIMIT_EXCEEDED: limit=% spent=% requested=%',
      b.hard_limit_eur, b.spent_eur, ABS(NEW.amount_eur);
  END IF;

  -- Weekly cap
  SELECT COALESCE(SUM(ABS(amount_eur)), 0) INTO weekly_spent
  FROM transactions_ledger
  WHERE budget_id = NEW.budget_id
    AND amount_eur < 0
    AND created_at >= DATE_TRUNC('week', NOW());

  IF (weekly_spent + ABS(NEW.amount_eur)) > b.weekly_limit_eur THEN
    RAISE EXCEPTION 'WEEKLY_LIMIT_EXCEEDED: limit=% spent_this_week=% requested=%',
      b.weekly_limit_eur, weekly_spent, ABS(NEW.amount_eur);
  END IF;

  -- Flag for approval if above threshold
  IF ABS(NEW.amount_eur) > b.auto_approve_threshold_eur THEN
    NEW.requires_approval = true;
    NEW.approved_at       = NULL;
  ELSE
    NEW.requires_approval = false;
    NEW.approved_at       = NOW();
    NEW.approved_by       = 'auto';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_enforce_limits
  BEFORE INSERT ON transactions_ledger
  FOR EACH ROW EXECUTE FUNCTION enforce_budget_limits();

-- ============================================================
-- TRIGGER: 3-consecutive-failures → pause agent
-- ============================================================

CREATE OR REPLACE FUNCTION check_consecutive_failures()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'failed' THEN
    UPDATE agents
    SET consecutive_failures = consecutive_failures + 1,
        status = CASE WHEN consecutive_failures + 1 >= 3 THEN 'paused' ELSE status END
    WHERE id = NEW.agent_id;
  ELSIF NEW.status = 'completed' THEN
    UPDATE agents
    SET consecutive_failures = 0
    WHERE id = NEW.agent_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER runs_failure_check
  AFTER UPDATE OF status ON runs
  FOR EACH ROW EXECUTE FUNCTION check_consecutive_failures();

-- ============================================================
-- TRIGGER: mode immutability (explorer/exploiter)
-- ============================================================

CREATE OR REPLACE FUNCTION prevent_type_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.type != NEW.type AND OLD.type IN ('explorer','exploiter') THEN
    RAISE EXCEPTION 'Agent type cannot be changed after creation (% → %)', OLD.type, NEW.type;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agents_no_type_change
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION prevent_type_change();

-- ============================================================
-- VIEW: agent_full_status
-- ============================================================

CREATE OR REPLACE VIEW agent_full_status AS
SELECT
  a.*,
  b.id           AS budget_id,
  b.stage        AS budget_stage,
  b.allocated_eur,
  b.spent_eur,
  b.available_eur,
  b.hard_limit_eur,
  b.weekly_limit_eur,
  b.auto_approve_threshold_eur,
  m.date         AS last_metrics_date,
  m.revenue_eur  AS last_revenue_eur,
  m.net_profit_eur AS last_net_profit_eur,
  m.margin       AS last_margin,
  m.cac_eur      AS last_cac_eur,
  m.risk_score   AS last_risk_score,
  r.id           AS last_run_id,
  r.status       AS last_run_status,
  r.finished_at  AS last_run_finished_at,
  rp.id          AS last_report_id,
  rp.is_valid    AS last_report_valid,
  rp.created_at  AS last_report_at_ts
FROM agents a
LEFT JOIN budgets b ON b.agent_id = a.id AND b.stage = a.stage
LEFT JOIN LATERAL (
  SELECT * FROM metrics_daily WHERE agent_id = a.id ORDER BY date DESC LIMIT 1
) m ON true
LEFT JOIN LATERAL (
  SELECT * FROM runs WHERE agent_id = a.id ORDER BY created_at DESC LIMIT 1
) r ON true
LEFT JOIN LATERAL (
  SELECT * FROM reports WHERE agent_id = a.id ORDER BY created_at DESC LIMIT 1
) rp ON true;

-- ============================================================
-- VIEW: studio_summary
-- ============================================================

CREATE OR REPLACE VIEW studio_summary AS
SELECT
  COUNT(*)                                           AS total_agents,
  COUNT(*) FILTER (WHERE status = 'active')          AS active_agents,
  COUNT(*) FILTER (WHERE status = 'paused')          AS paused_agents,
  COUNT(*) FILTER (WHERE status = 'frozen')          AS frozen_agents,
  COUNT(*) FILTER (WHERE type = 'explorer')          AS explorer_count,
  COUNT(*) FILTER (WHERE type = 'exploiter')         AS exploiter_count,
  ROUND(AVG(current_score), 2)                       AS avg_score,
  (SELECT COALESCE(SUM(allocated_eur), 0) FROM budgets)  AS total_budget_allocated_eur,
  (SELECT COALESCE(SUM(spent_eur), 0) FROM budgets)      AS total_budget_spent_eur,
  (SELECT COALESCE(SUM(revenue_eur), 0)
   FROM metrics_daily WHERE date >= DATE_TRUNC('month', CURRENT_DATE)) AS monthly_revenue_eur,
  (SELECT COALESCE(SUM(net_profit_eur), 0)
   FROM metrics_daily WHERE date >= DATE_TRUNC('month', CURRENT_DATE)) AS monthly_profit_eur,
  (SELECT COUNT(*) FROM decisions
   WHERE created_at >= DATE_TRUNC('week', CURRENT_DATE))               AS decisions_this_week,
  (SELECT COUNT(*) FROM transactions_ledger
   WHERE requires_approval = true AND approved_at IS NULL
     AND rejected_at IS NULL)                                           AS pending_approvals,
  (SELECT COUNT(*) FROM agents
   WHERE status = 'active'
     AND (last_report_at IS NULL
          OR last_report_at < NOW() - INTERVAL '48 hours'))             AS reports_missing
FROM agents;

-- ============================================================
-- SEED: Governance policies
-- ============================================================

INSERT INTO governance_policies (name, description, rule_type, parameters) VALUES
  ('consecutive_failure_pause',
   'Pause agent after 3 consecutive run failures',
   'consecutive_failure_pause',
   '{"threshold": 3}'),
  ('no_report_freeze',
   'Freeze funding if no valid report in 48 hours',
   'no_report_freeze',
   '{"hours": 48}'),
  ('spend_approval_threshold',
   'Any single spend above 30 EUR requires human approval',
   'spend_approval_threshold',
   '{"threshold_eur": 30}'),
  ('explorer_no_self_scale',
   'Explorer agents cannot promote themselves — requires Mother AI decision',
   'explorer_no_self_scale',
   '{"enforce": true}'),
  ('weekly_spend_cap',
   'Default weekly spend cap per agent',
   'weekly_spend_cap',
   '{"default_eur": 100}');

-- ============================================================
-- SEED: Mother AI agent
-- ============================================================

INSERT INTO agents (name, type, vertical, status, stage, hypothesis, config_json) VALUES
  ('Mother-AI-v1', 'mother', 'education', 'active', 'S3',
   'Govern and optimise a portfolio of AI micro-ventures through data-driven decisions',
   '{
     "tools_allowed": ["database_read","database_write"],
     "max_cost_per_run_eur": 5,
     "max_daily_spend_eur": 20,
     "reporting_required": false,
     "report_interval_hours": 0,
     "can_spawn_agents": true,
     "kill_switch_active": false,
     "custom_constraints": {}
   }');

-- ============================================================
-- SEED: Explorer agents (Fase 2)
-- ============================================================

INSERT INTO agents (name, type, vertical, stage, hypothesis, config_json) VALUES
  ('EDU-Explorer-01', 'explorer', 'education', 'S0',
   'AI-powered microlearning for corporate L&D teams reduces training costs 40% while improving knowledge retention',
   '{
     "tools_allowed": ["web_search","web_scrape","email_send","file_write"],
     "max_cost_per_run_eur": 5,
     "max_daily_spend_eur": 15,
     "reporting_required": true,
     "report_interval_hours": 24,
     "can_spawn_agents": false,
     "kill_switch_active": false,
     "custom_constraints": {"max_emails_per_day": 50}
   }'),
  ('TECH-Explorer-01', 'explorer', 'b2b_tech', 'S0',
   'Automated API documentation generation saves mid-market SaaS dev teams 5h+/week and cuts onboarding time by 60%',
   '{
     "tools_allowed": ["web_search","web_scrape","email_send","file_write","api_call_external"],
     "max_cost_per_run_eur": 5,
     "max_daily_spend_eur": 15,
     "reporting_required": true,
     "report_interval_hours": 24,
     "can_spawn_agents": false,
     "kill_switch_active": false,
     "custom_constraints": {"max_api_calls_per_hour": 100}
   }');

-- Budgets: S0 = 150 EUR hard limit, 30 EUR/week
INSERT INTO budgets (agent_id, stage, allocated_eur, hard_limit_eur, weekly_limit_eur, auto_approve_threshold_eur, end_date)
SELECT id, 'S0', 150.00, 150.00, 30.00, 30.00, CURRENT_DATE + INTERVAL '30 days'
FROM agents WHERE type = 'explorer';
