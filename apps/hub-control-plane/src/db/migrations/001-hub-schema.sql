-- Organizations (customer accounts)
CREATE TABLE organizations (
  org_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  stripe_customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Products (from product manifests)
CREATE TABLE products (
  product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Spokes (customer instances)
CREATE TABLE spokes (
  spoke_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(org_id),
  product_id TEXT NOT NULL REFERENCES products(product_id),
  plan TEXT NOT NULL,
  region TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'provisioning',
  os_version TEXT,
  hostname TEXT,
  api_key_hash TEXT,
  last_heartbeat TIMESTAMPTZ,
  health JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Subscriptions (billing)
CREATE TABLE subscriptions (
  subscription_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(org_id),
  spoke_id TEXT NOT NULL REFERENCES spokes(spoke_id),
  stripe_subscription_id TEXT,
  plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Provisioning events (pipeline audit trail)
CREATE TABLE provisioning_events (
  event_id SERIAL PRIMARY KEY,
  spoke_id TEXT NOT NULL REFERENCES spokes(spoke_id),
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Network directory (DID → endpoint resolution)
CREATE TABLE network_directory (
  did TEXT PRIMARY KEY,
  spoke_id TEXT NOT NULL REFERENCES spokes(spoke_id),
  endpoint TEXT NOT NULL,
  capabilities TEXT[] NOT NULL DEFAULT '{}',
  visible BOOLEAN NOT NULL DEFAULT true,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
