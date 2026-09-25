-- Production audit fixes:
-- 1. Sign-ups were limited to approved email domains, but an existing user could change their
--    account email to any address and keep access. Email changes now follow the same rule.
-- 2. template_roles_template_id_idx duplicates the (template_id, name) unique index.

create or replace function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from private.allowed_email_domains)
     and not exists (
       select 1 from private.allowed_email_domains
       where domain = lower(split_part(new.email, '@', 2))
     ) then
    raise exception 'Email addresses are limited to approved email domains';
  end if;
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

-- Check before the change is stored (the old trigger ran after it)
drop trigger on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  before update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

revoke all on function private.handle_user_email_change() from public, anon, authenticated;

drop index if exists public.template_roles_template_id_idx;
