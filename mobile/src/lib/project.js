/**
 * The account service both ends sign into.
 *
 * The same project the Mac launcher points ForgeFX at and the same one the web
 * app uses — copied rather than imported for the reason set out in
 * scripts/sync-relay-rules.mjs, and checked by the test suite against
 * desktop/lib/project.mjs so the phone cannot end up signing into somewhere the
 * Mac isn't.
 *
 * The key is the publishable one and is meant to sit in plain sight. Safety
 * comes from the policy on the project, not from the key being secret: a
 * signed-in user can read and write only the channel `remote:<their own uid>`,
 * so a stranger who takes this key and signs up gets a channel of their own
 * with no Mac on it. Never put a service-role key here.
 */
export const DEFAULT_PROJECT = {
  url: 'https://biznwrqeckviawjuhvyg.supabase.co',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpem53cnFlY2t2aWF3anVodnlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MjIyNDksImV4cCI6MjEwMzQ5ODI0OX0.WT2K6kxqy5cMc1tL-Lr3JgTwwhFYY2t-NJsOXNJXgVU'
}
