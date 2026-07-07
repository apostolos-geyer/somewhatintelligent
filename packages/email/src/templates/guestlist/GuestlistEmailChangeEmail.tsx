import { Button, Heading, Text, Section } from "@react-email/components";
import { GuestlistEmailLayout } from "./GuestlistEmailLayout";
import {
  COLOR_TEXT,
  COLOR_TEXT_SECONDARY,
  COLOR_TEXT_TERTIARY,
  COLOR_INK,
  FONT_MONO,
  CTA_BUTTON_STYLE,
  HEADING_STYLE,
  BODY_STYLE,
} from "./constants";

export interface GuestlistEmailChangeEmailProps {
  name?: string;
  oldEmail: string;
  newEmail: string;
  url: string;
}

export function GuestlistEmailChangeEmail({
  name,
  oldEmail,
  newEmail,
  url,
}: GuestlistEmailChangeEmailProps) {
  return (
    <GuestlistEmailLayout
      title="Confirm email change"
      previewText="Your identity is changing addresses."
    >
      <Heading as="h1" style={HEADING_STYLE}>
        Email change requested.
      </Heading>

      <Text style={{ ...BODY_STYLE, color: COLOR_TEXT_SECONDARY, margin: "0 0 16px" }}>
        {name ? `${name}, someone` : "Someone"} asked to change the email on this account. Since
        this is your <strong style={{ color: COLOR_TEXT }}>identity provider</strong>, every service
        that trusts it will see the new address.
      </Text>

      <Text
        style={{
          fontSize: "13px",
          lineHeight: "22px",
          fontFamily: FONT_MONO,
          color: COLOR_TEXT_TERTIARY,
          margin: "0 0 4px",
        }}
      >
        <span style={{ color: COLOR_TEXT_SECONDARY }}>from:</span> {oldEmail}
      </Text>
      <Text
        style={{
          fontSize: "13px",
          lineHeight: "22px",
          fontFamily: FONT_MONO,
          color: COLOR_TEXT_TERTIARY,
          margin: "0 0 24px",
        }}
      >
        <span style={{ color: COLOR_TEXT_SECONDARY }}>to:</span>{" "}
        <span style={{ color: COLOR_INK }}>{newEmail}</span>
      </Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Button href={url} style={CTA_BUTTON_STYLE}>
          Confirm Change
        </Button>
      </Section>

      <Text
        style={{ fontSize: "13px", lineHeight: "22px", color: COLOR_TEXT_TERTIARY, margin: "0" }}
      >
        If you didn't request this, ignore this email. It'll sort itself out.
      </Text>
    </GuestlistEmailLayout>
  );
}

export default GuestlistEmailChangeEmail;
