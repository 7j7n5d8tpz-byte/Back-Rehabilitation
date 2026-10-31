alter table public.flares
  add column if not exists stage_override smallint,
  add column if not exists override_on date;

comment on column public.flares.stage_override is
  'Manual return-stage override (0-4). Applied only when override_on is later than the most recent setback; otherwise the computed stage wins.';
comment on column public.flares.override_on is
  'Date the manual stage override was set.';

create index if not exists flares_open_idx on public.flares (resolved_on, started_on desc);;
