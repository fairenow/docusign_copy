import { FIELD_LABELS } from '../../lib/fields'

/** A field while preparing an envelope: type, required marker and assignee, in the assignee's color. */
export default function PlaceholderField({ field, color, assignee }) {
  return (
    <div
      className="w-full h-full border border-dashed flex items-center px-1 overflow-hidden whitespace-nowrap text-[11px] font-medium leading-none"
      style={{ borderColor: color, backgroundColor: `${color}26`, color }}
      title={assignee}
    >
      {field.type !== 'checkbox' && (
        <span className="truncate">
          {FIELD_LABELS[field.type]}{field.required ? ' *' : ''}
          <span className="opacity-70"> · {assignee}</span>
        </span>
      )}
    </div>
  )
}
