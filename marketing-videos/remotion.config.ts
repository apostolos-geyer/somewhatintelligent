import { Config } from "@remotion/cli/config";

// H.264 MP4 at high quality — good default for social + web embeds.
Config.setVideoImageFormat("jpeg");
Config.setCodec("h264");
Config.setCrf(18);
Config.overrideWebpackConfig((config) => config);
