import { useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native'

import { color, font, radius, space, TAP } from '../lib/theme'
import { useRig } from '../lib/rig'
import * as device from '../lib/device'
import { buildTone, revert } from '../lib/tone'
import Note from '../components/Note'
import Press from '../components/Press'

const ofPreset = (s) => s.preset
const ofCaps = (s) => s.capabilities
const ofSceneNames = (s) => s.sceneNames

/**
 * Asking for a sound in words, from the phone.
 *
 * The bench screen this app spent its whole life not having. The reason it
 * exists now is not that the objection was wrong — a generate button within
 * reach of a stage tap IS a hazard — but that the cost of hitting it turns out
 * to be small: a phone cannot save to a slot, so every tone lands in the edit
 * buffer and Revert loads the stored version back over it. Nothing here can
 * lose a preset.
 *
 * It is a screen of its own rather than a panel on Stage for the same reason
 * Settings is: it is reached deliberately, and while you are on it you are not
 * looking at the thing you play.
 *
 * WHAT IT DOES NOT DO, deliberately. It does not hold a conversation — there is
 * no refining "warmer" against the last answer, no history, no saved tones.
 * Those are the browser's, where there is a keyboard and a screen to read them
 * on. This asks once and reports once, which is the shape that fits a phone.
 */
export default function Tone({ onBack }) {
  const preset = useRig(ofPreset)
  const caps = useRig(ofCaps)
  const sceneNames = useRig(ofSceneNames)

  const [words, setWords] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [reverted, setReverted] = useState(false)

  /* A handle on the request while it runs, so Stop actually stops it. Without
     one the only way out of a stuck run is force-quitting the app. */
  const running = useRef(null)

  const ask = async () => {
    const description = words.trim()
    if (!description || busy) return

    setBusy(true)
    setError(null)
    setResult(null)
    setReverted(false)
    const control = new AbortController()
    running.current = control

    try {
      const built = await buildTone({
        unit: device,
        description,
        device: { capabilities: caps },
        sceneNames,
        presetNumber: preset?.number ?? null,
        signal: control.signal,
        onStage: setStage
      })
      setResult(built)
    } catch (err) {
      setError(
        err?.name === 'AbortError'
          ? 'Stopped. Nothing more was written to the unit.'
          : err?.message || 'The tone could not be built.'
      )
    } finally {
      running.current = null
      setStage(null)
      setBusy(false)
    }
  }

  const putItBack = async () => {
    if (typeof result?.presetNumber !== 'number') return
    setBusy(true)
    try {
      await revert(device, result.presetNumber)
      setReverted(true)
    } catch (err) {
      setError(err?.message || 'Could not reload the preset.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text accessibilityRole="header" style={{ color: color.silk, fontSize: font.title, fontWeight: '700' }}>
          Ask for a tone
        </Text>
        <Press label="Back" onPress={onBack} disabled={busy} />
      </View>

      {preset ? (
        <Text style={{ color: color.silkDim, fontSize: font.small }}>
          {`It will change ${preset.name?.trim() || `preset ${preset.number}`}, which you can undo.`}
        </Text>
      ) : null}

      <TextInput
        value={words}
        onChangeText={setWords}
        editable={!busy}
        multiline
        placeholder="A thick rhythm sound with a tight low end"
        placeholderTextColor={color.silkFaint}
        style={{
          minHeight: TAP * 2,
          color: color.silk,
          fontSize: font.body,
          backgroundColor: color.panel,
          borderWidth: 1,
          borderColor: color.rule,
          borderRadius: radius.md,
          padding: space.md,
          textAlignVertical: 'top'
        }}
      />

      {busy ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <ActivityIndicator color={color.live} />
          <Text style={{ color: color.silkDim, fontSize: font.small, flex: 1 }}>
            {stage?.text || 'Working…'}
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: space.md }}>
        <Press
          label={busy ? 'Building…' : 'Build it'}
          tone="signal"
          grow
          disabled={busy || !words.trim()}
          onPress={ask}
        />
        {busy ? <Press label="Stop" onPress={() => running.current?.abort()} /> : null}
      </View>

      {error ? <Note tone="fault">{error}</Note> : null}

      {result ? (
        <View style={{ gap: space.md }}>
          {result.summary ? <Note tone="hint">{result.summary}</Note> : null}

          <Text style={{ color: color.silk, fontSize: font.body }}>
            {`${result.changes.length} block${result.changes.length === 1 ? '' : 's'} changed` +
              (result.scenes?.length ? `, ${result.scenes.length} scenes written` : '')}
          </Text>

          {/*
            What did not land, said plainly. A run that half worked is the
            common case over a relay, and a screen that only says "done" leaves
            somebody hunting for which knob is wrong.
          */}
          {result.failures.length ? (
            <Note tone="warn">
              {`${result.failures.length} did not land:\n${result.failures.join('\n')}`}
            </Note>
          ) : null}

          {/* Refusals and corrections are different things and are not stacked
              together: a change kept after matching the control the model NAMED
              is a save, not a loss. */}
          {result.problems.length ? (
            <Note tone="warn">{`Skipped:\n${result.problems.join('\n')}`}</Note>
          ) : null}

          {reverted ? (
            <Note tone="hint">Put back. The unit is on the saved version again.</Note>
          ) : (
            <Press
              label="Put it back"
              sub="Loads the saved version over this"
              disabled={busy || typeof result.presetNumber !== 'number'}
              onPress={putItBack}
            />
          )}

          <Text style={{ color: color.silkFaint, fontSize: font.micro, lineHeight: 18 }}>
            Nothing here is permanent. Your phone can’t save to a slot, so this only changes
            the working copy — the stored preset is untouched until you save it at the Mac.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  )
}
