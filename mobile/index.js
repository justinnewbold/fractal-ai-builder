/**
 * The entry point, and the two polyfills that have to run before anything else.
 *
 * `react-native-url-polyfill` gives Hermes a WHATWG URL, which supabase-js uses
 * to build every request and every websocket address. Without it the client
 * throws on construction, before a single line of this app's own code runs —
 * so it is imported here rather than beside the client it is for.
 */
import 'react-native-url-polyfill/auto'
import { registerRootComponent } from 'expo'

import App from './App'

registerRootComponent(App)
