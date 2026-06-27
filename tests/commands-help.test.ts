import { describe, it, expect } from 'vitest';
import { renderHelp, ADMIN_COMMANDS } from '../examples/commands-help';

describe('admin command help', () => {
  it('lists every admin command', () => {
    const out = renderHelp('/');
    for (const c of ADMIN_COMMANDS) expect(out).toContain('/' + c.name);
    expect(ADMIN_COMMANDS.map((c) => c.name)).toEqual(['stats', 'members', 'immunity', 'help']);
  });

  it('uses the platform prefix', () => {
    expect(renderHelp('/')).toContain('/stats');
    expect(renderHelp('!')).toContain('!stats');
    expect(renderHelp('!')).not.toContain('/stats');
  });

  it('shows argument hints', () => {
    expect(renderHelp('/')).toContain('/members [current|all|left]');
    expect(renderHelp('/')).toContain('/immunity [@user]');
  });

  it('gives a platform-specific immunity tip', () => {
    expect(renderHelp('/')).toContain('Reply to a message with /immunity');
    expect(renderHelp('!')).toContain('!immunity @user');
  });
});
