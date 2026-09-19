-- EchoRooms backend verification (self-contained, rolls back).
--
-- Paste this into the Supabase SQL editor and Run. It creates two throwaway
-- users, impersonates them, and proves that:
--   1. create_room works;
--   2. room/membership reads do NOT trigger RLS recursion;
--   3. a member can send a message;
--   4. a non-member sees nothing and cannot message the room.
--
-- Everything runs in one transaction and is rolled back, so no data or users
-- are left behind. A failure raises an exception with a FAIL message; success
-- ends with "ALL CHECKS PASSED".

begin;

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'verify-a@example.test', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'verify-b@example.test', now(), now(), now());

update public.profiles set display_name = 'Verify A' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set display_name = 'Verify B' where id = '00000000-0000-0000-0000-0000000000a2';

-- Act as user A.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);

do $$
declare
  rid uuid;
begin
  select id into rid from public.create_room('Verify room');
  perform set_config('echorooms.rid', rid::text, true);
  raise notice 'PASS: create_room -> %', rid;
end $$;

do $$
declare
  rid uuid := current_setting('echorooms.rid')::uuid;
  n int;
begin
  select count(*) into n from public.rooms;
  if n <> 1 then raise exception 'FAIL: A sees % rooms, expected 1', n; end if;
  raise notice 'PASS: A reads rooms without RLS recursion';

  select count(*) into n from public.room_members;
  if n <> 1 then raise exception 'FAIL: A sees % memberships, expected 1', n; end if;
  raise notice 'PASS: A reads room membership without RLS recursion';

  insert into public.messages (room_id, sender_id, body)
  values (rid, '00000000-0000-0000-0000-0000000000a1', 'hello from A');
  raise notice 'PASS: A sent a message';
end $$;

-- Switch to user B (not a member of the room).
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);

do $$
declare
  rid uuid := current_setting('echorooms.rid')::uuid;
  n int;
begin
  select count(*) into n from public.rooms;
  if n <> 0 then raise exception 'FAIL: B sees % rooms, expected 0', n; end if;
  raise notice 'PASS: B cannot see the room';

  select count(*) into n from public.messages;
  if n <> 0 then raise exception 'FAIL: B sees % messages, expected 0', n; end if;
  raise notice 'PASS: B cannot see the messages';

  begin
    insert into public.messages (room_id, sender_id, body)
    values (rid, '00000000-0000-0000-0000-0000000000a2', 'nope');
    raise exception 'FAIL: B inserted a message into a non-member room';
  exception
    when insufficient_privilege then
      raise notice 'PASS: B is blocked from messaging the room';
  end;
end $$;

rollback;

select 'ALL CHECKS PASSED' as result;
