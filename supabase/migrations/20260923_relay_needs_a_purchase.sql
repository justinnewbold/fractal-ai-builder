-- THE SWITCH: the relay carries traffic only for an account that has paid.
--
-- NOT APPLIED WITH THE REST. This is the one migration in the set that can
-- lock a paying customer out of their own rig, so it is applied on its own,
-- after 20260923_entitlements.sql has been running long enough to be full, and
-- only with Justin's say-so. Everything it depends on is already live:
--
--   public.entitlements       who has paid
--   public.is_entitled(uuid)  the question these policies ask
--   revenuecat-webhook        writes a row the moment RevenueCat hears of a sale
--   entitlement               writes a row whenever a paying customer's app asks
--
-- WHAT IT CHANGES. The relay's two existing rules — read your own channel,
-- write your own channel — each gain one condition. Nothing else about who can
-- reach which channel moves. The phone, the browser and the computer's device
-- server all already join remote:<account id> as a private channel, so all
-- three are governed by these two rules and none needs a new build.
--
-- WHAT IT DOES NOT COVER, and cannot: the computer app driving the unit
-- directly down its own USB cable. That traffic never touches the relay, and
-- the device server underneath it is open source — anybody can run ForgeFX for
-- nothing. What the relay protects is the thing that is actually sold: control
-- from a phone, or from a browser, reaching a rig somewhere else.
--
-- TO UNDO, run the two statements at the bottom, which put back exactly the
-- policies this replaces.

drop policy if exists "own remote channel: read" on realtime.messages;
create policy "own remote channel: read"
  on realtime.messages for select to authenticated
  using (
    realtime.topic() = ('remote:'::text || (auth.uid())::text)
    and public.is_entitled(auth.uid())
  );

drop policy if exists "own remote channel: write" on realtime.messages;
create policy "own remote channel: write"
  on realtime.messages for insert to authenticated
  with check (
    realtime.topic() = ('remote:'::text || (auth.uid())::text)
    and public.is_entitled(auth.uid())
  );

-- UNDO (do not run as part of this migration):
--
-- drop policy if exists "own remote channel: read" on realtime.messages;
-- create policy "own remote channel: read" on realtime.messages for select
--   to authenticated using (realtime.topic() = ('remote:'::text || (auth.uid())::text));
-- drop policy if exists "own remote channel: write" on realtime.messages;
-- create policy "own remote channel: write" on realtime.messages for insert
--   to authenticated with check (realtime.topic() = ('remote:'::text || (auth.uid())::text));
