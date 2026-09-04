export function Preview({
  result,
  onApply,
  onDiscard,
  busy,
  writeCount,
  withScenes,
  onWithScenes,
  sceneWriteCount,
  scene,
  sceneNames,
  sceneCount,
  onScene,
  renamePreset,
  onRenamePreset,
  presetNow
}) {
  if (!result) return null

  const { changes, problems, repairs = [], summary, notes, presetName, scenes = [] } = result
  const total = writeCount + (withScenes ? sceneWriteCount : 0)
  /*
   * Which half of a write is scene-bound.
   *
   * Parameter values and models belong to the preset (and to a block's
   * channel); bypass belongs to the *scene*. So a generation that switches
   * anything on or off lands partly in whichever scene happens to be live —
   * silently, until now. This is the question that started the scene work:
   * "how does the user know what scene this will be written to?"
   */
  const touchesBypass = changes.some((c) => c.bypassed !== undefined)
  const sceneLabel = (i) => sceneNames?.[i]?.trim() || `Scene ${i + 1}`

  /*
   * What this write does to the scenes that already exist.
   *
   * The question the player asked: "what happens to the other three scenes if
   * it's a new empty preset?" Nothing happens to them — a scene not in the
   * plan is not touched — but until now nothing on this screen said so, and
   * nothing said which of the named scenes were about to be written over
   * either. Both halves are answered here, before the button rather than
   * after it.
   */
  const nameOf = (i) => (sceneNames?.[i] || '').trim()
  const written = scenes.map((s) => s.index)
  const overwritten = written.filter((i) => nameOf(i))
  const untouched = Array.from({ length: sceneCount || 0 }, (_, i) => i).filter(
    (i) => !written.includes(i)
  )
  const namedUntouched = untouched.filter((i) => nameOf(i))
  const list = (items, fn) => items.map(fn).join(', ')

  /*
   * No block changes is only "nothing to apply" if there are also no scenes.
   *
   * A scene plan is a real proposal on its own — "give this preset a clean, a
   * rhythm and a lead" changes no parameter and is entirely worth applying.
   * The early return here used to discard it and report that everything had
   * been rejected, which was both wrong and unrecoverable: the plan was gone
   * from the screen with no way back to it.
   *
   * It also fires on the honest no-op — asking for a tone the preset is
   * already dialled to leaves nothing to write — so this cannot simply
   * announce failure either.
   */
  if (changes.length === 0 && scenes.length === 0) {
    return (
      <div className="notice" data-kind="fault">
        <h2>Nothing to apply</h2>
        <p>Every setting the generator produced was rejected during checking.</p>
        {problems.map((p, i) => (
          <p key={i} className="mono problem">
            {p}
          </p>
        ))}
      </div>
    )
  }

  return (
    <section className="preview">
      <div className="preview-head">
        <div>
          <p className="silk-label">Proposed</p>
          <h2 className="preset-name">{presetName || 'UNTITLED'}</h2>
          {summary ? <p className="summary">{summary}</p> : null}
        </div>
        <div className="preview-actions">
          <button onClick={onDiscard} disabled={busy}>
            Discard
          </button>
          {/* Blurred before the write for the same reason the assistant box is:
              a focused control is something iOS scrolls back into view on every
              layout change, and writing a preset changes the layout for several
              seconds. The button has done its job the moment it's pressed. */}
          {/* A button offering zero writes is a button that does nothing, and
              it is reachable: clear the scene box on a plan that only had
              scenes and the count falls to nothing. Say so rather than
              inviting the press. */}
          <button
            className="primary"
            onClick={(e) => {
              e.currentTarget.blur()
              onApply()
            }}
            disabled={busy || total === 0}
          >
            {busy ? 'Writing…' : total === 0 ? 'Nothing selected to send' : `Send ${total} changes to the unit`}
          </button>
        </div>
      </div>

      {changes.length === 0 ? (
        <p className="notes">
          Nothing to change in the blocks themselves — this is a scene plan over the preset as it
          already stands.
        </p>
      ) : null}

      {/*
        Naming the preset is a separate decision from naming the scenes.
        Every generation used to rename the slot as a side effect of applying
        it, so laying a set of scenes into a preset you had already named
        renamed it underneath you. Only worth asking when there is a name
        there to lose.
      */}
      {presetName && onRenamePreset ? (
        <label className="rename-choice">
          <input
            type="checkbox"
            checked={!!renamePreset}
            onChange={(e) => onRenamePreset(e.target.checked)}
            disabled={busy}
          />
          <span>
            {(presetNow || '').trim()
              ? `Rename the preset from “${presetNow.trim()}” to “${presetName}”`
              : `Name the preset “${presetName}”`}
            <span className="hint">
              {(presetNow || '').trim()
                ? 'Off leaves the preset called what it is called. The scene names are written either way.'
                : 'The scene names are written either way.'}
            </span>
          </span>
        </label>
      ) : null}

      <div className="diff">
        {changes.map((change) => (
          <div className="diff-block" key={change.eid}>
            <div className="diff-block-head">
              <span className="block-name">{change.name}</span>
              {change.bypassed !== undefined ? (
                <span className={`tag ${change.bypassed ? 'off' : 'on'}`}>
                  {change.bypassed ? 'bypass' : 'engage'}
                </span>
              ) : null}
            </div>

            {change.typeName ? (
              <div className="diff-row">
                <span className="diff-label">Model</span>
                <span className="diff-value mono">{change.typeName}</span>
                {change.typeBasedOn ? <span className="based-on">{change.typeBasedOn}</span> : null}
              </div>
            ) : null}

            {change.params.map((param) => (
              <div className="diff-row" key={param.id}>
                <span className="diff-label">{param.name}</span>
                <span className="diff-value mono">
                  <span className="from">{round(param.from)}</span>
                  <span className="arrow">→</span>
                  <span className="to">
                    {round(param.to)}
                    {param.unit}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/*
        The scene plan, and the choice of whether to write it.
        
        Off by default, and the count is on the button, because this is the one
        part of a generation that moves the unit around: it switches through
        every scene in the list and writes a bypass for every block in each.
        On a preset with a dozen blocks that is a hundred round trips down one
        serial port, and someone who only wanted the sound should not pay for it
        without having said so.
      */}
      {/*
        Where this actually lands. Only shown when there is a bypass to write
        and no scene plan taking over — with a plan, the plan's own list says
        which scenes are touched and this would contradict it.
      */}
      {touchesBypass && !scenes.length ? (
        <div className="write-target">
          <p className="hint">
            Values go to the preset. Switching blocks on and off belongs to a scene, so that part
            lands in:
          </p>
          {sceneCount > 1 && onScene ? (
            <label className="save-field">
              <span className="silk-label">Scene</span>
              <select
                value={scene ?? 0}
                onChange={(e) => onScene(Number(e.target.value))}
                disabled={busy}
                aria-label="Scene the bypass changes are written to"
              >
                {Array.from({ length: sceneCount }, (_, i) => (
                  <option key={i} value={i}>
                    {i + 1} · {sceneLabel(i)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="write-target-now mono">{sceneLabel(scene ?? 0)}</p>
          )}
        </div>
      ) : null}

      {scenes.length ? (
        <div className="scene-plan">
          <label className="scene-plan-head">
            <input
              type="checkbox"
              checked={!!withScenes}
              onChange={(e) => onWithScenes?.(e.target.checked)}
              disabled={busy}
            />
            <span>
              <strong>
                Also set up {scenes.length} scene{scenes.length > 1 ? 's' : ''}
              </strong>
              <span className="hint">
                {scenes.length > 1
                  ? `One rig, ${scenes.length} states of it — same amp and cab, different blocks switched in.`
                  : 'One more state of this rig — same amp and cab, different blocks switched in.'}{' '}
                Adds {sceneWriteCount} writes.
              </span>
            </span>
          </label>

          {/*
            Said before the button, in scene names rather than counts.
            "Overwriting" is the word that matters: a player who laid out
            Rhythm / Lead / Clean by hand needs to know which of those three
            this is about to write over, and that the rest are left alone.
          */}
          <p className="scene-plan-scope hint">
            {overwritten.length
              ? `Overwrites ${list(overwritten, (i) => `scene ${i + 1} · ${nameOf(i)}`)}. `
              : 'Nothing here is named yet, so nothing is being written over. '}
            {namedUntouched.length
              ? `${list(namedUntouched, (i) => `Scene ${i + 1} · ${nameOf(i)}`)} ${
                  namedUntouched.length === 1 ? 'is' : 'are'
                } left exactly as ${namedUntouched.length === 1 ? 'it is' : 'they are'}.`
              : untouched.length
                ? `The other ${untouched.length} scene${untouched.length === 1 ? '' : 's'} are left alone.`
                : ''}
          </p>

          <ol className="scene-plan-list">
            {scenes.map((scene) => {
              const on = scene.blocks.filter((b) => !b.bypassed)
              /*
               * The other half of what a scene is. A scene that puts the amp on
               * a channel of its own is a scene with its own sound, and that is
               * the interesting line in this list — "Lead: amp on D" says more
               * than the block names, which are the same in every row.
               */
              const moved = scene.blocks.filter((b) => b.channel)
              return (
                <li key={scene.index} className={withScenes ? '' : 'muted'}>
                  <span className="scene-plan-tag mono">S{scene.index + 1}</span>
                  <span className="scene-plan-name">{scene.name || `Scene ${scene.index + 1}`}</span>
                  {/* What this row does to the scene that is already there. A
                      scene with a name is somebody's work; a scene without one
                      is a blank slot. They are not the same write. */}
                  <span className={`tag ${nameOf(scene.index) ? 'off' : 'on'}`}>
                    {nameOf(scene.index) ? `replaces ${nameOf(scene.index)}` : 'empty slot'}
                  </span>
                  <span className="scene-plan-blocks">
                    {on.map((b) => b.name).join(' · ')}
                    {moved.length ? (
                      <span className="scene-plan-channels">
                        {moved.map((b) => `${b.name} on channel ${b.channel}`).join(', ')}
                      </span>
                    ) : null}
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      ) : null}

      {notes ? <p className="notes">{notes}</p> : null}

      {problems.length > 0 ? (
        <div className="problems">
          <p className="silk-label">Rejected during checking</p>
          {problems.map((p, i) => (
            <p key={i} className="mono problem">
              {p}
            </p>
          ))}
        </div>
      ) : null}

      {/* Kept, not lost — but you should know the control isn't the one the
          generator addressed, because that is worth doubting. */}
      {repairs.length > 0 ? (
        <div className="problems">
          <p className="silk-label">Matched by name</p>
          {repairs.map((p, i) => (
            <p key={i} className="mono problem repair">
              {p}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function round(n) {
  if (typeof n !== 'number') return '—'
  return Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100
}
