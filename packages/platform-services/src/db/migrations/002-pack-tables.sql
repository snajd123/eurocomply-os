-- Installed packs
CREATE TABLE installed_packs (
  tenant_id TEXT NOT NULL,
  pack_name TEXT NOT NULL,
  pack_version TEXT NOT NULL,
  pack_type TEXT NOT NULL,
  manifest JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, pack_name)
);

CREATE INDEX idx_installed_packs_type ON installed_packs(pack_type);

-- Compliance locks
CREATE TABLE compliance_locks (
  lock_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  root_pack_name TEXT NOT NULL,
  lock_data JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_compliance_locks_tenant ON compliance_locks(tenant_id);
CREATE INDEX idx_compliance_locks_root ON compliance_locks(root_pack_name);
