# Cognitive Surrender

> *Are you reviewing Claude Code's tool calls, or just pressing [y]?*

A CLI tool that hooks into Claude Code and measures how quickly you approve permission prompts. It classifies each approval as **reviewed**, **surrendered** (approved too fast), or **auto-approved** (settings bypassed the prompt entirely). The goal isn't to shame — it's to surface data that sparks honest conversations about whether human review adds value in AI-assisted workflows.

## Install

```bash
npm install -g cognitive-surrender
cs install      # adds hooks to ~/.claude/settings.json
```

Restart Claude Code. The hooks fire silently on every tool call.

## Commands

```bash
cs stats              # Surrender rate and tool breakdown (last 7 days)
cs stats --days 30    # Longer window
cs streak             # Current and longest rubber-stamp streak
cs challenge          # Provocative summary of today's approvals
cs uninstall          # Remove hooks from settings.json
```

## How it works

Three categories of tool call, measured differently:

1. **Permission-prompted** — Claude Code shows you a `[y/n]` prompt. The time between the prompt appearing and your approval is your *decision time*. Under the threshold for that tool's complexity = surrendered.
2. **Auto-approved by settings** — your `settings.json` or an existing hook auto-approved. You were never asked. Logged as auto-approved.
3. **Auto-approved by hook** — same as above, just via a different mechanism.

Stats show the full picture: *"Of 200 tool calls, 150 were auto-approved. Of the 50 that asked you, you rubber-stamped 40."*

## Scoring

**Complexity** is computed per tool call:
- Tool type: `Bash` (0.7), `Write` (0.6), `Edit` (0.5), `Read` (0.1)
- Input length: +0.15 for >500 chars, +0.1 for >2000
- Code content: +0.1 if the input looks like code

**Threshold** = `1000ms + (complexity × 5000ms)` — the minimum time you'd need to actually read what you're approving.

**Cognitive Surrender Index (CSI)** = weighted surrender rate (0–100). Recent decisions and complex approvals weigh more. 100 = total autopilot.

## Data

Stored locally in `~/.cognitive-surrender/data.db` (SQLite). Nothing leaves your machine.

## The point

This tool doesn't answer whether rubber-stamping is *bad*. Maybe you trust the model. Maybe low-risk auto-approvals are fine. Maybe you're faster at reviewing than you think. The data lets you have that conversation with your team from a factual baseline instead of a vibe.

The question worth asking: *are you slowing things down, or catching things others would miss?*
