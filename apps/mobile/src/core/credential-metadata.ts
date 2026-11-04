/** A typed, non-sensitive failure: do not initialize credentials or delete keys. */
export class CredentialMetadataDamaged extends Error {
 readonly code = "CREDENTIAL_METADATA_DAMAGED";
 constructor(detail: string) {
  super(`Credential metadata damaged: ${detail}`);
  this.name = "CredentialMetadataDamaged";
 }
}
