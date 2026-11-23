export type SessionJoinRole = 'musician' | 'audience';

const sessionCode = /^[A-Z0-9]{8}$/;
const bandId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function readSessionJoin(search: string) {
  const params = new URLSearchParams(search);
  const code = params.get('join')?.trim().toUpperCase();
  if (!code || !sessionCode.test(code)) return null;

  const band = params.get('band');
  const role: SessionJoinRole = params.get('role') === 'audience' ? 'audience' : 'musician';
  return {code, role, band: band && bandId.test(band) ? band.toLowerCase() : undefined};
}

export function sessionJoinUrl(origin: string, code: string, role: SessionJoinRole = 'musician', band?: string) {
  const url = new URL('/', origin);
  url.searchParams.set('join', code);
  if (band) url.searchParams.set('band', band);
  if (role === 'audience') url.searchParams.set('role', role);
  return url;
}
