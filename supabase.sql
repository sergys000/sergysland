-- SERGYSLAND: отзывы + ЛИЧНАЯ поддержка + персонал
-- ВАЖНО: этот файл заменяет старую версию supabase.sql. Выполни его целиком в SQL Editor.
create extension if not exists pgcrypto;

do $$ begin create type public.staff_role as enum ('staff','admin'); exception when duplicate_object then null; end $$;
do $$ begin create type public.chat_author_type as enum ('visitor','staff'); exception when duplicate_object then null; end $$;

create table if not exists public.reviews (
 id uuid primary key default gen_random_uuid(), nickname text not null check(char_length(nickname) between 1 and 16), rating integer not null check(rating between 1 and 5), comment text default '' check(char_length(comment)<=300), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.support_threads (
 id uuid primary key default gen_random_uuid(), visitor_token text not null unique, visitor_name text not null check(char_length(visitor_name) between 1 and 32), status text not null default 'open' check(status in ('open','closed')), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.support_messages (
 id uuid primary key default gen_random_uuid(), thread_id uuid not null references public.support_threads(id) on delete cascade, author_type public.chat_author_type not null, author_name text not null check(char_length(author_name) between 1 and 32), message text not null check(char_length(message) between 1 and 1000), author_id uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create table if not exists public.staff_members (
 user_id uuid primary key references auth.users(id) on delete cascade, email text, role public.staff_role not null default 'staff', created_at timestamptz not null default now()
);

alter table public.support_threads add column if not exists visitor_token text;
create unique index if not exists support_threads_token_idx on public.support_threads(visitor_token);
create index if not exists support_messages_thread_idx on public.support_messages(thread_id,created_at);
create index if not exists support_threads_status_idx on public.support_threads(status,updated_at desc);
create unique index if not exists reviews_nickname_unique_idx on public.reviews(lower(nickname));

create or replace function public.is_staff() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.staff_members where user_id=auth.uid()); $$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.staff_members where user_id=auth.uid() and role='admin'); $$;

alter table public.reviews enable row level security;
alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;
alter table public.staff_members enable row level security;

drop policy if exists "reviews public read" on public.reviews;
create policy "reviews public read" on public.reviews for select to anon,authenticated using(true);
drop policy if exists "reviews public insert" on public.reviews;
create policy "reviews public insert" on public.reviews for insert to anon,authenticated with check(true);
drop policy if exists "reviews staff update" on public.reviews;
create policy "reviews staff update" on public.reviews for update to authenticated using(public.is_staff()) with check(public.is_staff());
drop policy if exists "reviews staff delete" on public.reviews;
create policy "reviews staff delete" on public.reviews for delete to authenticated using(public.is_staff());

drop policy if exists "threads staff read" on public.support_threads;
create policy "threads staff read" on public.support_threads for select to authenticated using(public.is_staff());
drop policy if exists "threads staff update" on public.support_threads;
create policy "threads staff update" on public.support_threads for update to authenticated using(public.is_staff()) with check(public.is_staff());
drop policy if exists "threads staff delete" on public.support_threads;
create policy "threads staff delete" on public.support_threads for delete to authenticated using(public.is_staff());
drop policy if exists "threads public insert" on public.support_threads;
create policy "threads public insert" on public.support_threads for insert to anon,authenticated with check(false);

drop policy if exists "messages staff read" on public.support_messages;
create policy "messages staff read" on public.support_messages for select to authenticated using(public.is_staff());
drop policy if exists "messages staff delete" on public.support_messages;
create policy "messages staff delete" on public.support_messages for delete to authenticated using(public.is_staff());
drop policy if exists "messages public insert" on public.support_messages;
create policy "messages public insert" on public.support_messages for insert to anon,authenticated with check(false);

drop policy if exists "staff read own" on public.staff_members;
create policy "staff read own" on public.staff_members for select to authenticated using(user_id=auth.uid() or public.is_admin());
drop policy if exists "staff admin insert" on public.staff_members;
create policy "staff admin insert" on public.staff_members for insert to authenticated with check(public.is_admin());
drop policy if exists "staff admin update" on public.staff_members;
create policy "staff admin update" on public.staff_members for update to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists "staff admin delete" on public.staff_members;
create policy "staff admin delete" on public.staff_members for delete to authenticated using(public.is_admin());

-- Создать обращение посетителя. Токен хранится только в браузере посетителя.
create or replace function public.support_create_thread(p_token text,p_name text) returns uuid language plpgsql security definer set search_path=public as $$
declare tid uuid; begin
 if p_token is null or char_length(p_token)<10 or p_name is null or char_length(trim(p_name))<2 then raise exception 'Некорректные данные'; end if;
 select id into tid from public.support_threads where visitor_token=p_token and status='open' limit 1;
 if tid is null then insert into public.support_threads(visitor_token,visitor_name) values(p_token,trim(p_name)) returning id into tid; end if;
 return tid; end $$;

create or replace function public.support_get_my_thread(p_token text) returns table(id uuid,visitor_name text,status text,created_at timestamptz,updated_at timestamptz) language sql security definer set search_path=public as $$
 select id,visitor_name,status,created_at,updated_at from public.support_threads where visitor_token=p_token and status='open' order by updated_at desc limit 1; $$;

create or replace function public.support_get_my_messages(p_token text,p_thread_id uuid) returns table(id uuid,thread_id uuid,author_type public.chat_author_type,author_name text,message text,created_at timestamptz) language sql security definer set search_path=public as $$
 select m.id,m.thread_id,m.author_type,m.author_name,m.message,m.created_at from public.support_messages m join public.support_threads t on t.id=m.thread_id where t.visitor_token=p_token and t.id=p_thread_id order by m.created_at asc; $$;

create or replace function public.support_add_visitor_message(p_token text,p_thread_id uuid,p_name text,p_message text) returns uuid language plpgsql security definer set search_path=public as $$
declare mid uuid; begin
 if not exists(select 1 from public.support_threads where id=p_thread_id and visitor_token=p_token and status='open') then raise exception 'Обращение не найдено или уже завершено'; end if;
 insert into public.support_messages(thread_id,author_type,author_name,message) values(p_thread_id,'visitor',trim(p_name),trim(p_message)) returning id into mid;
 update public.support_threads set updated_at=now(),visitor_name=trim(p_name) where id=p_thread_id;
 return mid; end $$;

-- Только персонал может удалить сообщение/обращение через обычные table API-запросы.
create or replace function public.find_user_by_email(target_email text) returns uuid language plpgsql security definer set search_path=public,auth as $$ declare found_id uuid; begin if not public.is_admin() then return null; end if; select id into found_id from auth.users where lower(email)=lower(target_email) limit 1; return found_id; end $$;
revoke all on function public.find_user_by_email(text) from public; grant execute on function public.find_user_by_email(text) to authenticated;
revoke all on function public.support_create_thread(text,text) from public; grant execute on function public.support_create_thread(text,text) to anon,authenticated;
revoke all on function public.support_get_my_thread(text) from public; grant execute on function public.support_get_my_thread(text) to anon,authenticated;
revoke all on function public.support_get_my_messages(text,uuid) from public; grant execute on function public.support_get_my_messages(text,uuid) to anon,authenticated;
revoke all on function public.support_add_visitor_message(text,uuid,text,text) from public; grant execute on function public.support_add_visitor_message(text,uuid,text,text) to anon,authenticated;

alter table public.reviews replica identity full;
alter table public.support_threads replica identity full;
alter table public.support_messages replica identity full;
do $$ begin alter publication supabase_realtime add table public.support_threads; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.support_messages; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.reviews; exception when duplicate_object then null; end $$;

-- Если у тебя остались старые строки support_threads без visitor_token, они не будут показаны посетителям. Их можно удалить вручную после проверки:
-- delete from public.support_threads where visitor_token is null;
