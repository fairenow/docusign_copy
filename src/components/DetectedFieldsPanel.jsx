import { useState, useMemo } from 'react'
import {
  Pen,
  Type,
  Calendar,
  Hash,
  CheckSquare,
  Circle,
  ChevronDown,
  ChevronRight,
  Sparkles,
  AlertCircle,
  Check,
  X,
  FileText,
  List
} from 'lucide-react'
import { FIELD_TYPES, getFieldStats, groupFieldsByType, groupFieldsByPage } from '../utils/formFieldDetector'

// Icon mapping for field types
const fieldIcons = {
  [FIELD_TYPES.TEXT]: Type,
  [FIELD_TYPES.CHECKBOX]: CheckSquare,
  [FIELD_TYPES.RADIO]: Circle,
  [FIELD_TYPES.SIGNATURE]: Pen,
  [FIELD_TYPES.DATE]: Calendar,
  [FIELD_TYPES.INITIALS]: Hash,
  [FIELD_TYPES.DROPDOWN]: List
}

// Color mapping for field types
const fieldColors = {
  [FIELD_TYPES.TEXT]: 'text-blue-400 bg-blue-500/20 border-blue-500/50',
  [FIELD_TYPES.CHECKBOX]: 'text-green-400 bg-green-500/20 border-green-500/50',
  [FIELD_TYPES.RADIO]: 'text-purple-400 bg-purple-500/20 border-purple-500/50',
  [FIELD_TYPES.SIGNATURE]: 'text-amber-400 bg-amber-500/20 border-amber-500/50',
  [FIELD_TYPES.DATE]: 'text-teal-400 bg-teal-500/20 border-teal-500/50',
  [FIELD_TYPES.INITIALS]: 'text-pink-400 bg-pink-500/20 border-pink-500/50',
  [FIELD_TYPES.DROPDOWN]: 'text-indigo-400 bg-indigo-500/20 border-indigo-500/50'
}

// Label mapping for field types
const fieldLabels = {
  [FIELD_TYPES.TEXT]: 'Text',
  [FIELD_TYPES.CHECKBOX]: 'Checkbox',
  [FIELD_TYPES.RADIO]: 'Radio',
  [FIELD_TYPES.SIGNATURE]: 'Signature',
  [FIELD_TYPES.DATE]: 'Date',
  [FIELD_TYPES.INITIALS]: 'Initials',
  [FIELD_TYPES.DROPDOWN]: 'Dropdown'
}

