-- events_redesign (the founder's redesign brief, 27 Nov 2026): measurement through the existing
-- first-party events table only. Four more names:
--   * cta_clicked and example_viewed, recorded with no user (the visitor is not signed in) and a
--     placement label from a fixed list;
--   * first_conversation_opened and first_conversation_saved, at most one of each per user.
-- Nothing else changes: the table stays deny-all for API roles and is written server-side.

alter table public.events drop constraint events_name_check;
alter table public.events add constraint events_name_check check (name in (
  'signed_up', 'product_confirmed', 'checkout_started', 'trial_started', 'feed_opened',
  'rivals_opened', 'build_opened', 'post_saved', 'post_replied', 'post_hidden',
  'digest_opened', 'subscription_canceled', 'account_deleted',
  'cta_clicked', 'example_viewed', 'first_conversation_opened', 'first_conversation_saved'));

-- A user's first conversation opened and first saved are recorded once: a second insert is a
-- unique violation, which the event store treats as already recorded.
create unique index events_first_once on public.events (user_id, name)
  where name in ('first_conversation_opened', 'first_conversation_saved');
