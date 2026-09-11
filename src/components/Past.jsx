import { useState } from 'react'
import { formatWhen } from '../lib/history'

/**
 * Everything you have made, in one place, whichever store it landed in.
 *
 * "Create a dedicated button in the settings menu for history where you can
 * view previous chats and reload them as well as the history of previously
 * generated presets that can be reloaded and viewed. Combine the previously
 * generated presets into one menu, don't separate them from what's saved in
 * the browser compared to what's saved in the cloud."
 *
 * That last sentence is the whole design. The Presets sheet answers "where is
 * this kept" — three panels, one per store, because moving a library between
 * them is a real job somebody occasionally has to do. This answers "what have
 * I made", which is a different question and has no business knowing about
 * stores at all. The list arrives already merged and deduplicated by
 * history.newestFirst, the same list Earlier generations is drawn from.
 *
 * Where things are kept is said once, at the top, as a fact rather than a
 * choice: signed in it is the account, signed out it is this browser. Nothing
 * here offers to put a preset somewhere — that is the Presets sheet's job, and
 * two places offering the same move is how a library ends up in both.
 */
export default function Past({
  chats,
  presets,
  chatId,
  busy,
  signedIn,
  unit,
  onOpenChat,
  onDeleteChat,
  onRestore,
  onDelete
}) {
  // Which row is asking, across both lists. One at a time, cleared on blur, so
  // a half-pressed delete never sits armed on a screen nobody is looking at.
  const [confirm, setConfirm] = useState(null)

  /*
   * Which unit a tone was made on, when it was not this one.
   *
   * "Most of these presets were created on the FM3" — and nothing on this list
   * said so, which is the first half of the surprise when an eight-scene tone
   * lands on a four-scene unit. Everything still loads; the scenes are picked
   * on the way in (see lib/sceneFit.js). This is the line that stops that
   * question being asked of the app in the first place.
   *
   * Absent when it matches, because "FM3" against every row on an FM3 is a
   * column of the same word.
   */
  const madeOn = (entry) => {
    const made = String(entry?.device || '').trim()
    if (!made || !unit) return null
    return made.toLowerCase().includes(String(unit).toLowerCase()) ? null : made
  }

  const armed = (key, act) => ({
    onClick: () => {
      if (confirm === key) act()
      else setConfirm(key)
    },
    onBlur: () => setConfirm((k) => (k === key ? null : k)),
    children: confirm === key ? 'Sure?' : '×'
  })

  return (
    <div className="past">
      {/*
        Where all of this is kept, in one line, before either list.

        Signed out this is the only warning anybody gets that a library lives
        in one browser's storage — which survives a reload and does not survive
        a browser being reinstalled, cleared, or swapped for a different one.
      */}
      <p className="hint past-where">
        {signedIn
          ? 'Kept with your account — everything here is on any machine you sign in from.'
          : 'Saved in this browser. Sign in and everything here is kept with your account instead.'}
      </p>

      <section className="past-group">
        <h3 className="past-head">Chats</h3>
        {chats.length ? (
          <ul className="past-list">
            {chats.map((chat) => (
              <li key={chat.id} className={chat.id === chatId ? 'past-now' : undefined}>
                <button
                  className="past-row"
                  disabled={busy}
                  onClick={() => onOpenChat(chat)}
                  title={chat.title || undefined}
                >
                  <span className="past-name">
                    <span className="past-title">{chat.title || 'Untitled chat'}</span>
                  </span>
                  <span className="past-when mono">
                    {chat.id === chatId ? 'Open now' : formatWhen(chat.at)}
                  </span>
                </button>
                <button
                  className="past-del icon-btn"
                  disabled={busy}
                  aria-label={`Delete ${chat.title || 'this chat'}`}
                  {...armed(`chat:${chat.id}`, () => onDeleteChat(chat))}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">Nothing yet. Every conversation lands here when you start a new one.</p>
        )}
      </section>

      <section className="past-group">
        <h3 className="past-head">Presets you have made</h3>
        {presets.length ? (
          <ul className="past-list">
            {presets.map((entry) => (
              <li key={`${entry.where || 'local'}-${entry.id}`}>
                <button
                  className="past-row"
                  disabled={busy}
                  onClick={() => onRestore(entry)}
                  /* The request that made it. Two presets called "Lead" tell
                     you nothing apart; what was asked for does. */
                  title={entry.description || entry.summary || undefined}
                >
                  <span className="past-name">
                    <span className="past-title">{entry.name || 'Untitled'}</span>
                    {madeOn(entry) ? (
                      <span className="past-made">Made on {madeOn(entry)}</span>
                    ) : null}
                  </span>
                  <span className="past-when mono">{formatWhen(entry.at)}</span>
                </button>
                <button
                  className="past-del icon-btn"
                  disabled={busy}
                  aria-label={`Delete ${entry.name || 'Untitled'}`}
                  {...armed(`preset:${entry.where || 'local'}:${entry.id}`, () => onDelete(entry))}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">Nothing yet. Every tone you design is kept here, sent or not.</p>
        )}
      </section>
    </div>
  )
}
