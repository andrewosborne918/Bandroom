// Supabase verifies the credential itself. Accept its supported opaque token sizes
// rather than assuming the provider always emits a 64-character SHA-256 value.
export const validInvitationTokenHash=(value:string)=>/^[A-Za-z0-9_-]{32,256}$/.test(value);
