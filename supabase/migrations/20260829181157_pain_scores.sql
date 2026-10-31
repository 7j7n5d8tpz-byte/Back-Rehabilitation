alter table public.sessions
  add column if not exists pain smallint,
  add constraint sessions_pain_range check (pain is null or (pain >= 0 and pain <= 10)) not valid;

alter table public.checkins
  add column if not exists pain smallint,
  add constraint checkins_pain_range check (pain is null or (pain >= 0 and pain <= 10)) not valid;

alter table public.sessions validate constraint sessions_pain_range;
alter table public.checkins validate constraint checkins_pain_range;

comment on column public.sessions.pain is
  'Worst back pain 0-10 (clinical NRS, the number Andreas gives his physio). traffic_light is derived from this plus leg_symptoms via program.json pain_scale. Null on rows logged before 29 Aug 2026, when only the traffic light existed.';
comment on column public.checkins.pain is
  'Morning back pain 0-10. Same derivation and same backfill caveat as sessions.pain.';;
