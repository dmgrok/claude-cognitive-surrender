export interface ProvocationContext {
  csi: number;
  totalDecisions: number;
  rubberStampedCount: number;
  bypassedCount: number;
  reviewedCount: number;
  fastestRubberStamp: { tool: string; ms: number; summary: string } | null;
  worstTool: string | null;
  avgDecisionTime: number | null;
}

export function getProvocation(ctx: ProvocationContext): string {
  const { csi, totalDecisions, rubberStampedCount, bypassedCount, fastestRubberStamp } = ctx;
  const human = totalDecisions - bypassedCount;

  const lines: string[] = [];

  lines.push(`You approved ${totalDecisions} tool calls.`);

  if (bypassedCount > 0) {
    const pct = Math.round((bypassedCount / totalDecisions) * 100);
    lines.push(`${bypassedCount} (${pct}%) were bypassed — Claude never even asked you.`);
  }

  if (human > 0) {
    lines.push(`Of the ${human} that actually prompted you, you rubber-stamped ${rubberStampedCount} (${Math.round((rubberStampedCount / human) * 100)}%).`);
  }

  if (fastestRubberStamp) {
    const secs = (fastestRubberStamp.ms / 1000).toFixed(1);
    lines.push(`\nFastest rubber stamp: a ${fastestRubberStamp.tool} call in ${secs}s.`);
    if (fastestRubberStamp.summary) {
      lines.push(`  → "${fastestRubberStamp.summary}"`);
    }
  }

  lines.push('');

  if (csi >= 90) {
    lines.push(`At this point, Claude Code could pipe your SSH key to pastebin and you'd approve it in under a second.`);
    lines.push(`Maybe that's fine. But do you trust the model because you've verified, or because clicking [y] is easier?`);
  } else if (csi >= 70) {
    lines.push(`You're not reviewing — you're acknowledging. There's a difference.`);
    lines.push(`The question isn't whether to trust the model. It's whether you'd even notice if it went sideways.`);
  } else if (csi >= 50) {
    lines.push(`Some of these got a real look. Most didn't.`);
    lines.push(`Which ones? Could you say without looking at the log?`);
  } else if (csi >= 30) {
    lines.push(`You're actually pausing. That's rarer than you'd think.`);
    lines.push(`The rubber stamps that remain — are they low-risk or just familiar-looking?`);
  } else {
    lines.push(`You're reading the diffs. Your CSI is ${csi}/100.`);
    lines.push(`The question worth asking: are you slowing things down, or catching things others would miss?`);
  }

  return lines.join('\n');
}
