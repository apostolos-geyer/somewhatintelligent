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

export interface GuestlistMagicLinkEmailProps {
  name?: string;
  url: string;
}

export function GuestlistMagicLinkEmail({ name, url }: GuestlistMagicLinkEmailProps) {
  return (
    <GuestlistEmailLayout
      title="Your sign-in link"
      previewText="No password. Just a link. Click and you're in."
    >
      <Heading as="h1" style={HEADING_STYLE}>
        {name ? `${name}, here's your link.` : "Here's your link."}
      </Heading>

      <Text style={{ ...BODY_STYLE, color: COLOR_TEXT_SECONDARY, margin: "0 0 16px" }}>
        You asked to sign in without a password. The link below proves you control this inbox, which
        is the only thing the system was ever really checking. Passwords were a detour; this is the
        same fact, stated more honestly.
      </Text>

      <Text style={{ ...BODY_STYLE, color: COLOR_TEXT_SECONDARY, margin: "0 0 24px" }}>
        One click. <strong style={{ color: COLOR_TEXT }}>One use.</strong> Then it's gone.
      </Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Button href={url} style={CTA_BUTTON_STYLE}>
          Sign In
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
        Valid for <strong style={{ color: COLOR_TEXT_SECONDARY }}>5 minutes</strong>. If you didn't
        ask for this, ignore it. The link expires on its own and proves nothing about anyone who
        didn't click it.
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
        {url}
      </Text>
    </GuestlistEmailLayout>
  );
}

export default GuestlistMagicLinkEmail;
