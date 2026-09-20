/**
 * Where the phone app lives, once it lives anywhere.
 *
 * "Maybe even QR codes that they can scan to go directly to the App Store or
 * the Google Play store to download it, which I know we don't have those yet."
 *
 * The ADDRESSES exist already and always did — an App Store URL is the
 * numeric id from App Store Connect, a Play URL is the package name, and both
 * were fixed the day those records were created. What does not exist yet is
 * anything behind them: both answer 404 until each app is actually published,
 * and a QR code leading to a 404 is worse than no QR code, because somebody
 * has to fetch their phone and aim it to find that out.
 *
 * So the address and the AVAILABILITY are two different facts and are stored
 * as two. `live` is the only thing that changes on the day each store opens,
 * and nothing else in the app needs touching — the page reads these, draws a
 * square for what is live and says "coming soon" for what is not.
 *
 * WHY THIS IS NOT DETECTED AT RUNTIME. A browser cannot ask apps.apple.com
 * whether a listing exists: the request is blocked before it is answered, and
 * the app would have to guess from a failure it cannot see. A flag somebody
 * sets on the day they press Publish is one honest line; a guess is a page
 * that changes its mind on a bad network.
 */

/** The App Store Connect record. Set live the day the app is on sale. */
export const APPLE = {
  id: '6812916461',
  url: 'https://apps.apple.com/app/id6812916461',
  live: false
}

/** The Play Console record, keyed by the package name the app is built with. */
export const GOOGLE = {
  id: 'cloud.newbold.fractalremote',
  url: 'https://play.google.com/store/apps/details?id=cloud.newbold.fractalremote',
  live: false
}

/**
 * The two, in the order they are offered.
 *
 * Apple first because that is the one this app was built for first, and
 * because a list that reorders itself by what happens to be live reads as a
 * bug to anybody who saw it the other way round yesterday.
 */
export const STORES = [
  { key: 'ios', name: 'iPhone', store: 'App Store', ...APPLE },
  { key: 'android', name: 'Android', store: 'Google Play', ...GOOGLE }
]

/** Whether there is anything at all to point anybody at yet. */
export const anyStoreLive = () => STORES.some((s) => s.live)
