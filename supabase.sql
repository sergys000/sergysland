-- SERGYSLAND: база чата, отзывов и сотрудников
-- Выполни весь файл в Supabase -> SQL Editor -> Run.

create extension if not exists pgcrypto;

do $$ begin
  create type public.staff_role as enum ('staff','admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.chat_author_type as enum ('visitor','staff');
exception when duplicate_object then null; end $$;

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  nickname text not null check (char_length(nickname) between 1 and 16),
  rating integer not null check (rating between 1 and 5),
  comment text default '' check (char_length(comment) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ip_hash text
);

create table if not exists public.support_threads (
  id uuid primary key default gen_random_uuid(),
  visitor_name text not null check (char_length(visitor_name) between 1 and 32),
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  author_type public.chat_author_type not null,
  author_name text not null check (char_length(author_name) between 1 and 32),
  message text not null check (char_length(message) between 1 and 1000),
  author_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role public.staff_role not null default 'staff',
  created_at timestamptz not null default now()
);

create index if not exists support_messages_thread_idx on public.support_messages(thread_id, created_at);
create index if not exists reviews_created_idx on public.reviews(created_at desc);

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.staff_members where user_id = auth.uid()); $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.staff_members where user_id = auth.uid() and role = 'admin'); $$;

alter table public.reviews enable row level security;
alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;
alter table public.staff_members enable row level security;

drop policy if exists "reviews public read" on public.reviews;
create policy "reviews public read" on public.reviews for select to anon, authenticated using (true);

drop policy if exists "reviews public insert" on public.reviews;
create policy "reviews public insert" on public.reviews for insert to anon, authenticated with check (true);

drop policy if exists "reviews staff update" on public.reviews;
create policy "reviews staff update" on public.reviews for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "reviews staff delete" on public.reviews;
create policy "reviews staff delete" on public.reviews for delete to authenticated using (public.is_staff());

drop policy if exists "threads public insert" on public.support_threads;
create policy "threads public insert" on public.support_threads for insert to anon, authenticated with check (true);

drop policy if exists "threads staff read" on public.support_threads;
create policy "threads staff read" on public.support_threads for select to authenticated using (public.is_staff());

drop policy if exists "threads staff update" on public.support_threads;
create policy "threads staff update" on public.support_threads for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "messages public insert" on public.support_messages;
create policy "messages public insert" on public.support_messages for insert to anon, authenticated with check (author_type = 'visitor' or (author_type = 'staff' and public.is_staff()));

drop policy if exists "messages staff read" on public.support_messages;
create policy "messages staff read" on public.support_messages for select to authenticated using (public.is_staff());

drop policy if exists "staff read own" on public.staff_members;
create policy "staff read own" on public.staff_members for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "staff admin insert" on public.staff_members;
create policy "staff admin insert" on public.staff_members for insert to authenticated with check (public.is_admin());

drop policy if exists "staff admin update" on public.staff_members;
create policy "staff admin update" on public.staff_members for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "staff admin delete" on public.staff_members;
create policy "staff admin delete" on public.staff_members for delete to authenticated using (public.is_admin());

-- После создания твоего аккаунта в Auth выполни ОДИН раз:
-- insert into public.staff_members(user_id,email,role)
-- select id,email,'admin' from auth.users where email='ТВОЙ_EMAIL';

-- Realtime для чата/отзывов
alter table public.reviews replica identity full;
alter table public.support_messages replica identity full;
alter table public.support_threads replica identity full;

-- Добавление таблиц в realtime publication, если их там ещё нет.
do $$ begin
  alter publication supabase_realtime add table public.reviews;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.support_messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.support_threads;
exception when duplicate_object then null; end $$;

-- Для текущей версии сайта чат является общей публичной лентой поддержки:
-- посетители видят вопросы и ответы персонала. Не размещайте в нём личные данные.
drop policy if exists "threads public read" on public.support_threads;
create policy "threads public read" on public.support_threads for select to anon, authenticated using (true);
drop policy if exists "messages public read" on public.support_messages;
create policy "messages public read" on public.support_messages for select to anon, authenticated using (true);

-- Позволяет администратору найти уже зарегистрированного сотрудника по email.
create or replace function public.find_user_by_email(target_email text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare found_id uuid;
begin
  if not public.is_admin() then return null; end if;
  select id into found_id from auth.users where lower(email)=lower(target_email) limit 1;
  return found_id;
end;
$$;
revoke all on function public.find_user_by_email(text) from public;
grant execute on function public.find_user_by_email(text) to authenticated;

create unique index if not exists reviews_nickname_unique_idx on public.reviews (lower(nickname));
