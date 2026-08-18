-- One delivery per payment, enforced by the database.
--
-- An agent using an allowance carries its reference on-chain, in the contract's event, so the
-- payment and the request it settles are bound together and cannot be separated.
--
-- An agent paying directly has no way to do that. Soroban transactions do not support memos,
-- and a plain SAC transfer has no field for arbitrary data, so a direct payer has to name its
-- reference in the HTTP request instead. That is weaker: someone could pair a reference they
-- were issued with a payment somebody else made.
--
-- This index bounds the damage. A transaction hash can be consumed by exactly one challenge, so
-- each payment yields exactly one delivery no matter who claims it first. The on-chain binding
-- an allowance provides is still strictly better, and that difference is worth stating rather
-- than papering over.

create unique index if not exists challenges_consumed_tx_unique
  on challenges (consumed_tx_hash)
  where consumed_tx_hash is not null;
