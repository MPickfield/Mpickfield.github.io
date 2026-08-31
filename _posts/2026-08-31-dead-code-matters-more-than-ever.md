---
layout: posts
title: "Dead code matters more than ever"
date: 2026-08-31 12:00:00 -0500
---

Not long ago dead code was a minor annoyance. Occasionally, the 'new guy' would stumble upon some superseded module or file and be a bit confused until thier peer confessed that they had been meaning to remove it. These days though, it's much more impactful.

While our new guy may have been confused once, they're unlikely to forget about the hours spent in a puzzled haze trying to accomplish whatever they were doing that actually mattered. They may have even done the cleanup themselves to save the next maintainer from sharing in their frustrations! Either scenario has a very human benefit; the propogation of tribal knowledge or helping out an overworked (forgetful) peer can bring a team closer together. 

Agents do none of these things. Their memories might lean towards 'things that cannot be derived from code', and they're far more likely to try and reuse or respect some block of dead code for 'legacy concerns' than they are to suggest removing it. So instead each chunk of dead code is just more context that needs to be ingested and reasoned through. 

Fortunately, it's cheaper than ever to clean up dead code, especially when you can hand tools like [knip](https://knip.dev/) to your agent and let it hack away. So, bring out your dead.