function FieldItem({ field, isSelected, onSelect, onPlace }) {
  const Icon = fieldIcons[field.type] || FileText
  const colorClass = fieldColors[field.type] || 'text-gray-400 bg-gray-500/20 border-gray-500/50'

  return (
    <div
      className={`p-2 rounded-lg border transition-all cursor-pointer mb-2 ${
        isSelected
          ? 'border-blue-500 bg-blue-500/10'
          : 'border-dark-600 bg-dark-700 hover:border-dark-500'
      }`}
      onClick={() => onSelect(field.id)}
    >
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded ${colorClass} border`}>
          <Icon size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-200 truncate">{field.label}</p>
          <p className="text-xs text-dark-400">
            Page {field.page} {field.required && <span className="text-red-400">*</span>}
          </p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onPlace(field)
          }}
          className="p-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          title="Place this field"
        >
          <Check size={14} />
        </button>
      </div>
    </div>
  )
}

function FieldTypeSection({ type, fields, selectedFields, onSelect, onPlace, onPlaceAll }) {
  const [isExpanded, setIsExpanded] = useState(true)
  const Icon = fieldIcons[type] || FileText
  const colorClass = fieldColors[type] || 'text-gray-400'
  const label = fieldLabels[type] || 'Unknown'

  return (
    <div className="mb-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-dark-700 transition-colors"
      >
        {isExpanded ? <ChevronDown size={16} className="text-dark-400" /> : <ChevronRight size={16} className="text-dark-400" />}
        <Icon size={16} className={colorClass.split(' ')[0]} />
        <span className="text-sm text-gray-200 flex-1 text-left">{label}</span>
        <span className="text-xs text-dark-400 bg-dark-600 px-2 py-0.5 rounded-full">
          {fields.length}
        </span>
      </button>

      {isExpanded && (
        <div className="ml-6 mt-1">
          {fields.map(field => (
            <FieldItem
              key={field.id}
              field={field}
              isSelected={selectedFields.includes(field.id)}
              onSelect={onSelect}
              onPlace={onPlace}
            />
          ))}
          {fields.length > 1 && (
            <button
              onClick={() => onPlaceAll(fields)}
              className="w-full p-2 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors"
            >
              Place all {label.toLowerCase()} fields
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function DetectedFieldsPanel({
  detectedFields,
  onPlaceField,
  onPlaceAllFields,
  onClose,
  isDetecting
}) {
  const [selectedFields, setSelectedFields] = useState([])
  const [viewMode, setViewMode] = useState('type') // 'type' or 'page'

  const stats = useMemo(() => getFieldStats(detectedFields), [detectedFields])
  const fieldsByType = useMemo(() => groupFieldsByType(detectedFields), [detectedFields])
  const fieldsByPage = useMemo(() => groupFieldsByPage(detectedFields), [detectedFields])

  const handleSelect = (fieldId) => {
    setSelectedFields(prev =>
      prev.includes(fieldId)
        ? prev.filter(id => id !== fieldId)
        : [...prev, fieldId]
    )
  }

  const handlePlaceField = (field) => {
    onPlaceField(field)
    setSelectedFields(prev => prev.filter(id => id !== field.id))
  }

  const handlePlaceSelected = () => {
    const fieldsToPlace = detectedFields.filter(f => selectedFields.includes(f.id))
    onPlaceAllFields(fieldsToPlace)
    setSelectedFields([])
  }

  const handlePlaceAllOfType = (fields) => {
    onPlaceAllFields(fields)
  }

  if (isDetecting) {
    return (
      <div className="bg-dark-800 border border-dark-600 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="animate-spin">
            <Sparkles size={20} className="text-blue-400" />
          </div>
          <div>
            <p className="text-sm text-gray-200">Analyzing document...</p>
            <p className="text-xs text-dark-400">Detecting form fields</p>
          </div>
        </div>
      </div>
    )
  }

  if (detectedFields.length === 0) {
    return (
      <div className="bg-dark-800 border border-dark-600 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-3 text-dark-400">
          <AlertCircle size={20} />
          <div>
            <p className="text-sm text-gray-300">No form fields detected</p>
            <p className="text-xs">Add fields manually using the buttons below</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="mt-3 w-full p-2 text-sm text-dark-400 hover:text-gray-300 hover:bg-dark-700 rounded transition-colors"
        >
          Dismiss
        </button>
      </div>
    )
  }

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-lg mb-4 overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-dark-600 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-blue-400" />
          <span className="text-sm font-medium text-gray-200">
            {stats.total} Fields Detected
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-dark-600 rounded transition-colors"
        >
          <X size={16} className="text-dark-400" />
        </button>
      </div>

      {/* Stats Bar */}
      <div className="px-3 py-2 bg-dark-700/50 border-b border-dark-600 flex gap-2 flex-wrap">
        {Object.entries(stats.byType).map(([type, count]) => {
          const Icon = fieldIcons[type] || FileText
          const colorClass = fieldColors[type] || 'text-gray-400'
          return (
            <div
              key={type}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${colorClass} border`}
            >
              <Icon size={12} />
              <span>{count}</span>
            </div>
          )
        })}
      </div>

      {/* View Toggle */}
      <div className="px-3 py-2 border-b border-dark-600 flex gap-2">
        <button
          onClick={() => setViewMode('type')}
          className={`px-3 py-1 rounded text-xs transition-colors ${
            viewMode === 'type'
              ? 'bg-blue-600 text-white'
              : 'bg-dark-700 text-dark-400 hover:text-gray-300'
          }`}
        >
          By Type
        </button>
        <button
          onClick={() => setViewMode('page')}
          className={`px-3 py-1 rounded text-xs transition-colors ${
            viewMode === 'page'
              ? 'bg-blue-600 text-white'
              : 'bg-dark-700 text-dark-400 hover:text-gray-300'
          }`}
        >
          By Page
        </button>
      </div>

      {/* Fields List */}
      <div className="p-3 max-h-64 overflow-y-auto">
        {viewMode === 'type' ? (
          Object.entries(fieldsByType).map(([type, fields]) => (
            <FieldTypeSection
              key={type}
              type={type}
              fields={fields}
              selectedFields={selectedFields}
              onSelect={handleSelect}
              onPlace={handlePlaceField}
              onPlaceAll={handlePlaceAllOfType}
            />
          ))
        ) : (
          Object.entries(fieldsByPage).map(([page, fields]) => (
            <div key={page} className="mb-3">
              <div className="flex items-center gap-2 p-2 text-sm text-gray-300">
                <FileText size={14} className="text-dark-400" />
                <span>Page {page}</span>
                <span className="text-xs text-dark-400">({fields.length} fields)</span>
              </div>
              <div className="ml-4">
                {fields.map(field => (
                  <FieldItem
                    key={field.id}
                    field={field}
                    isSelected={selectedFields.includes(field.id)}
                    onSelect={handleSelect}
                    onPlace={handlePlaceField}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Actions */}
      <div className="p-3 border-t border-dark-600 space-y-2">
        {selectedFields.length > 0 && (
          <button
            onClick={handlePlaceSelected}
            className="w-full p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <Check size={16} />
            Place Selected ({selectedFields.length})
          </button>
        )}
        <button
          onClick={() => onPlaceAllFields(detectedFields)}
          className="w-full p-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
        >
          <Sparkles size={16} />
          Place All Fields
        </button>
      </div>
    </div>
  )
}
