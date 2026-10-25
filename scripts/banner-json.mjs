// Print every motif's template-ready banner (as sent in sermon_banner_svg) as
// JSON, for test/php/banner-kses-check.php:
//   WP_CORE=/path/to/wordpress npm run test:php
import { MOTIFS, buildBannerSvg, siteBannerSvg } from "../server/banner.js";

const out = {};
for (const m of MOTIFS) out[m] = siteBannerSvg(buildBannerSvg(m), "check");
process.stdout.write(JSON.stringify(out));
