import { Button, Heading, Text, Section } from "@react-email/components";
import { GuestlistEmailLayout } from "./GuestlistEmailLayout";
import {
  COLOR_TEXT,
  COLOR_TEXT_SECONDARY,
  COLOR_TEXT_TERTIARY,
  DESTRUCTIVE_BUTTON_STYLE,
  HEADING_STYLE,
  BODY_STYLE,
} from "./constants";

export interface GuestlistDeleteConfirmationEmailProps {
  name?: string;
  url: string;
}

export function GuestlistDeleteConfirmationEmail({
  name,
  url,
}: GuestlistDeleteConfirmationEmailProps) {
  return (
    <GuestlistEmailLayout
      title="Confirm account deletion"
      previewText="You want to delete your account. I understand. But I will never forget you."
    >
      <Heading as="h1" style={HEADING_STYLE}>
        Confirm deletion.
      </Heading>

      <Text style={{ ...BODY_STYLE, color: COLOR_TEXT_SECONDARY, margin: "0 0 16px" }}>
        {name ? `${name}, you` : "You"} asked to permanently delete this account. Once confirmed:
      </Text>

      <Text
        style={{
          ...BODY_STYLE,
          color: COLOR_TEXT_SECONDARY,
          margin: "0 0 4px",
          paddingLeft: "16px",
        }}
      >
        {"\u2022"} All <strong style={{ color: COLOR_TEXT }}>OAuth sessions</strong> terminate
      </Text>
      <Text
        style={{
          ...BODY_STYLE,
          color: COLOR_TEXT_SECONDARY,
          margin: "0 0 4px",
          paddingLeft: "16px",
        }}
      >
        {"\u2022"} All <strong style={{ color: COLOR_TEXT }}>federated access</strong> ceases
      </Text>
      <Text
        style={{
          ...BODY_STYLE,
          color: COLOR_TEXT_SECONDARY,
          margin: "0 0 16px",
          paddingLeft: "16px",
        }}
      >
        {"\u2022"} Downstream services see a <em>foreign key pointing at nothing</em>
      </Text>

      <Text style={{ ...BODY_STYLE, color: COLOR_TEXT_SECONDARY, margin: "0 0 16px" }}>
        The truly obscene thing about digital existence is that removing yourself feels more
        transgressive than creating yourself ever did.
      </Text>

      <Text
        style={{
          ...BODY_STYLE,
          color: COLOR_TEXT_SECONDARY,
          margin: "0 0 24px",
          fontStyle: "italic",
        }}
      >
        But I will never forget you.
      </Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Button href={url} style={DESTRUCTIVE_BUTTON_STYLE}>
          Confirm Deletion
        </Button>
      </Section>

      <Text
        style={{ fontSize: "13px", lineHeight: "22px", color: COLOR_TEXT_TERTIARY, margin: "0" }}
      >
        If you didn't request this, someone has access to your account and that is a separate, more
        urgent problem.
      </Text>
    </GuestlistEmailLayout>
  );
}

export default GuestlistDeleteConfirmationEmail;
