/**
 * What counts as a change to the native app, for deciding whether a build can
 * take an update.
 *
 * The runtime version is a fingerprint (see app.json): a hash of everything
 * that ends up in the binary, so it moves when the native side really changes
 * and an update is only offered to a build that can run it. That is the right
 * policy for this app — the alternative, appVersion, would tie the runtime to
 * `expo.version`.
 *
 * WHICH IS EXACTLY WHAT THE DEFAULT FINGERPRINT DOES ANYWAY, and it took
 * measuring to find out. `expo.version` is part of the app config, the app
 * config is hashed whole, so changing the version number and nothing else
 * moves the fingerprint:
 *
 *   7.325.0 → 54612e0a85ee9a08a80322c34dbb96e460377165
 *   7.326.0 → 375fcaa1bc4c11c1911a6fe8106a99434b0e250c
 *
 * Every change in this repository carries a new version number — the `version`
 * job in .github/workflows/web.yml fails a pull request without one. So with
 * the default every single change would have been a new runtime that no phone
 * already out there could take an update for, and EAS Update would have been
 * set up, believed in, and never once used. Choosing the fingerprint policy
 * over appVersion bought nothing by itself.
 *
 * ExpoConfigVersions leaves the three numbers that are only ever stamped on a
 * build out of the hash: `version`, `android.versionCode` and
 * `ios.buildNumber`. Nothing else about the config is skipped, so a plugin, a
 * permission, an icon or a new native package still moves the fingerprint and
 * still asks for a build — which is the whole point of it.
 *
 * The number a person reads in About and the one the stores sort by is
 * untouched. This says only that it is not what decides whether the binary
 * changed, because it is not.
 */
const { SourceSkips } = require('@expo/fingerprint')

module.exports = {
  sourceSkips: SourceSkips.ExpoConfigVersions
}
