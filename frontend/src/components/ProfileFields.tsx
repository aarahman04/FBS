const INPUT_CLASS =
  'w-full rounded-2xl bg-white/[0.07] px-4 py-3.5 text-white ring-1 ring-inset ring-white/10 transition-shadow placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-white/30'

function Name({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Display name"
      className={INPUT_CLASS}
    />
  )
}

function Link({
  value,
  onChange,
  onClearInstant,
  error,
}: {
  value: string
  onChange: (v: string) => void
  /** Instant mode has nothing to open without a link; the server enforces
   * this too, but leaving the toggle visibly on would misrepresent what was
   * saved. */
  onClearInstant: () => void
  error: string | null
}) {
  return (
    <div>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          if (e.target.value.trim() === '') onClearInstant()
        }}
        placeholder="https://…"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={INPUT_CLASS}
      />
      {error && <p className="mt-2 px-1 text-sm text-red-400">{error}</p>}
    </div>
  )
}

function InstantToggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean
  onChange: (v: boolean) => void
  disabled: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      disabled={disabled}
      className="flex w-full items-start gap-3 rounded-2xl bg-white/[0.05] px-4 py-3.5 text-left ring-1 ring-inset ring-white/[0.07] transition-opacity disabled:opacity-40"
    >
      <span
        className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          value ? 'bg-emerald-500' : 'bg-white/15'
        }`}
      >
        <span
          className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
            value ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] text-white">Instant link</span>
        <span className="block text-[13px] leading-relaxed text-white/45">
          {value
            ? 'Opens by itself a moment after your face is recognized.'
            : 'Shows your name with a button to tap.'}
        </span>
      </span>
    </button>
  )
}

interface ProfileFieldsProps {
  name: string
  onNameChange: (value: string) => void
  link: string
  onLinkChange: (value: string) => void
  instant: boolean
  onInstantChange: (value: boolean) => void
  linkError: string | null
}

/** All three fields stacked, for first-run onboarding where there's nothing
 * else on screen to group them against.
 *
 * The profile screen composes the parts individually instead
 * (`ProfileFields.Name` and friends), because there they sit in separate
 * labelled cards -- as one flat stack they read as an undifferentiated pile
 * of pills. Sharing the parts keeps the two screens from drifting apart. */
function ProfileFieldsBase({
  name,
  onNameChange,
  link,
  onLinkChange,
  instant,
  onInstantChange,
  linkError,
}: ProfileFieldsProps) {
  return (
    <>
      <Name value={name} onChange={onNameChange} />
      <Link
        value={link}
        onChange={onLinkChange}
        onClearInstant={() => onInstantChange(false)}
        error={linkError}
      />
      <InstantToggle value={instant} onChange={onInstantChange} disabled={link.trim() === ''} />
    </>
  )
}

export const ProfileFields = Object.assign(ProfileFieldsBase, {
  Name,
  Link,
  InstantToggle,
})
