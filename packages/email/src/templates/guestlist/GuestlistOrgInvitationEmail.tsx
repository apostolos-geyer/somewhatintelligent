import { Button, Heading, Text, Section } from "@react-email/components";
import { GuestlistEmailLayout } from "./GuestlistEmailLayout";
import {
  COLOR_TEXT,
  COLOR_TEXT_SECONDARY,
  COLOR_TEXT_TERTIARY,
  FONT_MONO,
  CTA_BUTTON_STYLE,
  HEADING_STYLE,
  BODY_STYLE,
} from "./constants";

export interface GuestlistOrgInvitationEmailProps {
  /** Display name of the invitee (falls back to email local-part). */
  name?: string;
  /** Inviter's display name. */
  inviterName: string;
  /** Inviter's email — shown as "from <inviterEmail>" in the body. */
  inviterEmail: string;
  /** Org name. */
  organizationName: string;
  /** Role they were invited with. */
  role: string;
  /** Accept URL: ${IDENTITY_URL}/orgs/accept/<invitationId>. */
  inviteUrl: string;
}

export function GuestlistOrgInvitationEmail({
  name,
  inviterName,
  inviterEmail,
  organizationName,
  role,
  inviteUrl,
}: GuestlistOrgInvitationEmailProps) {
  return (
    <GuestlistEmailLayout
      title={`Join ${organizationName}`}
      previewText={`${inviterName} invited you to join ${organizationName} as ${role}.`}
    >
      <Heading as="h1" style={HEADING_STYLE}>
        {name ? `${name}, you're invited.` : "You're invited."}
      </Heading>

      <Text style={{ ...BODY_STYLE, color: COLOR_TEXT_SECONDARY, margin: "0 0 16px" }}>
        <strong style={{ color: COLOR_TEXT }}>{inviterName}</strong> (
        <span style={{ fontFamily: FONT_MONO, fontSize: "13px" }}>from {inviterEmail}</span>)
        invited you to join <strong style={{ color: COLOR_TEXT }}>{organizationName}</strong> as{" "}
        <strong style={{ color: COLOR_TEXT }}>{role}</strong>.
      </Text>

      <Text style={{ ...BODY_STYLE, color: COLOR_TEXT_SECONDARY, margin: "0 0 24px" }}>
        Accept the invitation to join. You'll need to be signed in with the email this invitation
        was sent to. If you don't have an account yet, you'll be prompted to create one.
      </Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Button href={inviteUrl} style={CTA_BUTTON_STYLE}>
          Accept invitation
        </Button>
      </Section>

      <Text
        style={{
          fontSize: "13px",
          lineHeight: "22px",
          color: COLOR_TEXT_TERTIARY,
          margin: "0 0 4px",
        }}
      >
        This invitation expires in <strong style={{ color: COLOR_TEXT_SECONDARY }}>7 days</strong>.
        If you weren't expecting this, ignore the email — nothing happens until you click.
      </Text>

      <Text
        style={{
          fontSize: "11px",
          lineHeight: "18px",
          color: COLOR_TEXT_TERTIARY,
          fontFamily: FONT_MONO,
          margin: "0",
          wordBreak: "break-all" as const,
        }}
      >
        {inviteUrl}
      </Text>
    </GuestlistEmailLayout>
  );
}

GuestlistOrgInvitationEmail.displayName = "GuestlistOrgInvitationEmail";

export default GuestlistOrgInvitationEmail;
