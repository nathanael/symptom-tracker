-- Talk mode daily usage caps, keyed by Firebase uid. Only the edge function (service role) touches
-- this: RLS is on with no policies, and the spend function is not callable by anon/authenticated.
create table public.voice_usage (
  uid text not null,
  day date not null,
  sessions integer not null default 0,
  turns integer not null default 0,
  tts_chars integer not null default 0,
  primary key (uid, day)
);

alter table public.voice_usage enable row level security;

-- Adds p_amount to one counter for today; returns false (and changes nothing) if that would pass p_cap
create function public.spend_voice(p_uid text, p_field text, p_amount integer, p_cap integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  updated integer;
begin
  if p_field not in ('sessions', 'turns', 'tts_chars') or p_amount < 0 then
    raise exception 'invalid arguments';
  end if;
  insert into public.voice_usage (uid, day) values (p_uid, today) on conflict do nothing;
  execute format(
    'update public.voice_usage set %1$I = %1$I + $1 where uid = $2 and day = $3 and %1$I + $1 <= $4 returning %1$I',
    p_field
  ) into updated using p_amount, p_uid, today, p_cap;
  return updated is not null;
end;
$$;

revoke all on function public.spend_voice(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.spend_voice(text, text, integer, integer) to service_role;
