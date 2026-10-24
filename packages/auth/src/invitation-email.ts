import {
  describeEmailDeliveryError,
  type EmailService,
  renderInvitationEmail,
  renderInvitationRevokedEmail,
} from "@openvalens/email";
import { localeForInvitee, type MessageLocales } from "@openvalens/i18n/server";
import { createStructuredLogger, type StructuredLogger } from "@openvalens/observability";

import { maskEmailRecipient } from "./auth-logging";

/** Two-day workspace invitation window, shared by Better Auth and the sharing router. */
export const INVITATION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 2;

/**
 * Outcome of one workspace-invitation email:
 * - `sent`: handed to the provider.
 * - `unavailable`: email is a dry run on this server (no Resend key or
 *   `EMAIL_DRY_RUN` on), so nothing left the server.
 * - `failed`: the provider rejected or errored; logged value-free.
 */
export type InvitationEmailDelivery = "sent" | "unavailable" | "failed";

export type InvitationEmailInviter = {
  id: string;
  name: string | null | undefined;
  email: string;
};

export type WorkspaceInvitationEmailInput = {
  recipient: string;
  invitationId: string;
  role: string;
  organizationName: string;
  inviter: InvitationEmailInviter;
};

export type WorkspaceInvitationRevokedEmailInput = {
  recipient: string;
  invitationId: string;
  organizationName: string;
  /** The owner who revoked it; their language is the fallback. */
  revokedBy: InvitationEmailInviter;
};

/**
 * Issue #243 — the one place workspace-invitation email is composed and sent.
 * Better Auth's `sendInvitationEmail` and the sharing router both use it, so an
 * invitation reads the same whichever path created it: rendered in the
 * invitee's saved language (else the inviter's, #231), linking to the web
 * `/accept-invitation/$id` page. Never throws; recipients are masked in logs.
 */
export type WorkspaceInvitationEmails = {
  sendInvitation(input: WorkspaceInvitationEmailInput): Promise<InvitationEmailDelivery>;
  sendRevoked(input: WorkspaceInvitationRevokedEmailInput): Promise<InvitationEmailDelivery>;
};

export function createWorkspaceInvitationEmails(deps: {
  email: Pick<EmailService, "sendEmail" | "organizationName">;
  locales: MessageLocales;
  /** The web app origin (`CORS_ORIGIN`); a trailing slash is ignored. */
  webOrigin: string;
  logger?: StructuredLogger;
}): WorkspaceInvitationEmails {
  const { email, locales } = deps;
  const webOrigin = deps.webOrigin.replace(/\/+$/, "");
  const logger = deps.logger ?? createStructuredLogger({ level: "info" });

  async function deliver(
    message: { to: string; subject: string; html: string; text: string; template: string },
    invitationId: string,
  ): Promise<InvitationEmailDelivery> {
    try {
      const result = await email.sendEmail(
        {
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          templateName: message.template,
          tags: [message.template],
        },
        { correlationId: undefined },
      );
      if (result.dryRun) {
        logger.info(`auth.${message.template}.dry-run`, {
          recipient: maskEmailRecipient(message.to),
          invitationId,
        });
        return "unavailable";
      }
    } catch (error) {
      // Issue #61 — categorized and value-free; `code` keeps its name.
      const { errorCode, errorCategory, retryable } = describeEmailDeliveryError(error);
      logger.error(`auth.${message.template}.send.failed`, {
        recipient: maskEmailRecipient(message.to),
        invitationId,
        code: errorCode,
        errorCategory,
        retryable,
      });
      return "failed";
    }
    logger.info(`auth.${message.template}.queued`, {
      recipient: maskEmailRecipient(message.to),
      invitationId,
    });
    return "sent";
  }

  return {
    async sendInvitation(input) {
      let rendered;
      try {
        const locale = await localeForInvitee(locales, input.recipient, input.inviter.id);
        rendered = renderInvitationEmail(
          {
            inviterName: input.inviter.name || input.inviter.email,
            organizationName: input.organizationName,
            acceptUrl: `${webOrigin}/accept-invitation/${encodeURIComponent(input.invitationId)}`,
            expiresInDays: Math.round(INVITATION_EXPIRES_IN_SECONDS / (60 * 60 * 24)),
            role: input.role,
          },
          { organizationName: email.organizationName, locale },
        );
      } catch {
        logger.error("auth.invitation.render.failed", { invitationId: input.invitationId });
        return "failed";
      }
      return deliver(
        { to: input.recipient, template: "invitation", ...rendered },
        input.invitationId,
      );
    },

    async sendRevoked(input) {
      let rendered;
      try {
        const locale = await localeForInvitee(locales, input.recipient, input.revokedBy.id);
        rendered = renderInvitationRevokedEmail(
          {
            inviterName: input.revokedBy.name || input.revokedBy.email,
            organizationName: input.organizationName,
          },
          { organizationName: email.organizationName, locale },
        );
      } catch {
        logger.error("auth.invitation-revoked.render.failed", { invitationId: input.invitationId });
        return "failed";
      }
      return deliver(
        { to: input.recipient, template: "invitation-revoked", ...rendered },
        input.invitationId,
      );
    },
  };
}
