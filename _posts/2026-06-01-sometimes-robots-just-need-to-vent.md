---
layout: posts
title: "Sometimes, robots just need to vent"
date: 2026-06-01 12:00:00 -0500
---

I've written a lot of code in my day, and I've rewritten a lot more. It is seldom my intention to refactor something, but as a believer in the "boy scout principle," I try to leave things better than I found them. I'll find something misleading, or discover a module that has multiple concerns involved, or just scratch my head for too long trying to figure out what the heck is going on, and I'll "fix" it in hopes the next person has an easier go of things.

<figure>
  <img src="/assets/images/marvin.jpg" alt="I'd make a suggestion but you wouldn't listen">
  <figcaption class="image-caption">
      Who asked anyways?
  </figcaption>
</figure>

Since "agentic engineering" (or whatever we’re calling it these days) has taken over, I'm doing less refactoring. I'm still reading and shipping plenty of code, but my relationship with it has changed and I'm not as familiar with it or the friction of understanding it as I once was. Part of this is likely that if everyone on your team is using the same agent things will at least be somewhat consistent, but a bigger part of it is that our agents are too polite about the friction they encounter.

A solution I've been playing with is to let my agents `/complain`, cut the polite bullshit, and tell me what was confusing. Often it will bring things up that were hidden in "thinking" steps. What required a deep module read where just the interface should've been enough? Was there a stale or misleading comment that you only ignored after reading deeper? Agents are tuned to give results, not complain; this is a problem if you want to make continuous improvements to your codebase (you do).

After a significant session, run `/complain` and let the agent reflect. My early results are promising: revealing friction I wouldn't have known about unless I was willing to read hundreds of lines of LLM thoughts (I'm not).

You can check it out [here](https://github.com/MPickfield/agent-tools/blob/main/skills/complain/SKILL.md) or try it out in Claude code:

```sh
mkdir -p ~/.claude/skills/complain
curl -o ~/.claude/skills/complain/SKILL.md \
  https://raw.githubusercontent.com/MPickfield/agent-tools/refs/heads/main/skills/complain/SKILL.md
```

---

As an aside, you may notice this skill looks AI-generated itself. I originally had a much longer prompt that got decent results. I then had an agent A/B test various more condensed versions of it by using subagents with session loading, iterating until a more compact (under half the size of the original!) skill achieved the same results as the longer skill. Human written, machine optimized.
