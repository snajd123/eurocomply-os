import { randomUUID } from 'crypto';
import type { HubDb } from '../db/connection.js';

export interface BillingProvider {
  createCustomer(name: string, email: string): Promise<string>;
  createSubscription(customerId: string, priceId: string): Promise<{ id: string; status: string }>;
  cancelSubscription(subscriptionId: string): Promise<void>;
}

interface ServiceResult<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface Subscription {
  subscription_id: string;
  org_id: string;
  spoke_id: string;
  stripe_subscription_id: string | null;
  plan: string;
  status: string;
}

export class BillingService {
  constructor(
    private db: HubDb,
    private provider: BillingProvider,
  ) {}

  async setupSubscription(input: {
    org_id: string;
    spoke_id: string;
    plan: string;
  }): Promise<ServiceResult<Subscription>> {
    // Get or create Stripe customer
    const orgResult = await this.db.query(
      `SELECT * FROM organizations WHERE org_id = $1`,
      [input.org_id],
    );
    if (orgResult.rows.length === 0) {
      return { success: false, data: null as any, error: 'Organization not found' };
    }
    const org = orgResult.rows[0];

    let stripeCustomerId = org.stripe_customer_id;
    if (!stripeCustomerId) {
      stripeCustomerId = await this.provider.createCustomer(org.name, org.email);
      await this.db.query(
        `UPDATE organizations SET stripe_customer_id = $1, updated_at = now() WHERE org_id = $2`,
        [stripeCustomerId, input.org_id],
      );
    }

    // Create Stripe subscription
    const priceId = `price_${input.plan}`;
    const stripeSub = await this.provider.createSubscription(stripeCustomerId, priceId);

    // Record in database
    const subscriptionId = `sub-${randomUUID().slice(0, 8)}`;
    await this.db.query(
      `INSERT INTO subscriptions (subscription_id, org_id, spoke_id, stripe_subscription_id, plan, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [subscriptionId, input.org_id, input.spoke_id, stripeSub.id, input.plan, stripeSub.status],
    );

    return {
      success: true,
      data: {
        subscription_id: subscriptionId,
        org_id: input.org_id,
        spoke_id: input.spoke_id,
        stripe_subscription_id: stripeSub.id,
        plan: input.plan,
        status: stripeSub.status,
      },
    };
  }

  async cancelSubscription(subscriptionId: string): Promise<ServiceResult<void>> {
    const result = await this.db.query(
      `SELECT * FROM subscriptions WHERE subscription_id = $1`,
      [subscriptionId],
    );
    if (result.rows.length === 0) {
      return { success: false, data: undefined as any, error: 'Subscription not found' };
    }

    const sub = result.rows[0];
    if (sub.stripe_subscription_id) {
      await this.provider.cancelSubscription(sub.stripe_subscription_id);
    }

    await this.db.query(
      `UPDATE subscriptions SET status = 'cancelled', updated_at = now() WHERE subscription_id = $1`,
      [subscriptionId],
    );
    return { success: true, data: undefined as any };
  }

  async handleWebhookEvent(event: { type: string; subscription_id: string }): Promise<ServiceResult<void>> {
    // Find internal subscription by stripe ID
    const result = await this.db.query(
      `SELECT * FROM subscriptions WHERE stripe_subscription_id = $1`,
      [event.subscription_id],
    );
    if (result.rows.length === 0) {
      return { success: false, data: undefined as any, error: 'Subscription not found for webhook' };
    }
    const sub = result.rows[0];

    if (event.type === 'payment_failed') {
      await this.db.query(
        `UPDATE subscriptions SET status = 'past_due', updated_at = now() WHERE subscription_id = $1`,
        [sub.subscription_id],
      );
      await this.db.query(
        `UPDATE spokes SET status = 'suspended', updated_at = now() WHERE spoke_id = $1`,
        [sub.spoke_id],
      );
    } else if (event.type === 'payment_succeeded') {
      await this.db.query(
        `UPDATE subscriptions SET status = 'active', updated_at = now() WHERE subscription_id = $1`,
        [sub.subscription_id],
      );
      await this.db.query(
        `UPDATE spokes SET status = 'active', updated_at = now() WHERE spoke_id = $1`,
        [sub.spoke_id],
      );
    } else if (event.type === 'subscription_cancelled') {
      await this.db.query(
        `UPDATE subscriptions SET status = 'cancelled', updated_at = now() WHERE subscription_id = $1`,
        [sub.subscription_id],
      );
    }

    return { success: true, data: undefined as any };
  }
}
