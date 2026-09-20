# Vision

**One conversation -> many agents -> many phones.**

Octagon is an open-source agent layer for the phones you own. You describe what
you want in one conversation. Agents turn that into work, and your physical
phones carry out the parts that need a real device - inside the apps you
already use.

## Why

Running several phones means juggling devices, accounts, schedules and
follow-up across all of them. Most of that is coordination, not creativity.
Octagon exists to absorb the coordination: you give goals, agents plan and
execute, phones do the hands-on part.

## The model

- **The conversation.** One place to talk to your fleet. You state goals;
  Octagon turns them into tasks and reports what happened.
- **Specialists.** Work is divided into clear jobs - research, content,
  scheduling, monitoring - and one agent per physical phone. Today the
  in-app assistant is rule-based, and any MCP client (Claude Desktop,
  Claude Code, your own agent) can act as the main agent through the
  Octagon MCP tools. Hierarchical sub-agents are the direction.
- **The phone is the hands.** Devices execute through iOS Voice Control:
  the Mac speaks a cue, the phone performs the action. No unofficial APIs,
  no cloud relay, no jailbreak.

## Principles

1. **Intent over interfaces.** Never make the user think like the software.
   "Run a session on Alpha for 20 minutes" is a sentence, not a form.
2. **Autonomy with control.** Agents do real work, but everything is logged:
   what happened, on which device, whether it succeeded. Destructive or
   consequential actions should ask first.
3. **Local first.** Your phones, your data, your machine. State lives in one
   SQLite file you can inspect and delete. We make no stronger privacy claim
   than the implementation supports.
4. **Open and modular.** Clone it, run it, change it, build agents on top of
   it. The goal is a reusable agent + device orchestration layer, not one
   giant script.
5. **MCP as the seam.** Every tool is a real capability - devices, health,
   tasks, events, screens - simple enough that another agent can use
   Octagon without knowing its internals.
6. **Honest automation.** No fake engagement. No features designed to evade
   platform enforcement. No promises about moderation outcomes. Agents work
   through devices you own, and they say what they actually do.

## Design

The interface should feel like talking to a capable operator, not configuring
a dashboard. The conversation is the center of the product. Devices, tasks,
agents and context appear around that conversation only when they are useful.
Simple. Calm. Fast. Obvious.

## Where this is going

Social media workflows are the first strong use case: scheduling posts of
your own content, watching your own accounts, operating your own devices.
The long-term primitive is broader:

**AI agents that can safely use your phones for you.**

## North star

When deciding whether something belongs in Octagon, ask:

> Does this make it easier for someone to tell Octagon what they want and
> have agents safely get it done through their phones?

If yes, it probably belongs. If it adds complexity without helping that loop,
question it.
