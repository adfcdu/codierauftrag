/**
 * Param-free JSON log lines.
 * No query params, no IPs, no looked-up strings — the lookup inputs are personal data.
 */

export interface LogFields {
  state?: string;
  status?: number;
  durMs?: number;
  upstream?: number; // URL index (0 = primary), never the URL itself
  [key: string]: unknown;
}

function emit(stream: NodeJS.WriteStream, lvl: 'info' | 'error', msg: string, fields: LogFields): void {
  stream.write(
    JSON.stringify({ ts: new Date().toISOString(), lvl, msg, ...fields }) + '\n',
  );
}

export function logInfo(msg: string, fields: LogFields = {}): void {
  emit(process.stdout, 'info', msg, fields);
}

export function logError(msg: string, fields: LogFields = {}): void {
  emit(process.stderr, 'error', msg, fields);
}
