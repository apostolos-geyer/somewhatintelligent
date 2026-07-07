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

export interface GuestlistResetPasswordEmailProps {
  name?: string;
  url: string;
}

export function GuestlistResetPasswordEmail({ name, url }: GuestlistResetPasswordEmailProps) {
  return (
    <GuestlistEmailLayout
      title="Reset your password"
      previewText="You forgot your password. It happens to the best of us. And to you."
    >
      <Heading as="h1" style={HEADING_STYLE}>
        Password reset.
      </Heading>

      <Text style={{ ...BODY_STYLE, color: COLOR_TEXT_SECONDARY, margin: "0 0 16px" }}>
        {name ? `${name}, someone` : "Someone"} requested a password reset for this account. I'm not
        going to speculate about whether you <em>forgot</em> it or just decided you didn't like it
        anymore.
      </Text>

      <Text style={{ ...BODY_STYLE, color: COLOR_TEXT_SECONDARY, margin: "0 0 24px" }}>
        This is your <strong style={{ color: COLOR_TEXT }}>identity provider</strong> password, so
        it's the one that matters. Everything else flows from here.
      </Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Button href={url} style={CTA_BUTTON_STYLE}>
          Reset Password
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
        This link expires in <strong style={{ color: COLOR_TEXT_SECONDARY }}>one hour</strong>.
        After that you'll have to do this whole thing again.
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

export default GuestlistResetPasswordEmail;
