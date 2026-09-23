/**
 * The functions that run on a server, and the three ways this one can be
 * badly wrong without looking it.
 *
 * Nothing in supabase/functions was tested before this. They had got away with
 * it: both of the others send email, and email that does not arrive gets
 * reported by the person waiting for it. `entitlement` is different. It decides
 * whether somebody who paid gets to drive their rig from a computer, and every
 * way it can fail is silent — a wrong answer looks exactly like a right one to
 * everybody except the person locked out of a thing they bought.
 *
 * Read as text rather than imported: it is Deno TypeScript, which node will not
 * load, and standing up a Deno runtime to check three properties would be a
 * heavier answer than the question deserves. The properties are the point.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

/* Comments quote the traps by name, so every check below reads the code with
   the prose taken out. This repository has failed on its own explanation
   seven times; that is enough times to make it the default here. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

export function run(test) {
  test('who is asking is never the caller’s word', () => {
    /*
     * THE ONE THAT WOULD GIVE THE APP AWAY.
     *
     * The account id is what RevenueCat is asked about. If it came out of the
     * request body, anybody could type somebody else's id and be told yes —
     * and the ids are UUIDs that appear in ordinary traffic, not secrets. The
     * whole reason this check is on a server rather than in the page is that
     * the answer must not be the client's to choose.
     *
     * So the id comes out of a token, and the token is verified by Supabase
     * rather than decoded here. A JWT's middle segment is base64, not a
     * signature: reading `sub` out of it is reading the attacker's own claim
     * about who they are.
     */
    const src = code(read('supabase/functions/entitlement/index.ts'))
    assert.match(src, /auth\/v1\/user/, 'the token is not checked with Supabase')
    assert.match(src, /accountFrom\(token\)/, 'the account id does not come from the token')
    assert.ok(
      !/req\.json\(\)/.test(src),
      'the function reads the request body; the account id must never come from there'
    )
    assert.ok(
      !/atob|JSON\.parse\(.*split\('\.'\)|decodeJwt/.test(src),
      'the token is being decoded rather than verified, so a forged one would pass'
    )
  })

  test('an entitlement is recognised under either of its two names', () => {
    /*
     * THE ONE THAT WOULD LOCK OUT EVERYBODY WHO PAID.
     *
     * A RevenueCat entitlement has an `id` (entl…) and a `lookup_key` (`full`),
     * and the active-entitlements list reports one field called
     * `entitlement_id`. Which of the two names lands in it cannot be settled by
     * asking about a customer who has bought nothing — the list comes back
     * empty either way, and an empty list says nothing about the shape of a
     * full one.
     *
     * Match the wrong one and the gate tells a paying customer they have not
     * paid, for ever, with nothing on fire and nothing in a log. So both names
     * are accepted, and the id is read from the project rather than typed in.
     */
    const src = code(read('supabase/functions/entitlement/index.ts'))
    assert.match(src, /const ENTITLEMENT = 'full'/, 'the entitlement is not named')
    assert.match(src, /lookup_key === ENTITLEMENT/, 'the id is not resolved from the lookup key')
    assert.match(src, /names\.add\(String\(e\.id\)\)/, 'the entitlement’s own id is not accepted')
    assert.match(src, /names\.has\(String\(e\.entitlement_id\)\)/, 'the answer is not matched against both names')
    assert.ok(
      !/entitlement_id === ENTITLEMENT/.test(src),
      'only the lookup key is matched, so an id-shaped answer reads as unpaid'
    )
    /* And the id is never hardcoded: it is this project's today and would be
       a different string in any project rebuilt from scratch. */
    assert.ok(!/'entl[0-9a-f]+'/.test(src), 'an entitlement id is typed into the source')
  })

  test('a question that could not be asked is not a no', () => {
    /*
     * THE ONE THAT WOULD LOCK OUT EVERYBODY, FULL STOP.
     *
     * RevenueCat having a bad minute, a key rotated, a network that went away:
     * none of it is evidence that somebody did not pay. Treating it as a no
     * turns a third party's outage into every customer losing their rig.
     *
     * The phone follows this rule already — mobile/src/lib/unlock-rule fails
     * open for the same reason — and the two ends disagreeing about it would
     * be worse than either answer.
     */
    const src = code(read('supabase/functions/entitlement/index.ts'))
    assert.match(src, /Promise<boolean \| null>/, 'the check cannot say that it does not know')
    assert.match(src, /if \(answer === null\) return json\(\{ unlocked: true, unknown: true \}\)/, 'an unanswerable question locks the app')
    /* A customer RevenueCat has never heard of is a real no, not an outage:
       that is almost everybody, and it must not read as unknown. */
    assert.match(src, /if \(res\.status === 404\) return false/, 'a customer who never bought anything reads as an outage')
  })

  test('the entitlement the server checks is the one the phone checks', () => {
    /*
     * Two ends, one word. The phone reads `full` out of its own constant and
     * this reads `full` out of its own, and if the two ever part company the
     * computer would say unpaid about a purchase the phone had just made.
     */
    const server = code(read('supabase/functions/entitlement/index.ts'))
    const phone = code(read('mobile/src/lib/purchases.js'))
    const of = (src, name) => (src.match(new RegExp(`${name} = '([^']+)'`)) || [])[1]
    assert.equal(
      of(server, 'ENTITLEMENT'),
      of(phone, 'ENTITLEMENT'),
      'the server and the phone are asking about different entitlements'
    )
  })
}
