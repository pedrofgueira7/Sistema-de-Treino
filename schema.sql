-- Sistema de Treino — schema do Supabase
-- Rode isto uma vez no SQL Editor do seu projeto Supabase (Project > SQL Editor > New query).

create table if not exists treinos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data date not null,
  tipo text not null check (tipo in ('Leve', 'Intervalado', 'Moderado', 'Longa', 'Prova')),
  distancia numeric not null check (distancia > 0),
  tempo_segundos integer not null check (tempo_segundos > 0),
  notas text,
  criado_em timestamptz not null default now()
);

create table if not exists referencia (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  distancia_km numeric not null check (distancia_km > 0),
  tempo_segundos integer not null check (tempo_segundos > 0),
  atualizado_em timestamptz not null default now()
);

create table if not exists plano_progresso (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  semana_inicio date not null,
  dia integer not null check (dia between 1 and 5),
  concluido boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (user_id, semana_inicio, dia)
);

-- plano de treino editável (título e exercícios de cada um dos 5 dias), como JSON
create table if not exists plano (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  dados jsonb not null,
  atualizado_em timestamptz not null default now()
);

alter table treinos enable row level security;
alter table referencia enable row level security;
alter table plano_progresso enable row level security;
alter table plano enable row level security;

create policy "treinos: dono le" on treinos for select using (auth.uid() = user_id);
create policy "treinos: dono insere" on treinos for insert with check (auth.uid() = user_id);
create policy "treinos: dono atualiza" on treinos for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "treinos: dono remove" on treinos for delete using (auth.uid() = user_id);

create policy "referencia: dono le" on referencia for select using (auth.uid() = user_id);
create policy "referencia: dono insere" on referencia for insert with check (auth.uid() = user_id);
create policy "referencia: dono atualiza" on referencia for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "plano_progresso: dono le" on plano_progresso for select using (auth.uid() = user_id);
create policy "plano_progresso: dono insere" on plano_progresso for insert with check (auth.uid() = user_id);
create policy "plano_progresso: dono atualiza" on plano_progresso for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "plano_progresso: dono remove" on plano_progresso for delete using (auth.uid() = user_id);

create policy "plano: dono le" on plano for select using (auth.uid() = user_id);
create policy "plano: dono insere" on plano for insert with check (auth.uid() = user_id);
create policy "plano: dono atualiza" on plano for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists treinos_user_data_idx on treinos (user_id, data desc);
create index if not exists plano_progresso_user_semana_idx on plano_progresso (user_id, semana_inicio);
