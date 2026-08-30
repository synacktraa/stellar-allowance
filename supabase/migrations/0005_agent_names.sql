-- Agent accounts get a name.
--
-- A list of contract ids identifies nothing. `CBJNXCGG…42FF` is not a thing anyone recognises,
-- and choosing between two of them is guesswork — which is why the old interface described each
-- allowance by what it could buy and what was in it. That helped, but it is a description rather
-- than a name, and it changes as soon as the allowance does.
--
-- A name is chosen once and stays. It is also what an owner has been calling the thing in their
-- head since before they opened this page.

alter table allowances
  add column if not exists name text
    check (name is null or name ~ '^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$');

-- Unique per owner, not globally. Two people may both have an agent called "research" — they
-- are different agents belonging to different wallets, and forcing one to rename would be
-- inventing a conflict that does not exist.
create unique index if not exists allowances_owner_name_unique
  on allowances (owner_address, name)
  where name is not null;

-- ---------------------------------------------------------------------------
-- Existing allowances predate names. Give them one rather than leaving rows that cannot be
-- displayed the way every other row is.
-- ---------------------------------------------------------------------------
do $$
declare
  row record;
begin
  for row in
    select contract_id,
           'agent-' || row_number() over (partition by owner_address order by created_at) as generated
    from allowances
    where name is null
  loop
    update allowances set name = row.generated where contract_id = row.contract_id;
  end loop;
end $$;
