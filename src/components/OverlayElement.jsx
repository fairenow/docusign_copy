import { useRef, useState, useCallback, useEffect } from 'react'
import { X } from 'lucide-react'

export default function OverlayElement({ element, onUpdate, onDelete, onSignatureClick }) {
  const elementRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isSelected, setIsSelected] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, origX: 0, origY: 0 })

  const handleMouseDown = (e) => {
    if (e.target.tagName === 'INPUT') return
    e.preventDefault()
    
    setIsDragging(true)
    setIsSelected(true)
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    
    dragStart.current = {
      x: clientX,
      y: clientY,
      origX: element.x,
      origY: element.y
    }
  }

  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    
    const dx = clientX - dragStart.current.x
    const dy = clientY - dragStart.current.y
    
    const newX = Math.max(0, dragStart.current.origX + dx)
    const newY = Math.max(0, dragStart.current.origY + dy)
    
    onUpdate({ x: newX, y: newY })
  }, [isDragging, onUpdate])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.addEventListener('touchmove', handleMouseMove)
      document.addEventListener('touchend', handleMouseUp)
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.removeEventListener('touchmove', handleMouseMove)
        document.removeEventListener('touchend', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  // Click outside to deselect
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (elementRef.current && !elementRef.current.contains(e.target)) {
        setIsSelected(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleCheckboxClick = (e) => {
    e.stopPropagation()
    onUpdate({ checked: !element.checked })
  }

  const handleSignaturePlaceholderClick = (e) => {
    e.stopPropagation()
    if (!element.data && onSignatureClick) {
      onSignatureClick(element.id)
    }
  }

  const renderContent = () => {
    switch (element.type) {
      case 'signature':
        return (
          <div className="p-1">
            {element.data ? (
              <img
                src={element.data}
                alt="Signature"
                className="max-h-16 pointer-events-none"
                draggable={false}
              />
            ) : (
              <div
                onClick={handleSignaturePlaceholderClick}
                className="px-4 py-2 bg-amber-50 border-2 border-dashed border-amber-400 rounded text-amber-600 text-sm flex items-center gap-2 min-w-[150px] cursor-pointer hover:bg-amber-100 hover:border-amber-500 transition-colors"
              >
                <span className="text-lg">✍️</span>
                <span>Click to sign</span>
              </div>
            )}
          </div>
        )
      
      case 'text':
        return (
          <div className="px-2 py-1 bg-white/95 border border-dashed border-blue-500 min-w-[100px]">
            <input
              type="text"
              value={element.text}
              onChange={(e) => onUpdate({ text: e.target.value })}
              placeholder="Enter text..."
              className="overlay-text-input"
              style={{ 
                fontSize: `${element.fontSize}px`,
                color: element.color 
              }}
            />
          </div>
        )
      
      case 'date':
        return (
          <div className="px-2 py-1 bg-white/95 border border-dashed border-green-500">
            <input
              type="text"
              value={element.text}
              onChange={(e) => onUpdate({ text: e.target.value })}
              className="overlay-text-input text-sm"
              style={{ color: '#000' }}
            />
          </div>
        )
      
      case 'initials':
        return (
          <div 
            className="px-3 py-1 bg-white/95 border border-dashed border-purple-500 text-xl"
            style={{ fontFamily: '"Brush Script MT", cursive', color: '#000' }}
          >
            {element.text}
          </div>
        )
      
      case 'checkbox':
        return (
          <div
            onClick={handleCheckboxClick}
            className={`checkbox-field ${element.checked ? 'bg-blue-100' : ''}`}
          >
            {element.checked && (
              <span className="text-blue-600 font-bold text-sm">✓</span>
            )}
          </div>
        )
      
      default:
        return null
    }
  }

  return (
    <div
      ref={elementRef}
      className={`overlay-element pointer-events-auto ${isSelected ? 'selected' : ''}`}
      style={{
        left: `${element.x}px`,
        top: `${element.y}px`
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleMouseDown}
    >
      {renderContent()}
      
      {/* Delete Handle */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        className={`absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white transition-opacity ${
          isSelected ? 'opacity-100' : 'opacity-0 hover:opacity-100'
        }`}
      >
        <X size={12} />
      </button>
    </div>
  )
}
