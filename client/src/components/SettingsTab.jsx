import React, { useState, useEffect } from 'react';
import { Settings, Save, Key, Cpu, CheckCircle } from 'lucide-react';

export default function SettingsTab({ settings, onSaveSettings }) {
  const [formData, setFormData] = useState({
    llm_provider: 'gemini',
    llm_model: 'gemini-2.0-flash',
    openai_api_key: '',
    gemini_api_key: '',
    anthropic_api_key: '',
    ollama_base_url: 'http://localhost:11434',
    auto_download_media: 'true'
  });
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (settings) {
      setFormData({ ...settings });
    }
  }, [settings]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSaveSettings(formData);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const getModelOptions = (provider) => {
    switch (provider) {
      case 'gemini':
        return [
          { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Recommended - Multimodal & Fast)' },
          { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (Advanced Reasoning)' }
        ];
      case 'openai':
        return [
          { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast & Cost Effective)' },
          { value: 'gpt-4o', label: 'GPT-4o (High Performance Vision)' }
        ];
      case 'anthropic':
        return [
          { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
          { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' }
        ];
      case 'ollama':
        return [
          { value: 'qwen2.5', label: 'Qwen 2.5 (Local Ollama)' },
          { value: 'llama3', label: 'Llama 3 (Local Ollama)' }
        ];
      default:
        return [{ value: formData.llm_model, label: formData.llm_model }];
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      <div className="glass-panel" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Settings size={22} color="#25d366" /> System & LLM Configurations
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '2px' }}>
              Select active LLM Provider, model choices, and API keys.
            </p>
          </div>
          {savedSuccess && (
            <span className="badge badge-success" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircle size={14} /> Saved Successfully
            </span>
          )}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Provider Selection */}
          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <Cpu size={16} color="#06b6d4" /> Active LLM Provider
            </label>
            <select
              className="input-field"
              value={formData.llm_provider}
              onChange={(e) => {
                const newProv = e.target.value;
                const models = getModelOptions(newProv);
                setFormData({ ...formData, llm_provider: newProv, llm_model: models[0].value });
              }}
            >
              <option value="gemini">Google Gemini (Recommended)</option>
              <option value="openai">OpenAI (GPT-4o)</option>
              <option value="anthropic">Anthropic (Claude 3.5)</option>
              <option value="ollama">Local Ollama (Self-Hosted)</option>
            </select>
          </div>

          {/* Model Selection */}
          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', display: 'block', marginBottom: '8px' }}>
              Target Model
            </label>
            <select
              className="input-field"
              value={formData.llm_model}
              onChange={(e) => setFormData({ ...formData, llm_model: e.target.value })}
            >
              {getModelOptions(formData.llm_provider).map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <hr style={{ borderColor: 'var(--border-color)', margin: '4px 0' }} />

          {/* API Keys */}
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Key size={18} color="#f59e0b" /> API Keys & Endpoints
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Google Gemini API Key</label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="AIzaSy..."
                  value={formData.gemini_api_key || ''}
                  onChange={(e) => setFormData({ ...formData, gemini_api_key: e.target.value })}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>OpenAI API Key</label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="sk-proj-..."
                  value={formData.openai_api_key || ''}
                  onChange={(e) => setFormData({ ...formData, openai_api_key: e.target.value })}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Anthropic API Key</label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="sk-ant-..."
                  value={formData.anthropic_api_key || ''}
                  onChange={(e) => setFormData({ ...formData, anthropic_api_key: e.target.value })}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Ollama Base URL</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="http://localhost:11434"
                  value={formData.ollama_base_url || ''}
                  onChange={(e) => setFormData({ ...formData, ollama_base_url: e.target.value })}
                />
              </div>
            </div>
          </div>

          <hr style={{ borderColor: 'var(--border-color)', margin: '4px 0' }} />

          {/* Options */}
          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', display: 'block', marginBottom: '8px' }}>
              Media & Document Auto-Download
            </label>
            <select
              className="input-field"
              value={formData.auto_download_media || 'true'}
              onChange={(e) => setFormData({ ...formData, auto_download_media: e.target.value })}
            >
              <option value="true">Enabled (Download images & documents for OCR / Multimodal LLM)</option>
              <option value="false">Disabled (Process text messages only)</option>
            </select>
          </div>

          <button type="submit" className="btn btn-primary" style={{ marginTop: '10px' }}>
            <Save size={18} /> Save Configurations
          </button>
        </form>
      </div>
    </div>
  );
}
