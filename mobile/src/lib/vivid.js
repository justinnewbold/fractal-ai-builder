/**
 * The same colour, turned up.
 *
 * "I want this to look more like the liquid glass type stuff that Apple does,
 * and the color is a little bit more vibrant like it is in this mock-up."
 *
 * WHY THIS IS A FUNCTION AND NOT A NEW PALETTE. The block colours are not a
 * style choice — they are a claim about the hardware. A drive is red because a
 * drive is red on the unit's own screen, and several of them are marked
 * VERIFIED against FM3-Edit. Hand-picking sixty new hex values to look livelier
 * would be sixty chances to break the one promise that palette makes.
 *
 * So the HUE is never touched. Only saturation and lightness move, which is
 * the difference between "make the red more vivid" and "pick a different red".
 * The scene palette gets the same treatment for the same reason: its comment
 * says colour is identity and brightness is state, and lifting everything
 * equally leaves both of those intact.
 *
 * It also keeps this to the phone. The palettes are shared with the browser
 * through sync:rules, and editing them there would have repainted the computer
 * app too — which was not what was asked for.
 *
 * GREY STAYS GREY. Multiplying saturation leaves a colour with almost none
 * almost exactly where it was, so the slate scene and the utility blocks do
 * not turn into pastels. That falls out of the maths rather than needing a
 * list of exceptions.
 */

/** How much more saturated, and how much lighter, a lit tile becomes. */
const SAT = 1.6
const LIFT = 1.14
/* Past this a vivid colour starts washing out and white text stops reading on
   it. The ceiling matters more than the multiplier. */
const MAX_L = 0.62

const hex2 = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')

/** '#rgb' or '#rrggbb' to {r,g,b} 0-255, or null for anything else. */
export function readHex(value) {
  const s = String(value || '').trim()
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
  if (!m) return null
  const body = m[1]
  const full =
    body.length === 3
      ? body
          .split('')
          .map((c) => c + c)
          .join('')
      : body
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16)
  }
}

function toHsl({ r, g, b }) {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  const d = max - min
  if (!d) return { h: 0, s: 0, l }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6
  else if (max === G) h = ((B - R) / d + 2) / 6
  else h = ((R - G) / d + 4) / 6
  return { h, s, l }
}

const channel = (p, q, t) => {
  let x = t
  if (x < 0) x += 1
  if (x > 1) x -= 1
  if (x < 1 / 6) return p + (q - p) * 6 * x
  if (x < 1 / 2) return q
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
  return p
}

function toHex({ h, s, l }) {
  if (!s) {
    const v = hex2(l * 255)
    return `#${v}${v}${v}`
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return `#${hex2(channel(p, q, h + 1 / 3) * 255)}${hex2(channel(p, q, h) * 255)}${hex2(
    channel(p, q, h - 1 / 3) * 255
  )}`
}

/**
 * The vivid version of a colour, hue untouched.
 *
 * Anything this cannot read — a CSS variable, a name, undefined — comes back
 * exactly as it went in. The browser's palette carries `var(--panel-hi)` for
 * an unknown block, and a helper that turned that into garbage would paint a
 * tile black rather than leave it neutral.
 */
export function vivid(value) {
  const rgb = readHex(value)
  if (!rgb) return value
  const { h, s, l } = toHsl(rgb)
  return toHex({
    h,
    s: Math.min(1, s * SAT),
    l: Math.min(MAX_L, l * LIFT)
  })
}

/**
 * The same colour at an opacity, as an eight-digit hex.
 *
 * RN takes `#rrggbbaa` directly, so this needs no colour maths and no
 * rgba() string building — and it works on a vivid colour the same as a
 * plain one.
 */
export function at(value, alpha) {
  const rgb = readHex(value)
  if (!rgb) return value
  return `${toHex(toHsl(rgb))}${hex2(Math.max(0, Math.min(1, alpha)) * 255)}`
}
