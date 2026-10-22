/**
 * Nonsecret routing provenance. A startup-engine fingerprint hashes the engine
 * endpoints; a Comfy Cloud fingerprint hashes the account id, never a credential.
 */
export type JobTargetBinding = {
  format: 'aftertake-job-target/1';
  kind: 'startup-engine' | 'comfy-cloud';
  fingerprint: string;
};
