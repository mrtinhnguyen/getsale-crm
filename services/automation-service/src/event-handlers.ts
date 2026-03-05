import crypto from 'node:crypto';
import { Pool } from 'pg';
import { Counter } from 'prom-client';
import { RabbitMQClient } from '@getsale/utils';
import { EventType, AutomationRuleTriggeredEvent, Event } from '@getsale/events';
import { Logger } from '@getsale/logger';

interface EventHandlerDeps {
  pool: Pool;
  rabbitmq: RabbitMQClient;
  log: Logger;
  automationEventsTotal: Counter<string>;
  automationProcessedTotal: Counter;
  automationSkippedTotal: Counter;
  automationFailedTotal: Counter;
  dealCreatedTotal: Counter;
  automationDlqTotal: Counter<string>;
  automationSlaProcessedTotal: Counter;
  automationSlaSkippedTotal: Counter;
}

export function subscribeToEvents(deps: EventHandlerDeps): Promise<void> {
  const { rabbitmq, pool, log, ...metrics } = deps;
  return rabbitmq.subscribeToEvents(
    [
      EventType.MESSAGE_RECEIVED,
      EventType.DEAL_STAGE_CHANGED,
      EventType.CONTACT_CREATED,
      EventType.LEAD_STAGE_CHANGED,
      EventType.LEAD_SLA_BREACH,
      EventType.DEAL_SLA_BREACH,
    ],
    (event) => processEvent({ pool, rabbitmq, log, ...metrics }, event),
    'events',
    'automation-service'
  );
}

async function processEvent(deps: EventHandlerDeps, event: any) {
  try {
    if (event.type === EventType.LEAD_STAGE_CHANGED) {
      deps.automationEventsTotal.inc({ event_type: EventType.LEAD_STAGE_CHANGED });
      const correlationId = event.data?.correlationId ?? event.id;
      deps.log.info({
        message: 'consume lead.stage.changed',
        correlation_id: correlationId,
        event_id: event.id,
        entity_type: 'lead',
        entity_id: event.data?.leadId,
      });
      await processLeadStageChanged(deps, event, correlationId);
      return;
    }

    if (event.type === EventType.LEAD_SLA_BREACH || event.type === EventType.DEAL_SLA_BREACH) {
      deps.automationEventsTotal.inc({ event_type: event.type });
      const correlationId = event.data?.correlationId ?? event.id;
      deps.log.info({
        message: event.type === EventType.LEAD_SLA_BREACH ? 'consume lead.sla.breach' : 'consume deal.sla.breach',
        correlation_id: correlationId,
        event_id: event.id,
        entity_type: event.type === EventType.LEAD_SLA_BREACH ? 'lead' : 'deal',
        entity_id: event.data?.leadId ?? event.data?.dealId,
        breach_date: event.data?.breachDate,
      });
      await processSlaBreach(deps, event, correlationId);
      return;
    }

    const rules = await deps.pool.query(
      `SELECT * FROM automation_rules 
       WHERE is_active = true 
       AND trigger_type = $1 
       AND organization_id = $2`,
      [event.type, event.organizationId]
    );

    for (const rule of rules.rows) {
      const triggerConditions =
        typeof rule.trigger_conditions === 'string'
          ? JSON.parse(rule.trigger_conditions)
          : rule.trigger_conditions;
      const conditions =
        typeof rule.conditions === 'string' ? JSON.parse(rule.conditions) : rule.conditions || [];
      let shouldExecute = true;

      for (const condition of conditions) {
        if (!evaluateCondition(condition, event)) {
          shouldExecute = false;
          break;
        }
      }

      if (shouldExecute) {
        await executeRule(deps, rule, event);
      }
    }
  } catch (error) {
    deps.log.error({ message: 'Error processing automation event', error: String(error) });
  }
}

