import React from 'react';
import {
  CheckCircle2,
  Clock3,
  Database,
  FileSearch,
  MessageSquareText,
  RefreshCw,
  X,
  XCircle
} from 'lucide-react';

function parsedJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function localTime(value) {
  if (!value) return 'Unknown time';
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function reasonLabel(reason) {
  return {
    missing_required_fields: 'Required Oracle fields were not evidenced in the supplier messages.',
    case_lifetime_elapsed: 'The case expired before the missing supplier evidence arrived.',
    no_quote_items: 'No definite new-tyre quotation item could be extracted.',
    failed_evidence_validation: 'The extracted values were not supported by the source messages.',
    negative_availability_only: 'The supplier said stock was unavailable, so no quotation could be created.',
    no_supplier_price: 'The supplier message contained no explicit quotation price.',
    no_tyre_size: 'No valid tyre size was present in the correlated messages.',
    unsupported_product: 'The conversation was about an unsupported product rather than a new tyre quotation.',
    logistics_or_acknowledgement: 'The message was logistics or acknowledgement text, not quotation evidence.',
    acknowledgement_only: 'The supplier only acknowledged the conversation and supplied no new quotation evidence.',
    unrelated_confirmation: 'The confirmation could not be tied safely to a tyre quotation request.',
    requester_message: 'The message came from the requester, so it could not trigger a supplier quotation.',
    current_message_missing: 'The triggering message was not present in the bounded case context.',
    ambiguous_case_match: 'The message could relate to more than one open quotation case.',
    invalid_supplier_mapping: 'The configured supplier could not be verified against Oracle.',
    duplicate_quotes: 'The same quotation candidate had already been recorded.',
    llm_failure: 'The quotation extraction service could not complete the check.',
    pipeline_error: 'The quotation pipeline encountered an internal processing error.',
    assumed_availability_needs_review: 'Ready-stock availability was assumed from the supplier price and quantity. MRR staff verification is required before publishing.',
    llm_interpretation_needs_review: 'One or more quotation fields were interpreted contextually by the LLM. MRR staff verification is required before publishing.'
  }[reason] || reason || 'No blocking reason was recorded.';
}

const FIELD_DEFINITIONS = [
  { key: 'brands', missingKey: 'brand', label: 'Brand', requirement: 'An explicit tyre brand from the supplier' },
  { key: 'models', missingKey: 'model', label: 'Model', requirement: 'An explicit tyre model from the supplier' },
  { key: 'sizes', missingKey: 'size', label: 'Tyre size', requirement: 'A valid tyre size such as 295/30R21' },
  { key: 'prices', missingKey: 'price', label: 'Per-piece price', requirement: 'A positive supplier quote price per tyre' },
  { key: 'quantities', missingKey: 'quantity', label: 'Stock quantity', requirement: 'A positive quantity explicitly confirmed by the supplier' },
  { key: 'availabilities', missingKey: 'confirmed_availability', label: 'Availability', requirement: 'Explicit ready stock, or a priced supplier quantity pending MRR staff verification' }
];

function fieldValues(definition, fields) {
  const values = fields[definition.key] || [];
  if (definition.key === 'prices') return values.map(value => `S$${Number(value).toFixed(2)}`);
  if (definition.key === 'quantities') return values.map(value => `${value} pc${Number(value) === 1 ? '' : 's'}`);
  if (definition.key === 'availabilities') {
    const assumed = (fields.availability_evidence || []).includes('price_quantity_assumption');
    return values.map(value => value === 'ready_stock'
      ? assumed ? 'Ready stock assumed — verify' : 'Ready stock confirmed'
      : String(value).replaceAll('_', ' '));
  }
  return values;
}

function runReason(run) {
  if (run.status === 'completed') return 'Quotation fields extracted and checked.';
  return reasonLabel(run.reason);
}

const MAPPING_LABELS = {
  brand: 'Brand',
  model: 'Model',
  size: 'Tyre size',
  price: 'Price',
  quantity: 'Quantity',
  availability: 'Availability'
};

function mappingValue(mapping, field) {
  if (field === 'quantity') return mapping.stock_quantity;
  return mapping[field];
}

export default function CaseEvidencePanel({ audit, loading, onClose, onRefresh }) {
  const caseItem = audit?.case;
  if (!caseItem && !loading) return null;

  const knownFields = parsedJson(caseItem?.known_fields_json, {});
  const missingFields = parsedJson(caseItem?.missing_fields_json, []);
  const complete = missingFields.length === 0;
  const blocked = !complete || !['ready', 'published'].includes(caseItem?.status);
  const assumedAvailability = (knownFields.availability_evidence || []).includes('price_quantity_assumption');
  const llmReviewRequired = knownFields.requires_staff_verification === true;
  const requiresVerification = (assumedAvailability || llmReviewRequired) && caseItem?.status !== 'published';
  const needsAttention = blocked || requiresVerification;
  const fieldMappings = knownFields.field_mappings || [];

  return (
    <div style={{ borderTop: '1px solid var(--border-color)', background: 'rgba(4, 10, 20, 0.58)', padding: '22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: 'var(--accent-cyan)', fontSize: '0.76rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Case evidence dossier</div>
          <h3 style={{ marginTop: '5px', fontSize: '1.15rem' }}>
            {caseItem ? `Q-${String(caseItem.id).padStart(4, '0')} · ${caseItem.group_name || caseItem.group_id}` : 'Loading case evidence…'}
          </h3>
          {caseItem && <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '6px' }}>Opened {localTime(caseItem.opened_at)} · Last activity {localTime(caseItem.last_activity_at)}</div>}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={onRefresh} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh evidence</button>
          <button className="btn btn-secondary" onClick={onClose} aria-label="Close case evidence"><X size={17} /></button>
        </div>
      </div>

      {loading && !caseItem ? (
        <div style={{ padding: '34px 0', color: 'var(--text-muted)', display: 'flex', gap: '10px', alignItems: 'center' }}><RefreshCw size={18} className="spin" /> Loading the exact source messages and decisions…</div>
      ) : (
        <>
          <div style={{ marginTop: '18px', padding: '16px', borderRadius: '13px', border: `1px solid ${needsAttention ? 'rgba(245, 158, 11, 0.35)' : 'rgba(37, 211, 102, 0.35)'}`, background: needsAttention ? 'rgba(245, 158, 11, 0.09)' : 'rgba(37, 211, 102, 0.09)', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
            {needsAttention ? <XCircle size={21} color="#fbbf24" style={{ flex: '0 0 auto' }} /> : <CheckCircle2 size={21} color="#4ade80" style={{ flex: '0 0 auto' }} />}
            <div>
              <strong style={{ color: needsAttention ? '#fbbf24' : '#4ade80' }}>{blocked
                ? 'Not fulfilled — no Oracle create/update was sent'
                : requiresVerification ? 'Prepared for MRR staff verification' : 'All required quotation evidence is present'}</strong>
              <div style={{ color: 'var(--text-muted)', marginTop: '5px', lineHeight: 1.55 }}>
                {blocked
                  ? `${reasonLabel(caseItem.last_reason)}${missingFields.length ? ` Missing: ${missingFields.join(', ')}.` : ''}`
                  : requiresVerification
                    ? assumedAvailability
                      ? 'The supplier provided a price and quantity, so ready-stock availability was assumed. Verify the LLM mapping and source messages below before publishing to Oracle.'
                      : 'The LLM interpreted one or more fields using conversational context or learned supplier patterns. Verify the mapping and source messages below before publishing to Oracle.'
                    : 'This case has passed the six-field readiness gate.'}
              </div>
            </div>
          </div>

          <div style={{ marginTop: '22px' }}>
            <h4 style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.95rem' }}><FileSearch size={18} color="var(--accent-cyan)" /> Six-field readiness check</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '10px', marginTop: '12px' }}>
              {FIELD_DEFINITIONS.map(definition => {
                const values = fieldValues(definition, knownFields);
                const isMissing = missingFields.includes(definition.missingKey) || values.length === 0;
                return (
                  <div key={definition.key} style={{ padding: '13px', borderRadius: '11px', border: `1px solid ${isMissing ? 'rgba(244, 63, 94, 0.25)' : 'rgba(37, 211, 102, 0.22)'}`, background: isMissing ? 'rgba(244, 63, 94, 0.06)' : 'rgba(37, 211, 102, 0.06)' }}>
                    <div style={{ display: 'flex', gap: '7px', alignItems: 'center', color: isMissing ? '#f87171' : '#4ade80', fontSize: '0.78rem', fontWeight: 700 }}>
                      {isMissing ? <XCircle size={15} /> : <CheckCircle2 size={15} />} {definition.label}
                    </div>
                    <div style={{ marginTop: '7px', fontWeight: 600, lineHeight: 1.4 }}>{values.length ? values.join(' · ') : 'Not stated'}</div>
                    <div style={{ marginTop: '6px', color: 'var(--text-dim)', fontSize: '0.72rem', lineHeight: 1.4 }}>{definition.requirement}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {fieldMappings.length > 0 && (
            <div style={{ marginTop: '24px' }}>
              <h4 style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.95rem' }}><FileSearch size={18} color="var(--accent-amber)" /> LLM field mapping</h4>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '5px', lineHeight: 1.5 }}>The LLM’s value, interpretation basis, source message IDs, and explanation for each field. Historical examples guide language interpretation only; current values must point to this case’s messages.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '13px' }}>
                {fieldMappings.map((mapping, mappingIndex) => (
                  <div key={`${mapping.brand || 'quote'}-${mappingIndex}`} style={{ padding: '14px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.025)' }}>
                    <strong>{mapping.brand} {mapping.model}</strong>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '9px', marginTop: '11px' }}>
                      {Object.entries(MAPPING_LABELS).map(([field, label]) => {
                        const evidence = mapping.evidence?.[field] || {};
                        const value = mappingValue(mapping, field);
                        return (
                          <div key={field} style={{ padding: '10px', borderRadius: '9px', background: 'rgba(255,255,255,0.035)' }}>
                            <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', textTransform: 'uppercase' }}>{label}</div>
                            <div style={{ marginTop: '4px', fontWeight: 600 }}>{value == null || value === '' ? 'Not mapped' : String(value)}</div>
                            <div style={{ marginTop: '5px', color: evidence.basis === 'explicit' ? '#4ade80' : '#fbbf24', fontSize: '0.72rem' }}>{String(evidence.basis || 'contextual').replaceAll('_', ' ')}</div>
                            <div style={{ marginTop: '4px', color: 'var(--text-muted)', fontSize: '0.72rem', lineHeight: 1.4 }}>{evidence.explanation || 'No explanation supplied.'}</div>
                            <div style={{ marginTop: '4px', color: 'var(--text-dim)', fontSize: '0.68rem' }}>Messages: {(evidence.message_ids || []).map(id => `#${id}`).join(', ') || 'case transcript'}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: '24px' }}>
            <h4 style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.95rem' }}><MessageSquareText size={18} color="#25d366" /> Exact case transcript</h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '5px', lineHeight: 1.5 }}>These are the complete messages the system attached to this case, in chronological order. “Triggered check” identifies the supplier message that initiated a quotation-processing run.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '13px' }}>
              {(audit.messages || []).map(message => {
                const supplier = message.role === 'supplier';
                const triggered = (message.triggered_run_ids || []).length > 0;
                return (
                  <div key={message.id} style={{ alignSelf: supplier ? 'flex-end' : 'flex-start', width: 'min(780px, 94%)', padding: '14px 15px', borderRadius: supplier ? '15px 15px 4px 15px' : '15px 15px 15px 4px', background: supplier ? 'rgba(37, 211, 102, 0.12)' : 'rgba(6, 182, 212, 0.1)', border: `1px solid ${supplier ? 'rgba(37, 211, 102, 0.24)' : 'rgba(6, 182, 212, 0.22)'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <div style={{ display: 'flex', gap: '7px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <strong>{message.sender_name || message.sender_id}</strong>
                        <span className={supplier ? 'badge badge-success' : 'badge badge-info'}>{message.role || 'context'}</span>
                        {triggered && <span className="badge badge-warning">Triggered check #{message.triggered_run_ids.join(', #')}</span>}
                      </div>
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.74rem', display: 'flex', gap: '5px', alignItems: 'center' }}><Clock3 size={13} /> {localTime(message.timestamp)}</span>
                    </div>
                    <div style={{ marginTop: '10px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.55 }}>{message.content || `[${message.message_type || 'message'}]`}</div>
                    {message.extracted_text && message.extracted_text !== message.content && (
                      <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.09)', color: 'var(--text-muted)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}><strong style={{ color: 'var(--text-main)' }}>Extracted media text:</strong> {message.extracted_text}</div>
                    )}
                    <div style={{ marginTop: '9px', color: 'var(--text-dim)', fontSize: '0.7rem' }}>Message #{message.id} · {message.source || 'unknown source'}{message.reply_to_wa_message_id ? ` · reply to ${message.reply_to_wa_message_id}` : ''}</div>
                  </div>
                );
              })}
              {(audit.messages || []).length === 0 && <div style={{ color: 'var(--text-muted)', padding: '16px 0' }}>No source messages are attached to this case.</div>}
            </div>
          </div>

          <div style={{ marginTop: '24px' }}>
            <h4 style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.95rem' }}><Clock3 size={18} color="var(--accent-amber)" /> Full surrounding group context</h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '5px', lineHeight: 1.5 }}>All stored messages from the same group within the {audit.context_window_minutes || 60}-minute correlation horizon leading up to the case’s last activity. This makes excluded context visible without implying that it influenced the quotation.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '13px' }}>
              {(audit.context_messages || []).map(message => (
                <div key={message.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(125px, auto) minmax(120px, 180px) 1fr', gap: '12px', alignItems: 'start', padding: '11px 12px', borderRadius: '10px', background: message.included_in_case ? 'rgba(37, 211, 102, 0.07)' : 'rgba(255,255,255,0.025)', border: `1px solid ${message.included_in_case ? 'rgba(37, 211, 102, 0.19)' : 'var(--border-color)'}` }}>
                  <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{localTime(message.timestamp)}</div>
                  <div style={{ minWidth: 0 }}><strong style={{ fontSize: '0.8rem' }}>{message.sender_name || message.sender_id}</strong><div style={{ marginTop: '5px' }}><span className={message.included_in_case ? 'badge badge-success' : 'badge badge-info'}>{message.included_in_case ? 'Used by case' : 'Context only'}</span></div></div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.45, color: message.message_type === 'senderKeyDistributionMessage' ? 'var(--text-dim)' : 'var(--text-main)' }}>{message.content || `[${message.message_type || 'message'}]`}</div>
                    {message.exclusion_reason && <div style={{ color: 'var(--text-dim)', fontSize: '0.71rem', marginTop: '5px' }}>{message.exclusion_reason}</div>}
                  </div>
                </div>
              ))}
              {(audit.context_messages || []).length === 0 && <div style={{ color: 'var(--text-muted)', padding: '12px 0' }}>No surrounding messages were stored within the case horizon.</div>}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px', marginTop: '24px' }}>
            <div style={{ padding: '16px', borderRadius: '13px', background: 'rgba(255,255,255,0.035)', border: '1px solid var(--border-color)' }}>
              <h4 style={{ fontSize: '0.92rem' }}>Processing decisions</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
                {(audit.runs || []).map(run => (
                  <div key={run.id} style={{ paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}><strong>Check #{run.id}</strong><span className={run.status === 'completed' ? 'badge badge-success' : run.status === 'failed' ? 'badge badge-danger' : 'badge badge-info'}>{run.status}</span></div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '6px', lineHeight: 1.45 }}>{runReason(run)}</div>
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginTop: '5px' }}>{localTime(run.created_at)} · Trigger message #{run.trigger_message_id}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ padding: '16px', borderRadius: '13px', background: 'rgba(255,255,255,0.035)', border: '1px solid var(--border-color)' }}>
              <h4 style={{ display: 'flex', gap: '7px', alignItems: 'center', fontSize: '0.92rem' }}><Database size={17} color="var(--accent-cyan)" /> Oracle outcome</h4>
              {(audit.events || []).length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.55, marginTop: '12px' }}>No Oracle candidate record was created for this case because it did not pass the readiness gate. No Oracle create or update request was sent.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
                  {audit.events.map(event => (
                    <div key={event.id} style={{ paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' }}>
                      <div><strong>{event.brand} {event.model}</strong> · {event.size} · S${Number(event.price).toFixed(2)}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.76rem', marginTop: '6px' }}>{event.sync_status}{event.error_message ? ` — ${event.error_message}` : ''}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
