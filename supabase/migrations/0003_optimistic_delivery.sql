-- Delivering before the ledger closes.
--
-- Payment normally takes about seven seconds, almost all of it waiting for Stellar to close a
-- ledger. But the allowance's rules run during *simulation*, not at apply time — by the time a
-- transaction is prepared, the per-call cap, the window and the allowlist have all been checked.
-- A refusal is already known.
--
-- So an agent can hand the gateway a signed, simulated transaction rather than a hash. The
-- gateway re-simulates it for itself (about half a second), submits it, and delivers on the
-- network's acceptance rather than on the ledger's. This is card authorization: the shop hands
-- over the coffee at auth, not at settlement.
--
-- It is not free. Simulation reads state now and the ledger applies it about five seconds later,
-- so a transaction that simulated cleanly can still revert — two purchases in flight from one
-- agent can both see the same headroom, and an owner can revoke inside the gap. A revert after
-- delivery means the developer served one call for nothing.
--
-- That is the developer's money, so it is the developer's switch, and it is off by default.

alter table apis
  add column if not exists optimistic boolean not null default false;

comment on column apis.optimistic is
  'Deliver on network acceptance rather than ledger inclusion. Trades a bounded risk of one free call for roughly five seconds.';

-- ---------------------------------------------------------------------------
-- What actually happened to an optimistically delivered payment.
--
-- The request is answered before the outcome is known, so the outcome has to be recorded
-- somewhere afterwards or nobody could ever tell how often this goes wrong. `settled` is null
-- until a ledger takes a position.
-- ---------------------------------------------------------------------------
alter table requests
  add column if not exists optimistic boolean not null default false,
  add column if not exists settled boolean;

create index if not exists requests_unsettled_idx on requests (created_at desc)
  where optimistic and settled is null;

-- ---------------------------------------------------------------------------
-- Agents whose transactions bounce lose the privilege.
--
-- Tracked per agent address rather than per allowance: the agent is what submits, and an owner
-- with several allowances should not have one agent's behaviour excuse another's.
-- ---------------------------------------------------------------------------
create table if not exists agent_reliability (
  agent_address  text primary key,
  delivered      bigint not null default 0,
  reverted       bigint not null default 0,
  -- Set when a revert drops the agent back to confirm-first. Cleared once it settles clean
  -- again, so this is a demotion rather than a ban.
  demoted_at     timestamptz,
  updated_at     timestamptz not null default now()
);

alter table agent_reliability enable row level security;