async function processLeadStageChanged(deps: EventHandlerDeps, event: any, correlationId: string) {
  const { organizationId, data } = event;
  const leadId = data?.leadId;
  const pipelineId = data?.pipelineId;
  const toStageId = data?.toStageId;
  const userId = event.userId;

  if (!organizationId || !leadId || !pipelineId || !toStageId) {
    deps.log.warn({
      message: 'lead.stage.changed missing required fields',
      correlation_id: correlationId,
      event_id: event.id,
      organizationId: organizationId ?? null,
      leadId: leadId ?? null,
      pipelineId: pipelineId ?? null,
      toStageId: toStageId ?? null,
    });
    return;
  }

  const rules = await deps.pool.query(
    `SELECT * FROM automation_rules 
     WHERE is_active = true 
     AND trigger_type = $1 
     AND organization_id = $2`,
    [EventType.LEAD_STAGE_CHANGED, organizationId]
  );

  for (const rule of rules.rows) {
    const triggerConditions =
      typeof rule.trigger_conditions === 'string'
        ? JSON.parse(rule.trigger_conditions)
        : rule.trigger_conditions || {};
    if (triggerConditions.pipeline_id !== pipelineId || triggerConditions.to_stage_id !== toStageId) {
      continue;
    }

    const actions =
      typeof rule.actions === 'string' ? JSON.parse(rule.actions || '[]') : rule.actions || [];
    const createDealAction = actions.find((a: any) => a.type === 'create_deal');
    if (!createDealAction) continue;

    const existing = await deps.pool.query(
      `SELECT id FROM automation_executions 
       WHERE rule_id = $1 AND entity_type = 'lead' AND entity_id = $2`,
      [rule.id, leadId]
    );
    if (existing.rows.length > 0) {
      deps.automationSkippedTotal.inc();
      deps.log.info({
        message: 'lead.stage.changed skip (already executed)',
        correlation_id: correlationId,
        event_id: event.id,
        rule_id: rule.id,
        entity_type: 'lead',
        entity_id: leadId,
        status: 'skipped',
      });
      continue;
    }

    const crmServiceUrl = process.env.CRM_SERVICE_URL || 'http://crm-service:3002';
    const MAX_CRM_RETRIES = 3;
    let dealId: string | null = null;
    let status: 'success' | 'skipped' | 'failed' = 'success';

    let effectiveUserId = userId;
    if (!effectiveUserId) {
      const userRow = await deps.pool.query(
        'SELECT id FROM users WHERE organization_id = $1 LIMIT 1',
        [organizationId]
      );
      effectiveUserId = userRow.rows[0]?.id ?? '';
    }

    for (let attempt = 1; attempt <= MAX_CRM_RETRIES; attempt++) {
      try {
        const res = await fetch(`${crmServiceUrl}/api/crm/deals`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': effectiveUserId,
            'X-Organization-Id': organizationId,
            'X-Correlation-Id': correlationId,
          },
          body: JSON.stringify({
            leadId,
            pipelineId,
            contactId: data?.contactId,
            title: `Deal from lead ${leadId.slice(0, 8)}`,
          }),
        });

        if (res.status === 201) {
          const body = (await res.json()) as { id?: string };
          dealId = body.id ?? null;
          deps.dealCreatedTotal.inc();
          break;
        }
        if (res.status === 409) {
          status = 'skipped';
          deps.automationSkippedTotal.inc();
          break;
        }
        status = 'failed';
        deps.log.error({
          message: 'lead.stage.changed CRM returned non-success',
          correlation_id: correlationId,
          event_id: event.id,
          rule_id: rule.id,
          entity_id: leadId,
          status: 'failed',
          http_status: res.status,
          response: await res.text(),
          attempt,
        });
        if (attempt < MAX_CRM_RETRIES) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      } catch (err) {
        status = 'failed';
        deps.log.error({
          message: 'lead.stage.changed CRM call failed',
          correlation_id: correlationId,
          event_id: event.id,
          rule_id: rule.id,
          entity_id: leadId,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          attempt,
        });
        if (attempt < MAX_CRM_RETRIES) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
    }

    if (status === 'failed') {
      deps.automationFailedTotal.inc();
      try {
        await deps.rabbitmq.publishToDlq('lead.stage.changed.dlq', event);
        deps.automationDlqTotal.inc({ event_type: EventType.LEAD_STAGE_CHANGED });
        deps.log.warn({
          message: 'lead.stage.changed sent to DLQ after retries exceeded',
          correlation_id: correlationId,
          event_id: event.id,
          entity_type: 'lead',
          entity_id: leadId,
        });
      } catch (dlqErr) {
        deps.log.error({
          message: 'Failed to publish to DLQ',
          correlation_id: correlationId,
          event_id: event.id,
          error: dlqErr instanceof Error ? dlqErr.message : String(dlqErr),
        });
      }
    }

    try {
      await deps.pool.query(
        `INSERT INTO automation_executions 
         (rule_id, organization_id, trigger_event, status, entity_type, entity_id, deal_id, correlation_id, trigger_event_id, created_at)
         VALUES ($1, $2, $3, $4, 'lead', $5, $6, $7, $8, NOW())`,
        [rule.id, organizationId, event.type, status, leadId, dealId, correlationId, event.id ?? null]
      );
    } catch (insertErr: any) {
      if (insertErr?.code === '23505') {
        deps.automationSkippedTotal.inc();
        deps.log.info({
          message: 'lead.stage.changed execution already exists (unique), treat as success, ACK',
          correlation_id: correlationId,
          event_id: event.id,
          rule_id: rule.id,
          entity_type: 'lead',
          entity_id: leadId,
          status: 'skipped',
        });
        continue;
      }
      throw insertErr;
    }

    if (status === 'success') deps.automationProcessedTotal.inc();
    deps.log.info({
      message: 'lead.stage.changed processed',
      correlation_id: correlationId,
      event_id: event.id,
      rule_id: rule.id,
      entity_type: 'lead',
      entity_id: leadId,
      status,
      deal_id: dealId ?? undefined,
    });
  }
}

