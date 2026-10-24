export function visitorCopy(target: string, existing: Buffer, recorded: Buffer): boolean;
export function loadExamples(
  directory?: string,
): Promise<{ data: string; manifest: { files: { source: string; target: string }[] } }>;
