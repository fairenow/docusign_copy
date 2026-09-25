import { displayName } from '../../lib/envelopeModel'

const initialsOf = (name) => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('')

/** A teammate's initials in a circle. */
export default function Avatar({ person, size = 'w-7 h-7 text-[11px]' }) {
  const name = displayName(person)
  return (
    <span className={`${size} flex-shrink-0 rounded-full bg-gradient-to-br from-gray-600 to-gray-900 text-white font-semibold flex items-center justify-center`} title={name} aria-hidden="true">
      {initialsOf(name)}
    </span>
  )
}
