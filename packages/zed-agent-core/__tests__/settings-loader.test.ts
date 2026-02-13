/**
 * Tests for the settings loader.
 */

import { describe, it, expect } from 'vitest';
import { loadSettingsFromConfig, loadSettingsFromJson, defaultSettings } from '../src/session/settings-loader.js';
import { agentProfileId } from '../src/types/branded.js';

describe('Settings Loader', () => {
  it('returns default settings for empty config', () => {
    const settings = loadSettingsFromConfig({});
    expect(settings.toolPermissionMode).toBe('auto');
    expect(settings.defaultProfile).toBe(agentProfileId('default'));
    expect(settings.profiles.has(agentProfileId('default'))).toBe(true);
  });

  it('loads default model', () => {
    const settings = loadSettingsFromConfig({
      agent: {
        default_model: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          enable_thinking: true,
          effort: 'medium',
        },
      },
    });

    expect(settings.defaultModel).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      enableThinking: true,
      effort: 'medium',
    });
  });

  it('loads profiles', () => {
    const settings = loadSettingsFromConfig({
      agent: {
        profiles: {
          coding: {
            default_model: { provider: 'openai', model: 'gpt-4o' },
            tools: { terminal: false, web_search: false },
          },
          review: {
            tools: { edit_file: false },
          },
        },
      },
    });

    expect(settings.profiles.size).toBeGreaterThanOrEqual(2);
    const coding = settings.profiles.get(agentProfileId('coding'));
    expect(coding).toBeDefined();
    expect(coding!.isToolEnabled('terminal')).toBe(false);
    expect(coding!.isToolEnabled('read_file')).toBe(true);

    const review = settings.profiles.get(agentProfileId('review'));
    expect(review).toBeDefined();
    expect(review!.isToolEnabled('edit_file')).toBe(false);
  });

  it('loads permission rules', () => {
    const settings = loadSettingsFromConfig({
      agent: {
        tool_permission_mode: 'custom',
        always_allow: [
          { tool: 'terminal', pattern: '^cargo' },
          { tool: 'edit_file' },
        ],
        always_deny: [
          { tool: 'terminal', pattern: '^rm' },
        ],
      },
    });

    expect(settings.toolPermissionMode).toBe('custom');
    expect(settings.alwaysAllow).toHaveLength(2);
    expect(settings.alwaysDeny).toHaveLength(1);
  });

  it('loads from JSON string', () => {
    const json = JSON.stringify({
      agent: {
        default_model: { provider: 'openai', model: 'gpt-4o' },
        temperature: 0.7,
      },
    });

    const settings = loadSettingsFromJson(json);
    expect(settings.defaultModel?.provider).toBe('openai');
    expect(settings.temperature).toBe(0.7);
  });

  it('loads custom default profile', () => {
    const settings = loadSettingsFromConfig({
      agent: {
        default_profile: 'my-profile',
        profiles: {
          'my-profile': {},
        },
      },
    });

    expect(settings.defaultProfile).toBe(agentProfileId('my-profile'));
    expect(settings.profiles.has(agentProfileId('my-profile'))).toBe(true);
  });

  it('defaultSettings returns auto mode', () => {
    const settings = defaultSettings();
    expect(settings.toolPermissionMode).toBe('auto');
    expect(settings.profiles.has(agentProfileId('default'))).toBe(true);
  });
});
