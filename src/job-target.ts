/** Nonsecret routing provenance; never identifies an account or proves readiness. */
export type JobTargetBinding = {
  format: 'aftertake-job-target/1';
  kind: 'startup-engine';
  fingerprint: string;
};
