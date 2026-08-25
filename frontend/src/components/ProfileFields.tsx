interface ProfileFieldsProps {
  name: string
  onNameChange: (value: string) => void
  link: string
  onLinkChange: (value: string) => void
  instant: boolean
  onInstantChange: (value: boolean) => void
  linkError: string | null
}

/** Name / link / instant-mode inputs. Shared by first-run onboarding and the
 * edit screen so the two can't drift apart. */
export function ProfileFields({
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
      <input
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Display name"
        className="w-full rounded-lg bg-neutral-800 px-4 py-3 text-white placeholder:text-white/40"
      />
      <div>
        <input
          value={link}
          onChange={(e) => {
            onLinkChange(e.target.value)
            // Instant mode has nothing to open without a link; the server
            // enforces this too, but leaving the toggle visibly on would
            // misrepresent what was saved.
            if (e.target.value.trim() === '') onInstantChange(false)
          }}
          placeholder="Link (optional) — https://…"
          className="w-full rounded-lg bg-neutral-800 px-4 py-3 text-white placeholder:text-white/40"
        />
        {linkError && <p className="mt-1 text-sm text-red-400">{linkError}</p>}
      </div>

      <button
        type="button"
        onClick={() => onInstantChange(!instant)}
        disabled={link.trim() === ''}
        className="flex w-full items-start gap-3 rounded-lg bg-neutral-800 px-4 py-3 text-left disabled:opacity-40"
      >
        <span
          className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
            instant ? 'bg-emerald-500' : 'bg-neutral-600'
          }`}
        >
          <span
            className={`h-5 w-5 rounded-full bg-white transition-transform ${
              instant ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </span>
        <span>
          <span className="block text-white">Instant link</span>
          <span className="block text-sm text-white/50">
            {instant
              ? 'Your link opens by itself a moment after your face is recognized.'
              : 'Your name shows with a button to tap to open your link.'}
          </span>
        </span>
      </button>
    </>
  )
}
