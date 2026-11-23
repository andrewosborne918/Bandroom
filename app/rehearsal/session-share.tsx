'use client';

import {Copy, Radio} from 'lucide-react';
import {QRCodeSVG} from 'qrcode.react';
import {sessionJoinUrl, type SessionJoinRole} from '../../lib/session-join';
import './session-share.css';

export default function SessionShare({name, code, bandId, origin, onNotify}: {
  name: string;
  code: string;
  bandId?: string;
  origin: string;
  onNotify: (message: string) => void;
}) {
  const joinUrl = sessionJoinUrl(origin, code, 'musician', bandId);

  async function copy(role: SessionJoinRole) {
    const audience = role === 'audience';
    const link = audience ? sessionJoinUrl(origin, code, role, bandId) : joinUrl;
    try {
      await navigator.clipboard.writeText(link.href);
      onNotify(audience ? 'Audience device link copied.' : 'Band join link copied.');
    } catch {
      onNotify(audience ? 'Enter ' + code + ' in Bndrm and choose Audience output.' : 'Enter ' + code + ' in Bndrm to join.');
    }
  }

  return (
    <>
      <p className="modal-intro">Scan with your phone’s camera to join <strong>{name}</strong>.</p>
      <div className="session-share-code">
        <QRCodeSVG value={joinUrl.href} size={224} marginSize={4} level="M" title="QR code to join as a band member" />
        <div>
          <span>Session code</span>
          <strong>{code}</strong>
        </div>
      </div>
      <button type="button" className="button primary full" onClick={() => void copy('musician')}><Copy size={16} /> Copy band join link</button>
      <button type="button" className="button subtle full audience-link" onClick={() => void copy('audience')}><Radio size={16} /> Copy audience device link</button>
      <p className="form-hint">Sessions last 24 hours. Cloud sessions require a signed-in member of this band.</p>
    </>
  );
}
