alter table public.sessions
  add column if not exists flare_stage smallint;

comment on column public.sessions.flare_stage is
  'Flare return-ladder stage this session was trained at (0-4), or null when the session ran the normal programme. Explains why the loads on this row are lower than the trend.';;
