import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy } from '../store/policy';
import { routeToWorkflow } from './workflow-router';
import type { PolicyFile } from './types';

let policy: PolicyFile;

beforeAll(() => {
  const yaml = readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8');
  const result = loadPolicy(yaml);
  if (!result.valid) throw new Error(`fixture policy invalid: ${JSON.stringify(result.errors)}`);
  policy = result.policy;
});

describe('routeToWorkflow', () => {
  it('TC-LC-2-01: Low tier ("self-service") routes to lifecycle_stage "approved", no 2LoD action required', () => {
    const action = routeToWorkflow('Low', policy);
    expect(action.lifecycle_stage).toBe('approved');
    expect(action.requires_twoLoD_action).toBe(false);
    expect(action.auto_approves_after_days).toBeNull();
  });

  it('TC-LC-2-02: High tier ("2LoD-approve") routes to lifecycle_stage "pre_checked", 2LoD action required', () => {
    const action = routeToWorkflow('High', policy);
    expect(action.lifecycle_stage).toBe('pre_checked');
    expect(action.requires_twoLoD_action).toBe(true);
    expect(action.auto_approves_after_days).toBeNull();
  });

  it('TC-LC-2-02b: Critical tier ("2LoD-approve") routes the same as High — 2LoD action required, and the policy file maps Critical to 2LoD-approve [TC-LC-2-03]', () => {
    expect(policy.tier_workflow.Critical).toBe('2LoD-approve');
    const action = routeToWorkflow('Critical', policy);
    expect(action.lifecycle_stage).toBe('pre_checked');
    expect(action.requires_twoLoD_action).toBe(true);
  });

  it('Medium tier ("2LoD-notify") routes to lifecycle_stage "pre_checked", no action required but auto-approves after a review window', () => {
    const action = routeToWorkflow('Medium', policy);
    expect(action.lifecycle_stage).toBe('pre_checked');
    expect(action.requires_twoLoD_action).toBe(false);
    expect(action.auto_approves_after_days).toBe(5);
  });

  it('BC-P6C02-04: an unrecognized WorkflowType string fails safe to the strictest 2LoD-approve-equivalent path, never silently auto-approves', () => {
    const unknownPolicy: PolicyFile = {
      ...policy,
      tier_workflow: { ...policy.tier_workflow, Low: 'some-future-workflow-type' },
    };
    const action = routeToWorkflow('Low', unknownPolicy);
    expect(action.lifecycle_stage).toBe('pre_checked');
    expect(action.requires_twoLoD_action).toBe(true);
    expect(action.notification_message).toMatch(/unrecognized workflow type/i);
  });
});
