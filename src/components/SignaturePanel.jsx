import { useState, useRef, useEffect } from 'react'

export default function SignaturePanel({ onApply }) {
  const [mode, setMode] = useState('draw')
  const [typedName, setTypedName] = useState('')
  const canvasRef = useRef(null)
  const isDrawing = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [])

  const getPos = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    
    if (e.touches) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      }
    }
    return {
      x: e.nativeEvent.offsetX,
      y: e.nativeEvent.offsetY
    }
  }

  const startDrawing = (e) => {
    isDrawing.current = true
    const pos = getPos(e)
    lastPos.current = pos
  }

  const draw = (e) => {
    if (!isDrawing.current) return
    e.preventDefault()

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const pos = getPos(e)

    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()

    lastPos.current = pos
  }

  const stopDrawing = () => {
    isDrawing.current = false
  }

  const clearCanvas = () => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setTypedName('')
  }

  const handleApply = () => {
    let signatureData

    if (mode === 'draw') {
      signatureData = canvasRef.current.toDataURL()
    } else {
      if (!typedName.trim()) {
        alert('Please enter your name')
        return
      }
      // Create typed signature
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = 200
      tempCanvas.height = 60
      const ctx = tempCanvas.getContext('2d')
      ctx.font = '32px "Brush Script MT", cursive'
      ctx.fillStyle = '#000'
      ctx.fillText(typedName, 10, 40)
      signatureData = tempCanvas.toDataURL()
    }

    onApply(signatureData)
  }

  return (
    <div className="bg-dark-700 rounded-xl p-4 mb-2">
      {/* Mode Tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setMode('draw')}
          className={`flex-1 py-2 px-3 rounded-lg text-sm transition-all ${
            mode === 'draw'
              ? 'bg-blue-600 text-white'
              : 'bg-dark-800 text-dark-400'
          }`}
        >
          Draw
        </button>
        <button
          onClick={() => setMode('type')}
          className={`flex-1 py-2 px-3 rounded-lg text-sm transition-all ${
            mode === 'type'
              ? 'bg-blue-600 text-white'
              : 'bg-dark-800 text-dark-400'
          }`}
        >
          Type
        </button>
      </div>

      {/* Draw Mode */}
      {mode === 'draw' && (
        <div className="bg-white rounded-lg overflow-hidden mb-3">
          <canvas
            ref={canvasRef}
            width={230}
            height={80}
            className="signature-canvas block w-full"
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
          />
        </div>
      )}

      {/* Type Mode */}
      {mode === 'type' && (
        <input
          type="text"
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          placeholder="Your Name"
          className="w-full p-3 bg-white rounded-lg text-2xl text-center mb-3 text-dark-900"
          style={{ fontFamily: '"Brush Script MT", cursive' }}
        />
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={clearCanvas}
          className="flex-1 py-2 px-3 bg-dark-600 text-gray-200 rounded-lg text-sm hover:bg-dark-500 transition-all"
        >
          Clear
        </button>
        <button
          onClick={handleApply}
          className="flex-1 py-2 px-3 bg-green-600 text-white rounded-lg text-sm hover:bg-green-500 transition-all"
        >
          Add to Doc
        </button>
      </div>
    </div>
  )
}
