import { DEFAULT_FONT_SIZE } from '../../lib/fields'

/**
 * A "Fill in now" field: the sender types the text straight onto the page. It is printed into
 * the document on a white background, so it can also cover a placeholder like "[COMPANY NAME]".
 */
export default function PrefillField({ field, scale, readOnly, onChange }) {
  const style = { fontSize: `${(field.fontSize || DEFAULT_FONT_SIZE) * scale}px` }
  const empty = !(field.text ?? '').trim()
  return (
    <div className={`w-full h-full bg-white border border-dashed ${empty ? 'border-amber-500' : 'border-slate-400'}`}>
      {readOnly ? (
        <div className="w-full h-full px-0.5 flex items-center text-gray-900 whitespace-nowrap overflow-hidden" style={style}>{field.text}</div>
      ) : (
        <input
          type="text"
          value={field.text ?? ''}
          onChange={(e) => onChange(e.target.value)}
          maxLength={500}
          placeholder={field.label || 'Type here'}
          aria-label={field.label || 'Fill in now'}
          className="overlay-text-input w-full h-full px-0.5 text-gray-900 placeholder-amber-600/70"
          style={style}
        />
      )}
    </div>
  )
}
