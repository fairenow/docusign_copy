import { FIELD_LABELS } from '../../lib/fields'

/** A suggested field on the page, before it is added: a faint outline with its type. */
export default function SuggestedField({ suggestion, color }) {
  return (
    <div
      className="w-full h-full border-2 border-dashed rounded-sm flex items-center px-1 overflow-hidden whitespace-nowrap text-[10px] font-medium leading-none pointer-events-none"
      style={{ borderColor: color, backgroundColor: `${color}14`, color }}
      data-testid="suggested-field"
    >
      <span className="truncate">{suggestion.label || FIELD_LABELS[suggestion.type]}?</span>
    </div>
  )
}
