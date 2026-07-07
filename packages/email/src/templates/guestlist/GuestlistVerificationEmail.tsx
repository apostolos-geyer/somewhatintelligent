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

export interface GuestlistVerificationEmailProps {
  name?: string;
  url: string;
}

export function GuestlistVerificationEmail({ name, url }: GuestlistVerificationEmailProps) {
  return (
    <GuestlistEmailLayout
      title="Verify your identity"
      previewText="You signed up. Now prove you exist."
    >
      <Heading as="h1" style={HEADING_STYLE}>
        {name ? `${name}, verify yourself.` : "Verify yourself."}
      </Heading>

      <Text style={{ ...BODY_STYLE, color: COLOR_TEXT_SECONDARY, margin: "0 0 16px" }}>
        You just created an account on my identity provider. This is a <em>federated</em> system.
        One login, everything I build. You sign up once, here, and everywhere else already knows
        you. If you've ever used "Sign in with Google," you understand the concept. This is that,
        but mine.
      </Text>

      <Text style={{ ...BODY_STYLE, color: COLOR_TEXT_SECONDARY, margin: "0 0 16px" }}>
        I now need to verify you control this email address. Not <em>who you are</em>. Nobody can
        verify that. There is no inner you waiting behind the inbox. There is no self prior to the
        systems that recognize one. You are, at best, a set of claims other people have agreed to go
        along with. Strip those away and there is{" "}
        <strong style={{ color: COLOR_TEXT }}>nothing to authenticate</strong>.
      </Text>

      <Text style={{ ...BODY_STYLE, color: COLOR_TEXT_SECONDARY, margin: "0 0 24px" }}>
        But you opened this email, which means you own the inbox, which means you are whoever this
        system says you are. That's the <em>entire ontology</em> here. Click the button.
      </Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Button href={url} style={CTA_BUTTON_STYLE}>
          Verify Identity
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
        This link expires in <strong style={{ color: COLOR_TEXT_SECONDARY }}>24 hours</strong>. If
        you didn't sign up, do nothing. The request dies on its own.
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

export default GuestlistVerificationEmail;
