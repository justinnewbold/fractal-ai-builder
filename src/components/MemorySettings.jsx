import { useEffect, useState } from 'react'

/**
 * The two fields the agent knows you by, where you can read and write them.
 *
 * "Add a simple settings screen where I can view and edit both fields
 * directly so the agent works on day one." Two boxes and a Save: what the
 * agent has been told about you, and how you want it to talk to you. The
 * profile also fills itself in from conversations (src/lib/memory.js); the
 * preferences are yours alone.
 */
export default function MemorySettings({ memory, onSave, busy = false }) {
  const [profile, setProfile] = useState(memory?.profile || '')
  const [preferences, setPreferences] = useState(memory?.preferences || '')
  const [savedAt, setSavedAt] = useState(0)

  // A profile the agent updated behind this screen shows up in the box —
  // unless the box is mid-edit, in which case the edit is what stands.
  useEffect(() => {
    setProfile((was) => (was === memory?.profile ? was : memory?.profile || ''))
    setPreferences((was) => (was === memory?.preferences ? was : memory?.preferences || ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memory?.updatedAt])

  const dirty = profile !== (memory?.profile || '') || preferences !== (memory?.preferences || '')
  const justSaved = savedAt && Date.now() - savedAt < 4000

  const save = async () => {
    await onSave?.({ profile, preferences })
    setSavedAt(Date.now())
  }

  return (
    <div className="memory-settings">
      <label className="memory-field">
        <span className="silk-label">What it knows about you</span>
        <span className="hint">
          Your name, what you play, who you play with, what you are working on. The agent adds to
          this from your chats; anything here is yours to change or remove.
        </span>
        <textarea
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          rows={5}
          placeholder={'- [stated] My name is …\n- [stated] I play in …'}
          aria-label="What the agent knows about you"
        />
      </label>
      <label className="memory-field">
        <span className="silk-label">How to talk to you</span>
        <span className="hint">
          Tone, length, format. "Keep it short." "No bullet points." "Plain words, no jargon."
          Applied to every reply, whatever the subject.
        </span>
        <textarea
          value={preferences}
          onChange={(e) => setPreferences(e.target.value)}
          rows={3}
          placeholder="Short answers. Plain words."
          aria-label="How you want the agent to talk to you"
        />
      </label>
      <div className="history-actions">
        <button className="save-now" onClick={save} disabled={busy || !dirty}>
          {justSaved && !dirty ? '✓ Saved' : 'Save'}
        </button>
      </div>
    </div>
  )
}
