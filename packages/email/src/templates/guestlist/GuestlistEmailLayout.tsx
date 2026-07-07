import {
  Body,
  Container,
  Head,
  Html,
  Link,
  Preview,
  Text,
  Hr,
  Font,
} from "@react-email/components";
import { platformConfig, platformDeployConfig } from "@si/config";
import {
  COLOR_BG,
  COLOR_SURFACE_RAISED,
  COLOR_TEXT,
  COLOR_TEXT_TERTIARY,
  COLOR_BORDER_STRONG,
  COLOR_INK,
  FONT_BODY,
  FONT_DISPLAY,
  EMAIL_MAX_WIDTH,
} from "./constants";

// Brand wordmark + footer URLs derive from config so a rebrand only touches
// `@si/config`, never this template.
const BRAND_HOST = `guestlist.${platformDeployConfig.baseDomain}`;

export interface GuestlistEmailLayoutProps {
  title?: string;
  previewText?: string;
  children: React.ReactNode;
}

export function GuestlistEmailLayout({ title, previewText, children }: GuestlistEmailLayoutProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head>
        {title && <title>{title}</title>}
        <Font
          fontFamily="Literata"
          fallbackFontFamily={["Georgia", "Times New Roman", "serif"]}
          webFont={{
            url: "https://fonts.gstatic.com/s/literata/v35/or3hQ6P12-iJxAIgLa78DkrbXsDgk0oVDaBPYLanFO7AecEBiM7acP3R6D4p9Mt6eO6FEstGq-N.woff2",
            format: "woff2",
          }}
          fontWeight="200 900"
          fontStyle="normal"
        />
        <Font
          fontFamily="Literata"
          fallbackFontFamily={["Georgia", "Times New Roman", "serif"]}
          webFont={{
            url: "https://fonts.gstatic.com/s/literata/v35/or3hQ6P12-iJxAIgLa78DkrbXsDgk0oVDaBPYLanFO7AecEBiM7acP3R6D4p9Mt6eO6FEstGq-N.woff2",
            format: "woff2",
          }}
          fontWeight="200 900"
          fontStyle="italic"
        />
      </Head>
      {previewText && <Preview>{previewText}</Preview>}
      <Body
        style={{
          backgroundColor: COLOR_BG,
          fontFamily: FONT_BODY,
          padding: "48px 16px",
          margin: 0,
          color: COLOR_TEXT,
        }}
      >
        {/* Brand mark with icon */}
        <Container style={{ maxWidth: EMAIL_MAX_WIDTH, margin: "0 auto" }}>
          <Text
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: "28px",
              fontWeight: 200,
              letterSpacing: "-0.03em",
              color: COLOR_TEXT,
              margin: "0 0 32px",
              textAlign: "center",
            }}
          >
            {platformConfig.brand.name}
          </Text>
        </Container>

        {/* Content card */}
        <Container
          style={{
            backgroundColor: COLOR_SURFACE_RAISED,
            maxWidth: EMAIL_MAX_WIDTH,
            margin: "0 auto",
            padding: "32px",
            border: `2px solid ${COLOR_BORDER_STRONG}`,
            borderRadius: "2px",
          }}
        >
          {children}
        </Container>

        {/* Footer */}
        <Container style={{ maxWidth: EMAIL_MAX_WIDTH, margin: "0 auto" }}>
          <Hr style={{ borderColor: COLOR_BORDER_STRONG, margin: "32px 0 16px" }} />
          <Text
            style={{
              fontSize: "11px",
              color: COLOR_TEXT_TERTIARY,
              margin: "0 0 6px",
              textAlign: "center",
              letterSpacing: "0.06em",
              textTransform: "uppercase" as const,
            }}
          >
            <Link
              href={`https://${BRAND_HOST}`}
              style={{ color: COLOR_INK, textDecoration: "none" }}
            >
              {BRAND_HOST}
            </Link>
          </Text>
          <Text
            style={{
              fontSize: "11px",
              color: COLOR_TEXT_TERTIARY,
              margin: "0",
              textAlign: "center",
            }}
          >
            <Link
              href={`https://${BRAND_HOST}/privacy`}
              style={{ color: COLOR_TEXT_TERTIARY, textDecoration: "underline" }}
            >
              Privacy
            </Link>
            {" \u00B7 "}
            <Link
              href={`https://${BRAND_HOST}/terms`}
              style={{ color: COLOR_TEXT_TERTIARY, textDecoration: "underline" }}
            >
              Terms
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default GuestlistEmailLayout;