async function processSlaBreach(deps: EventHandlerDeps, event: any, correlationId: string) {
  const { organizationId, data } = event;
  const breachDate = data?.breachDate;
  const pipelineId = data?.pipelineId;
  const stageId = data?.stageId;
  const isLead = event.type === EventType.LEAD_SLA_BREACH;
  const entityId = isLead ? data?.leadId : data?.dealId;

  if (!organizationId || !breachDate || !pipelineId || !stageId || !entityId) {
    deps.log.warn({
      message: 'sla.breach missing required fields',
      correlation_id: correlationId,
      event_id: event.id,
      organizationId: organizationId ?? null,
      breachDate: breachDate ?? null,
      pipelineId: pipelineId ?? null,
      stageId: stageId ?? null,
      entity_id: entityId ?? null,
    });
    return;
  }

  const rules = await deps.pool.query(
    `SELECT * FROM automation_rules 
     WHERE is_active = true 
     AND trigger_type = $1 
     AND organization_id = $2`,
    [event.type, organizationId]
  );

  for (const rule of rules.rows) {
    const triggerConditions =
      typeof rule.trigger_conditions === 'string'
        ? JSON.parse(rule.trigger_conditions)
        : rule.trigger_conditions || {};
    if (triggerConditions.pipeline_id !== pipelineId || triggerConditions.stage_id !== stageId) {
      continue;
    }

    const actions =
      typeof rule.actions === 'string' ? JSON.parse(rule.actions || '[]') : rule.actions || [];
    for (const action of actions) {
      try {
        switch (action.type) {
          case 'move_to_stage':
            await moveToStage(deps, action, event);
            break;
          case 'notify_team':
            await notifyTeam(deps, action, event);
            break;
          case 'create_task':
            await createTask(deps, action, event);
            break;
        }
      } catch (err) {
        deps.log.error({
          message: 'sla.breach action failed',
          correlation_id: correlationId,
          event_id: event.id,
          rule_id: rule.id,
          action_type: action.type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const entityType = isLead ? 'lead' : 'deal';
    const dealId = isLead ? null : entityId;

    try {
      await deps.pool.query(
        `INSERT INTO automation_executions 
         (rule_id, organization_id, trigger_event, status, entity_type, entity_id, deal_id, correlation_id, trigger_event_id, breach_date, created_at)
         VALUES ($1, $2, $3, 'success', $4, $5, $6, $7, $8, $9::date, NOW())`,
        [rule.id, organizationId, event.type, entityType, entityId, dealId, correlationId, event.id ?? null, breachDate]
      );
      deps.automationSlaProcessedTotal.inc();
      deps.log.info({
        message: isLead ? 'lead.sla.breach processed' : 'deal.sla.breach processed',
        correlation_id: correlationId,
        event_id: event.id,
        rule_id: rule.id,
        entity_type: entityType,
        entity_id: entityId,
        breach_date: breachDate,
      });
    } catch (insertErr: any) {
      if (insertErr?.code === '23505') {
        deps.automationSlaSkippedTotal.inc();
        deps.log.info({
          message: 'sla.breach execution already exists (unique), skip, ACK',
          correlation_id: correlationId,
          event_id: event.id,
          rule_id: rule.id,
          entity_type: entityType,
          entity_id: entityId,
          breach_date: breachDate,
          status: 'skipped',
        });
        continue;
      }
      throw insertErr;
    }
  }
}

function evaluateCondition(condition: any, event: any): boolean {
  const { field, operator, value } = condition;
  const eventValue = event.data?.[field];

  switch (operator) {
    case 'eq':
      return eventValue === value;
    case 'ne':
      return eventValue !== value;
    case 'gt':
      return eventValue > value;
    case 'lt':
      return eventValue < value;
    case 'contains':
      return String(eventValue).includes(String(value));
    default:
      return false;
  }
}

/** Exported for use by time-based cron. */
export async function executeRule(deps: EventHandlerDeps, rule: any, event: any) {
  try {
    const actions = rule.actions || [];

    for (const action of actions) {
      switch (action.type) {
        case 'move_to_stage':
          await moveToStage(deps, action, event);
          break;
        case 'notify_team':
          await notifyTeam(deps, action, event);
          break;
        case 'create_task':
          await createTask(deps, action, event);
          break;
      }
    }

    await deps.pool.query(
      `INSERT INTO automation_executions (rule_id, client_id, deal_id, status, result)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        rule.id,
        event.data?.clientId || event.data?.contactId,
        event.data?.dealId,
        'success',
        JSON.stringify({ actions }),
      ]
    );

    const lastActionType = actions.length > 0 ? actions[actions.length - 1].type : 'executed';
    const automationEvent: AutomationRuleTriggeredEvent = {
      id: crypto.randomUUID(),
      type: EventType.AUTOMATION_RULE_TRIGGERED,
      timestamp: new Date(),
      organizationId: event.organizationId,
      userId: event.userId,
      data: {
        ruleId: rule.id,
        clientId: event.data?.clientId || event.data?.contactId,
        action: lastActionType,
      },
    };
    await deps.rabbitmq.publishEvent(automationEvent);
  } catch (error) {
    deps.log.error({ message: 'Error executing automation rule', error: String(error) });
  }
}

async function moveToStage(deps: EventHandlerDeps, action: any, event: any) {
  const dealId = event.data?.dealId;
  const organizationId = event.organizationId;
  if (dealId && organizationId && action.targetStageId) {
    const crmServiceUrl = process.env.CRM_SERVICE_URL || 'http://crm-service:3002';
    const userRow = await deps.pool.query(
      'SELECT id FROM users WHERE organization_id = $1 LIMIT 1',
      [organizationId]
    );
    const userId = event.userId || userRow.rows[0]?.id || '';
    await fetch(`${crmServiceUrl}/api/crm/deals/${dealId}/stage`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userId,
        'X-Organization-Id': organizationId,
      },
      body: JSON.stringify({
        stageId: action.targetStageId,
        reason: `Automated by rule: ${action.ruleName || 'N/A'}`,
        autoMoved: true,
      }),
    });
    return;
  }
  const pipelineServiceUrl = process.env.PIPELINE_SERVICE_URL || 'http://pipeline-service:3008';
  await fetch(
    `${pipelineServiceUrl}/api/pipeline/clients/${event.data?.clientId || event.data?.contactId}/stage`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stageId: action.targetStageId,
        dealId: event.data?.dealId,
        autoMoved: true,
        reason: `Automated by rule: ${action.ruleName || 'N/A'}`,
      }),
    }
  );
}

async function notifyTeam(deps: EventHandlerDeps, action: any, event: any) {
  const triggerEvent = {
    id: crypto.randomUUID(),
    type: EventType.TRIGGER_EXECUTED,
    timestamp: new Date(),
    organizationId: event.organizationId,
    userId: event.userId,
    data: {
      type: 'notification',
      ruleId: '',
      message: action.message || 'Automation rule triggered',
      userIds: action.userIds || [],
    },
  };
  await deps.rabbitmq.publishEvent(triggerEvent as Event);
}

async function createTask(deps: EventHandlerDeps, action: any, event: any) {
  deps.log.info({ message: 'Create task (TODO: integrate with task service)', action_type: action.type, event_id: event?.id });
}
