/**
 * Expo's defaults, with `.mjs` added.
 *
 * Nothing in this app reaches outside `mobile/` — see
 * scripts/sync-relay-rules.mjs for why the relay rules are copied in rather
 * than imported across the repo — so there is no monorepo configuration here
 * and an EAS build that uploads this directory alone still bundles.
 */
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
if (!config.resolver.sourceExts.includes('mjs')) config.resolver.sourceExts.push('mjs')

module.exports = config
