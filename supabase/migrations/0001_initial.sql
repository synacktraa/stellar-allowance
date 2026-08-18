-- Stellar Allowance — initial schema.
--
-- Everything here is off-chain bookkeeping. Money, limits and the fee split live in the
-- contracts; this database exists because HTTP is stateless and the gateway has to remember
-- what it quoted between one request and the next.
--
-- Reached only from server-side routes using the service role key, so every table has RLS
-- enabled with no policies: the service role bypasses RLS, and anything else is denied.

-- ---------------------------------------------------------------------------
-- Developers — identified by their Stellar address, proven by signing a nonce.
-- ---------------------------------------------------------------------------
create table if not exists developers (
  address     text primary key,
  created_at  timestamptz not null default now()
);

create table if not exists auth_challenges (
  nonce       text primary key,
  address     text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists auth_challenges_address_idx on auth_challenges (address);

-- ---------------------------------------------------------------------------
-- Registered APIs. Each gets its own splitter contract, so payments for one API
-- never mix with another's and an allowance can allowlist a single API.
-- ---------------------------------------------------------------------------
create table if not exists apis (
  id                    uuid primary key default gen_random_uuid(),
  developer_address     text not null references developers (address) on delete cascade,
  name                  text not null,
  upstream_url          text not null,
  -- Base units, 7 decimals. 100000 = 0.01 USDC. Never a float.
  price_stroops         bigint not null check (price_stroops > 0),
  -- Where the developer's 90% lands.
  payout_address        text not null,
  -- The contract the 402 names as recipient. Null until deployed.
  splitter_contract_id  text unique,
  -- Sent upstream as X-Allowance-Secret so the origin can tell the call came through us.
  upstream_secret       text not null,
  status                text not null default 'active'
                          check (status in ('pending', 'active', 'archived')),
  created_at            timestamptz not null default now()
);

create index if not exists apis_developer_idx on apis (developer_address);
create index if not exists apis_status_idx on apis (status);

-- ---------------------------------------------------------------------------
-- Challenges — one per 402 issued.
--
-- `reference` is passed into the contract's spend() and emitted in its event, so it is a
-- Soroban Symbol: at most 32 characters, [a-zA-Z0-9_] only. A 64-character hex string will
-- not convert.
--
-- consumed_tx_hash is what makes a payment single-use. Transaction hashes are public, so
-- without binding a payment to the challenge that requested it, anyone could replay someone
-- else's payment straight off the block explorer.
-- ---------------------------------------------------------------------------
create table if not exists challenges (
  reference         text primary key check (reference ~ '^[A-Za-z0-9_]{1,32}$'),
  api_id            uuid not null references apis (id) on delete cascade,
  amount_stroops    bigint not null check (amount_stroops > 0),
  recipient         text not null,           -- the API's splitter contract
  expires_at        timestamptz not null,
  consumed_tx_hash  text,
  consumed_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists challenges_api_idx on challenges (api_id);
create index if not exists challenges_open_idx on challenges (expires_at)
  where consumed_tx_hash is null;

-- ---------------------------------------------------------------------------
-- Requests — the lifecycle of one paid call.
--
-- upstream_failed exists so a payment that bought nothing is visible rather than silent.
-- No refund is issued today, but the reference ties the payment to the failed delivery,
-- which is the information a refund would need.
-- ---------------------------------------------------------------------------
create table if not exists requests (
  id            uuid primary key default gen_random_uuid(),
  api_id        uuid not null references apis (id) on delete cascade,
  reference     text references challenges (reference) on delete set null,
  status        text not null default 'challenge_sent'
                  check (status in ('challenge_sent', 'payment_verified',
                                    'forwarded', 'upstream_failed', 'replayed')),
  tx_hash       text,
  http_status   int,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists requests_api_idx on requests (api_id, created_at desc);
create index if not exists requests_reference_idx on requests (reference);

-- ---------------------------------------------------------------------------
-- Allowances — deployed per user. Balances, limits and spend history are read from the
-- chain, not from here; this table only records which contract belongs to whom.
-- ---------------------------------------------------------------------------
create table if not exists allowances (
  contract_id     text primary key,
  owner_address   text not null,
  agent_address   text not null,
  created_at      timestamptz not null default now()
);

create index if not exists allowances_owner_idx on allowances (owner_address);
create index if not exists allowances_agent_idx on allowances (agent_address);

-- ---------------------------------------------------------------------------
-- Deny everything that does not come through the service role.
-- ---------------------------------------------------------------------------
alter table developers      enable row level security;
alter table auth_challenges enable row level security;
alter table apis            enable row level security;
alter table challenges      enable row level security;
alter table requests        enable row level security;
alter table allowances      enable row level security;
