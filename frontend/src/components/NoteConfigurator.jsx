import { useState, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import TemplateFieldEditor from './TemplateFieldEditor';
import NotePreview from './NotePreview';

const SUGGESTED_SECTIONS = [
  'Motivo de consulta', 'Estado de ánimo', 'Intervenciones',
  'Acuerdos y tareas', 'Escala de malestar', 'Objetivos',
  'Riesgos', 'Observaciones', 'Recursos',
];

function emptyField(label = '', type = 'text') {
  return { id: uuidv4(), label, type, options: [], order: 0 };
}

const TYPE_ICONS = { text: '📝', scale: '📊', options: '☑️', date: '📅' };

export default function NoteConfigurator({ initialFields = [], onSave, onCancel, isFirstTime = false }) {
  const [fields, setFields] = useState(initialFields.length > 0 ? initialFields : []);
  const [activeFieldIndex, setActiveFieldIndex] = useState(initialFields.length > 0 ? 0 : -1);
  const [saving, setSaving] = useState(false);
  const [customSectionName, setCustomSectionName] = useState('');
  const [previewExpanded, setPreviewExpanded] = useState(true);

  const dragItem = useRef();
  const dragOverItem = useRef();

  const handleDragStart = (e, index) => { dragItem.current = index; };
  const handleDragEnter = (e, index) => { dragOverItem.current = index; };
  const handleDragEnd = () => {
    const copy = [...fields];
    const item = copy[dragItem.current];
    copy.splice(dragItem.current, 1);
    copy.splice(dragOverItem.current, 0, item);
    dragItem.current = null;
    dragOverItem.current = null;
    const updated = copy.map((f, i) => ({ ...f, order: i + 1 }));
    setFields(updated);
    setActiveFieldIndex(updated.indexOf(item));
  };

  const toggleAccordion = (idx) => {
    setActiveFieldIndex(prev => prev === idx ? -1 : idx);
  };

  const moveField = (e, idx, direction) => {
    e.stopPropagation();
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= fields.length) return;
    const copy = [...fields];
    [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
    const updated = copy.map((f, i) => ({ ...f, order: i + 1 }));
    setFields(updated);
    if (activeFieldIndex === idx) setActiveFieldIndex(newIdx);
    else if (activeFieldIndex === newIdx) setActiveFieldIndex(idx);
  };

  const addField = (label = '') => {
    const newF = emptyField(label);
    newF.order = fields.length + 1;
    const newFields = [...fields, newF];
    setFields(newFields);
    setActiveFieldIndex(newFields.length - 1);
  };

  const handleAddCustomSection = (e) => {
    e.preventDefault();
    if (customSectionName.trim()) {
      addField(customSectionName.trim());
      setCustomSectionName('');
    }
  };

  const updateActiveField = (updated) => {
    setFields(prev => prev.map((f, i) => i === activeFieldIndex ? updated : f));
  };

  const removeField = (e, idx) => {
    e.stopPropagation();
    const newFields = fields.filter((_, i) => i !== idx).map((f, i) => ({ ...f, order: i + 1 }));
    setFields(newFields);
    setActiveFieldIndex(prev => {
      if (prev === idx) return newFields.length > 0 ? Math.max(0, idx - 1) : -1;
      if (prev > idx) return prev - 1;
      return prev;
    });
  };

  const canSave = fields.length > 0 && fields.every(f => f.label.trim());

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(fields);
    } finally {
      setSaving(false);
    }
  };

  const usedLabels = new Set(fields.map(f => f.label.toLowerCase()));

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col font-sans">

      {/* Topbar — h-10 mobile, h-16 desktop */}
      <div className="h-10 md:h-16 border-b border-black/[0.08] flex items-center justify-between px-4 md:px-6 bg-[#f4f4f2] flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 md:w-8 md:h-8 bg-white border border-[#18181b]/[0.08] shadow-sm rounded-xl flex items-center justify-center">
            <svg className="w-3.5 h-3.5 md:w-5 md:h-5 text-[#5a9e8a]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-[13px] font-semibold text-[#18181b]">Configura tu nota</span>
        </div>
        {!isFirstTime && (
          <button
            onClick={onCancel}
            className="text-[12px] text-[#6b7280] hover:text-[#18181b] font-medium transition-colors"
          >
            ✕ Cerrar
          </button>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left Panel / Single scroll column */}
        <div className="w-full md:w-[450px] flex-shrink-0 flex flex-col border-r border-black/[0.08] bg-white overflow-y-auto">
          <div className="p-4 md:p-6 space-y-6">

            {/* Section A — Lista de secciones */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#6b7280] block mb-2">
                Secciones de la nota
              </label>

              {fields.length === 0 ? (
                <div className="border border-dashed border-black/20 rounded-xl p-4 text-[12px] text-center text-[#6b7280]">
                  Agrega secciones abajo para comenzar
                </div>
              ) : (
                <div className="space-y-1.5">
                  {fields.map((field, idx) => {
                    const isActive = activeFieldIndex === idx;
                    return (
                      <div
                        key={field.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, idx)}
                        onDragEnter={(e) => handleDragEnter(e, idx)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => e.preventDefault()}
                        className={`rounded-xl border transition-all ${
                          isActive
                            ? 'border-[#5a9e8a] bg-[#f0f8f5]'
                            : 'border-black/[0.06] bg-white hover:border-black/[0.15]'
                        }`}
                      >
                        {/* Row header */}
                        <div
                          className="flex items-center gap-1.5 py-2.5 px-3 cursor-pointer"
                          onClick={() => toggleAccordion(idx)}
                        >
                          <span className="text-[#9ca3af] cursor-grab select-none px-0.5">⠿</span>
                          <span className="text-sm flex-shrink-0">
                            {TYPE_ICONS[field.type] || '📝'}
                          </span>
                          <p className={`flex-1 text-[13px] font-medium truncate ${isActive ? 'text-[#5a9e8a]' : 'text-[#18181b]'}`}>
                            {field.label || 'Sección sin nombre'}
                          </p>
                          <button
                            onClick={(e) => moveField(e, idx, 'up')}
                            disabled={idx === 0}
                            aria-label="Mover arriba"
                            className="p-1.5 text-[#9ca3af] hover:text-[#18181b] disabled:opacity-30 transition-colors"
                          >
                            ↑
                          </button>
                          <button
                            onClick={(e) => moveField(e, idx, 'down')}
                            disabled={idx === fields.length - 1}
                            aria-label="Mover abajo"
                            className="p-1.5 text-[#9ca3af] hover:text-[#18181b] disabled:opacity-30 transition-colors"
                          >
                            ↓
                          </button>
                          <button
                            onClick={(e) => removeField(e, idx)}
                            aria-label="Eliminar sección"
                            className="p-1.5 rounded-md text-[#9ca3af] hover:text-red-500 hover:bg-red-50 transition-colors"
                          >
                            ✕
                          </button>
                        </div>

                        {/* Accordion body */}
                        {isActive && (
                          <div className="border-t border-[#5a9e8a]/20 px-3 py-2">
                            <TemplateFieldEditor
                              field={field}
                              onChange={updateActiveField}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Section B — Agregar sección */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#6b7280] block mb-2">
                Agregar sección
              </label>

              <div className="flex flex-wrap gap-1.5 mb-3">
                {SUGGESTED_SECTIONS.filter(s => !usedLabels.has(s.toLowerCase())).map(suggestion => (
                  <button
                    key={suggestion}
                    onClick={() => addField(suggestion)}
                    className="text-[11px] px-2.5 py-1 rounded-full bg-[#f4f4f2] text-[#18181b] hover:bg-[#eae8e5] transition-colors"
                  >
                    + {suggestion}
                  </button>
                ))}
              </div>

              <form onSubmit={handleAddCustomSection} className="flex gap-2">
                <input
                  type="text"
                  value={customSectionName}
                  onChange={(e) => setCustomSectionName(e.target.value)}
                  placeholder="Nombre personalizado…"
                  className="flex-1 bg-white border border-black/[0.1] rounded-xl px-3 py-2 text-[13px] text-[#18181b] placeholder-[#9ca3af] focus:outline-none focus:border-[#5a9e8a]/60 focus:ring-1 focus:ring-[#5a9e8a]/20"
                />
                <button
                  type="submit"
                  disabled={!customSectionName.trim()}
                  className="px-3 py-2 rounded-xl text-[13px] font-medium bg-[#f4f4f2] text-[#18181b] hover:bg-[#eae8e5] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  + Agregar
                </button>
              </form>
            </div>

            {/* Section C — Vista previa inline (solo mobile; desktop usa panel derecho) */}
            <div className="md:hidden">
              <button
                className="w-full flex items-center justify-between py-2 border-t border-black/[0.06]"
                onClick={() => setPreviewExpanded(prev => !prev)}
              >
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#6b7280]">
                  Vista previa
                </span>
                <span className="text-[#6b7280] text-sm">
                  {previewExpanded ? '∧' : '∨'}
                </span>
              </button>
              {previewExpanded && (
                <div className="mt-2">
                  <NotePreview fields={fields} activeFieldIndex={activeFieldIndex} />
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Right Panel — Preview desktop only */}
        <div className="hidden md:flex flex-1 bg-[#f4f4f2] p-6 lg:p-10 overflow-y-auto">
          <div className="max-w-2xl mx-auto w-full">
            <h3 className="text-[14px] font-medium text-[#6b7280] mb-4 text-center">Vista previa</h3>
            <NotePreview fields={fields} activeFieldIndex={activeFieldIndex} />
          </div>
        </div>

      </div>

      {/* Bottombar — h-[52px] mobile, h-20 desktop */}
      <div className="h-[52px] md:h-20 border-t border-black/[0.08] flex items-center justify-between px-4 md:px-6 bg-white flex-shrink-0">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-xl text-[13px] font-medium text-[#18181b] hover:bg-[#f4f4f2] transition-colors"
        >
          ← Volver
        </button>
        <button
          onClick={handleSave}
          disabled={!canSave || saving}
          className={`px-5 py-2 rounded-xl text-[13px] font-medium text-white transition-[opacity,background-color,box-shadow] duration-150 ${
            !canSave || saving
              ? 'bg-[#5a9e8a] opacity-40 cursor-not-allowed'
              : 'bg-[#5a9e8a] hover:bg-[#4a8a78] shadow-sm'
          }`}
        >
          {saving ? 'Guardando…' : (isFirstTime ? 'Guardar y entrar →' : 'Guardar cambios')}
        </button>
      </div>

    </div>
  );
}
