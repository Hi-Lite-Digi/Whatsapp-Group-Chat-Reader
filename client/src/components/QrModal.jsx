import React, { useState } from 'react';
import { QrCode, Smartphone, X, RefreshCw, KeyRound } from 'lucide-react';

export default function QrModal({ qrDataUrl, onClose, onReset, onRequestPairingCode, pairingCode }) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [usePhoneMode, setUsePhoneMode] = useState(false);
  const [loadingCode, setLoadingCode] = useState(false);

  const handleRequestCode = async (e) => {
    e.preventDefault();
    if (!phoneNumber) return;
    setLoadingCode(true);
    await onRequestPairingCode(phoneNumber);
    setLoadingCode(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ textAlign: 'center', maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <QrCode size={22} color="#25d366" /> Connect WhatsApp Account
          </h3>
          <button className="btn btn-secondary" style={{ padding: '4px 10px' }} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Toggle Mode */}
        <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', padding: '4px', borderRadius: '10px', marginBottom: '18px', border: '1px solid var(--border-color)' }}>
          <button
            style={{ flex: 1, padding: '8px', border: 'none', borderRadius: '8px', background: !usePhoneMode ? '#25d366' : 'transparent', color: !usePhoneMode ? '#fff' : 'var(--text-muted)', fontWeight: 600, cursor: 'pointer' }}
            onClick={() => setUsePhoneMode(false)}
          >
            QR Code Scan
          </button>
          <button
            style={{ flex: 1, padding: '8px', border: 'none', borderRadius: '8px', background: usePhoneMode ? '#25d366' : 'transparent', color: usePhoneMode ? '#fff' : 'var(--text-muted)', fontWeight: 600, cursor: 'pointer' }}
            onClick={() => setUsePhoneMode(true)}
          >
            Pairing Code (Phone #)
          </button>
        </div>

        {!usePhoneMode ? (
          <>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '16px' }}>
              Open WhatsApp on your mobile phone, navigate to <strong>Linked Devices</strong> &rarr; <strong>Link a Device</strong>, and scan the QR code:
            </p>

            {qrDataUrl ? (
              <div style={{ background: '#ffffff', padding: '14px', borderRadius: '16px', display: 'inline-block', boxShadow: '0 0 30px rgba(37, 211, 102, 0.3)' }}>
                <img src={qrDataUrl} alt="WhatsApp QR Code" style={{ width: '240px', height: '240px', display: 'block' }} />
              </div>
            ) : (
              <div style={{ padding: '50px 20px', color: 'var(--text-muted)' }}>
                Generating QR Code...
              </div>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'left' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Enter your WhatsApp phone number with country code (e.g. <code>14155552671</code> or <code>60123456789</code>) to receive an 8-digit pairing code on your phone:
            </p>

            <form onSubmit={handleRequestCode} style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                className="input-field"
                placeholder="Country code + number (digits only)"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value.replace(/[^0-9]/g, ''))}
                required
              />
              <button type="submit" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
                {loadingCode ? 'Generating...' : 'Get Code'}
              </button>
            </form>

            {pairingCode && (
              <div style={{ background: 'rgba(37, 211, 102, 0.15)', border: '1px solid rgba(37, 211, 102, 0.4)', padding: '16px', borderRadius: '12px', textAlign: 'center', marginTop: '10px' }}>
                <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '4px' }}>
                  <KeyRound size={16} color="#4ade80" /> Your Pairing Code
                </span>
                <div style={{ fontSize: '2.2rem', fontWeight: 800, letterSpacing: '0.25em', color: '#ffffff', fontFamily: 'var(--font-mono)' }}>
                  {pairingCode}
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                  On phone: <strong>Linked Devices</strong> &rarr; <strong>Link a Device</strong> &rarr; <strong>Link with phone number instead</strong>.
                </p>
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {onReset && (
            <button className="btn btn-secondary" style={{ width: '100%' }} onClick={onReset}>
              <RefreshCw size={16} /> Stalled / Restart Session
            </button>
          )}

          <div style={{ padding: '10px', background: 'rgba(37, 211, 102, 0.1)', borderRadius: '12px', border: '1px solid rgba(37, 211, 102, 0.2)', fontSize: '0.8rem', color: '#4ade80', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <Smartphone size={16} /> Fully compatible with WhatsApp & WhatsApp Business
          </div>
        </div>
      </div>
    </div>
  );
}
