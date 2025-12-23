import { useState } from 'react'

export default function TextOptions({ onApply }) {
  const [fontSize, setFontSize] = useState('14')
  const [color, setColor] = useState('#000000')

  const handleApply = () => {
    onApply({ fontSize, color })
  }

  return (
    <div className="bg-dark-700 rounded-xl p-4 mb-2">
      <div className="flex gap-3 mb-4">
        <div className="flex-1">
          <label className="block text-xs text-dark-400 mb-1">Font Size</label>
          <select
            value={fontSize}
            onChange={(e) => setFontSize(e.target.value)}
            className="w-full p-2 bg-dark-800 border border-dark-600 rounded-lg text-gray-200 text-sm"
          >
            <option value="12">12px</option>
            <option value="14">14px</option>
            <option value="16">16px</option>
            <option value="18">18px</option>
            <option value="24">24px</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs text-dark-400 mb-1">Color</label>
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
