-- Settings: single row, holds program start date and the app passcode hash
create table public.settings (
  id smallint primary key default 1 check (id = 1),
  program_start date not null default current_date,
  passcode_hash text,
  created_at timestamptz not null default now()
);
insert into public.settings (id) values (1);

-- Gym sessions
create table public.sessions (
  id bigint generated always as identity primary key,
  session_date date not null default current_date,
  logged_at timestamptz not null default now(),
  phase smallint not null default 1,
  week smallint,
  day_code text check (day_code in ('A','B','C')),
  traffic_light text not null check (traffic_light in ('green','amber','red')),
  leg_symptoms boolean not null default false,
  symptom_note text,
  lifts jsonb not null default '[]'::jsonb,
  notes text
);
create index sessions_date_idx on public.sessions (session_date desc);

-- Daily check-in (non-gym): morning traffic light, home routine, walking
create table public.checkins (
  id bigint generated always as identity primary key,
  checkin_date date not null unique default current_date,
  logged_at timestamptz not null default now(),
  traffic_light text check (traffic_light in ('green','amber','red')),
  home_routine boolean not null default false,
  walk_minutes smallint,
  notes text
);
create index checkins_date_idx on public.checkins (checkin_date desc);

-- Flare-ups
create table public.flares (
  id bigint generated always as identity primary key,
  started_on date not null default current_date,
  resolved_on date,
  severity smallint check (severity between 0 and 10),
  leg_symptoms boolean not null default true,
  symptom_note text,
  suspected_cause text,
  debrief text,
  logged_at timestamptz not null default now()
);

-- Four-weekly benchmark tests
create table public.benchmarks (
  id bigint generated always as identity primary key,
  test_date date not null default current_date,
  calf_raise_l smallint,
  calf_raise_r smallint,
  side_plank_l smallint,
  side_plank_r smallint,
  bird_dog_hold smallint,
  balance_l smallint,
  balance_r smallint,
  walk_tolerance_min smallint,
  sit_tolerance_min smallint,
  notes text,
  logged_at timestamptz not null default now()
);

-- Lock everything down. RLS on with NO policies means anon and authenticated
-- roles cannot read or write anything. The edge function uses the service role,
-- which bypasses RLS, and is gated behind a passcode.
alter table public.settings   enable row level security;
alter table public.sessions   enable row level security;
alter table public.checkins   enable row level security;
alter table public.flares     enable row level security;
alter table public.benchmarks enable row level security;;
