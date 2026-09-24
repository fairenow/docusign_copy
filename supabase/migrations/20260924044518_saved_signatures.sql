-- Signatures and initials a team member saves for reuse. Private to their owner.
create table public.saved_signatures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('signature', 'initials')),
  -- Same format and size limit as signature field values
  image text not null check (image ~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$' and char_length(image) <= 300000),
  created_at timestamptz not null default now()
);

create index saved_signatures_user_kind_idx on public.saved_signatures (user_id, kind, created_at desc);

alter table public.saved_signatures enable row level security;

create policy "Owners read their saved signatures" on public.saved_signatures
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Owners add saved signatures" on public.saved_signatures
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Owners delete their saved signatures" on public.saved_signatures
  for delete to authenticated using (user_id = (select auth.uid()));

-- Clients choose only what is saved; ids, owner and time are set by the database. No updates.
revoke all on public.saved_signatures from anon, authenticated;
grant select, delete on public.saved_signatures to authenticated;
grant insert (kind, image) on public.saved_signatures to authenticated;

-- Keep at most 5 of each kind per person
create function private.limit_saved_signatures()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Serialize inserts per user so concurrent saves cannot exceed the limit
  perform pg_advisory_xact_lock(hashtextextended('saved_signatures:' || new.user_id::text, 0));
  if (select count(*) from public.saved_signatures where user_id = new.user_id and kind = new.kind) >= 5 then
    raise exception 'You can save up to 5 %. Delete one first.', case new.kind when 'signature' then 'signatures' else 'sets of initials' end
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger saved_signatures_limit
  before insert on public.saved_signatures
  for each row execute function private.limit_saved_signatures();
