-- Entity type definitions
CREATE TABLE entity_types (
  entity_type TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  schema JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Entity instances
CREATE TABLE entities (
  entity_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL REFERENCES entity_types(entity_type),
  tenant_id TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_entities_type ON entities(entity_type);
CREATE INDEX idx_entities_tenant ON entities(tenant_id);

-- Entity version history
CREATE TABLE entity_versions (
  version_id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
  version INT NOT NULL,
  data JSONB NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(entity_id, version)
);

-- File metadata
CREATE TABLE files (
  file_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage_key TEXT NOT NULL,
  entity_id TEXT REFERENCES entities(entity_id) ON DELETE SET NULL,
  entity_type TEXT,
  uploaded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_files_entity ON files(entity_id);

-- Audit log (append-only)
CREATE TABLE audit_log (
  audit_entry_id TEXT PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_entity_type TEXT NOT NULL,
  resource_entity_id TEXT NOT NULL,
  changes JSONB,
  success BOOLEAN NOT NULL DEFAULT true,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_tenant ON audit_log(tenant_id);
CREATE INDEX idx_audit_log_resource ON audit_log(resource_entity_type, resource_entity_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);

-- Jobs (background processing)
CREATE TABLE jobs (
  job_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  result JSONB,
  error TEXT,
  submitted_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_tenant ON jobs(tenant_id);

-- Relation type definitions (cardinality, constraints)
CREATE TABLE relation_types (
  relation_type TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  from_entity_type TEXT NOT NULL REFERENCES entity_types(entity_type),
  to_entity_type TEXT NOT NULL REFERENCES entity_types(entity_type),
  cardinality TEXT NOT NULL DEFAULT 'n:n'
    CHECK (cardinality IN ('1:1', '1:n', 'n:1', 'n:n')),
  constraints JSONB NOT NULL DEFAULT '{}',
  inverse_type TEXT,
  cascade_delete BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_relation_types_tenant ON relation_types(tenant_id);
