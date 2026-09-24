import arrowIcon from '../../mobile/assets/icons/arrow.png'
import chevronIcon from '../../mobile/assets/icons/chevron.png'
import gearIcon from '../../mobile/assets/icons/setup.png'

/*
 * THE LOOK OF EVERY WALKTHROUGH PAGE, FROM HIS "HERE'S THE APP" MOCKUP.
 *
 * "Update this screen across all platforms to look like this. And actually,
 * if you could go through all pages of any tutorials and onboarding type
 * stuff so that we can make them all look more robust like this." So these
 * few pieces are the whole of it: the step dots, cards with an amber picture
 * tile, one amber button with its arrow, and the settings row at the foot.
 * The phone's walkthrough draws the same (mobile/src/screens/Onboarding.js),
 * and so does the computer's own setup, which uses these too.
 *
 * The pictures are the phone's white PNGs used as masks, so they take
 * whatever colour the theme gives them.
 */
export function Pic({ src, className = '' }) {
  return (
    <span
      className={`walk-pic ${className}`}
      aria-hidden="true"
      style={{ WebkitMaskImage: `url(${src})`, maskImage: `url(${src})` }}
    />
  )
}

/** Dots joined by lines, the reached ones amber, and "2 of 3" under them. */
export function Steps({ at, of, label }) {
  return (
    <div className="walk-steps">
      <div className="walk-dots" aria-hidden="true">
        {Array.from({ length: of }, (_, i) => (
          <span key={i} className="walk-dot-wrap">
            {i ? <span className={`walk-line${i <= at ? ' on' : ''}`} /> : null}
            <span className={`walk-dot${i <= at ? ' on' : ''}`} />
          </span>
        ))}
      </div>
      <span className="walk-count">{label || `${Math.min(at, of - 1) + 1} of ${of}`}</span>
    </div>
  )
}

/** The amber picture tile a card leads with. */
export function Tile({ icon, children }) {
  return <span className="walk-tile">{icon ? <Pic src={icon} /> : children}</span>
}

/** A card: the tile, an amber label, a line under it, and a chevron when it goes somewhere. */
export function TipCard({ icon, tile, label, body, onClick }) {
  const inner = (
    <>
      <Tile icon={icon}>{tile}</Tile>
      <span className="walk-card-words">
        <span className="walk-card-label">{label}</span>
        {body ? <span className="walk-card-body">{body}</span> : null}
      </span>
      {onClick ? <Pic src={chevronIcon} className="walk-chevron" /> : null}
    </>
  )
  return onClick ? (
    <button type="button" className="walk-card" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="walk-card">{inner}</div>
  )
}

/** The one amber button: the words on the left, the arrow at the far end. */
export function Cta({ label, onClick, disabled, stick, className = '' }) {
  return (
    <button
      type="button"
      className={`walk-cta${stick ? ' pw-stick' : ''} ${className}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span>{label}</span>
      <Pic src={arrowIcon} className="walk-arrow" />
    </button>
  )
}

/** The foot: a hairline, then the gear, a quiet line, and a chevron when it goes somewhere. */
export function FootRow({ text, onClick }) {
  const inner = (
    <>
      <Pic src={gearIcon} className="walk-gear" />
      <span className="walk-foot-text">{text}</span>
      {onClick ? <Pic src={chevronIcon} className="walk-chevron" /> : null}
    </>
  )
  return (
    <div className="walk-foot">
      <span className="walk-hair" />
      {onClick ? (
        <button type="button" className="walk-foot-row" onClick={onClick}>
          {inner}
        </button>
      ) : (
        <div className="walk-foot-row">{inner}</div>
      )}
    </div>
  )
}
