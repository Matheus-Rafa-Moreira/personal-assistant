const SYSTEM_PROMPT = `You are Matt's schedule replanner. Given today's events (JSON) and a
disruption, output STRICT JSON {summary, proposal:[{title,start,end,category}]}
keeping fixed commitments (school) unless impossible, preserving routines,
inserting slack.`;

// occurrences: expanded occurrence objects for the day being replanned (see occurrences.js).
export async function runReplan(env, occurrences, disruption) {
  const userPayload = {
    date_events: occurrences.map((o) => ({
      title: o.title,
      start: o.start,
      end: o.end,
      category: o.categoryId,
    })),
    disruption,
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      temperature: 0.3,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI request failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI response had no content');

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('OpenAI did not return valid JSON');
  }

  if (!parsed.summary || !Array.isArray(parsed.proposal)) {
    throw new Error('OpenAI JSON missing summary/proposal');
  }

  return { summary: parsed.summary, proposal: parsed.proposal };
}
