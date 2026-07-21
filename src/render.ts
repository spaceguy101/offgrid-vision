import type { AnalysisResult } from './schema.js';

function renderOne(result: AnalysisResult): string {
  const lines: string[] = [result.file];

  if (result.metadata) {
    const { format, width, height, bytes } = result.metadata;
    const size = width !== null && height !== null ? `${width}x${height}` : 'unknown size';
    lines.push(`  ${format}, ${size}, ${bytes} bytes, ${result.duration_ms} ms`);
  }

  if (result.error) {
    lines.push(`  ERROR [${result.error.code}] ${result.error.message}`);
  }

  const analysis = result.analysis;
  if (analysis) {
    if (analysis.parse_error && analysis.raw) {
      lines.push('  Raw model output (could not be parsed):');
      lines.push(`    ${analysis.raw.split('\n').join('\n    ')}`);
    } else {
      lines.push(`  ${analysis.description}`);
      if (analysis.objects.length) {
        const objects = analysis.objects.map((o) => `${o.name} (${o.confidence})`).join(', ');
        lines.push(`  Objects: ${objects}`);
      }
      if (analysis.text) {
        lines.push('  Text:');
        lines.push(`    ${analysis.text.split('\n').join('\n    ')}`);
      }
      if (analysis.tags.length) {
        lines.push(`  Tags: ${analysis.tags.join(', ')}`);
      }
    }
  }

  return lines.join('\n');
}

export function renderHuman(results: AnalysisResult[]): string {
  if (results.length === 0) return 'No files were analyzed.\n';

  const body = results.map(renderOne).join('\n\n');
  if (results.length === 1) return `${body}\n`;

  const failed = results.filter((result) => result.error !== null).length;
  const summary = `${results.length} files — ${results.length - failed} succeeded, ${failed} failed`;
  return `${body}\n\n${summary}\n`;
}
