-- RunWorld — Supabase DB Schema
-- Run this in: Supabase Dashboard > SQL Editor > New Query

-- ── profiles ────────────────────────────────────────────────────────────────
create table public.profiles (
  id               uuid references auth.users(id) on delete cascade primary key,
  name             text        not null,
  email            text        not null unique,
  avatar           text        not null default '🏃',
  level            integer     not null default 1,
  xp               integer     not null default 0,
  xp_to_next       integer     not null default 1000,
  streak           integer     not null default 0,
  territory_percent float       not null default 0,
  total_distance_km float       not null default 0,
  total_steps      integer     not null default 0,
  push_token       text,
  created_at       timestamptz not null default now()
);

-- ── run_sessions ─────────────────────────────────────────────────────────────
create table public.run_sessions (
  id                 uuid        default gen_random_uuid() primary key,
  user_id            uuid        not null references public.profiles(id) on delete cascade,
  activity_type      text        not null default 'running' check (activity_type in ('running','walking')),
  distance_km        float       not null default 0,
  duration_seconds   integer     not null default 0,
  steps              integer     not null default 0,
  calories           integer     not null default 0,
  xp_earned          integer     not null default 0,
  territory_captured integer     not null default 0,
  path_coordinates   jsonb       not null default '[]',
  badges_unlocked    jsonb       not null default '[]',
  created_at         timestamptz not null default now()
);

create index run_sessions_user_id_idx on public.run_sessions(user_id);
create index run_sessions_created_at_idx on public.run_sessions(created_at desc);

-- ── territories ──────────────────────────────────────────────────────────────
create table public.territories (
  id           uuid        default gen_random_uuid() primary key,
  name         text        not null,
  owner_id     uuid        references public.profiles(id) on delete set null,
  owner_color  text        not null default '#3498DB',
  coordinates  jsonb       not null default '[]',
  center_lat   float,
  center_lng   float,
  captured_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index territories_center_idx on public.territories(center_lat, center_lng);

-- ── friendships ──────────────────────────────────────────────────────────────
create table public.friendships (
  id            uuid        default gen_random_uuid() primary key,
  requester_id  uuid        not null references public.profiles(id) on delete cascade,
  addressee_id  uuid        not null references public.profiles(id) on delete cascade,
  status        text        not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at    timestamptz not null default now(),
  unique(requester_id, addressee_id)
);

-- ── otp_codes ────────────────────────────────────────────────────────────────
create table public.otp_codes (
  id         uuid        default gen_random_uuid() primary key,
  email      text        not null,
  code       text        not null,
  expires_at timestamptz not null,
  used       boolean     not null default false,
  created_at timestamptz not null default now()
);

create index otp_codes_email_idx on public.otp_codes(email);

-- ── refresh_tokens ───────────────────────────────────────────────────────────
create table public.refresh_tokens (
  id         uuid        default gen_random_uuid() primary key,
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  token      text        not null unique,
  expires_at timestamptz not null,
  revoked    boolean     not null default false,
  created_at timestamptz not null default now()
);

create index refresh_tokens_token_idx on public.refresh_tokens(token);

-- ── Row-Level Security ───────────────────────────────────────────────────────
alter table public.profiles       enable row level security;
alter table public.run_sessions   enable row level security;
alter table public.territories    enable row level security;
alter table public.friendships    enable row level security;
alter table public.otp_codes      enable row level security;
alter table public.refresh_tokens enable row level security;

-- Backend uses service role key which bypasses RLS — policies below are for anon/frontend safety

create policy "Profiles readable by all"          on public.profiles for select using (true);
create policy "Territories readable by all"        on public.territories for select using (true);
create policy "Service role full access profiles"  on public.profiles for all using (true);
create policy "Service role full access sessions"  on public.run_sessions for all using (true);
create policy "Service role full access territory" on public.territories for all using (true);
create policy "Service role full access friends"   on public.friendships for all using (true);
create policy "Service role full access otp"       on public.otp_codes for all using (true);
create policy "Service role full access tokens"    on public.refresh_tokens for all using (true);

-- ── Seed: default Bengaluru territories ──────────────────────────────────────
insert into public.territories (name, coordinates, center_lat, center_lng) values
  ('MG Road',     '[{"latitude":12.9716,"longitude":77.6005},{"latitude":12.9725,"longitude":77.6015},{"latitude":12.9718,"longitude":77.6025},{"latitude":12.9708,"longitude":77.6015}]', 12.9716, 77.6014),
  ('Cubbon Park', '[{"latitude":12.9763,"longitude":77.5929},{"latitude":12.9785,"longitude":77.5942},{"latitude":12.9775,"longitude":77.5960},{"latitude":12.9755,"longitude":77.5947}]', 12.9770, 77.5945),
  ('Brigade Rd',  '[{"latitude":12.9707,"longitude":77.6064},{"latitude":12.9714,"longitude":77.6077},{"latitude":12.9705,"longitude":77.6087},{"latitude":12.9698,"longitude":77.6073}]', 12.9706, 77.6075),
  ('Indiranagar', '[{"latitude":12.9784,"longitude":77.6408},{"latitude":12.9796,"longitude":77.6422},{"latitude":12.9786,"longitude":77.6438},{"latitude":12.9774,"longitude":77.6423}]', 12.9790, 77.6422),
  ('Koramangala', '[{"latitude":12.9352,"longitude":77.6245},{"latitude":12.9365,"longitude":77.6258},{"latitude":12.9355,"longitude":77.6272},{"latitude":12.9342,"longitude":77.6259}]', 12.9354, 77.6258),
  ('UB City',     '[{"latitude":12.9718,"longitude":77.5958},{"latitude":12.9728,"longitude":77.5968},{"latitude":12.9720,"longitude":77.5980},{"latitude":12.9710,"longitude":77.5970}]', 12.9719, 77.5969);
