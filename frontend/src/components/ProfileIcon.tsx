interface ProfileIconProps {
  onClick: () => void
  registered: boolean
}

export function ProfileIcon({ onClick, registered }: ProfileIconProps) {
  return (
    <button
      onClick={onClick}
      aria-label="Profile"
      className="absolute left-4 top-[calc(env(safe-area-inset-top)+1rem)] z-10 flex h-11 w-11 items-center justify-center rounded-full border-2 border-white/70 bg-black/40 text-white shadow-lg backdrop-blur"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
        <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.24-8 5v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1c0-2.76-3.58-5-8-5Z" />
      </svg>
      {registered && (
        <span className="absolute right-0 top-0 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-black" />
      )}
    </button>
  )
}
