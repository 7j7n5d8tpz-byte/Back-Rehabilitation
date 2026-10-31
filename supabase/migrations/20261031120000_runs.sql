-- Marathon runs. One row per run, logged by hand in the app or imported from Apple Health
-- (Health Auto Export -> health-ingest function). Additive only; rollback is
-- `drop table public.runs`.
create table public.runs (
  id bigint generated always as identity primary key,
  run_date date not null,
  started_at timestamptz,
  -- Which of the week's planned runs this was. Null = not chosen yet; the app assigns it
  -- from the duration and shows it as a suggestion until saved.
  slot text check (slot in ('E','Q','L','RACE','extra')),
  duration_min numeric(6,1) not null check (duration_min > 0 and duration_min < 600),
  distance_km numeric(5,2) check (distance_km >= 0 and distance_km < 100),
  avg_hr smallint check (avg_hr between 30 and 250),
  max_hr smallint check (max_hr between 30 and 250),
  cadence_spm smallint check (cadence_spm between 60 and 260),
  elevation_m smallint check (elevation_m between 0 and 5000),
  rpe smallint check (rpe between 1 and 10),
  -- Back response, same scale and meaning as sessions.pain / leg_symptoms. Null on an
  -- imported run until it is confirmed in the app; that null IS the "unconfirmed" state.
  pain smallint check (pain between 0 and 10),
  leg_symptoms boolean not null default false,
  notes text,
  source text not null default 'manual' check (source in ('manual','healthkit')),
  external_id text,
  raw jsonb,
  created_at timestamptz not null default now(),
  -- Re-sending the same workout from Health Auto Export updates it instead of duplicating.
  -- Manual runs have a null external_id, which a unique constraint allows any number of.
  constraint runs_source_external_key unique (source, external_id)
);
create index runs_date_idx on public.runs (run_date desc);

-- Sealed like every other table here: RLS on, no policies. Only the service-role edge
-- functions can read or write.
alter table public.runs enable row level security;
