import type { JobPhase } from './types';

/** What a running conversion is doing right now, in words, for the queue and the agent cards. */
export interface StepInput {
  Progress: number;
  Speed?: number | null;
  EtaSeconds?: number | null;
  Encoder?: string | null;
  Phase?: JobPhase | null;
  BytesPerSecond?: number | null;
  AgentName?: string | null;
}

function pct(p: number): string {
  return `${Math.floor(Math.min(p, 0.999) * 100)}%`;
}

function rate(bps?: number | null): string {
  if (!bps || bps <= 0) return '';
  const mb = bps / 1e6;
  return ` · ${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB/s`;
}

function left(sec: number | null | undefined, duration: (s: number) => string): string {
  return sec ? ` · about ${duration(sec)} left` : '';
}

/**
 * "Copying to GAMING-PC · 40% · 85 MB/s", "Converting 62% · 6.1× real time · GPU · on GAMING-PC",
 * "Sending back to the server · 30% · 12 MB/s". `where` adds the agent name (the queue wants it, an agent's own card doesn't).
 */
export function jobStep(j: StepInput, duration: (s: number) => string, where = true): string {
  const on = where && j.AgentName ? ` · on ${j.AgentName}` : '';
  const kind = j.Encoder ? ` · ${/nvenc|amf|qsv/.test(j.Encoder) ? 'GPU' : 'CPU'}` : '';
  switch (j.Phase) {
    case 'downloading':
      return `Copying the original${where && j.AgentName ? ` to ${j.AgentName}` : ''} · ${pct(j.Progress)}${rate(j.BytesPerSecond)}${left(j.EtaSeconds, duration)}`;
    case 'uploading':
      // Agents from before 0.9.9 don't report upload progress: say what's happening instead of a frozen 100%.
      if (!j.BytesPerSecond && j.Progress >= 0.999) return `Converted; sending it back to the server (this agent version can't show progress)${on}`;
      return `Converted; sending it back · ${pct(j.Progress)}${rate(j.BytesPerSecond)}${left(j.EtaSeconds, duration)}${on}`;
    default:
      return `${j.Phase ? 'Converting ' : ''}${pct(j.Progress)}${j.Speed ? ` · ${j.Speed.toFixed(1)}× real time` : ''}${left(j.EtaSeconds, duration)}${kind}${on}`;
  }
}

/** The bar shows the conversion as the main part; copying and sending back fill it in their own colour. */
export function stepClass(phase?: JobPhase | null): string {
  return phase === 'downloading' || phase === 'uploading' ? ' transfer' : '';
}
