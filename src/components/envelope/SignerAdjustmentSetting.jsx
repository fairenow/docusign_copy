/**
 * Whether signers may nudge or resize their own fields while signing. Off by default;
 * "Date signed" is never movable. Read-only once sent.
 */
export default function SignerAdjustmentSetting({ checked, readOnly, onChange }) {
  if (readOnly) {
    return (
      <p className="text-sm text-gray-600" data-testid="signer-adjustments">
        {checked ? 'Signers may adjust their fields slightly' : 'Signers cannot move fields'}
      </p>
    )
  }
  return (
    <label className="flex items-start gap-2 text-sm text-gray-800 cursor-pointer">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Let signers adjust their fields
        <span className="block text-xs text-gray-500">
          Signers can nudge or resize their boxes a little to fit the lines. &ldquo;Date signed&rdquo; always stays where you put it.
        </span>
      </span>
    </label>
  )
}
