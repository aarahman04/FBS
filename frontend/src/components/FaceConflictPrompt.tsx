interface FaceConflictPromptProps {
  /** The account (display name) that currently holds this face. */
  owner: string
  /** Move the face to this account (re-register with transfer). */
  onMove: () => void
  /** Back out -- the user keeps the face on the other account and can't
   * register it here. */
  onCancel: () => void
  busy: boolean
}

/** Shown when a scan matches a face already registered to another account.
 * One face may belong to only one account, so the choice is binary: move it
 * here (which removes it from the other account), or cancel. */
export function FaceConflictPrompt({ owner, onMove, onCancel, busy }: FaceConflictPromptProps) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 px-6">
      <div className="glass w-full max-w-xs rounded-3xl p-6 text-center text-white">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-400/20">
          <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-amber-300" aria-hidden="true">
            <path
              d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h2 className="text-[17px] font-semibold tracking-tight">This face is already registered</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-white/60">
          It belongs to <span className="font-medium text-white/85">{owner}</span>. A face can
          be on only one account. Move it to this account?
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-white/40">
          Moving it removes the face from {owner}.
        </p>

        <div className="mt-6 space-y-2.5">
          <button
            onClick={onMove}
            disabled={busy}
            className="w-full rounded-full bg-white px-6 py-3 text-[15px] font-medium text-black transition-transform duration-200 active:scale-[0.97] disabled:opacity-50"
          >
            {busy ? 'Moving…' : 'Move it to this account'}
          </button>
          <button
            onClick={onCancel}
            disabled={busy}
            className="glass glass-interactive w-full rounded-full px-6 py-3 text-[15px] font-medium text-white disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
