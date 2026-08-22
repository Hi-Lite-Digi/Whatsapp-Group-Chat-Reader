import React, { useState } from 'react';
import { FileCode, Plus, Trash2, Save, Check } from 'lucide-react';

export default function SchemasTab({ schemas, onSaveSchema, onDeleteSchema }) {
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    description: '',
    instruction_prompt: '',
    json_schema: ''
  });

  const handleEdit = (s) => {
    setEditingId(s.id);
    setFormData({ ...s });
  };

  const handleCreateNew = () => {
    setEditingId('new');
    setFormData({
      id: `schema_${Date.now().toString().slice(-4)}`,
      name: 'Custom Extractor',
      description: 'Custom schema rules for group chat messages',
      instruction_prompt: 'Analyze incoming message and extract key data matching fields below.',
      json_schema: JSON.stringify({
        field_1: 'string',
        field_2: 'number'
      }, null, 2)
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    try {
      // Validate JSON
      JSON.parse(formData.json_schema);
      onSaveSchema(formData);
      setEditingId(null);
    } catch (err) {
      alert('Invalid JSON Schema format: ' + err.message);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* Header */}
      <div className="glass-panel" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileCode size={22} color="#8b5cf6" /> LLM Extraction Schema Rules
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '2px' }}>
            Define custom prompts and JSON schemas to instruct the LLM on what data to extract.
          </p>
        </div>

        <button className="btn btn-primary" onClick={handleCreateNew}>
          <Plus size={16} /> Create New Schema
        </button>
      </div>

      {/* Editor Modal / Form */}
      {editingId && (
        <div className="modal-overlay" onClick={() => setEditingId(null)}>
          <div className="modal-content" style={{ maxWidth: '800px' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '16px' }}>
              {editingId === 'new' ? 'Create New Extraction Schema' : `Edit Schema (${formData.id})`}
            </h3>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Schema ID (Unique Slug)</label>
                  <input
                    type="text"
                    className="input-field"
                    required
                    disabled={editingId !== 'new'}
                    value={formData.id}
                    onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Display Name</label>
                  <input
                    type="text"
                    className="input-field"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Description</label>
                <input
                  type="text"
                  className="input-field"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>LLM System Prompt / Instructions</label>
                <textarea
                  className="input-field"
                  rows="4"
                  required
                  value={formData.instruction_prompt}
                  onChange={(e) => setFormData({ ...formData, instruction_prompt: e.target.value })}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: '#4ade80', display: 'block', marginBottom: '4px', fontWeight: 600 }}>Target JSON Output Schema</label>
                <textarea
                  className="input-field"
                  rows="6"
                  required
                  style={{ color: '#4ade80' }}
                  value={formData.json_schema}
                  onChange={(e) => setFormData({ ...formData, json_schema: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">
                  <Save size={16} /> Save Schema Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Schema Cards List */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '20px' }}>
        {schemas.map(s => (
          <div key={s.id} className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#ffffff' }}>{s.name}</h3>
                  <span className="badge badge-info" style={{ marginTop: '4px' }}>{s.id}</span>
                </div>
                {s.is_default === 1 && <span className="badge badge-success"><Check size={12} /> Default</span>}
              </div>

              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '14px' }}>
                {s.description}
              </p>

              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.8rem', color: 'var(--text-main)', marginBottom: '14px' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Instruction Prompt</div>
                "{s.instruction_prompt}"
              </div>

              <div style={{ background: '#090d16', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>JSON Schema Format</div>
                <pre style={{ color: '#4ade80', maxHeight: '140px', overflowY: 'auto' }}>
                  {s.json_schema}
                </pre>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => handleEdit(s)}>
                Edit Schema
              </button>
              {s.id !== 'default' && (
                <button className="btn btn-danger" onClick={() => onDeleteSchema(s.id)}>
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
