import { useState } from 'react'
import { DEFAULT_FONT_SIZE, FONT_SIZES } from '../lib/fields'

export default function TextOptions({ onApply }) {
  const [fontSize, setFontSize] = useState(String(DEFAULT_FONT_SIZE))
  const [color, setColor] = useState('#000000')

  const handleApply = () => {
    onApply({ fontSize: Number(fontSize), color })
  }

  return (
    <div className="bg-gray-50 rounded-xl p-4 mb-2">
      <div className="flex gap-3 mb-4">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Font Size</label>
          <select
            value={fontSize}
            onChange={(e) => setFontSize(e.target.value)}
            className="w-full p-2 bg-white border border-gray-300 rounded-lg text-gray-800 text-sm"
          >
            {FONT_SIZES.map(size => <option key={size} value={size}>{size} pt</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Color</label>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-full h-9 rounded-lg cursor-pointer border-0"
          />
        </div>
      </div>
      <button
        onClick={handleApply}
        className="w-full py-2 px-3 bg-green-600 text-white rounded-lg text-sm hover:bg-green-500 transition-all"
      >
        Add Text Field
      </button>
    </div>
  )
}
