/**
 * While a field follows the pointer: how to place it. It floats over the document so the pages
 * do not move when it appears or goes away (a field lands exactly where it was clicked).
 */
export default function PlacementHint({ what }) {
  return (
    <p
      role="status"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none max-w-[90vw] rounded-full bg-gray-900/90 px-4 py-2 text-sm text-white shadow-lg"
    >
      Click where the {what} should start (its bottom-left corner follows the pointer). Press Esc to cancel.
    </p>
  )
}
