import Sheet from './Sheet'
import SignIn from './SignIn'

/**
 * Sign-in as a sheet: it pops up, you do the one thing, it goes.
 *
 * The same form in both roles; only the words around it differ. On a phone
 * it is "Connect to your Mac", because that is what the person is doing —
 * the account is the means. At the Mac it is "Set up phone remote", once.
 */
export default function SignInSheet({ open, role, account = false, email, busy, onClose, onSubmit, onCreate }) {
  const phone = role !== 'mac'
  /*
   * A sign-in with no errand: the account and nothing else, for the demo and
   * for buying the unlock. The phone's words for it, not new ones — its
   * form's button says "Sign in", and its sign-in screen says what an
   * account is. (Its Setup button's "Sign in with an email and password"
   * was the title here first, and ran off the edge of a phone.)
   */
  if (account) {
    return (
      <Sheet open={open} onClose={onClose} title="Sign in">
        <div className="signin-sheet">
          <p className="hint">
            Sign in with the same account as the computer your unit is plugged into. Your setlists
            and starred presets follow you to any device.
          </p>
          <SignIn email={email} busy={busy} autoFocus submitLabel="Sign in" onSubmit={onSubmit} onCreate={onCreate} />
        </div>
      </Sheet>
    )
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={phone ? 'Connect to your computer' : 'Set up phone remote'}
      note={phone ? 'Sign in once — this phone stays signed in' : 'Once, on this computer'}
    >
      <div className="signin-sheet">
        {/*
          WHERE THE ACCOUNT COMES FROM, said here because it cannot be made
          here. "Only sign-ins" on the computer — an account is created in
          the phone app, after the unlock, and this end signs into it.
        */}
        <p className="hint">
          {phone
            ? 'Use the same account you set up on the computer.'
            : 'Sign in with the account you made in the phone app. Your phone signs in with these same details to reach this computer.'}
        </p>
        <SignIn
          email={email}
          busy={busy}
          autoFocus
          submitLabel={phone ? 'Connect' : 'Turn on'}
          onSubmit={onSubmit}
        />
      </div>
    </Sheet>
  )
}
