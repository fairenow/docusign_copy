import { useState, useRef, useEffect } from 'react'
import { renderTypedSignature, trimCanvas, SIGNATURE_FONT } from '../lib/signatureImage'

const PAD_HEIGHT = 110

export default function SignaturePanel({ onApply, applyLabel = 'Add to Doc' }) {
  const [mode, setMode] = useState('draw')
  const [typedName, setTypedName] = useState('')
  const [hasInk, setHasInk] = useState(false)
  const canvasRef = useRef(null)
  const lastPos = useRef(null)

  // Size the drawing buffer to the displayed size × device pixel ratio,
  // so pointer coordinates map 1:1 and strokes stay sharp.
  useEffect(() => {
    if (mode !== 'draw') return
    const canvas = canvasRef.current
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(PAD_HEIGHT * dpr)
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    setHasInk(false)
  }, [mode])

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const handlePointerDown = (e) => {
    e.preventDefault()
    canvasRef.current.setPointerCapture(e.pointerId)
    lastPos.current = getPos(e)
    // Draw a dot so a single tap leaves a mark
    const ctx = canvasRef.current.getContext('2d')
    ctx.beginPath()
    ctx.arc(lastPos.current.x, lastPos.current.y, ctx.lineWidth / 2, 0, Math.PI * 2)
    ctx.fillStyle = ctx.strokeStyle
    ctx.fill()
    setHasInk(true)
  }

  const handlePointerMove = (e) => {
    if (!lastPos.current) return
    const ctx = canvasRef.current.getContext('2d')
    const pos = getPos(e)
    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    lastPos.current = pos
  }

  const stopDrawing = () => {
    lastPos.current = null
  }

  const clear = () => {
    const canvas = canvasRef.current
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
    setTypedName('')
  }

  const handleApply = async () => {
    let result
    if (mode === 'draw') {
      result = hasInk ? trimCanvas(canvasRef.current) : null
      if (!result) {
        alert('Please draw your signature first')
        return
      }
    } else {
      if (!typedName.trim()) {
        alert('Please type your name')
        return
      }
      result = await renderTypedSignature(typedName.trim())
    }
    onApply(result)
  }

  const tabClass = (active) =>
    `flex-1 py-2 px-3 rounded-lg text-sm transition-all ${active ? 'bg-blue-600 text-white' : 'bg-dark-800 text-dark-400'}`

  return (
    <div className="bg-dark-700 rounded-xl p-4 mb-2">
      <div className="flex gap-2 mb-4">
        <button onClick={() => setMode('draw')} className={tabClass(mode === 'draw')}>Draw</button>
        <button onClick={() => setMode('type')} className={tabClass(mode === 'type')}>Type</button>
      </div>

      {mode === 'draw' ? (
        <div className="bg-white rounded-lg overflow-hidden mb-3 relative">
          <canvas
            ref={canvasRef}
            className="signature-canvas block w-full touch-none"
            style={{ height: PAD_HEIGHT }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDrawing}
            onPointerCancel={stopDrawing}
          />
          {!hasInk && (
            <span className="absolute inset-x-0 bottom-3 text-center text-xs text-gray-400 pointer-events-none">
              Sign here
            </span>
          )}
        </div>
      ) : (
        <input
          type="text"
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          placeholder="Your Name"
          className="w-full p-3 bg-white rounded-lg text-3xl text-center mb-3 text-dark-900"
          style={{ fontFamily: SIGNATURE_FONT, fontWeight: 600 }}
        />
      )}

      <div className="flex gap-2">
        <button onClick={clear} className="flex-1 py-2 px-3 bg-dark-600 text-gray-200 rounded-lg text-sm hover:bg-dark-500 transition-all">
          Clear
        </button>
        <button onClick={handleApply} className="flex-1 py-2 px-3 bg-green-600 text-white rounded-lg text-sm hover:bg-green-500 transition-all">
          {applyLabel}
        </button>
      </div>
    </div>
  )
}
