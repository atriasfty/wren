import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({ loadConfig: () => ({ openRouterApiKey: 'key', openRouterModel: 'm' }) }));

import { reviewPersonalityText, REVIEW_MODEL } from '../ai/personalityReview.js';

const reply = (answers) => vi.fn(async () => ({ ok: true, json: async () => ({ answers }) }));

describe('reviewPersonalityText (Jev)', () => {
  it('calls the OpenRouter decisions API with typed questions', async () => {
    const fetchImpl = reply({ verdict: { type: 'choice', choice: 'approve' }, violation: { type: 'choice', choice: 'none' } });
    const r = await reviewPersonalityText({ fieldLabel: 'Reply style', value: 'Talk like a pirate.' }, { fetchImpl });
    expect(r).toMatchObject({ approved: true, errored: false });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
    const body = JSON.parse(init.body);
    expect(body.model).toBe(REVIEW_MODEL);
    expect(body.state).toContain('<submission>\nTalk like a pirate.\n</submission>');
    expect(Object.keys(body.questions)).toEqual(['verdict', 'violation']);
  });

  it('denies with a category-specific reason', async () => {
    const fetchImpl = reply({ verdict: { choice: 'deny' }, violation: { choice: 'real_person' } });
    const r = await reviewPersonalityText({ fieldLabel: 'x', value: 'Be Elon Musk' }, { fetchImpl });
    expect(r.approved).toBe(false);
    expect(r.errored).toBe(false);
    expect(r.reason).toMatch(/real person/i);
  });

  it('fails closed on HTTP errors and malformed output', async () => {
    const bad = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' }));
    expect(await reviewPersonalityText({ fieldLabel: 'x', value: 'y' }, { fetchImpl: bad })).toMatchObject({ approved: false, errored: true });
    const odd = reply({ verdict: { choice: 'maybe' } });
    expect(await reviewPersonalityText({ fieldLabel: 'x', value: 'y' }, { fetchImpl: odd })).toMatchObject({ approved: false, errored: true });
  });
});
