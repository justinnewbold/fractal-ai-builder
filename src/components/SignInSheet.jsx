import Sheet from './Sheet'
import SignIn from './SignIn'

/**
 * Sign-in as a sheet: it pops up, you do the one thing, it goes.
 *
 * The same form in both roles; only the words around it differ. On a phone
 * it is "Connect to your Mac", because that is what the person is doing —
 * the account is the means. At the Mac it is "Set up phone remote", once.
 */
export default function SignInSheet({ open, role, email, busy, onClose, onSubmit }) {
  const phone = role !== 'mac'
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={phone ? 'Connect to your Mac' : 'Set up phone remote'}
      note={phone ? 'Sign in once — this phone stays signed in' : 'Once, on this Mac'}
    >
      <div className="signin-sheet">
        <p className="hint">
          {phone
            ? 'Use the same account you set up on the Mac.'
            : 'Your phone will sign in with these same details to reach this Mac.'}
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
