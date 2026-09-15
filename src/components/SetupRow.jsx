/**
 * One row of Setup: a name, one line of live status, and a way in.
 *
 * "I wanna overhaul this whole settings set-up screen." Setup was four doors
 * with a pile of unrelated buttons over them, and nothing on it said what
 * state anything was in until a door was opened. Now it is a short list, and
 * each row carries the one fact you would have opened it to learn — which
 * unit and whether it answers, which Mac the phone is on, what size Play is
 * at, what today has cost, how long the log is. Tap for the page.
 */
export default function SetupRow({ title, status, onClick }) {
  return (
    <button type="button" className="setup-row" onClick={onClick}>
      <span className="setup-row-text">
        <span className="setup-row-title">{title}</span>
        {status ? <span className="setup-row-status">{status}</span> : null}
      </span>
      <span className="setup-row-chevron" aria-hidden="true">
        ›
      </span>
    </button>
  )
}
