import { inferKind } from '../lib/links'
import { PlatformIcon } from './PlatformIcon'
import type { DisplayMode } from '../types'

const INPUT_CLASS =
  'w-full rounded-2xl bg-white/[0.07] px-4 py-3.5 text-white ring-1 ring-inset ring-white/10 transition-shadow placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-white/30'

export const MAX_LINKS = 5

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

/** One URL row with a live platform icon (or favicon for a custom host) and a
 * remove control. The icon is what tells you the link was recognized as, say,
 * Instagram before you ever save. */
function LinkRow({
  value,
  onChange,
  onRemove,
  canRemove,
}: {
  value: string
  onChange: (v: string) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const trimmed = value.trim()
  const kind = trimmed ? inferKind(trimmed) : null

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={`${INPUT_CLASS} ${kind ? 'pl-11' : ''}`}
        />
        {kind && (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/80">
            <PlatformIcon kind={kind} url={trimmed} className="h-5 w-5" />
          </span>
        )}
      </div>
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove link"
          className="glass glass-interactive flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg leading-none text-white/70"
        >
          &times;
        </button>
      )}
    </div>
  )
}

/** Up to five link rows. Held as raw strings (blanks allowed) so typing is
 * frictionless; the parent drops blanks and tags them on save. */
function LinksEditor({
  links,
  onChange,
  error,
}: {
  links: string[]
  onChange: (links: string[]) => void
  error: string | null
}) {
  // Always show at least one row to type into.
  const rows = links.length === 0 ? [''] : links

  function setAt(index: number, value: string) {
    const next = rows.slice()
    next[index] = value
    onChange(next)
  }

  function removeAt(index: number) {
    const next = rows.filter((_, i) => i !== index)
    onChange(next.length === 0 ? [''] : next)
  }

  const filled = rows.filter((r) => r.trim()).length

  return (
    <div className="space-y-2.5">
      {rows.map((row, i) => (
        <LinkRow
          key={i}
          value={row}
          onChange={(v) => setAt(i, v)}
          onRemove={() => removeAt(i)}
          canRemove={rows.length > 1 || row.trim() !== ''}
        />
      ))}

      {error && <p className="px-1 text-sm text-red-400">{error}</p>}

      {rows.length < MAX_LINKS && (
        <button
          type="button"
          onClick={() => onChange([...rows, ''])}
          className="w-full rounded-2xl border border-dashed border-white/15 px-4 py-3 text-[14px] text-white/55 transition-colors hover:border-white/30 hover:text-white/80"
        >
          + Add another link
        </button>
      )}
      <p className="px-1 text-[12px] text-white/35">
        {filled}/{MAX_LINKS} links · known platforms get their icon, others show the site favicon.
      </p>
    </div>
  )
}

const MODE_OPTIONS: {
  value: DisplayMode
  title: string
  desc: string
  needsLink: boolean
}[] = [
  {
    value: 'name_and_links',
    title: 'Name + links',
    desc: 'Show your name with the tappable link bar.',
    needsLink: false,
  },
  {
    value: 'name_only',
    title: 'Name only',
    desc: 'Just your name — nothing opens on its own.',
    needsLink: false,
  },
  {
    value: 'name_then_open',
    title: 'Name, then open',
    desc: 'Show your name, then open your first link automatically.',
    needsLink: true,
  },
  {
    value: 'link_only',
    title: 'Open link only',
    desc: 'Open your first link automatically, without showing a name.',
    needsLink: true,
  },
]

/** The four idea.md §7 recognition modes. Link-dependent modes are disabled
 * until there's a link for them to open, matching the server's coercion. */
function DisplayModePicker({
  value,
  onChange,
  hasLinks,
}: {
  value: DisplayMode
  onChange: (v: DisplayMode) => void
  hasLinks: boolean
}) {
  return (
    <div className="space-y-2">
      {MODE_OPTIONS.map((opt) => {
        const disabled = opt.needsLink && !hasLinks
        const selected = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => !disabled && onChange(opt.value)}
            disabled={disabled}
            aria-pressed={selected}
            className={`flex w-full items-start gap-3 rounded-2xl px-4 py-3 text-left ring-1 ring-inset transition-colors disabled:opacity-35 ${
              selected
                ? 'bg-white/[0.10] ring-white/25'
                : 'bg-white/[0.04] ring-white/[0.07] hover:bg-white/[0.07]'
            }`}
          >
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                selected ? 'border-white' : 'border-white/30'
              }`}
            >
              {selected && <span className="h-2.5 w-2.5 rounded-full bg-white" />}
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] text-white">{opt.title}</span>
              <span className="block text-[13px] leading-relaxed text-white/45">{opt.desc}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

interface ProfileFieldsProps {
  name: string
  onNameChange: (value: string) => void
  links: string[]
  onLinksChange: (value: string[]) => void
  linkError: string | null
  displayMode: DisplayMode
  onDisplayModeChange: (value: DisplayMode) => void
}

/** All fields stacked, for first-run onboarding where there's nothing else on
 * screen to group them against. The profile screen composes the parts
 * individually into labelled cards instead (see ProfileModal). Sharing the
 * parts keeps the two screens from drifting apart. */
function ProfileFieldsBase({
  name,
  onNameChange,
  links,
  onLinksChange,
  linkError,
  displayMode,
  onDisplayModeChange,
}: ProfileFieldsProps) {
  const hasLinks = links.some((l) => l.trim() !== '')
  return (
    <>
      <Name value={name} onChange={onNameChange} />
      <LinksEditor links={links} onChange={onLinksChange} error={linkError} />
      <DisplayModePicker value={displayMode} onChange={onDisplayModeChange} hasLinks={hasLinks} />
    </>
  )
}

export const ProfileFields = Object.assign(ProfileFieldsBase, {
  Name,
  LinksEditor,
  DisplayModePicker,
})
