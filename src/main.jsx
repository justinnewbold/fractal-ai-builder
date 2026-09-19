import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import GetTheApp from './components/GetTheApp'
import Boundary from './components/Boundary'
import './styles.css'
import { apply, getMode } from './lib/theme'
import { isHostedOrigin, isStandalone } from './lib/platform'

// Before first paint, so a dark-preferring browser never flashes a light page.
apply(getMode())

/*
 * The last resort. A throw outside every panel boundary still unmounts the app,
 * and a white page tells nobody anything — least of all which build it was or
 * what it objected to.
 */
/*
 * THE HOSTED SITE IS A WAY TO GET THE APP, NOT THE APP.
 *
 * "We are getting rid of the web app accessibility ... it's going to require
 * an actual app download. We don't want it accessible from their browser
 * directly."
 *
 * Decided here, at the root, rather than inside App: everything below this
 * line assumes there is a rig to talk to, and the cheapest way to be certain
 * the app is not reachable is for it never to mount.
 *
 * WHAT IS NOT AFFECTED, and this is the whole reason the test is the hostname:
 *
 *   The desktop apps serve this same bundle from the machine holding the
 *   cable — that is what they ARE — and they serve it from localhost. They
 *   get the app.
 *
 *   A phone on the same wifi opens the computer's own address, which is also
 *   not the hosted one. It gets the app too.
 *
 *   The phone apps are React Native and never load this bundle at all.
 *
 *   Somebody who installed this to their home screen from the hosted site
 *   before today keeps working, because that is a downloaded app by any
 *   reasonable reading of the sentence and taking it away would be taking
 *   something away from a person who already has it.
 *
 * So the one case that changes is the one he named: a browser pointed at the
 * public address.
 */
const shopFront = isHostedOrigin() && !isStandalone()

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Boundary label="The app">{shopFront ? <GetTheApp /> : <App />}</Boundary>
  </React.StrictMode>
)
