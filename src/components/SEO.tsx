import { Helmet } from "react-helmet-async";

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  ogImage?: string;
  ogType?: string;
  canonical?: string;
  noIndex?: boolean;
}

const defaultTitle = "SALCI - Empowering Learning Beyond Marks";
const defaultDescription =
  "SALCI is a complete academic intelligence ecosystem for schools, combining fair AI-assisted evaluation, teacher control, and actionable insights.";
// Absolute URL required — WhatsApp/Facebook/Twitter fetch og:image server-side
// and don't resolve relative paths. Canonical brand domain serves both fronts.
const defaultOGImage = "https://app.salci.ai/Logo.png";

export function SEO({
  title,
  description = defaultDescription,
  keywords,
  ogImage = defaultOGImage,
  ogType = "website",
  canonical,
  noIndex = false,
}: SEOProps) {
  const fullTitle = title ? `${title} | SALCI` : defaultTitle;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {keywords && <meta name="keywords" content={keywords} />}

      {/* Open Graph */}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={ogType} />
      <meta property="og:image" content={ogImage} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />

      {/* Canonical URL */}
      {canonical && <link rel="canonical" href={canonical} />}

      {/* Robots */}
      {noIndex && <meta name="robots" content="noindex, nofollow" />}
    </Helmet>
  );
}
