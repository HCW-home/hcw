// Public Ed25519 key of the Iabsis signing authority (base64, raw 32 bytes).
// Used to verify instance signatures returned by /api/identity/.
// Generate with: `python manage.py hcw_keypair` on a trusted machine,
// keep the private key offline, and replace the value below with the public one.
export const IABSIS_PUBLIC_KEY_B64 =
  "+VlJpb+ii+qn+ckekS/GVChLoFOvTzyKvU7/sczRsAs=";
