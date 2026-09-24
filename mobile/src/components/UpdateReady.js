import { View } from 'react-native'

import { applyNow, dismissReady, useUpdates } from '../lib/updates'
import { space } from '../lib/theme'
import Note from './Note'
import Press from './Press'

/**
 * A NEW VERSION IS READY, said under the bar the way the browser says it.
 *
 * "Is it possible to do that once the phone actually downloads an update so
 * that they could just click that to restart it?"
 *
 * Only once the download has finished — a banner offering something that is
 * not on the phone yet would restart into the same version. The ✕ puts it
 * away until the next launch, and the Updates row in Settings still offers
 * the same restart. See watchForUpdates in lib/updates.js for when it asks.
 */
export default function UpdateReady() {
  const updates = useUpdates()
  if (updates.phase !== 'ready' || updates.dismissed) return null
  return (
    <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.sm }}>
      <Note tone="warn" onDismiss={dismissReady}>
        A new version of the app is ready. Restart to use it — it takes a second.
      </Note>
      <Press label="Restart now" tone="signal" onPress={() => applyNow()} />
    </View>
  )
}
