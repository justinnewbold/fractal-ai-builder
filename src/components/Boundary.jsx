import { Component } from 'react'

/**
 * A panel that fails says so, instead of taking the page with it.
 *
 * React unmounts the whole tree when a render throws, which turns one bad
 * assumption inside one panel into a blank screen — no message, no clue which
 * of a dozen panels did it, nothing to report but "it's blank". A boundary per
 * panel keeps the failure the size of the panel and prints what went wrong,
 * which is the difference between a bug report and a mystery.
 *
 * Deliberately not a retry loop: whatever the render didn't like is still there
 * on the next render. The button is there because a panel that failed on a
 * preset you have since changed will draw fine now.
 */
export default class Boundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // The stack is worth more than the message when someone is reading this out
    // of a console to describe what they saw.
    console.error(`[fractal] ${this.props.label || 'panel'} failed to draw`, error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="panel-failed">
        <p className="hint">
          {this.props.label ? `${this.props.label} couldn’t draw` : 'This panel couldn’t draw'} —{' '}
          {this.state.error.message || 'no reason given'}. Everything else on the page still works.
        </p>
        <button className="chip" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}
