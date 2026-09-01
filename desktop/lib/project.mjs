/**
 * The account service both ends sign into.
 *
 * One project, named once, imported by everything that needs it: the web app
 * (so a phone can sign in), and the two launchers (so ForgeFX on the Mac is
 * started already pointed at it, with no `.env` for anyone to edit). It lives
 * under desktop/lib because that is the one directory the packaged Mac app
 * carries with it; the web app reaches in here rather than the other way
 * round.
 *
 * The key is the publishable one and is meant to sit in plain sight. Safety
 * comes from the policy on the project, not from the key being secret: a
 * signed-in user can read and write only the channel `remote:<their own uid>`,
 * so a stranger who takes this key and signs up gets a channel of their own
 * with no Mac on it. They cannot see anyone else's, and knowing the key does
 * not change that. Never put a service-role key here.
 *
 * Zero imports on purpose — this file is read by Node in the launchers and by
 * the browser bundle, and must stay trivially importable by both.
 */
export const DEFAULT_PROJECT = {
  url: 'https://biznwrqeckviawjuhvyg.supabase.co',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpem53cnFlY2t2aWF3anVodnlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MjIyNDksImV4cCI6MjEwMzQ5ODI0OX0.WT2K6kxqy5cMc1tL-Lr3JgTwwhFYY2t-NJsOXNJXgVU'
}
