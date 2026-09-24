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
import { DETECTED_FIELD_TYPES, getFieldStats, groupFieldsByType, groupFieldsByPage } from '../utils/formFieldDetector'

// Icon mapping for field types
const fieldIcons = {
  [DETECTED_FIELD_TYPES.TEXT]: Type,
  [DETECTED_FIELD_TYPES.CHECKBOX]: CheckSquare,
  [DETECTED_FIELD_TYPES.RADIO]: Circle,
  [DETECTED_FIELD_TYPES.SIGNATURE]: Pen,
  [DETECTED_FIELD_TYPES.DATE]: Calendar,
  [DETECTED_FIELD_TYPES.INITIALS]: Hash,
  [DETECTED_FIELD_TYPES.DROPDOWN]: List
}

// Color mapping for field types
const fieldColors = {
  [DETECTED_FIELD_TYPES.TEXT]: 'text-blue-600 bg-blue-500/20 border-blue-500/50',
  [DETECTED_FIELD_TYPES.CHECKBOX]: 'text-green-600 bg-green-500/20 border-green-500/50',
  [DETECTED_FIELD_TYPES.RADIO]: 'text-purple-600 bg-purple-500/20 border-purple-500/50',
  [DETECTED_FIELD_TYPES.SIGNATURE]: 'text-amber-600 bg-amber-500/20 border-amber-500/50',
  [DETECTED_FIELD_TYPES.DATE]: 'text-teal-600 bg-teal-500/20 border-teal-500/50',
  [DETECTED_FIELD_TYPES.INITIALS]: 'text-pink-600 bg-pink-500/20 border-pink-500/50',
  [DETECTED_FIELD_TYPES.DROPDOWN]: 'text-indigo-600 bg-indigo-500/20 border-indigo-500/50'
}

// Label mapping for field types
const fieldLabels = {
  [DETECTED_FIELD_TYPES.TEXT]: 'Text',
  [DETECTED_FIELD_TYPES.CHECKBOX]: 'Checkbox',
  [DETECTED_FIELD_TYPES.RADIO]: 'Radio',
  [DETECTED_FIELD_TYPES.SIGNATURE]: 'Signature',
  [DETECTED_FIELD_TYPES.DATE]: 'Date',
  [DETECTED_FIELD_TYPES.INITIALS]: 'Initials',
  [DETECTED_FIELD_TYPES.DROPDOWN]: 'Dropdown'
}

function FieldItem({ field, isSelected, onSelect, onPlace }) {
  const Icon = fieldIcons[field.type] || FileText
  const colorClass = fieldColors[field.type] || 'text-gray-500 bg-gray-500/20 border-gray-500/50'

  return (
    <div
      className={`p-2 rounded-lg border transition-all cursor-pointer mb-2 ${
        isSelected
          ? 'border-blue-500 bg-blue-500/10'
          : 'border-gray-300 bg-gray-50 hover:border-gray-400'
      }`}
      onClick={() => onSelect(field.id)}
    >
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded ${colorClass} border`}>
          <Icon size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-800 truncate">{field.label}</p>
          <p className="text-xs text-gray-500">
            Page {field.page} {field.required && <span className="text-red-600">*</span>}
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
  const colorClass = fieldColors[type] || 'text-gray-500'
  const label = fieldLabels[type] || 'Unknown'

  return (
    <div className="mb-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-gray-100 transition-colors"
      >
        {isExpanded ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />}
        <Icon size={16} className={colorClass.split(' ')[0]} />
        <span className="text-sm text-gray-800 flex-1 text-left">{label}</span>
        <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
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
              className="w-full p-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-500/10 rounded transition-colors"
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
      <div className="bg-white border border-gray-300 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="animate-spin">
            <Sparkles size={20} className="text-blue-600" />
          </div>
          <div>
            <p className="text-sm text-gray-800">Analyzing document...</p>
            <p className="text-xs text-gray-500">Detecting form fields</p>
          </div>
        </div>
      </div>
    )
  }

  if (detectedFields.length === 0) {
    return (
      <div className="bg-white border border-gray-300 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-3 text-gray-500">
          <AlertCircle size={20} />
          <div>
            <p className="text-sm text-gray-700">No form fields detected</p>
            <p className="text-xs">Add fields manually using the buttons below</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="mt-3 w-full p-2 text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
        >
          Dismiss
        </button>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-300 rounded-lg mb-4 overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-gray-300 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-blue-600" />
          <span className="text-sm font-medium text-gray-800">
            {stats.total} Fields Detected
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-200 rounded transition-colors"
        >
          <X size={16} className="text-gray-500" />
        </button>
      </div>

      {/* Stats Bar */}
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-300 flex gap-2 flex-wrap">
        {Object.entries(stats.byType).map(([type, count]) => {
          const Icon = fieldIcons[type] || FileText
          const colorClass = fieldColors[type] || 'text-gray-500'
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
      <div className="px-3 py-2 border-b border-gray-300 flex gap-2">
        <button
          onClick={() => setViewMode('type')}
          className={`px-3 py-1 rounded text-xs transition-colors ${
            viewMode === 'type'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-50 text-gray-500 hover:text-gray-900'
          }`}
        >
          By Type
        </button>
        <button
          onClick={() => setViewMode('page')}
          className={`px-3 py-1 rounded text-xs transition-colors ${
            viewMode === 'page'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-50 text-gray-500 hover:text-gray-900'
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
              <div className="flex items-center gap-2 p-2 text-sm text-gray-700">
                <FileText size={14} className="text-gray-500" />
                <span>Page {page}</span>
                <span className="text-xs text-gray-500">({fields.length} fields)</span>
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
      <div className="p-3 border-t border-gray-300 space-y-2">
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
          className="w-full p-2 btn-primary rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
        >
          <Sparkles size={16} />
          Place All Fields
        </button>
      </div>
    </div>
  )
}
