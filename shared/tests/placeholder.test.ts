import { describe, expect, it } from 'vitest';
import { RECURRENCE_LABELS } from '../src/index.js';

describe('shared recurrence labels', () => {
  it('includes every supported recurrence', () => {
    expect(Object.keys(RECURRENCE_LABELS)).toEqual(['daily', 'weekly', 'monthly', 'as_needed']);
  });
});
