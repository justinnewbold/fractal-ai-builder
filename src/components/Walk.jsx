import arrowIcon from '../../mobile/assets/icons/arrow.png'
import chevronIcon from '../../mobile/assets/icons/chevron.png'
import gearIcon from '../../mobile/assets/icons/setup.png'
import ampIcon from '../../mobile/assets/icons/amp.png'
import laptopIcon from '../../mobile/assets/icons/laptop.png'
import phoneIcon from '../../mobile/assets/icons/phone.png'

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

/**
 * A card: the tile, an amber label, a line under it, and on the right a
 * chevron when it goes somewhere (or whatever `right` is, such as a lamp).
 */
export function TipCard({ icon, tile, label, body, onClick, right, small }) {
  const inner = (
    <>
      <span className={small ? 'walk-tile-sm' : undefined}>
        <Tile icon={icon}>{tile}</Tile>
      </span>
      <span className="walk-card-words">
        <span className="walk-card-label">{label}</span>
        {body ? <span className="walk-card-body">{body}</span> : null}
      </span>
      {right || (onClick ? <Pic src={chevronIcon} className="walk-chevron" /> : null)}
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

const CHAIN_ICONS = { unit: ampIcon, computer: laptopIcon, phone: phoneIcon }

/**
 * The unit, the computer and the phone, joined by their two wires, each with
 * a lamp: the top of Phone & computer. The words come from
 * shared/link-chain.mjs, and the phone draws the same three cards from the
 * same words (mobile/src/components/Walk.js).
 */
export function ChainCards({ cards }) {
  return (
    <div className="walk-chain">
      {cards.map((card) => (
        <div key={card.key}>
          <TipCard
            small
            icon={CHAIN_ICONS[card.key]}
            label={card.label}
            body={card.body}
            right={<span className="walk-lamp" data-tone={card.tone} aria-label={card.tone === 'good' ? 'answering' : card.tone === 'bad' ? 'not answering' : 'waiting'} />}
          />
          {card.wire ? (
            <div className={`walk-wire${card.lit ? ' lit' : ''}`} aria-hidden="true">
              <span className="walk-wire-line" />
              <span className="walk-wire-label">{card.wire}</span>
              <span className="walk-wire-line" />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
