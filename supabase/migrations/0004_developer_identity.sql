-- Developers get a name, and a way to prove the address is theirs.
--
-- Until now the developer surface was open: APIs were listed by `?developer=<address>` and
-- nothing could be edited, so there was nothing to protect. A dashboard changes that — a price
-- and an upstream URL are editable, and a handle is a claim about who you are.
--
-- `auth_challenges` has been in the schema since 0001, described as "identified by their Stellar
-- address, proven by signing a nonce", and nothing ever wrote a row to it. This is that.

-- ---------------------------------------------------------------------------
-- A handle, so an agent owner can see whose API they are about to allowlist.
--
-- It is a name someone picked, not an identity anybody checked, and the interface says so by
-- rendering it as @handle. First come, first served — the alternative is us deciding who is
-- really who, which is the vetting this project keeps refusing to pretend to do.
-- ---------------------------------------------------------------------------
alter table developers
  add column if not exists username text unique
    check (username ~ '^[a-z0-9][a-z0-9_-]{2,19}$');

comment on column developers.username is
  'Self-chosen handle, lowercase. Not verified — displayed as @handle so it never reads as an identity we confirmed.';

-- ---------------------------------------------------------------------------
-- One name per developer. Two APIs called "weather" under one handle would make
-- "@alice/weather" ambiguous, which is the thing the handle exists to fix.
-- ---------------------------------------------------------------------------
create unique index if not exists apis_developer_name_unique
  on apis (developer_address, name)
  where status <> 'archived';
