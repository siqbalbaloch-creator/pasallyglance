-- PasallyGlance — Supabase schema. Paste this whole file into the Supabase
-- dashboard → SQL Editor → Run. Safe to re-run.

-- ---------- tables ----------
create table if not exists public.profiles (
  id    uuid primary key references auth.users on delete cascade,
  email text,
  plan  text not null default 'free'   -- free | pro | pro_managed
);

-- One row per user per day. Free tier = 3/day; managed = monthly sum.
create table if not exists public.usage_daily (
  user_id uuid not null references auth.users on delete cascade,
  day     date not null,
  quick   int  not null default 0,     -- Haiku-tier actions
  deep    int  not null default 0,     -- Sonnet-tier actions
  primary key (user_id, day)
);

create table if not exists public.subscriptions (
  user_id             uuid primary key references auth.users on delete cascade,
  paddle_subscription_id text,
  status              text,
  current_period_end  timestamptz
);

-- Lock the tables down: no direct client access. Everything goes through the
-- security-definer functions below (entitlements) or the service role (Edge Functions).
alter table public.profiles      enable row level security;
alter table public.usage_daily   enable row level security;
alter table public.subscriptions enable row level security;

-- ---------- auto-create a profile on signup ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- metering: atomic daily increment ----------
create or replace function public.bump_usage(uid uuid, t text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.usage_daily (user_id, day, quick, deep)
  values (uid, (now() at time zone 'utc')::date,
          case when t = 'quick' then 1 else 0 end,
          case when t = 'deep'  then 1 else 0 end)
  on conflict (user_id, day) do update set
    quick = public.usage_daily.quick + (case when t = 'quick' then 1 else 0 end),
    deep  = public.usage_daily.deep  + (case when t = 'deep'  then 1 else 0 end);
end; $$;

-- ---------- entitlements: what the extension reads on load ----------
create or replace function public.entitlements()
returns json language plpgsql security definer set search_path = public as $$
declare
  p       text;
  today   date := (now() at time zone 'utc')::date;
  feats   json;
  uid     uuid := auth.uid();
  used_today int;
  mq int; md int;
begin
  if uid is null then
    return json_build_object('plan','free','features',json_build_array(),'quota',null,'dailyRemaining',3);
  end if;
  select plan into p from public.profiles where id = uid;
  if p is null then p := 'free'; end if;

  if p in ('pro','pro_managed') then
    feats := json_build_array('verify','deep','gmail','custom_prompts');
  else
    feats := json_build_array();
  end if;

  if p = 'pro_managed' then
    select coalesce(sum(quick),0), coalesce(sum(deep),0) into mq, md
      from public.usage_daily
      where user_id = uid and day >= date_trunc('month', today)::date;
    return json_build_object('plan',p,'features',feats,
      'quota', json_build_object('quickRemaining', greatest(0,500-mq), 'deepRemaining', greatest(0,100-md)),
      'dailyRemaining', null);
  elsif p = 'pro' then
    return json_build_object('plan',p,'features',feats,'quota',null,'dailyRemaining',null);
  else
    select coalesce(quick+deep,0) into used_today
      from public.usage_daily where user_id = uid and day = today;
    return json_build_object('plan','free','features',feats,'quota',null,
      'dailyRemaining', greatest(0, 3 - coalesce(used_today,0)));
  end if;
end; $$;

grant execute on function public.entitlements() to authenticated, anon;
grant execute on function public.bump_usage(uuid, text) to service_role;
